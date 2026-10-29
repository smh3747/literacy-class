// step644: Gemini 429 판정 — 메시지 문자열 대신 errorDetails(quotaId·retryDelay)로. 순수 함수(네트워크 없음).
//   배경: @google/generative-ai 0.21은 429 응답의 error.details를 err.errorDetails에 싣고 메시지 꼬리에도 JSON으로 덧붙인다.
//   종전 판정식 `PerProjectPerModel` 포함 여부는 분당 quotaId(GenerateRequestsPerMinutePerProjectPerModel)에도 맞아
//   분당 429를 일일 한도로 오판 → 즉시 폴백했다. 여기서는 quotaId에 PerDay가 있을 때만 일일, PerMinute이면 분당으로 본다.
//   게이트: scripts/gate-quota-error.js

export const RETRY_CAP_SEC = 20   // retryDelay를 따르되 이 이상은 기다리지 않는다(종전 30)

// "28s" | "28.5s" | "0.75s" | 28 → 초(number) 또는 null
export function parseRetryDelaySec(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null
  const m = String(v).trim().match(/^(\d+(?:\.\d+)?)\s*s?$/i)
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) && n >= 0 ? n : null
}

// 메시지 꼬리의 details JSON 배열(SDK가 `message += ' ' + JSON.stringify(details)`로 덧붙임) 복구. 없으면 null.
function detailsFromMessage(msg) {
  const i = msg.indexOf('[{')
  if (i < 0) return null
  try {
    const arr = JSON.parse(msg.slice(i))
    return Array.isArray(arr) ? arr : null
  } catch (_) { return null }
}

/**
 * @param {any} err - SDK 에러(err.status, err.errorDetails, err.message)
 * @returns {{ is429: boolean, daily: boolean, perMinute: boolean, retryDelaySec: number|null, quotaIds: string[], source: 'details'|'message'|'legacy'|'none' }}
 */
export function classifyQuotaError(err) {
  const msg = String(err?.message || err || '')
  const status = err?.status ?? null
  const is429 = status === 429 || /\b429\b/.test(msg) || /quota/i.test(msg)
  let details = Array.isArray(err?.errorDetails) ? err.errorDetails : null
  let source = details ? 'details' : 'none'
  if (!details) { details = detailsFromMessage(msg); if (details) source = 'message' }
  const quotaIds = []
  let retryDelaySec = null
  for (const d of details || []) {
    if (!d || typeof d !== 'object') continue
    const t = String(d['@type'] || '')
    if (/QuotaFailure$/.test(t) && Array.isArray(d.violations)) {
      for (const v of d.violations) if (v && v.quotaId) quotaIds.push(String(v.quotaId))
    }
    if (/RetryInfo$/.test(t) && d.retryDelay !== undefined) {
      const s = parseRetryDelaySec(d.retryDelay)
      if (s !== null) retryDelaySec = s
    }
  }
  let daily = quotaIds.some(q => /PerDay/i.test(q))
  const perMinute = quotaIds.some(q => /PerMinute/i.test(q))
  if (quotaIds.length === 0 && is429 && /per day|PerDay/i.test(msg)) { daily = true; source = 'legacy' }   // details 없는 구형 메시지
  return { is429, daily, perMinute, retryDelaySec, quotaIds, source }
}

// 같은 모델 재시도 대기(초). retryDelay가 있으면 그만큼만(올림, 상한 RETRY_CAP_SEC), 없으면 종전 3·6·9…(상한 동일).
export function retryWaitSec({ attempt, retryDelaySec, capSec = RETRY_CAP_SEC } = {}) {
  if (Number.isFinite(retryDelaySec) && retryDelaySec > 0) return Math.min(Math.max(1, Math.ceil(retryDelaySec)), capSec)
  const a = Number.isFinite(Number(attempt)) && Number(attempt) > 0 ? Number(attempt) : 1
  return Math.min(a * 3, capSec)
}

// 다음 태평양(PT) 자정의 epoch ms — Gemini 일일 한도(RPD)가 리셋되는 시각. Intl로 PST/PDT 자동.
export function nextPtMidnightMs(nowMs = Date.now()) {
  const now = new Date(nowMs)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0', 10) % 24
  const elapsedSec = get('hour') * 3600 + parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10) * 60 + parseInt(parts.find(p => p.type === 'second')?.value || '0', 10)
  return nowMs - elapsedSec * 1000 + 24 * 3600 * 1000
}
