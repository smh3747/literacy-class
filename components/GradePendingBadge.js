// ⏳ step671: 채점 보류 글 폴링 (표시·폴링만 — 채점·저장은 서버 /api/grade-backfill)
// 구글 혼잡으로 점수 없이 먼저 제출된 글(grade_status='pending')의 안내 카드 안에 붙인다.
// 이 폴링이 "접속 시 채점"의 트리거다: 마운트 20초 뒤 첫 호출, 이후 30초 간격, 최대 30회(약 15분).
//   서버는 그 글이 아직 pending이고, 다른 요청이 잡고 있지 않고, 학급 상한에 여유가 있을 때만 채점한다.
//   응답 status가 'pending'이 아니면(done·failed) onGraded()를 한 번 부르고 멈춘다. 부모가 화면을 새로 불러온다.
// StrictPendingBadge(step601)와 같은 구조. disabled=true(관리자 엿보기)면 폴링하지 않는다.
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { POLL_FIRST_MS, POLL_INTERVAL_MS, POLL_MAX_TRIES } from '../lib/gradeDefer'

export default function GradePendingBadge({ submissionId, onGraded, className = '', disabled = false }) {
  const onGradedRef = useRef(onGraded)
  onGradedRef.current = onGraded

  useEffect(() => {
    if (!submissionId || disabled) return
    let stopped = false
    let tries = 0
    let timer = null

    const poll = async () => {
      if (stopped) return
      tries++
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (token) {
          const res = await fetch('/api/grade-backfill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: token, submissionId }),
          })
          const data = await res.json().catch(() => null)
          if (!stopped && res.ok && data && data.status && data.status !== 'pending') {
            stopped = true
            onGradedRef.current?.(data.status)
            return
          }
        }
      } catch (_) { /* 네트워크 실패는 다음 회차 */ }
      if (!stopped && tries < POLL_MAX_TRIES) timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = setTimeout(poll, POLL_FIRST_MS)
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [submissionId, disabled])

  if (!submissionId) return null
  return (
    <div className={`mt-2 text-xs text-amber-800 flex items-start gap-1.5 ${className}`}>
      <span>⏳</span>
      <span>이 화면을 켜 두면 점수가 나오는 대로 보여 드려요.</span>
    </div>
  )
}
