// step644: 429 판정(lib/quotaError.js) + 서버 한도 기억(lib/gemini.js markQuotaHit/getQuotaHitModels) 회귀 게이트 (읽기 전용)
//
// ▶ lib/quotaError.js 또는 gemini.js 한도 기억 수정 시 커밋 전 실행:  node scripts/gate-quota-error.js
//   규칙: quotaId PerDay → 일일(폴백), PerMinute → 분당(백오프). retryDelay 있으면 그만큼만(올림, 상한 20초). 서버 기억은 키별·모델별, PT 자정 TTL.

const path = require('path')
const { pathToFileURL } = require('url')
const nodeModule = require('module')

// gemini.js가 확장자 없는 상대 import를 쓰므로(./apiThrottle 등) gate-safety-block과 같은 해석 훅(node 22.15+)
function registerExtensionlessHook() {
  if (typeof nodeModule.registerHooks !== 'function') throw new Error('node 22.15 이상이 필요해요(module.registerHooks 없음)')
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      try { return nextResolve(specifier, context) }
      catch (e) {
        if (specifier.startsWith('.') && !path.extname(specifier)) return nextResolve(`${specifier}.js`, context)
        throw e
      }
    },
  })
}

;(async () => {
  registerExtensionlessHook()
  const imp = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href)
  const q = await imp('lib/quotaError.js')
  const g = await imp('lib/gemini.js')
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })

  const DAY = { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaDimensions: { model: 'gemini-3.1-flash-lite' } }] }
  const MIN = { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }
  const RETRY = (s) => ({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: s })
  const mk = (details, status = 429) => {
    const e = new Error(`[GoogleGenerativeAI Error]: Error fetching from https://x/v1beta/models/m:generateContent: [429 Too Many Requests] You exceeded your current quota, please check your plan and billing details. ${JSON.stringify(details)}`)
    e.status = status; e.errorDetails = details; return e
  }

  // ── CLASSIFY ──
  { const c = q.classifyQuotaError(mk([DAY, RETRY('28s')]))
    rec('일일 quotaId(PerDay) → daily=true perMinute=false retry 28', c.is429 && c.daily && !c.perMinute && c.retryDelaySec === 28 && c.source === 'details', JSON.stringify(c)) }
  { const c = q.classifyQuotaError(mk([MIN, RETRY('5.5s')]))
    rec('분당 quotaId(PerMinute, PerProjectPerModel 포함) → daily=false perMinute=true retry 5.5', c.is429 && !c.daily && c.perMinute && c.retryDelaySec === 5.5, JSON.stringify(c)) }
  { const e = mk([MIN]); delete e.errorDetails; const c = q.classifyQuotaError(e)
    rec('errorDetails 없어도 메시지 꼬리 JSON에서 복구(source message)', c.perMinute && !c.daily && c.source === 'message', JSON.stringify(c)) }
  { const e = new Error('[429 Too Many Requests] Quota exceeded per day for this model'); e.status = 429; const c = q.classifyQuotaError(e)
    rec('details 없는 구형 메시지 "per day" → legacy daily', c.daily && c.source === 'legacy', JSON.stringify(c)) }
  { const e = new Error('[429 Too Many Requests] You exceeded your current quota'); e.status = 429; const c = q.classifyQuotaError(e)
    rec('details 없고 per day 문구도 없는 429 → daily=false(분당 취급·백오프)', c.is429 && !c.daily && c.retryDelaySec === null, JSON.stringify(c)) }
  { const c = q.classifyQuotaError(new Error('[503 Service Unavailable] high demand'))
    rec('503 → is429=false daily=false', !c.is429 && !c.daily, JSON.stringify(c)) }
  { const c = q.classifyQuotaError(mk([DAY, MIN]))
    rec('PerDay·PerMinute 동시 → daily 우선', c.daily && c.perMinute, '') }
  rec('parseRetryDelaySec: "28s"→28 "0.75s"→0.75 "abc"→null 12→12', q.parseRetryDelaySec('28s') === 28 && q.parseRetryDelaySec('0.75s') === 0.75 && q.parseRetryDelaySec('abc') === null && q.parseRetryDelaySec(12) === 12, '')

  // ── WAIT ──
  rec('retryDelay 7.2 → 8초(올림)', q.retryWaitSec({ attempt: 1, retryDelaySec: 7.2 }) === 8, String(q.retryWaitSec({ attempt: 1, retryDelaySec: 7.2 })))
  rec('retryDelay 45 → 20초(상한)', q.retryWaitSec({ attempt: 1, retryDelaySec: 45 }) === 20, '')
  rec('retryDelay 0.3 → 1초(최소)', q.retryWaitSec({ attempt: 1, retryDelaySec: 0.3 }) === 1, '')
  rec('retryDelay 없음 → 종전 3·6·9', q.retryWaitSec({ attempt: 1 }) === 3 && q.retryWaitSec({ attempt: 2 }) === 6 && q.retryWaitSec({ attempt: 3 }) === 9, '')
  rec('retryDelay 없음 attempt 8 → 20초(상한)', q.retryWaitSec({ attempt: 8 }) === 20, '')
  rec('RETRY_CAP_SEC = 20', q.RETRY_CAP_SEC === 20, '')

  // ── PT MIDNIGHT ──
  { const now = Date.now(); const next = q.nextPtMidnightMs(now); const h = (next - now) / 3600000
    rec('다음 PT 자정은 지금부터 0~24시간 안', h > 0 && h <= 24, `${h.toFixed(2)}h`)
    const ptHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false }).format(new Date(next + 1000)), 10) % 24
    rec('그 시각은 PT 00시', ptHour === 0, String(ptHour)) }

  // ── SERVER QUOTA MEMORY (window 없음 = 서버 경로) ──
  {
    g.markQuotaHit('key-A', 'gemini-3-flash-preview')
    const a = g.getQuotaHitModels('key-A'), b = g.getQuotaHitModels('key-B')
    rec('서버 기억: 같은 키는 건너뜀 목록에 포함', a.has('gemini-3-flash-preview'), [...a].join(','))
    rec('서버 기억: 다른 키(다른 학급)에는 영향 없음', !b.has('gemini-3-flash-preview'), [...b].join(','))
    g._setQuotaHitForTest('key-A', 'gemini-3.1-flash-lite', Date.now() - 1000)   // 이미 만료
    rec('서버 기억: TTL 지난 항목은 제외(만료 정리)', !g.getQuotaHitModels('key-A').has('gemini-3.1-flash-lite') && g.getQuotaHitModels('key-A').has('gemini-3-flash-preview'), '')
  }

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
