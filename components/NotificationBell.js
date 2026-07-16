// 🔔 알림 센터 — 헤더 종+배지+드롭다운 패널. 1차(step348) 교사·관리자, 2차(step358) 학생까지 개방.
// 로그인 사용자 전원이 수신자. 조회·읽음 처리 모두 recipient_id 기준이라 role 무관하게 동작.
// 60초 폴링(document.hidden 스킵 + 복귀 시 즉시 갱신), 바깥클릭 닫기, 최근 20건 로드.
// 원 기능과 무관한 부가 UI — 실패는 조용히 warn만.
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { toKST } from '../lib/timeFormat'

// 알림 종류별 아이콘(이모지)·색 원. Tabler 웹폰트 미사용이라 이모지로 구분.
const TYPE_META = {
  briefing:        { emoji: '📊', bg: 'bg-blue-100' },
  report:          { emoji: '⚠️', bg: 'bg-red-100' },
  admin_reply:     { emoji: '💬', bg: 'bg-gray-100' },
  stamp:           { emoji: '⭐', bg: 'bg-amber-100' },
  teacher_comment: { emoji: '📝', bg: 'bg-green-100' },
  grammar_done:    { emoji: '✅', bg: 'bg-green-100' },
  rewrite_allowed: { emoji: '✏️', bg: 'bg-purple-100' },   // step515: 추가 수정 허용(학생 수신)
  showcase_report: { emoji: '🚨', bg: 'bg-red-100' },      // step518: 챌린지 소개 글 신고(관리자 수신)
}
const DEFAULT_META = { emoji: '🔔', bg: 'bg-gray-100' }

export default function NotificationBell({ user }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)
  const fetchingRef = useRef(false)

  const isRecipient = !!user && (user.role === 'teacher' || user.role === 'admin' || user.role === 'student')

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
          .is('dismissed_at', null)
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
        .is('dismissed_at', null)
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

  // 개별 지우기 (소프트 삭제): 항목 클릭(이동)과 분리, 실패해도 UI 안 깨지게 비차단
  const dismiss = async (e, n) => {
    e.stopPropagation()
    const wasUnread = !n.read_at
    setItems((prev) => prev.filter((x) => x.id !== n.id))
    if (wasUnread) setUnread((u) => Math.max(0, u - 1))
    try {
      await supabase.from('notifications')
        .update({ dismissed_at: new Date().toISOString() }).eq('id', n.id)
    } catch (err) {
      console.warn('알림 지우기 실패:', err?.message)
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
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="text-xs text-primary hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-default"
            >
              모두 읽음
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">불러오는 중…</div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">새 소식이 없어요</div>
            ) : (
              items.map((n) => {
                const meta = TYPE_META[n.type] || DEFAULT_META
                return (
                  <div key={n.id} className="relative border-b border-gray-100 last:border-0">
                    <button
                      onClick={() => onItemClick(n)}
                      className={`w-full text-left flex gap-3 px-4 py-3.5 pr-9 hover:bg-gray-50 transition ${n.read_at ? '' : 'bg-blue-50'}`}
                    >
                      <span className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base ${meta.bg}`}>
                        {meta.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm ${n.read_at ? 'text-gray-600' : 'font-bold text-gray-900'}`}>
                          {n.title}
                        </div>
                        {n.type === 'briefing' && n.body && n.body.includes('\n') ? (() => {
                          const i = n.body.indexOf('\n')
                          const intro = n.body.slice(0, i)
                          const quote = n.body.slice(i + 1)
                          return (
                            <>
                              {intro && <div className="text-xs text-gray-500 mt-1 leading-relaxed">{intro}</div>}
                              {quote && <div className="mt-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs text-gray-800 leading-relaxed">{quote}</div>}
                            </>
                          )
                        })() : (
                          n.body && <div className="text-xs text-gray-500 mt-1 leading-relaxed whitespace-pre-line">{n.body}</div>
                        )}
                        <div className="text-[11px] text-gray-400 mt-1.5">{toKST(n.created_at)}</div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => dismiss(e, n)}
                      aria-label="알림 지우기"
                      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-600 hover:bg-gray-200 transition"
                    >
                      ✕
                    </button>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
