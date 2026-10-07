// 관리자 오류 로그 원인 분류기 — step606에서 pages/admin/index.js 인라인 함수를 그대로 옮김(로직 불변).
//   표시 시점 분류(저장구조 불변). 순서 중요: prepayment를 429보다 먼저.
//   step586: context.upstream(서버가 동봉한 상류 실패 정보)도 판정 텍스트에 합침 —
//     "AI가 응답하지 않습니다..." 일반 메시지 뒤의 503/한도/타임아웃이 기존 라벨로 잡히게.
//   step606: 🟣 AI 안전 필터 라벨 추가 — 503·JSON 규칙보다 앞(PROHIBITED_CONTENT가 빈 응답→'JSON 파싱 실패'로
//     둔갑하던 경로를 서버가 전용 code로 바꿨고, 과거 로그의 SDK 실메시지 "blocked due to …"도 같이 잡는다).
//     글 내용 무관·담임에게 알림이 가므로 무시 가능.

export const classifyError = (msg, ctx) => {
  const up = ctx?.upstream
  const m = [msg, up?.message, up?.status, up?.timeout ? 'TIMEOUT' : '', up?.blockReason]
    .filter(v => v !== null && v !== undefined && v !== '').join(' ')
  if (/prepayment|credits are depleted|billing#prepay/i.test(m))
    return { color: 'bg-rose-100 text-rose-700', label: '🔴 유료키 소진', summary: '유료키 잔액 소진 · 무료키로 교체 필요' }
  if (/AI_SAFETY_BLOCKED|PROHIBITED_CONTENT|blocked due to|\bBLOCKLIST\b|\bSPII\b/i.test(m))
    return { color: 'bg-purple-100 text-purple-700', label: '🟣 AI 안전 필터', summary: 'AI 안전 필터 차단(글 내용 무관·담임 전달됨) · 무시 가능' }
  if (/503|high demand|overloaded|UNAVAILABLE/i.test(m))
    return { color: 'bg-yellow-100 text-yellow-700', label: '🟡 구글 혼잡', summary: '구글 AI 서버 혼잡 · 곧 풀림(조치 불필요)' }
  if (/429|per day|PerDay|quota|exceeded|RESOURCE_EXHAUSTED/i.test(m))
    return { color: 'bg-orange-100 text-orange-700', label: '🟠 한도 소진', summary: '무료 한도 소진 · 오후 리셋' }
  if (/401|인증 정보가 유효|UNAUTHENTICATED/i.test(m))
    return { color: 'bg-gray-100 text-gray-600', label: '⚪ 세션 만료', summary: '학생 세션 만료 · 다시 로그인하면 됨(정상)' }
  if (/Failed to fetch|NetworkError|Load failed/i.test(m))
    return { color: 'bg-gray-100 text-gray-600', label: '⚪ 네트워크', summary: '네트워크 일시 끊김 · 보통 일시적' }
  if (/504|파싱 실패|JSON|TIMEOUT/i.test(m))
    return { color: 'bg-yellow-100 text-yellow-700', label: '🟡 응답지연', summary: '응답 지연/파싱 실패 · 보통 일시적' }
  if (/MetaMask|Invariant|extension|ethereum/i.test(m))
    return { color: 'bg-gray-200 text-gray-500', label: '⚫ 확장노이즈', summary: '브라우저 확장 노이즈 · 무시 가능' }
  if (/Script error/i.test(m))
    return { color: 'bg-gray-100 text-gray-600', label: '⚪ 외부 스크립트', summary: '교차출처 스크립트 오류(내용 숨김) · 무시 가능' }
  return { color: 'bg-gray-100 text-gray-600', label: '⚪ 기타', summary: '기타' }
}

// 분류 라벨 → 심각도 (무시 가능 라벨만 명시, 그 외 = 조치 필요). 라벨 문자열 기준 상수.
export const IGNORE_LABELS = new Set(['🟡 구글 혼잡', '⚪ 세션 만료', '⚪ 네트워크', '🟡 응답지연', '⚫ 확장노이즈', '⚪ 외부 스크립트', '🟣 AI 안전 필터'])
export const severityOf = (msg, ctx) => IGNORE_LABELS.has(classifyError(msg, ctx).label) ? 'ignore' : 'action'
