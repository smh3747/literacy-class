// step643: 채점 대기 시간 실측(lib/gradingTiming.js) 회귀 게이트 (읽기 전용 — lib는 import만)
//
// ▶ lib/gradingTiming.js 수정 시 커밋 전 실행:  node scripts/gate-grading-timing.js
//   경로 우선순위(error_then_retry > fallback > retry_N > pending > inline)·퍼센타일(nearest-rank)·60초 초과·KST 일자 고정.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const { deriveGradingPath, pathFamily, percentile, kstDay, summarizeTimings, fmtSec, OVER_MS } =
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
  rec('OVER_MS = 60000', OVER_MS === 60000, '')

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
