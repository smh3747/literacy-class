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
  //   step665: 예산·메인 15초는 503/429를 받은 뒤(congested)에만. 신호 전은 60초, 넘어갈 모델이 없으면 15초 상한 없음.
  rec('attemptTimeoutMs 메인·거절 뒤: min(60000, 30000, 15000) = 15000', attemptTimeoutMs({ defaultMs: 60000, remainingMs: 30000, isMainModel: true, mainTimeoutMs: 15000, congested: true, hasNextModel: true }) === 15000, '')
  rec('attemptTimeoutMs 보조·거절 뒤: 남은 예산 11000 → 11000(메인 상한 미적용)', attemptTimeoutMs({ defaultMs: 60000, remainingMs: 11000, isMainModel: false, mainTimeoutMs: 15000, congested: true, hasNextModel: false }) === 11000, '')
  rec('attemptTimeoutMs 비혼잡(remaining Infinity) → 60000', attemptTimeoutMs({ defaultMs: 60000, remainingMs: Infinity, isMainModel: true }) === 60000, '')
  rec('attemptTimeoutMs 최소 1000', attemptTimeoutMs({ defaultMs: 60000, remainingMs: 200, isMainModel: false, congested: true }) === 1000, '')
  rec('hasBudget: 999 false · 1000 true · Infinity true', !hasBudget(999) && hasBudget(1000) && hasBudget(Infinity), '')
  {
    const noSignal = attemptTimeoutMs({ defaultMs: 60000, remainingMs: Infinity, isMainModel: true, mainTimeoutMs: 15000, congested: false, hasNextModel: true })
    rec('(a) 거절 신호 없음: 메인 단건 60000 → 20초·40초 응답이 끊기지 않음', noSignal === 60000 && noSignal > 20000 && noSignal > 40000, `→ ${noSignal}`)
    const noSignalFinite = attemptTimeoutMs({ defaultMs: 60000, remainingMs: 5000, isMainModel: true, mainTimeoutMs: 15000, congested: false })
    rec('(a) 거절 신호 없음: 남은 예산 값이 들어와도 무시(60000)', noSignalFinite === 60000, `→ ${noSignalFinite}`)
    rec('(a) congested 인자 생략 = 신호 없음(60000)', attemptTimeoutMs({ defaultMs: 60000, remainingMs: 30000, isMainModel: true, mainTimeoutMs: 15000 }) === 60000, '')
    const after503 = attemptTimeoutMs({ defaultMs: 60000, remainingMs: 28000, isMainModel: true, mainTimeoutMs: 15000, congested: true, hasNextModel: true })
    rec('(b) 503 뒤·보조 있음: 메인 15000', after503 === 15000, `→ ${after503}`)
    const noAux = attemptTimeoutMs({ defaultMs: 60000, remainingMs: 28000, isMainModel: true, mainTimeoutMs: 15000, congested: true, hasNextModel: false })
    rec('(c) 503 뒤·보조 없음: 15초 끊기 없이 남은 예산 28000', noAux === 28000, `→ ${noAux}`)
  }

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

  // ── step665 배선 검증: 실제 callGeminiStructured에 가짜 모델을 꽂아 축소 시간으로 확인 ──
  //   축소: 단건 기본 3초(=운영 60초), 메인 상한 1초(=운영 15초, 정책 최소값), 합계 예산 8초(=운영 30초). 503 재시도 대기 2초는 실값.
  {
    const nodeModule = require('module')
    nodeModule.registerHooks({
      resolve(specifier, context, nextResolve) {
        try { return nextResolve(specifier, context) }
        catch (e) { if (specifier.startsWith('.') && !path.extname(specifier)) return nextResolve(`${specifier}.js`, context); throw e }
      },
    })
    const { callGeminiStructured, MODEL_CHAINS } = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'gemini.js')).href)
    const MAIN = MODEL_CHAINS.grading[0], AUX = MODEL_CHAINS.grading[1]
    const OK = { candidates: [{ finishReason: 'STOP' }], text: () => '{"ok":true}' }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms))
    // plan(model, n) → { delay, error } : 모델별 n번째 호출의 동작
    const fake = (plan) => {
      const calls = []
      return { calls, genAI: { getGenerativeModel: ({ model }) => ({ generateContent: async () => {
        calls.push(model)
        const p = plan(model, calls.filter(m => m === model).length) || {}
        if (p.delay) await sleep(p.delay)
        if (p.error) throw new Error(p.error)
        return { response: OK }
      } }) } }
    }
    const CG = { deadlineMs: 8000, mainTimeoutMs: 1000 }
    const run = async (f, extra = {}) => {
      const t0 = Date.now(); let out = null, err = null
      try { out = await callGeminiStructured('gate-key-665', 'p', { type: 'object' }, { taskType: 'grading', __genAI: f.genAI, timeoutMs: 3000, congestion: CG, ...extra }) } catch (e) { err = e }
      return { out, err, ms: Date.now() - t0 }
    }

    // (a) 거절 신호 없이 메인이 상한(1초)보다 오래 걸려도 끊기지 않고 메인이 답한다
    for (const delay of [1500, 2500]) {
      const f = fake((model) => model === MAIN ? { delay } : {})
      const r = await run(f)
      rec(`(a) 배선: 신호 없는 ${delay}ms 응답(메인 상한 1초 초과) → 메인 성공·전환 없음`,
        !r.err && r.out?.ok === true && r.out.__usedModel === MAIN && !r.out.__congestion && f.calls.join(',') === MAIN, `calls=${f.calls.length} ${r.err ? r.err.message : ''}`)
    }
    // (b) 503 1회 뒤에는 메인 상한 적용 → 1800ms 걸리는 재시도가 1초에 끊기고 보조가 답한다
    {
      const f = fake((model, n) => model === MAIN ? (n === 1 ? { error: msg503 } : { delay: 1800 }) : {})
      const r = await run(f)
      rec('(b) 배선: 503 뒤 메인 1800ms 응답 → 상한에서 끊고 보조 성공(__congestion 표식)',
        !r.err && r.out?.__usedModel === AUX && !!r.out.__congestion && f.calls.join(',') === [MAIN, MAIN, AUX].join(','), `calls=${f.calls.length} congestion=${r.out?.__congestion} ${r.err ? r.err.message : ''}`)
    }
    // (c) 넘어갈 모델 없음(체인에 메인만) + 503 뒤 → 1800ms 응답을 끊지 않고 메인이 답한다
    {
      const f = fake((model, n) => n === 1 ? { error: msg503 } : { delay: 1800 })
      const r = await run(f, { model: MAIN })
      rec('(c) 배선: 보조 없음 + 503 뒤 메인 1800ms 응답 → 끊기지 않고 메인 성공',
        !r.err && r.out?.ok === true && r.out.__usedModel === MAIN && f.calls.join(',') === [MAIN, MAIN].join(','), `calls=${f.calls.length} ${r.err ? r.err.message : ''}`)
    }
    // 유지 확인: 503 2회 연속 → 보조 / 429(분당) → 즉시 보조
    {
      const f = fake((model) => model === MAIN ? { error: msg503 } : {})
      const r = await run(f)
      rec('유지: 503 2회 연속 → 보조 전환(busy503)', !r.err && r.out?.__usedModel === AUX && r.out.__congestion === 'busy503' && f.calls.join(',') === [MAIN, MAIN, AUX].join(','), `calls=${f.calls.length} ${r.err ? r.err.message : ''}`)
    }
    {
      const e429 = '[GoogleGenerativeAI Error]: Error fetching: [429 Too Many Requests] quota exceeded [{"@type":"type.googleapis.com/google.rpc.QuotaFailure","violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]'
      const f = fake((model) => model === MAIN ? { error: e429 } : {})
      const r = await run(f)
      rec('유지: 429(분당) → 대기 없이 보조 전환(rate429)', !r.err && r.out?.__usedModel === AUX && r.out.__congestion === 'rate429' && f.calls.join(',') === [MAIN, AUX].join(',') && r.ms < 1500, `calls=${f.calls.length} ms=${r.ms} congestion=${r.out?.__congestion} ${r.err ? r.err.message : ''}`)
    }
  }

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
