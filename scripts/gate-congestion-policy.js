// step663: 혼잡(503/429) 전환 정책(lib/congestionPolicy.js) 회귀 게이트 (읽기 전용 — lib는 import만)
//
// ▶ lib/congestionPolicy.js 수정 시 커밋 전 실행:  node scripts/gate-congestion-policy.js
//   규칙: 503 1회째 2초 재시도·2회 연속 전환 / 429 분당 즉시 전환(마지막 모델은 예산 안 1회 대기) / 예산 30초·메인 15초 / quotaId 1줄.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'congestionPolicy.js')).href)
  const { CONGESTION_DEADLINE_MS, CONGESTION_MAIN_TIMEOUT_MS, CONGESTION_BUSY_WAIT_MS, CONGESTION_BUSY_MAX, GRADING_CONGESTION_OPTS,
    isBusyMessage, congestionKind, decideOnCongestion, attemptTimeoutMs, hasBudget, quotaLineOf } = m

  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })
  const J = (v) => JSON.stringify(v)

  // ── 상수(승인값) ──
  rec('예산 30초·메인 15초·503 대기 2초·연속 2회', CONGESTION_DEADLINE_MS === 30000 && CONGESTION_MAIN_TIMEOUT_MS === 15000 && CONGESTION_BUSY_WAIT_MS === 2000 && CONGESTION_BUSY_MAX === 2, '')
  rec('GRADING_CONGESTION_OPTS = {deadlineMs 30000, mainTimeoutMs 15000}', GRADING_CONGESTION_OPTS.deadlineMs === 30000 && GRADING_CONGESTION_OPTS.mainTimeoutMs === 15000, J(GRADING_CONGESTION_OPTS))

  // ── 판정 ──
  const msg503 = '[GoogleGenerativeAI Error]: Error fetching from https://x/models/m:generateContent: [503 Service Unavailable] This model is currently experiencing high demand.'
  rec('isBusyMessage: 503 실문구 true, overloaded true, 404 false', isBusyMessage(msg503) && isBusyMessage('model overloaded') && !isBusyMessage('404 not found'), '')
  rec('congestionKind: 503 → busy503', congestionKind(msg503, { is429: false }) === 'busy503', '')
  rec('congestionKind: 429 분당 → rate429', congestionKind('429', { is429: true, daily: false, perMinute: true }) === 'rate429', '')
  rec('congestionKind: 429 일일 → null(종전 분기)', congestionKind('429', { is429: true, daily: true }) === null, '')
  rec('congestionKind: 일반 오류 → null', congestionKind('JSON parse', { is429: false }) === null, '')

  // ── 503 ──
  const d1 = decideOnCongestion({ kind: 'busy503', consecutive: 1, remainingMs: 28000, isLastModel: false })
  rec('503 1회째(예산 충분) → retry 2000ms', d1.action === 'retry' && d1.waitMs === 2000, J(d1))
  const d2 = decideOnCongestion({ kind: 'busy503', consecutive: 2, remainingMs: 25000, isLastModel: false })
  rec('503 2회 연속 → switch', d2.action === 'switch' && d2.waitMs === 0, J(d2))
  const d3 = decideOnCongestion({ kind: 'busy503', consecutive: 2, remainingMs: 25000, isLastModel: true })
  rec('503 2회 연속·마지막 모델 → fail', d3.action === 'fail', J(d3))
  const d4 = decideOnCongestion({ kind: 'busy503', consecutive: 1, remainingMs: 4000, isLastModel: false })
  rec('503 1회째인데 예산 4초(대기 2+최소 3 미달) → switch', d4.action === 'switch', J(d4))
  const d5 = decideOnCongestion({ kind: 'busy503', consecutive: 1, remainingMs: 2000, isLastModel: false })
  rec('503 예산 2초(최소 3 미달) → fail', d5.action === 'fail', J(d5))
  const d6 = decideOnCongestion({ kind: 'busy503', consecutive: 1, remainingMs: Infinity, isLastModel: true })
  rec('503 1회째·마지막 모델·예산 무한 → retry', d6.action === 'retry', J(d6))

  // ── 429 ──
  const r1 = decideOnCongestion({ kind: 'rate429', consecutive: 1, remainingMs: 29000, isLastModel: false })
  rec('429 분당·다음 모델 있음 → 즉시 switch(대기 0)', r1.action === 'switch' && r1.waitMs === 0, J(r1))
  const r2 = decideOnCongestion({ kind: 'rate429', consecutive: 1, remainingMs: 20000, isLastModel: true, retryDelaySec: 7.2 })
  rec('429 마지막 모델·1회째·retryDelay 7.2 → retry 8000ms', r2.action === 'retry' && r2.waitMs === 8000, J(r2))
  const r3 = decideOnCongestion({ kind: 'rate429', consecutive: 1, remainingMs: 20000, isLastModel: true, retryDelaySec: null })
  rec('429 마지막 모델·retryDelay 없음 → retry 3000ms', r3.action === 'retry' && r3.waitMs === 3000, J(r3))
  const r4 = decideOnCongestion({ kind: 'rate429', consecutive: 2, remainingMs: 20000, isLastModel: true })
  rec('429 마지막 모델·2회째 → fail', r4.action === 'fail', J(r4))
  const r5 = decideOnCongestion({ kind: 'rate429', consecutive: 1, remainingMs: 5000, isLastModel: true, retryDelaySec: 20 })
  rec('429 마지막 모델·retryDelay 20초가 예산 5초 밖 → fail', r5.action === 'fail', J(r5))

  // ── 타임아웃·예산 ──
  rec('attemptTimeoutMs 메인: min(60000, 30000, 15000) = 15000', attemptTimeoutMs({ defaultMs: 60000, remainingMs: 30000, isMainModel: true, mainTimeoutMs: 15000 }) === 15000, '')
  rec('attemptTimeoutMs 보조: 남은 예산 11000 → 11000(메인 상한 미적용)', attemptTimeoutMs({ defaultMs: 60000, remainingMs: 11000, isMainModel: false, mainTimeoutMs: 15000 }) === 11000, '')
  rec('attemptTimeoutMs 비혼잡(remaining Infinity) → 60000', attemptTimeoutMs({ defaultMs: 60000, remainingMs: Infinity, isMainModel: true }) === 60000, '')
  rec('attemptTimeoutMs 최소 1000', attemptTimeoutMs({ defaultMs: 60000, remainingMs: 200, isMainModel: false }) === 1000, '')
  rec('hasBudget: 999 false · 1000 true · Infinity true', !hasBudget(999) && hasBudget(1000) && hasBudget(Infinity), '')

  // ── 11/3 사례 재구성: 메인 503·503 → 보조 전환, 보조 503 1회 재시도 → 총 대기 ≤ 4초 ──
  {
    let t = 0; const seq = []
    let d = decideOnCongestion({ kind: 'busy503', consecutive: 1, remainingMs: 30000 - t, isLastModel: false }); seq.push(d.action); t += d.waitMs + 500
    d = decideOnCongestion({ kind: 'busy503', consecutive: 2, remainingMs: 30000 - t, isLastModel: false }); seq.push(d.action); t += 500
    d = decideOnCongestion({ kind: 'busy503', consecutive: 1, remainingMs: 30000 - t, isLastModel: true }); seq.push(d.action); t += d.waitMs
    rec('시나리오: retry→switch→retry, 누적 대기 4초(종전 3+6+9=18초 뒤 오류)', seq.join(',') === 'retry,switch,retry' && t === 5000, `${seq.join(',')} t=${t}`)
  }

  // ── quotaId 1줄 ──
  const q = quotaLineOf({ is429: true, daily: false, perMinute: true, retryDelaySec: 28, quotaIds: ['GenerateRequestsPerMinutePerProjectPerModel-FreeTier'] })
  rec('quotaLineOf 분당', q === '[429 quota=GenerateRequestsPerMinutePerProjectPerModel-FreeTier retryDelay=28s perMinute]', q)
  rec('quotaLineOf 429 아님 → null', quotaLineOf({ is429: false }) === null && quotaLineOf(null) === null, '')
  rec('quotaLineOf quotaIds 없음 → unknown·unspecified', quotaLineOf({ is429: true, quotaIds: [], retryDelaySec: null }) === '[429 quota=unknown retryDelay=- unspecified]', quotaLineOf({ is429: true, quotaIds: [] }))

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
