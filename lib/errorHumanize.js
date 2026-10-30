// step657: 관리자 오류 탭 — 사람이 읽는 형식(표시 전용, error_logs 기록 구조·분류기 불변).
//   · 쌍 병합: 같은 사용자·같은 작업(aiType)·60초 안의 ai_call(클라)+api_error(서버)를 한 카드로. 반복도 한 카드 "N번 시도".
//   · 카드 1줄 = 사람 문장: 무엇을 하다 / 무슨 일 / 학생에게 어떻게 보였나. 영어 원문·URL·JSON은 "자세히" 안으로.
//   · 날짜별 구분·하루 요약·같은 학급 같은 날 3건 이상 묶음 머리.
//   순수 함수. 분류(라벨·심각도)는 lib/errorClassify.js를 그대로 쓴다. 게이트: scripts/gate-error-humanize.js
import { classifyError, severityOf, IGNORE_LABELS } from './errorClassify'

export const PAIR_WINDOW_MS = 60 * 1000
export const BURST_MIN = 3

const AI_TYPE_LABEL = {
  grading: '첫 글 채점', rewriteGrading: '수정본 채점', exampleEssay: '예시 작품', strict_inline: '맞춤법 보완',
  grammarStrict: '맞춤법 검사', grammarOnly: '맞춤법 검사', commentSuggest: '코멘트 추천', topicBatch: '주제 추천',
  topicSingle: '주제 추천', rubricGen: '평가 기준 만들기', topicDesc: '주제 설명', briefing: '아침 브리핑',
  schoolRecord: '생기부 평어', supplyTopic: '전국 주제 발행', supplyTopicBatch: '전국 주제 발행', feedbackSummary: '의견 요약',
  tutorChat: '튜터 챗봇', regrade: '재평가',
}

// 분류기와 같은 판정 텍스트(메시지 + 서버가 동봉한 upstream)
function textOf(log) {
  const up = log?.context?.upstream
  return [log?.message, up?.message, up?.status, up?.timeout ? 'TIMEOUT' : '', up?.blockReason]
    .filter(v => v !== null && v !== undefined && v !== '').join(' ')
}

export function whatOf(log) {
  const a = log?.context?.aiType
  if (a && AI_TYPE_LABEL[a]) return AI_TYPE_LABEL[a]
  const t = log?.error_type
  if (t === 'strict_backfill') return '맞춤법 보완'
  if (t === 'auth_bounce') return '진입'
  if (t === 'js_error') return '화면 동작'
  if (t === 'supply_ranking') return '전국 랭킹'
  return a || log?.page || '알 수 없는 작업'
}

// 번역표(순서 중요: 안전 필터 → 네트워크 → 타임아웃 → 503 → 429 → JSON → 진입 사유 → 원문 80자)
export function happenedOf(log) {
  const m = textOf(log)
  const reason = log?.context?.reason
  if (/AI_SAFETY_BLOCKED|PROHIBITED_CONTENT|blocked due to|\bBLOCKLIST\b|\bSPII\b/i.test(m)) return { key: 'safety', text: 'AI가 평가를 거절했어요(글 내용과 무관, 담임에게 알림 감)' }
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return { key: 'network', text: '학생 기기 인터넷이 잠깐 끊겼어요' }
  if (/TIMEOUT/i.test(m)) return { key: 'timeout', text: 'AI가 60초 넘게 답이 없어 중단했어요(구글 느림)' }
  if (/503|high demand|overloaded|UNAVAILABLE/i.test(m)) return { key: 'busy', text: '구글 AI 서버가 바빴어요(우리 잘못 아님)' }
  if (/429|per day|quota|RESOURCE_EXHAUSTED/i.test(m)) return { key: 'quota', text: '분당 호출 한도에 걸렸어요' }
  if (/파싱 실패|JSON/i.test(m)) return { key: 'parse', text: 'AI 답을 읽지 못했어요' }
  if (reason === 'no_session' || /no_session/.test(m)) return { key: 'no_session', text: '로그인 없이 들어왔어요' }
  if (reason === 'role_mismatch' || /role_mismatch/.test(m)) return { key: 'role_mismatch', text: '학생이 선생님 주소로 들어왔어요' }
  if (reason === 'profile_null' || reason === 'query_error') return { key: 'bounce', text: '로그인 정보를 확인하지 못해 로그인 화면으로 보냈어요' }
  const raw = String(log?.message || '').replace(/\s+/g, ' ').trim()
  return { key: 'other', text: raw.length > 80 ? raw.slice(0, 80) + '…' : (raw || '내용 없음') }
}

export function seenOf(log, happenedKey) {
  const t = log?.error_type
  const a = log?.context?.aiType
  if (t === 'auth_bounce') return '로그인 화면으로 돌아갔어요'
  if (t === 'js_error') return '화면이 잠깐 이상했을 수 있어요'
  if (t === 'strict_backfill' || a === 'strict_inline') return '글은 저장됐고 밑줄만 나중에 보완돼요'
  if (happenedKey === 'safety') return '점수 없이 저장되고 선생님께 알림이 갔어요'
  if (a === 'exampleEssay') return '예시 작품만 안 보이고 채점은 정상이에요'
  if (a === 'grading' || a === 'rewriteGrading') return '오류 안내가 뜨고 다시 제출할 수 있어요(글은 기기에 저장돼 있어요)'
  if (t === 'ai_call' || t === 'api_error') return '오류 안내가 뜨고 다시 시도할 수 있어요'
  return '화면 영향은 작아요'
}

