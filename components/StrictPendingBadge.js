// ⏳ step601: 맞춤법 보완 대기 배지 + 폴링 (표시·폴링만 — 채점·저장 로직 없음)
// 첫 글 채점이 피크(교사 60초 가드)로 전용 맞춤법 검사를 보류(strict_status='pending')한 글에 붙인다.
// Hobby 플랜(2분 크론 불가)이라 이 폴링이 서버 보완(/api/strict-backfill)의 트리거를 겸한다:
//   마운트 10초 뒤 첫 호출, 이후 30초 간격, 최대 10분(21회). 서버는 pending이고 가드가 비어 있을 때만 보완한다.
//   응답 status가 'done'이면 onUpdated(corrections, 'done')로 부모가 밑줄을 갱신하고 배지는 사라진다.
//   'skipped'면 onUpdated(null, 'skipped') → 배지만 사라진다(안내 없음). 실패·pending이면 다음 회차.
// 학생 대면 문구는 존댓말·쉬운 말. 내부 사정(모델·호출 횟수)은 노출하지 않는다.
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const FIRST_DELAY_MS = 10_000
const INTERVAL_MS = 30_000
const MAX_TRIES = 21   // 10초 + 30초 × 20 ≈ 10분

export default function StrictPendingBadge({ submissionId, status, onUpdated, className = '' }) {
  const onUpdatedRef = useRef(onUpdated)
  onUpdatedRef.current = onUpdated

  useEffect(() => {
    if (status !== 'pending' || !submissionId) return
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
          const res = await fetch('/api/strict-backfill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: token, submissionId }),
          })
          const data = await res.json().catch(() => null)
          if (!stopped && res.ok && data && data.status && data.status !== 'pending') {
            onUpdatedRef.current?.(Array.isArray(data.corrections) ? data.corrections : null, data.status)
            return
          }
        }
      } catch (_) { /* 네트워크 실패는 다음 회차 */ }
      if (!stopped && tries < MAX_TRIES) timer = setTimeout(poll, INTERVAL_MS)
    }

    timer = setTimeout(poll, FIRST_DELAY_MS)
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [submissionId, status])

  if (status !== 'pending') return null
  return (
    <div className={`bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 flex items-start gap-2 ${className}`}>
      <span>⏳</span>
      <span>맞춤법을 꼼꼼히 다시 보고 있어요. 잠시 뒤 밑줄이 더 추가될 수 있어요.</span>
    </div>
  )
}
