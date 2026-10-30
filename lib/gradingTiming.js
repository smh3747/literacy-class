// step643: 채점 대기 시간 실측 — 순수 함수(클라이언트 경로 판정 + 관리자 집계). 네트워크·DB 없음.
//   게이트: scripts/gate-grading-timing.js

export const OVER_MS = 60000   // "60초 초과" 기준

/**
 * 제출 행에 적을 경로 한 값. 우선순위: error_then_retry > fallback > retry_N > pending > inline
 * @param {{ failedBefore?: boolean, isFallback?: boolean, attempts?: number, strictStatus?: string }} p
 *   failedBefore: 같은 주제·같은 attempt에서 직전 시도가 실패(오류 모달)한 뒤 다시 눌러 성공
 *   isFallback  : 보조 모델로 채점됨(is_fallback_graded와 같은 판정)
 *   attempts    : 서버 총 시도 수(result.__attempts, 모델 전환 포함). 2 이상이면 retry_(attempts-1)
 *   strictStatus: result.__strictStatus ('pending'이면 피크로 전용 검사 보류)
 */
export function deriveGradingPath({ failedBefore, isFallback, attempts, strictStatus } = {}) {
  if (failedBefore) return 'error_then_retry'
  if (isFallback) return 'fallback'
  const a = Number(attempts)
  if (Number.isFinite(a) && a >= 2) return `retry_${Math.floor(a) - 1}`
  if (strictStatus === 'pending') return 'pending'
  return 'inline'
}

// 경로 → 분포 묶음 키(retry_1·retry_2… → 'retry')
export function pathFamily(path) {
  if (!path) return 'unknown'
  if (String(path).startsWith('retry_')) return 'retry'
  return String(path)
}

// nearest-rank 퍼센타일. sorted는 오름차순 숫자 배열.
export function percentile(sorted, p) {
  if (!sorted || sorted.length === 0) return null
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.min(idx, sorted.length - 1)]
}

export function kstDay(iso) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'unknown'
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

function stat(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    over60: sorted.filter(v => v > OVER_MS).length,
  }
}

/**
 * 관리자 집계. rows: [{ ms, path, at(ISO), classId }]
 * @returns {{ total, byDay: [{key,...stat}](최신순), byClass: [{key,...stat}](건수 내림차순), paths: {family: n} }}
 */
export function summarizeTimings(rows) {
  const list = (rows || []).filter(r => r && Number.isFinite(Number(r.ms))).map(r => ({ ...r, ms: Number(r.ms) }))
  const dayMap = new Map(), classMap = new Map(), paths = {}
  for (const r of list) {
    const d = kstDay(r.at)
    if (!dayMap.has(d)) dayMap.set(d, [])
    dayMap.get(d).push(r.ms)
    const c = r.classId || 'unknown'
    if (!classMap.has(c)) classMap.set(c, [])
    classMap.get(c).push(r.ms)
    const f = pathFamily(r.path)
    paths[f] = (paths[f] || 0) + 1
  }
  const byDay = [...dayMap.entries()].map(([key, v]) => ({ key, ...stat(v) })).sort((a, b) => (a.key < b.key ? 1 : -1))
  const byClass = [...classMap.entries()].map(([key, v]) => ({ key, ...stat(v) })).sort((a, b) => b.n - a.n)
  return { total: stat(list.map(r => r.ms)), byDay, byClass, paths }
}

export function fmtSec(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '-'
  return (Number(ms) / 1000).toFixed(1) + 's'
}

// step654: 한글 초 표기("5.6초"). 60초 이상은 "1분 12초"처럼.
export function fmtSecKo(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '-'
  const sec = Number(ms) / 1000
  if (sec >= 60) { const m = Math.floor(sec / 60); const r = Math.round(sec - m * 60); return r > 0 ? `${m}분 ${r}초` : `${m}분` }
  return sec.toFixed(1) + '초'
}

// step654: 머리 한 줄 문장(전문 용어 없이). total = stat 결과.
export function headlineOf(total, { days = 14 } = {}) {
  if (!total || !total.n) return '아직 측정값이 없어요'
  return `최근 ${days}일 ${total.n}편 · 보통 ${fmtSecKo(total.p50)} · 거의 모든 글(95%)이 ${fmtSecKo(total.p95)} 안 · 가장 오래 ${fmtSecKo(total.max)} · 1분 넘은 글 ${total.over60}건`
}

// step654: 표 아래 한 줄 해석. over60>0이면 경고(구글 혼잡 가능성 → 오류 탭 503 확인), 아니면 안심.
export function interpretTimings(total) {
  if (!total || !total.n) return { tone: 'none', text: '' }
  if (total.over60 > 0) return { tone: 'warn', text: `⚠ 1분 넘은 글 ${total.over60}건이 있어요. 구글 혼잡일 가능성이 커요. 오류 탭에서 503을 확인해 주세요.` }
  return { tone: 'ok', text: '느리지 않았어요. 1분 넘은 글이 없어요.' }
}