export function humanizeLog(log) {
  const c = classifyError(log?.message, log?.context)
  const h = happenedOf(log)
  return { what: whatOf(log), happened: h.text, happenedKey: h.key, seen: seenOf(log, h.key), label: c.label, color: c.color, severity: severityOf(log?.message, log?.context) }
}

const ms = (iso) => { const t = new Date(iso).getTime(); return Number.isFinite(t) ? t : 0 }
const pairKey = (log) => `${log?.user_id || log?.class_id || 'anon'}|${log?.context?.aiType || log?.error_type || ''}`

/**
 * 최신순 로그 → 카드. 같은 키(사용자|작업)가 직전 묶음의 가장 이른 시각과 60초 안이면 합친다(클라+서버 쌍·반복).
 * card: { id, key, logs(최신순), latestAt, earliestAt, tries, sources:Set('client'|'server'|'other'), primary(서버 로그 우선), human, severity, user_id, class_id, role, error_type }
 */
export function mergeLogs(logs) {
  const sorted = (logs || []).slice().sort((a, b) => ms(b.created_at) - ms(a.created_at))
  const cards = []
  const open = new Map()   // key → card(가장 최근에 만들어진 카드)
  for (const log of sorted) {
    const k = pairKey(log)
    const t = ms(log.created_at)
    const card = open.get(k)
    if (card && card.earliestAt - t <= PAIR_WINDOW_MS && card.earliestAt - t >= 0) {
      card.logs.push(log); card.earliestAt = t; card.tries++
      card.sources.add(log.error_type === 'api_error' ? 'server' : log.error_type === 'ai_call' ? 'client' : 'other')
      continue
    }
    const nc = { id: log.id || `${k}|${t}`, key: k, logs: [log], latestAt: t, earliestAt: t, tries: 1, sources: new Set([log.error_type === 'api_error' ? 'server' : log.error_type === 'ai_call' ? 'client' : 'other']), user_id: log.user_id || null, class_id: log.class_id || null, role: log.role || null, error_type: log.error_type || null }
    cards.push(nc); open.set(k, nc)
  }
  for (const c of cards) {
    // 대표 로그: 원인이 구체적인 것 우선 — 서버 로그(upstream 동봉) → 라벨이 '기타'가 아닌 로그 → 최신 로그.
    //   클라 로그의 일반 문구("AI가 응답하지 않습니다")만 보고 '기타·조치 필요'로 올리지 않게.
    const labelOf = (l) => classifyError(l.message, l.context).label
    c.primary = c.logs.find(l => l.error_type === 'api_error' && l.context?.upstream)
      || c.logs.find(l => labelOf(l) !== '⚪ 기타')
      || c.logs[0]
    c.human = humanizeLog(c.primary)
    const specificAction = c.logs.some(l => { const lb = labelOf(l); return lb !== '⚪ 기타' && !IGNORE_LABELS.has(lb) })
    c.severity = specificAction ? 'action' : (IGNORE_LABELS.has(c.human.label) ? 'ignore' : 'action')
    c.error_type = c.primary.error_type || c.error_type
  }
  return cards
}

export function kstDayOf(iso) {
  const t = ms(iso); if (!t) return 'unknown'
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10)
}
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
export function dayLabel(day) {
  const d = new Date(day + 'T00:00:00+09:00')
  if (!Number.isFinite(d.getTime())) return day
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEK[(d.getUTCDay() + 0) % 7] ?? ''})`
}

// 카드 → 날짜(KST) 묶음(최신 날짜 먼저). 각 날짜: action/ignore 분리 + 같은 학급 3건 이상 bursts
export function groupByDay(cards, { burstMin = BURST_MIN } = {}) {
  const map = new Map()
  for (const c of cards) {
    const day = kstDayOf(c.primary?.created_at || c.latestAt)
    if (!map.has(day)) map.set(day, [])
    map.get(day).push(c)
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, list]) => {
    const byClass = new Map()
    for (const c of list) { if (!c.class_id) continue; if (!byClass.has(c.class_id)) byClass.set(c.class_id, []); byClass.get(c.class_id).push(c) }
    const bursts = [...byClass.entries()].filter(([, l]) => l.length >= burstMin).map(([classId, l]) => {
      const cnt = {}
      l.forEach(c => { cnt[c.human.label] = (cnt[c.human.label] || 0) + 1 })
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]
      return { classId, count: l.length, label: top ? top[0] : '' }
    }).sort((a, b) => b.count - a.count)
    return { day, label: dayLabel(day), cards: list, action: list.filter(c => c.severity === 'action'), ignore: list.filter(c => c.severity !== 'action'), bursts }
  })
}

// 하루 요약: 총 · 구글 혼잡 · 네트워크 · 안전 필터 · 조치 필요 (카드 기준)
export function daySummary(cards) {
  const s = { total: cards.length, busy: 0, network: 0, safety: 0, action: 0 }
  for (const c of cards) {
    if (c.human.label === '🟡 구글 혼잡' || c.human.happenedKey === 'busy') s.busy++
    if (c.human.happenedKey === 'network') s.network++
    if (c.human.happenedKey === 'safety') s.safety++
    if (c.severity === 'action') s.action++
  }
  return s
}
