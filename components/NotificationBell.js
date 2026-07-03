// 🔔 알림 센터 1차(step348) — 교사·관리자 전용 헤더 종+배지+드롭다운 패널.
// 학생 화면에도 Header가 공용으로 쓰이므로 role 게이팅으로 학생은 렌더 자체를 안 함.
// 60초 폴링(document.hidden 스킵 + 복귀 시 즉시 갱신), 바깥클릭 닫기, 최근 20건 로드.
// 원 기능과 무관한 부가 UI — 실패는 조용히 warn만.
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { toKST } from '../lib/timeFormat'

export default function NotificationBell({ user }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)
  const fetchingRef = useRef(false)

  const isRecipient = !!user && (user.role === 'teacher' || user.role === 'admin')

  // 안읽음 수 조회 (마운트 1회 + 60초 폴링 + 탭 복귀 시)
  useEffect(() => {
    if (!isRecipient) return
    let alive = true

    const loadUnread = async () => {
      if (fetchingRef.current) return
      fetchingRef.current = true
      try {
        const { count, error } = await supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_id', user.id)
          .is('read_at', null)
        if (!error && alive) setUnread(count || 0)
      } catch (e) {
        console.warn('알림 개수 조회 실패:', e?.message)
      } finally {
        fetchingRef.current = false
      }
    }

    loadUnread()
    const timer = setInterval(() => {
      if (document.hidden) return
      loadUnread()
    }, 60000)
    const onVisible = () => { if (!document.hidden) loadUnread() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isRecipient, user?.id])

  // 바깥클릭 닫기
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!isRecipient) return null

  // 패널 열 때 최근 20건 로드
  const loadItems = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, link, read_at, created_at')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (!error) setItems(data || [])
    } catch (e) {
      console.warn('알림 목록 조회 실패:', e?.message)
    }
    setLoading(false)
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) loadItems()
  }

  // 항목 클릭: 안읽음이면 읽음 처리 후 링크 이동
  const onItemClick = async (n) => {
    setOpen(false)
    if (!n.read_at) {
      try {
        const now = new Date().toISOString()
        await supabase.from('notifications').update({ read_at: now }).eq('id', n.id)
        setUnread((u) => Math.max(0, u - 1))
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)))
      } catch (e) {
        console.warn('읽음 처리 실패:', e?.message)
      }
    }
    if (n.link) router.push(n.link)
  }

  // 모두 읽음
  const markAllRead = async () => {
    try {
      const now = new Date().toISOString()
      await supabase.from('notifications').update({ read_at: now })
        .eq('recipient_id', user.id).is('read_at', null)
      setUnread(0)
      setItems((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: now })))
    } catch (e) {
      console.warn('모두 읽음 실패:', e?.message)
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={toggle}
        className="relative text-xl px-2 py-1 rounded-full hover:bg-gray-100 transition"
        aria-label="알림"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white rounded-2xl shadow-lg border border-gray-200 z-40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <span className="text-sm font-bold text-gray-800">🔔 알림</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                모두 읽음
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">불러오는 중…</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">새 소식이 없어요</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onItemClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition ${n.read_at ? '' : 'bg-blue-50/40'}`}
                >
                  <div className={`text-sm ${n.read_at ? 'text-gray-700' : 'font-bold text-gray-900'}`}>
                    {n.title}
                  </div>
                  {n.body && <div className="text-xs text-gray-500 mt-0.5">{n.body}</div>}
                  <div className="text-[11px] text-gray-400 mt-1">{toKST(n.created_at)}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
