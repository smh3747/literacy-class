// ✉️ 쪽지 아이콘 — 헤더 알림 종 옆, 교사·관리자용(학생 제외). step422, step424에서 admin 지원.
// 교사: 관리자발 안읽음 배지 → /teacher/messages. 관리자: 교사발 안읽음 전체 배지 → /admin?tab=messages.
// 60초 폴링(NotificationBell 패턴). 임퍼소네이션 중엔 숨김(쪽지는 본인 세션 전용).
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import { isImpersonatingNow } from '../lib/impersonation'

export default function MessageBell({ user }) {
  const router = useRouter()
  const [unread, setUnread] = useState(0)
  const fetchingRef = useRef(false)

  const role = user?.role
  const hidden = !(role === 'teacher' || role === 'admin') || isImpersonatingNow()

  // 안읽음 수 조회 (마운트 1회 + 60초 폴링 + 탭 복귀 시) — NotificationBell과 동일 패턴
  useEffect(() => {
    if (hidden) return
    let alive = true

    const loadUnread = async () => {
      if (fetchingRef.current) return
      fetchingRef.current = true
      try {
        if (role === 'teacher') {
          // 교사: 내 스레드의 관리자발 안읽음
          const { count, error } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('teacher_id', user.id)
            .neq('sender_id', user.id)
            .is('read_at', null)
          if (!error && alive) setUnread(count || 0)
        } else {
          // 관리자: 교사발 안읽음 전체 — 컬럼끼리 비교(sender_id=teacher_id)는 .eq() 불가라
          // 안읽음만 select 후 클라 필터(행 수 소량, head 카운트 불가 감수)
          const { data, error } = await supabase
            .from('messages')
            .select('id, teacher_id, sender_id')
            .is('read_at', null)
            .limit(500)
          if (!error && alive) setUnread((data || []).filter(m => m.sender_id === m.teacher_id).length)
        }
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
      onClick={() => router.push(role === 'admin' ? '/admin?tab=messages' : '/teacher/messages')}
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
