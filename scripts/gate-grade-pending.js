// step669: 채점 보류 표식(lib/gradeStatus.js) 회귀 게이트 (읽기 전용 — lib는 import만)
//
// ▶ lib/gradeStatus.js 수정 시 커밋 전 실행:  node scripts/gate-grade-pending.js
//   고정하는 것: 표식 판정, 점수 없는 행의 표시 순서(보류 → 실패 → 그 밖), 엑셀 칸, 저장 필드(total_score는 반드시 null),
//   안전 필터 표식(lib/safetyBlock.js)과 서로 겹치지 않음.

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const imp = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href)
  const g = await imp('lib/gradeStatus.js')
  const sb = await imp('lib/safetyBlock.js')
  const { isPendingGrade, isFailedGrade, noScoreLabel, noScoreHint, exportScoreCell, pendingRowFields,
    GRADE_PENDING, GRADE_DONE, GRADE_FAILED, GRADE_REASONS,
    STUDENT_PENDING_TITLE, STUDENT_PENDING_MESSAGE, STUDENT_PENDING_SHORT,
    TEACHER_PENDING_LABEL, TEACHER_PENDING_HINT, TEACHER_FAILED_LABEL, TEACHER_FAILED_HINT } = g

  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })

  const pending = { grade_status: 'pending', total_score: null, graded_with_model: null }
  const failed = { grade_status: 'failed', total_score: null, graded_with_model: null }
  const done = { grade_status: 'done', total_score: 82, max_score: 100, graded_with_model: 'x' }
  const legacy = { total_score: 75, max_score: 100 }                                   // 기존 글(grade_status 없음)
  const blocked = { total_score: null, graded_with_model: sb.SAFETY_BLOCKED_MODEL }    // 안전 필터 행

  // ── 표식 판정 ──
  rec('상수 값 pending·done·failed', GRADE_PENDING === 'pending' && GRADE_DONE === 'done' && GRADE_FAILED === 'failed', '')
  rec('isPendingGrade: pending만 true', isPendingGrade(pending) && !isPendingGrade(failed) && !isPendingGrade(done) && !isPendingGrade(legacy) && !isPendingGrade(null), '')
  rec('isFailedGrade: failed만 true', isFailedGrade(failed) && !isFailedGrade(pending) && !isFailedGrade(done) && !isFailedGrade(legacy) && !isFailedGrade(undefined), '')
  rec('안전 필터 행은 보류·실패가 아니다', !isPendingGrade(blocked) && !isFailedGrade(blocked), '')
  rec('보류·실패 행은 안전 필터 행이 아니다', !sb.isBlockedSubmission(pending) && !sb.isBlockedSubmission(failed), '')

  // ── 점수 없는 행 표시 ──
  rec('noScoreLabel 교사: 보류 → "⏳ 채점 대기"', noScoreLabel(pending, 'AI 평가 없음') === '⏳ 채점 대기' && TEACHER_PENDING_LABEL === '⏳ 채점 대기', noScoreLabel(pending, 'x'))
  rec('noScoreLabel 교사: 실패 → "⚠ 채점 실패"', noScoreLabel(failed, 'AI 평가 없음') === '⚠ 채점 실패' && TEACHER_FAILED_LABEL === '⚠ 채점 실패', noScoreLabel(failed, 'x'))
  rec('noScoreLabel: 안전 필터·기존 글은 호출처 기본 문구 그대로', noScoreLabel(blocked, '🟣 AI 평가 없음') === '🟣 AI 평가 없음' && noScoreLabel(legacy, 'AI 평가 없음(필터)') === 'AI 평가 없음(필터)', '')
  rec('noScoreLabel 학생: 보류 → "⏳ 점수를 기다리고 있어요", 실패는 기본 문구', noScoreLabel(pending, 'AI 평가 없음', 'student') === STUDENT_PENDING_SHORT && STUDENT_PENDING_SHORT === '⏳ 점수를 기다리고 있어요' && noScoreLabel(failed, 'AI 평가 없음', 'student') === 'AI 평가 없음', '')
  rec('noScoreHint: 보류·실패는 전용 설명, 그 밖은 기본 설명', noScoreHint(pending, 'd') === TEACHER_PENDING_HINT && noScoreHint(failed, 'd') === TEACHER_FAILED_HINT && noScoreHint(blocked, 'd') === 'd', '')

  // ── 학생 문구(승인 문구 고정) ──
  rec('학생 안내 문구: "글은 잘 냈어요. AI가 바빠서 점수는 조금 뒤에 나와요."', STUDENT_PENDING_MESSAGE === '글은 잘 냈어요. AI가 바빠서 점수는 조금 뒤에 나와요.', STUDENT_PENDING_MESSAGE)
  rec('학생 문구에 반말 지칭·대시 없음', ![STUDENT_PENDING_TITLE, STUDENT_PENDING_MESSAGE, STUDENT_PENDING_SHORT].some(t => /—|너의|네 글|니 /.test(t)), '')

  // ── 엑셀 ──
  rec('exportScoreCell: 점수 있으면 숫자 그대로(0점 포함)', exportScoreCell(done) === 82 && exportScoreCell({ total_score: 0 }) === 0, '')
  rec('exportScoreCell: 보류 "채점 대기"·실패 "채점 실패"', exportScoreCell(pending) === '채점 대기' && exportScoreCell(failed) === '채점 실패', '')
  rec('exportScoreCell: 안전 필터 행은 종전대로 빈 값(null)', exportScoreCell(blocked) === null, String(exportScoreCell(blocked)))

  // ── 저장 필드 ──
  const f = pendingRowFields(100, 'busy503')
  rec('pendingRowFields: total_score·scores·피드백은 null(0 금지)', f.total_score === null && f.scores === null && f.feedback_overall === null && f.feedback_good === null && f.feedback_improve === null && f.rubric_reasons === null && f.improve_examples === null, JSON.stringify(f))
  rec('pendingRowFields: max_score 100·corrections 빈 배열·grade_status pending·grade_reason busy503', f.max_score === 100 && Array.isArray(f.corrections) && f.corrections.length === 0 && f.grade_status === 'pending' && f.grade_reason === 'busy503', '')
  rec('pendingRowFields: 안전 필터 표식을 쓰지 않는다(graded_with_model null)', f.graded_with_model === null && !sb.isBlockedSubmission(f) && isPendingGrade(f), '')
  rec('pendingRowFields: 모르는 이유는 null, 허용 이유 3종', pendingRowFields(100, 'weird').grade_reason === null && GRADE_REASONS.join(',') === 'busy503,limit,timeout', '')
  rec('pendingRowFields: 배점 합이 숫자가 아니면 max_score null', pendingRowFields(undefined, 'limit').max_score === null, '')
  rec('안전 필터 blockedRowFields도 total_score null(같은 방식)', sb.blockedRowFields(100).total_score === null, '')

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
