// step643: 채점 대기 시간 실측(lib/gradingTiming.js) 회귀 게이트 (읽기 전용 — lib는 import만)
//
// ▶ lib/gradingTiming.js 수정 시 커밋 전 실행:  node scripts/gate-grading-timing.js
//   경로 우선순위(error_then_retry > congestion > fallback > retry_N > pending > inline)·퍼센타일(nearest-rank)·60초 초과·KST 일자 고정.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const { deriveGradingPath, pathFamily, percentile, kstDay, summarizeTimings, fmtSec, fmtSecKo, headlineOf, interpretTimings, OVER_MS } =
    await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'gradingTiming.js')).href)

  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })

  // ── PATH ──
  rec('기본 → inline', deriveGradingPath({}) === 'inline', deriveGradingPath({}))
  rec('attempts 1 → inline', deriveGradingPath({ attempts: 1 }) === 'inline', '')
  rec('strict pending → pending', deriveGradingPath({ strictStatus: 'pending', attempts: 1 }) === 'pending', '')
  rec('attempts 2 → retry_1 (pending보다 우선)', deriveGradingPath({ attempts: 2, strictStatus: 'pending' }) === 'retry_1', deriveGradingPath({ attempts: 2, strictStatus: 'pending' }))
  rec('attempts 4 → retry_3', deriveGradingPath({ attempts: 4 }) === 'retry_3', '')
  rec('fallback이 retry보다 우선', deriveGradingPath({ isFallback: true, attempts: 3 }) === 'fallback', '')
  rec('error_then_retry가 최우선', deriveGradingPath({ failedBefore: true, isFallback: true, attempts: 3, strictStatus: 'pending' }) === 'error_then_retry', '')
  // step663: congestion — error_then_retry 다음, fallback보다 우선
  rec('congestion이 fallback·retry보다 우선', deriveGradingPath({ congestion: 'busy503', isFallback: true, attempts: 3 }) === 'congestion', deriveGradingPath({ congestion: 'busy503', isFallback: true, attempts: 3 }))
  rec('congestion은 error_then_retry 다음', deriveGradingPath({ failedBefore: true, congestion: 'rate429' }) === 'error_then_retry', '')
  rec('congestion 비어 있으면 종전 판정(fallback)', deriveGradingPath({ congestion: null, isFallback: true }) === 'fallback' && deriveGradingPath({ congestion: undefined, attempts: 2 }) === 'retry_1', '')
  rec('pathFamily: congestion → congestion', pathFamily('congestion') === 'congestion', '')
  rec('attempts 비수치·문자열 "x" → inline', deriveGradingPath({ attempts: 'x' }) === 'inline', '')
  rec('pathFamily: retry_2 → retry, inline → inline, null → unknown', pathFamily('retry_2') === 'retry' && pathFamily('inline') === 'inline' && pathFamily(null) === 'unknown', '')

  // ── PERCENTILE ──
  rec('percentile nearest-rank [1..10] p50=5 p95=10', percentile([1,2,3,4,5,6,7,8,9,10], 50) === 5 && percentile([1,2,3,4,5,6,7,8,9,10], 95) === 10, '')
  rec('percentile 단일 원소', percentile([7], 50) === 7 && percentile([7], 95) === 7, '')
  rec('percentile 빈 배열 → null', percentile([], 50) === null, '')

  // ── KST ──
  rec('kstDay: 2026-10-16T16:30Z → 2026-10-17 (KST 01:30)', kstDay('2026-10-16T16:30:00.000Z') === '2026-10-17', kstDay('2026-10-16T16:30:00.000Z'))
  rec('kstDay: 2026-10-16T14:59Z → 2026-10-16', kstDay('2026-10-16T14:59:00.000Z') === '2026-10-16', '')

  // ── SUMMARY ──
  {
    const rows = [
      { ms: 5000, path: 'inline', at: '2026-10-16T01:00:00Z', classId: 'A' },
      { ms: 12000, path: 'pending', at: '2026-10-16T01:01:00Z', classId: 'A' },
      { ms: 61000, path: 'retry_1', at: '2026-10-16T01:02:00Z', classId: 'B' },
      { ms: 60000, path: 'retry_2', at: '2026-10-17T01:00:00Z', classId: 'B' },
      { ms: 90000, path: 'fallback', at: '2026-10-17T01:00:00Z', classId: null },
      { ms: 'bad', path: 'inline', at: '2026-10-17T01:00:00Z', classId: 'A' },   // 무시
    ]
    const s = summarizeTimings(rows)
    rec('total n=5(비수치 제외) max=90000 over60=2(60000은 미포함)', s.total.n === 5 && s.total.max === 90000 && s.total.over60 === 2, JSON.stringify(s.total))
    rec('total p50=60000(정렬 5000·12000·60000·61000·90000의 3번째, nearest-rank) p95=90000', s.total.p50 === 60000 && s.total.p95 === 90000, JSON.stringify(s.total))
    rec('byDay 최신순 2일, 10/17 n=2', s.byDay.length === 2 && s.byDay[0].key === '2026-10-17' && s.byDay[0].n === 2, JSON.stringify(s.byDay.map(d => [d.key, d.n])))
    rec('byClass 건수 내림차순 A2·B2·unknown1', s.byClass.map(c => c.key).join(',') === 'A,B,unknown' || s.byClass.map(c => c.key).join(',') === 'B,A,unknown', s.byClass.map(c => `${c.key}:${c.n}`).join(','))
    rec('paths 분포 inline1 pending1 retry2 fallback1', s.paths.inline === 1 && s.paths.pending === 1 && s.paths.retry === 2 && s.paths.fallback === 1, JSON.stringify(s.paths))
    rec('빈 입력 → n 0·null', summarizeTimings([]).total.n === 0 && summarizeTimings([]).total.p50 === null && summarizeTimings(null).byDay.length === 0, '')
  }
  rec('fmtSec 61234 → 61.2s, null → -', fmtSec(61234) === '61.2s' && fmtSec(null) === '-', fmtSec(61234))
  // step654: 한글 표기·머리 문장·해석
  rec('fmtSecKo 5600 → 5.6초, 72000 → 1분 12초, 120000 → 2분', fmtSecKo(5600) === '5.6초' && fmtSecKo(72000) === '1분 12초' && fmtSecKo(120000) === '2분', `${fmtSecKo(5600)}/${fmtSecKo(72000)}/${fmtSecKo(120000)}`)
  { const h = headlineOf({ n: 226, p50: 5600, p95: 13800, max: 31700, over60: 0 })
    rec('headlineOf 문장', h === '최근 14일 226편 · 보통 5.6초 · 거의 모든 글(95%)이 13.8초 안 · 가장 오래 31.7초 · 1분 넘은 글 0건', h) }
  rec('interpretTimings: over60 0 → ok 문장, 2 → warn 문장(503 언급), n 0 → none', interpretTimings({ n: 5, over60: 0 }).tone === 'ok' && interpretTimings({ n: 5, over60: 2 }).tone === 'warn' && /503/.test(interpretTimings({ n: 5, over60: 2 }).text) && interpretTimings({ n: 0 }).tone === 'none', '')
  rec('OVER_MS = 60000', OVER_MS === 60000, '')

  // ── step666: 채점 시도(첫 누름~결과) 집계 ──
  {
    const { ATTEMPT_JOIN_MS, ATTEMPT_FRESH_MS, ATTEMPT_LONG_MS, causeOfLog, attachCauses, summarizeAttempts, attemptsHeadline, attemptsVerdict } =
      await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'gradingTiming.js')).href)
    rec('상수: 이어 붙이기 30분·진행 중 2분·10분 넘음', ATTEMPT_JOIN_MS === 1800000 && ATTEMPT_FRESH_MS === 120000 && ATTEMPT_LONG_MS === 600000, '')
    rec('causeOfLog: status 503 → busy503', causeOfLog({ status: 503, message: '[congestion busy503 30000ms] ...' }) === 'busy503', '')
    rec('causeOfLog: 429·quota → limit', causeOfLog({ status: 429 }) === 'limit' && causeOfLog({ status: null, quota: true }) === 'limit', '')
    rec('causeOfLog: TIMEOUT → timeout', causeOfLog({ status: null, timeout: true }) === 'timeout' && causeOfLog({ message: 'TIMEOUT: AI 응답 27.3초 초과' }) === 'timeout', '')
    rec('causeOfLog: 그 밖·빈 값 → unknown', causeOfLog({ status: 500, message: 'x' }) === 'unknown' && causeOfLog(null) === 'unknown', '')

    const NOW = new Date('2026-11-10T06:00:00Z').getTime()
    const rows = [
      // A반: 성공 2(8초, 11분), 결과 못 받음 2(503 / 한도)
      { userId: 'u1', classId: 'A', startedAt: '2026-11-10T04:36:00Z', lastTryAt: '2026-11-10T04:36:00Z', finishedAt: '2026-11-10T04:36:08Z', waitMs: 8000, tries: 1 },
      { userId: 'u2', classId: 'A', startedAt: '2026-11-10T04:37:00Z', lastTryAt: '2026-11-10T04:47:30Z', finishedAt: '2026-11-10T04:48:00Z', waitMs: 660000, tries: 9 },
      { userId: 'u3', classId: 'A', startedAt: '2026-11-10T04:40:00Z', lastTryAt: '2026-11-10T05:06:00Z', finishedAt: null, waitMs: null, tries: 49 },
      { userId: 'u4', classId: 'A', startedAt: '2026-11-10T05:00:00Z', lastTryAt: '2026-11-10T05:05:00Z', finishedAt: null, waitMs: null, tries: 4 },
      // B반: 전날 성공 1, 원인 로그 없는 미완료 1, 타임아웃 미완료 1
      { userId: 'u5', classId: 'B', startedAt: '2026-11-09T01:00:00Z', lastTryAt: '2026-11-09T01:00:00Z', finishedAt: '2026-11-09T01:00:30Z', waitMs: 30000, tries: 1 },
      { userId: 'u6', classId: 'B', startedAt: '2026-11-09T01:10:00Z', lastTryAt: '2026-11-09T01:10:00Z', finishedAt: null, waitMs: null, tries: 1 },
      { userId: 'u7', classId: null, startedAt: '2026-11-09T01:20:00Z', lastTryAt: '2026-11-09T01:20:00Z', finishedAt: null, waitMs: null, tries: 1 },
      // 방금 누른 미완료(1분 전) → 진행 중, 집계 제외
      { userId: 'u8', classId: 'A', startedAt: '2026-11-10T05:59:00Z', lastTryAt: '2026-11-10T05:59:00Z', finishedAt: null, waitMs: null, tries: 1 },
      { userId: 'u9', classId: 'A', startedAt: 'bad', finishedAt: null },   // 무시
    ]
    const logs = [
      { userId: 'u3', at: '2026-11-10T04:41:00Z', status: 429, quota: true },                 // 먼저 한도
      { userId: 'u3', at: '2026-11-10T05:06:30Z', status: 503, message: 'busy' },            // 마지막은 503 → busy503
      { userId: 'u3', at: '2026-11-10T05:30:00Z', status: 429, quota: true },                 // 창 밖(마지막 누름 2분 뒤 이후) → 무시
      { userId: 'u4', at: '2026-11-10T05:05:10Z', status: 429, quota: true },
      { userId: 'u7', at: '2026-11-09T01:20:28Z', status: null, timeout: true, message: 'TIMEOUT: AI 응답 27.3초 초과' },
      { userId: 'u1', at: '2026-11-10T04:36:05Z', status: 503 },                              // 완료 행 → 원인 안 붙음
      { userId: 'u6', at: '2026-11-08T01:10:00Z', status: 503 },                              // 하루 전 → 창 밖
    ]
    const withCause = attachCauses(rows, logs)
    const cause = (u) => withCause.find(r => r.userId === u)?.cause
    rec('attachCauses: 창 안 마지막 로그로 판정(u3 503)·한도(u4)·타임아웃(u7)', cause('u3') === 'busy503' && cause('u4') === 'limit' && cause('u7') === 'timeout', `${cause('u3')}/${cause('u4')}/${cause('u7')}`)
    rec('attachCauses: 로그 없음·창 밖 → unknown(u6), 완료 행은 null(u1)', cause('u6') === 'unknown' && cause('u1') === null, `${cause('u6')}/${cause('u1')}`)

    const s = summarizeAttempts(withCause, NOW)
    rec('total: 시도 7(진행 중 1·잘못된 행 제외)·결과 받음 3·결과 못 받음 4', s.total.n === 7 && s.total.done === 3 && s.total.unfinished === 4 && s.inProgress === 1, JSON.stringify({ n: s.total.n, done: s.total.done, un: s.total.unfinished, ip: s.inProgress }))
    rec('total: 대기 보통 30000·95% 660000·가장 오래 660000(결과 받은 시도만)', s.total.p50 === 30000 && s.total.p95 === 660000 && s.total.max === 660000, JSON.stringify({ p50: s.total.p50, p95: s.total.p95, max: s.total.max }))
    rec('total: 10분 넘음 2(11분 걸려 받은 u2 + 26분 누른 미완료 u3), 5분 누른 u4는 아님', s.total.over10 === 2, `over10=${s.total.over10}`)
    rec('total: 누른 횟수 보통 1·최다 49', s.total.triesP50 === 1 && s.total.triesMax === 49, `${s.total.triesP50}/${s.total.triesMax}`)
    rec('causes: 503 1·한도 1·시간 초과 1·원인 불명 1', s.causes.busy503 === 1 && s.causes.limit === 1 && s.causes.timeout === 1 && s.causes.unknown === 1, JSON.stringify(s.causes))
    rec('byDay 최신순(KST), 11/10 시도 4·못 받음 2 / 11/09 시도 3·못 받음 2', s.byDay.length === 2 && s.byDay[0].key === '2026-11-10' && s.byDay[0].n === 4 && s.byDay[0].unfinished === 2 && s.byDay[1].n === 3 && s.byDay[1].unfinished === 2, JSON.stringify(s.byDay.map(d => [d.key, d.n, d.unfinished])))
    rec('byClass 시도순 A4·B2·unknown1, A 못 받음 2', s.byClass.map(c => `${c.key}${c.n}`).join(',') === 'A4,B2,unknown1' && s.byClass[0].unfinished === 2, s.byClass.map(c => `${c.key}${c.n}`).join(','))
    const v = attemptsVerdict(s)
    rec('해석 줄: 사실 문장(시간 초과 포함)', v.tone === 'warn' && v.text === '결과 못 받은 시도 4건, 그중 503 1건·한도 초과 1건·시간 초과 1건·원인 불명 1건', v.text)
    const v2 = attemptsVerdict({ total: { n: 9, unfinished: 3 }, causes: { busy503: 2, limit: 1, timeout: 0, unknown: 0 } })
    rec('해석 줄: 시간 초과 0이면 생략', v2.text === '결과 못 받은 시도 3건, 그중 503 2건·한도 초과 1건·원인 불명 0건', v2.text)
    rec('해석 줄: 못 받은 시도 0 → "결과 못 받은 시도가 없어요.", 기록 0 → 빈 문장', attemptsVerdict({ total: { n: 5, unfinished: 0 } }).text === '결과 못 받은 시도가 없어요.' && attemptsVerdict({ total: { n: 0 } }).tone === 'none', '')
    rec('해석 줄에 추측 낱말 없음(가능성·같아요·추정)', !/가능성|같아요|추정/.test(v.text + v2.text), '')
    const h = attemptsHeadline(s.total)
    rec('머리 문장', h === '최근 14일 7번 시도 · 보통 30.0초 · 거의 모두(95%) 11분 안 · 가장 오래 11분 · 결과 못 받음 4건 · 10분 넘음 2건', h)
    rec('빈 입력 → n 0·null·머리 "아직 기록이 없어요"', summarizeAttempts([], NOW).total.n === 0 && summarizeAttempts(null, NOW).total.p50 === null && attemptsHeadline(summarizeAttempts([], NOW).total) === '아직 기록이 없어요', '')
  }

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
