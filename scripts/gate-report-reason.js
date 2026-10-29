// step649: 신고 사유 구조화(lib/reportReason.js) 회귀 게이트 (읽기 전용 — lib는 import만)
//
// ▶ lib/reportReason.js 수정 시 커밋 전 실행:  node scripts/gate-report-reason.js
//   규칙: "[태그] 상세" 직렬화·역직렬화, 상세 40자 절단, 목록 밖 태그 거부, 구 자유 입력 호환, 하루 3회 상한.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const { REPORT_TAGS, REPORT_DETAIL_MAX, REPORT_DAILY_LIMIT, buildReportReason, parseReportReason, isDailyLimitReached } =
    await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'reportReason.js')).href)
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })

  rec('태그 5개·라벨 고정', REPORT_TAGS.length === 5 && REPORT_TAGS.map(t => t.label).join('|') === '점수가 이상해요|맞춤법 지적이 틀렸어요|내 글에 없는 말을 해요|무슨 말인지 모르겠어요|기타', REPORT_TAGS.map(t => t.label).join('|'))
  rec('상세 없음 → "[태그]"', buildReportReason('점수가 이상해요', '') === '[점수가 이상해요]', buildReportReason('점수가 이상해요', ''))
  rec('상세 있음 → "[태그] 상세"(공백 정리)', buildReportReason('기타', '  너무   짧아요 ') === '[기타] 너무 짧아요', buildReportReason('기타', '  너무   짧아요 '))
  rec(`상세 ${REPORT_DETAIL_MAX}자 절단`, parseReportReason(buildReportReason('기타', 'a'.repeat(100))).text.length === REPORT_DETAIL_MAX, '')
  rec('목록 밖 태그 → null(저장 거부)', buildReportReason('아무거나', 'x') === null && buildReportReason('', 'x') === null, '')
  { const p = parseReportReason('[맞춤법 지적이 틀렸어요] 가전제품 왕복')
    rec('역직렬화 tag·text', p.tag === '맞춤법 지적이 틀렸어요' && p.text === '가전제품 왕복', JSON.stringify(p)) }
  { const p = parseReportReason('다 맞았는데 틀렸다고 함')
    rec('구 자유 입력(접두 없음) → tag null·text 원문', p.tag === null && p.text === '다 맞았는데 틀렸다고 함', JSON.stringify(p)) }
  rec('빈 값 → tag null·text ""', parseReportReason(null).tag === null && parseReportReason('').text === '', '')
  rec(`하루 상한 ${REPORT_DAILY_LIMIT}: 2→false, 3→true, 비수치→false`, !isDailyLimitReached(2) && isDailyLimitReached(3) && !isDailyLimitReached('x'), '')

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
