// ✉️ 쪽지 아이콘 — 헤더 알림 종 옆, 교사 전용(admin 제외). step422.
// 안읽음(관리자발 미열람) 배지 + 60초 폴링(NotificationBell 패턴), 클릭 시 /teacher/messages.
// 임퍼소네이션 중엔 숨김(쪽지는 본인 세션 전용).
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { isImpersonatingNow } from '../lib/impersonation'

export default function MessageBell({ user }) {
  const router = useRouter()
  const [unread, setUnread] = useState(0)
  const fetchingRef = useRef(false)

  const isTeacher = !!user && user.role === 'teacher'
  const hidden = !isTeacher || isImpersonatingNow()

  // 안읽음 수 조회 (마운트 1회 + 60초 폴링 + 탭 복귀 시) — NotificationBell과 동일 패턴
  useEffect(() => {
    if (hidden) return
    let alive = true

    const loadUnread = async () => {
      if (fetchingRef.current) return
      fetchingRef.current = true
      try {
        const { count, error } = await supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('teacher_id', user.id)
          .neq('sender_id', user.id)
          .is('read_at', null)
        if (!error && alive) setUnread(count || 0)
      } catch (e) {
        console.warn('쪽지 개수 조회 실패:', e?.message)
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
  }, [hidden, user?.id])

  if (hidden) return null

  return (
    <button
      onClick={() => router.push('/teacher/messages')}
      className="relative text-xl px-2 py-1 rounded-full hover:bg-gray-100 transition"
      aria-label="쪽지"
    >
      ✉️
      {unread > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}
