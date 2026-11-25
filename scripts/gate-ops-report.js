// step688: 매일 운영 보고서 + 즉시 알림의 회귀 게이트 (읽기 전용, DB·네트워크 없음)
//
// ▶ lib/opsReport.js · lib/opsReport.server.js · lib/opsAlert.server.js · pages/api/cron-ops-report.js ·
//   pages/api/admin-ops-report.js · pages/api/grading-attempt.js(알림 검사 호출) · components/OpsReportCard.js 수정 시 커밋 전 필수:
//     node scripts/gate-ops-report.js
//   고정하는 것: ① 판정 규칙(10/27~11/24 실제 수치에서 11/03·11/05·11/10만 빨강, 11/04·11/09만 노랑)
//               ② 수치 집계(15시 구간 경계, 수업일 평균, 오름·같음·내림, 조용한 학급·돌아온 학급, 쌓인 것과 증감)
//               ③ 시험 반 제외 ④ 즉시 알림 조건과 30분 간격 ⑤ 본문·실명을 읽지 않음, 채점 경로(ai.js) 미접촉
//   판정 기준을 일부러 바꾸면 아래 DAYS 기대값도 같은 커밋에서 고친다.

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

// [보고 날짜, 기대 판정, 채점오류, 한 학급 최대, 시도 수, 1분 넘음, 95% 대기(ms), 못 받음, 한 학급 최대, 보류, 한 학급 최대, 호출 추정 %]
const DAYS = [
  ['2026-10-27', 'green', 7, 5, 0, 0, null, 0, 0, 0, 0, 48],
  ['2026-10-28', 'green', 3, 3, 0, 0, null, 0, 0, 0, 0, 48],
  ['2026-10-29', 'green', 0, 0, 2, 0, 8948, 0, 0, 0, 0, 35],
  ['2026-10-30', 'green', 0, 0, 193, 0, 15668, 0, 0, 0, 0, 43],
  ['2026-10-31', 'green', 0, 0, 0, 0, null, 0, 0, 0, 0, 43],
  ['2026-11-01', 'green', 0, 0, 1, 0, 16502, 0, 0, 0, 0, 0],
  ['2026-11-02', 'green', 0, 0, 215, 1, 30834, 0, 0, 0, 0, 43],
  ['2026-11-03', 'red', 180, 127, 198, 14, 106971, 0, 0, 0, 0, 44],
  ['2026-11-04', 'yellow', 34, 16, 215, 7, 44856, 0, 0, 0, 0, 44],
  ['2026-11-05', 'red', 178, 99, 209, 1, 21819, 0, 0, 0, 0, 43],
  ['2026-11-06', 'green', 2, 1, 75, 0, 19031, 0, 0, 0, 0, 38],
  ['2026-11-07', 'green', 0, 0, 0, 0, null, 0, 0, 0, 0, 10],
  ['2026-11-08', 'green', 0, 0, 0, 0, null, 0, 0, 0, 0, null],
  ['2026-11-09', 'yellow', 42, 14, 210, 2, 28281, 0, 0, 0, 0, 44],
  ['2026-11-10', 'red', 189, 158, 127, 0, 21195, 0, 0, 0, 0, 44],
  ['2026-11-11', 'green', 1, 1, 231, 3, 21801, 1, 1, 0, 0, 22],
  ['2026-11-12', 'green', 1, 1, 120, 1, 11899, 3, 2, 1, 1, 22],
  ['2026-11-13', 'green', 1, 1, 77, 1, 19462, 0, 0, 0, 0, 12],
  ['2026-11-14', 'green', 0, 0, 1, 0, 36765, 0, 0, 0, 0, 9],
  ['2026-11-15', 'green', 0, 0, 0, 0, null, 0, 0, 0, 0, null],
  ['2026-11-16', 'green', 0, 0, 250, 0, 12821, 0, 0, 0, 0, 26],
  ['2026-11-17', 'green', 0, 0, 74, 0, 9174, 0, 0, 0, 0, 26],
  ['2026-11-18', 'green', 1, 1, 251, 2, 16639, 1, 1, 1, 1, 27],
  ['2026-11-19', 'green', 0, 0, 192, 0, 8758, 0, 0, 0, 0, 29],
  ['2026-11-20', 'green', 0, 0, 66, 0, 14691, 2, 1, 0, 0, 29],
  ['2026-11-21', 'green', 0, 0, 0, 0, null, 0, 0, 0, 0, 11],
  ['2026-11-22', 'green', 0, 0, 0, 0, null, 0, 0, 0, 0, null],
  ['2026-11-23', 'green', 0, 0, 235, 0, 14861, 1, 1, 0, 0, 36],
  ['2026-11-24', 'green', 0, 0, 59, 0, 22724, 2, 1, 0, 0, 36],
]

;(async () => {
  const root = path.join(__dirname, '..')
  const O = await import(pathToFileURL(path.join(root, 'lib/opsReport.js')).href)
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) })
  const eq = (name, got, want) => rec(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)

  // ── ① 판정 규칙 ──
  const judgeOf = (d) => O.judgeOps({ gradeErrors: d[2], gradeErrorsMaxClass: d[3], attempts: d[4], over60: d[5], p95: d[6], open: d[7], openMaxClass: d[8], deferred: d[9], deferredMaxClass: d[10], stale: null, callsPct: d[11] }).verdict
  for (const d of DAYS) rec(`판정 ${d[0]} → ${d[1]}`, judgeOf(d) === d[1], judgeOf(d))
  eq('빨강인 날은 11/03·11/05·11/10뿐', DAYS.filter(d => judgeOf(d) === 'red').map(d => d[0]), ['2026-11-03', '2026-11-05', '2026-11-10'])
  eq('노랑인 날은 11/04·11/09뿐', DAYS.filter(d => judgeOf(d) === 'yellow').map(d => d[0]), ['2026-11-04', '2026-11-09'])
  const base = { gradeErrors: 0, gradeErrorsMaxClass: 0, attempts: 200, over60: 0, p95: 10000, open: 0, openMaxClass: 0, deferred: 0, deferredMaxClass: 0, stale: 0, callsPct: 20 }
  const v = (x) => O.judgeOps({ ...base, ...x }).verdict
  eq('아무 신호 없음 → 초록', v({}), 'green')
  eq('제출 0건인 날 → 초록(사용량이 적다고 노랑이 되지 않는다)', v({ attempts: 0, p95: null }), 'green')
  eq('제출 1건에 대기 80초 → 초록(표본 30건 미만은 95% 기준을 보지 않는다)', v({ attempts: 1, p95: 80000 }), 'green')
  eq('채점 오류 9건 → 초록', v({ gradeErrors: 9, gradeErrorsMaxClass: 9 }), 'green')
  eq('채점 오류 10건 → 노랑', v({ gradeErrors: 10, gradeErrorsMaxClass: 4 }), 'yellow')
  eq('채점 오류 59건(한 학급 29건) → 노랑', v({ gradeErrors: 59, gradeErrorsMaxClass: 29 }), 'yellow')
  eq('채점 오류 60건 → 빨강', v({ gradeErrors: 60, gradeErrorsMaxClass: 10 }), 'red')
  eq('한 학급 채점 오류 30건 → 빨강', v({ gradeErrors: 30, gradeErrorsMaxClass: 30 }), 'red')
  eq('1분 넘음 3건이지만 1.5% → 초록', v({ over60: 3 }), 'green')
  eq('1분 넘음 4건 2% → 노랑', v({ over60: 4 }), 'yellow')
  eq('1분 넘음 10건 5% → 빨강', v({ over60: 10 }), 'red')
  eq('95% 대기 39.9초 → 초록', v({ p95: 39900 }), 'green')
  eq('95% 대기 40초 → 노랑', v({ p95: 40000 }), 'yellow')
  eq('95% 대기 90초 → 빨강', v({ p95: 90000 }), 'red')
  eq('못 받음 4건(한 학급 2건) → 초록', v({ open: 4, openMaxClass: 2 }), 'green')
  eq('못 받음 한 학급 3건 → 노랑', v({ open: 3, openMaxClass: 3 }), 'yellow')
  eq('못 받음 5건 → 노랑', v({ open: 5, openMaxClass: 1 }), 'yellow')
  eq('못 받음 10건 → 빨강', v({ open: 10, openMaxClass: 2 }), 'red')
  eq('못 받음 한 학급 5건 → 빨강', v({ open: 5, openMaxClass: 5 }), 'red')
  eq('보류 4건 → 초록', v({ deferred: 4, deferredMaxClass: 4 }), 'green')
  eq('보류 5건 → 노랑', v({ deferred: 5, deferredMaxClass: 2 }), 'yellow')
  eq('보류 30건 → 빨강', v({ deferred: 30, deferredMaxClass: 5 }), 'red')
  eq('보류 한 학급 15건 → 빨강', v({ deferred: 15, deferredMaxClass: 15 }), 'red')
  eq('15분 넘은 대기 1건 → 노랑', v({ stale: 1 }), 'yellow')
  eq('15분 넘은 대기 10건 → 빨강', v({ stale: 10 }), 'red')
  eq('호출 추정 80% → 노랑', v({ callsPct: 80 }), 'yellow')
  eq('호출 추정 100% → 빨강', v({ callsPct: 100 }), 'red')
  eq('지난 날짜(stale·callsPct 없음)는 그 기준을 건너뛴다', v({ stale: null, callsPct: null }), 'green')
  { const r = O.judgeOps({ ...base, gradeErrors: 189, gradeErrorsMaxClass: 158 })
    rec('사유 문장은 수치만 담는다', r.reasons.length === 1 && r.reasons[0].text === '채점 서버 오류가 189건이었고 한 학급에서 가장 많이 158건이 나왔어요.', r.reasons[0] && r.reasons[0].text) }

  // ── 날짜 ──
  { const w = O.windowOf('2026-11-25')
    eq('구간: 전날 15:00 ~ 당일 15:00(KST)', [new Date(w.startMs).toISOString(), new Date(w.endMs).toISOString()], ['2026-11-24T06:00:00.000Z', '2026-11-25T06:00:00.000Z'])
    eq('15:00 정각은 다음 날 보고에 들어간다', O.dateKeyOfMs(w.endMs), '2026-11-26')
    eq('14:59:59는 그날 보고에 들어간다', O.dateKeyOfMs(w.endMs - 1), '2026-11-25')
    eq('크론 날짜: 15:05에는 오늘', O.closedReportDate(Date.parse('2026-11-25T15:05:00+09:00')), '2026-11-25')
    eq('크론 날짜: 14:55에는 어제', O.closedReportDate(Date.parse('2026-11-25T14:55:00+09:00')), '2026-11-24')
    eq('화면이 기대하는 날짜: 15:30에는 아직 어제', O.expectedReportDate(Date.parse('2026-11-25T15:30:00+09:00')), '2026-11-24')
    eq('화면이 기대하는 날짜: 16:00부터 오늘', O.expectedReportDate(Date.parse('2026-11-25T16:00:00+09:00')), '2026-11-25')
    eq('화면이 기대하는 날짜: 자정 뒤 새벽에는 전날', O.expectedReportDate(Date.parse('2026-11-26T01:00:00+09:00')), '2026-11-25')
    eq('요일: 2026-11-27은 금요일', O.weekdayOf('2026-11-27'), 5) }

  // ── ②③ 수치 집계 + 시험 반 제외 ──
  const T = O.OPS_TEST_CLASS_ID
  rec('시험 반 id가 lib/testStudent.js와 같다', read('lib/testStudent.js').includes(`export const TEST_CLASS_ID = '${T}'`))
  const D = '2026-11-27'   // 금요일
  const at = (dayKey, hhmm) => new Date(`${dayKey}T${hhmm}:00+09:00`).toISOString()
  const classes = [
    { id: 'cA', name: '5학년 1반', school: '가나초', teacher_id: 'tA', created_at: at('2026-09-01', '09:00'), deleted_at: null, peer_share_enabled: true, auto_supply_enabled: true },
    { id: 'cB', name: '6학년 2반', school: '다라초', teacher_id: 'tB', created_at: at('2026-11-27', '09:00'), deleted_at: null, peer_share_enabled: false, auto_supply_enabled: false },
    { id: 'cC', name: '4학년 3반', school: '마바초', teacher_id: 'tC', created_at: at('2026-09-01', '09:00'), deleted_at: null, peer_share_enabled: false, auto_supply_enabled: false },
    { id: 'cD', name: '3학년 4반', school: '사아초', teacher_id: 'tD', created_at: at('2026-09-01', '09:00'), deleted_at: null, peer_share_enabled: false, auto_supply_enabled: false },
    { id: T, name: '5학년 2반', school: '구릉초', teacher_id: 'tT', created_at: at('2026-11-27', '09:00'), deleted_at: null, peer_share_enabled: true, auto_supply_enabled: true },
  ]
  const profiles = [
    { id: 'tA', class_id: 'cA', role: 'teacher', created_at: at('2026-09-01', '09:00'), deleted_at: null },
    { id: 'tB', class_id: 'cB', role: 'teacher', created_at: at('2026-11-27', '09:00'), deleted_at: null },
    { id: 'tC', class_id: 'cC', role: 'teacher', created_at: at('2026-11-20', '09:00'), deleted_at: null },
    { id: 'tD', class_id: 'cD', role: 'teacher', created_at: at('2026-09-01', '09:00'), deleted_at: null },
    { id: 'a1', class_id: 'cA', role: 'student', created_at: at('2026-09-02', '09:00'), deleted_at: null },
    { id: 'a2', class_id: 'cA', role: 'student', created_at: at('2026-09-02', '09:00'), deleted_at: null },
    { id: 'b1', class_id: 'cB', role: 'student', created_at: at('2026-11-27', '09:30'), deleted_at: null },
    { id: 'c1', class_id: 'cC', role: 'student', created_at: at('2026-09-02', '09:00'), deleted_at: null },
    { id: 'd1', class_id: 'cD', role: 'student', created_at: at('2026-09-02', '09:00'), deleted_at: null },
    { id: 'x1', class_id: T, role: 'student', created_at: at('2026-11-27', '09:30'), deleted_at: null },
  ]
  let sid = 0
  const sub = (user, topic, attempt, score, when, extra = {}) => ({ id: `s${++sid}`, user_id: user, topic_id: topic, attempt, total_score: score, max_score: 100, created_at: when, grading_ms: null, grade_reason: null, graded_with_model: 'm', ...extra })
  const subs = [
    sub('a1', 't1', 1, 60, at('2026-11-26', '15:00')),              // 구간 시작 정각 → 포함
    sub('a1', 't1', 2, 70, at('2026-11-27', '10:00')),              // 오름
    sub('a2', 't1', 1, 80, at('2026-11-27', '10:00')),
    sub('a2', 't1', 2, 80, at('2026-11-27', '10:10')),              // 같음
    sub('a2', 't1', 3, 75, at('2026-11-27', '10:20')),              // 내림
    sub('b1', 'tS', 1, null, at('2026-11-27', '11:00'), { grade_reason: 'busy503' }),   // 보류, 전국 주제, 처음 쓴 학급
    sub('c1', 't3', 1, 50, at('2026-11-27', '12:00'), { graded_with_model: 'safety_blocked' }),   // 돌아온 학급
    sub('a1', 't9', 1, 90, at('2026-11-27', '15:00')),              // 구간 끝 정각 → 제외
    sub('x1', 't1', 1, 10, at('2026-11-27', '10:00')),              // 시험 반 → 제외
    sub('c1', 't2', 1, 55, at('2026-11-01', '10:00')),              // cC의 앞 글(26일 전)
    sub('d1', 't4', 1, 55, at('2026-11-05', '10:00')),              // cD: 22일째 조용
  ]
  // 수업일 평균용: 11/23(월)~11/26(목) 보고 날짜에 각 20·30·40·10편(목요일 10편은 수업일 아님)
  const filler = []
  const addFill = (dayKey, n) => { for (let i = 0; i < n; i++) filler.push({ user_id: 'a1', created_at: at(dayKey, '10:00') }) }
  addFill('2026-11-23', 20); addFill('2026-11-24', 30); addFill('2026-11-25', 40); addFill('2026-11-26', 10)
  const data = {
    profiles, classes, subs,
    subsAll: [...subs.map(s => ({ user_id: s.user_id, created_at: s.created_at })), ...filler],
    pendingRows: [
      { user_id: 'b1', created_at: at('2026-11-27', '11:00'), grade_status: 'pending' },
      { user_id: 'x1', created_at: at('2026-11-27', '11:00'), grade_status: 'pending' },
    ],
    reports: [
      { user_id: 'a1', report_reason: '[점수가 이상해요] 너무 낮아요', reported_at: at('2026-11-27', '10:30'), report_resolved_at: null },
      { user_id: 'a2', report_reason: '옛 신고', reported_at: at('2026-10-01', '10:30'), report_resolved_at: null },
      { user_id: 'a2', report_reason: '[기타]', reported_at: at('2026-10-02', '10:30'), report_resolved_at: at('2026-10-03', '10:30') },
      { user_id: 'x1', report_reason: '[기타]', reported_at: at('2026-11-27', '10:30'), report_resolved_at: null },
    ],
    supplyTopicIds: ['tS'],
    attempts: [
      { class_id: 'cA', started_at: at('2026-11-27', '10:00'), last_try_at: at('2026-11-27', '10:00'), finished_at: at('2026-11-27', '10:00'), wait_ms: 5000, tries: 1, phase: 'first', precheck_ms: 100, grade_ms: 4000, save_ms: null },
      { class_id: 'cA', started_at: at('2026-11-27', '10:01'), last_try_at: at('2026-11-27', '10:01'), finished_at: at('2026-11-27', '10:03'), wait_ms: 70000, tries: 3, phase: 'rewrite', precheck_ms: null, grade_ms: null, save_ms: null },
      { class_id: 'cA', started_at: at('2026-11-27', '10:05'), last_try_at: at('2026-11-27', '10:06'), finished_at: null, wait_ms: null, tries: 2, phase: 'first' },                  // 못 받음
      { class_id: 'cB', started_at: at('2026-11-27', '14:59'), last_try_at: at('2026-11-27', '14:59'), finished_at: null, wait_ms: null, tries: 1, phase: 'first' },                  // 방금 누름 → 진행 중으로 뺌
      { class_id: T, started_at: at('2026-11-27', '10:05'), last_try_at: at('2026-11-27', '10:06'), finished_at: null, wait_ms: null, tries: 9, phase: 'first' },                       // 시험 반
    ],
    logs: [
      { created_at: at('2026-11-27', '10:00'), class_id: 'cA', error_type: 'api_error', ai_type: 'grading' },
      { created_at: at('2026-11-27', '10:01'), class_id: 'cA', error_type: 'api_error', ai_type: 'rewriteGrading' },
      { created_at: at('2026-11-27', '10:02'), class_id: 'cA', error_type: 'api_error', ai_type: 'topicSuggest' },
      { created_at: at('2026-11-27', '10:03'), class_id: 'cB', error_type: 'auth_bounce', ai_type: null },
      { created_at: at('2026-11-27', '10:03'), class_id: T, error_type: 'api_error', ai_type: 'grading' },
      { created_at: at('2026-11-26', '10:03'), class_id: 'cA', error_type: 'api_error', ai_type: 'grading' },     // 앞 구간
    ],
    alerts: [{ detected_at: at('2026-11-27', '09:00') }, { detected_at: at('2026-11-20', '09:00') }],
    messages: [
      { teacher_id: 'tA', sender_id: 'tA', read_at: null, created_at: at('2026-11-27', '09:00') },       // 교사가 보낸 새 쪽지(안 읽음)
      { teacher_id: 'tA', sender_id: 'adm', read_at: null, created_at: at('2026-11-27', '09:10') },      // 관리자가 보낸 것 → 세지 않음
      { teacher_id: 'tC', sender_id: 'tC', read_at: at('2026-11-21', '09:00'), created_at: at('2026-11-20', '09:00') },
    ],
    feedback: [
      { user_id: 'a1', created_at: at('2026-11-27', '09:00'), replied_at: null },
      { user_id: 'tA', created_at: at('2026-09-15', '09:00'), replied_at: null },     // 교사가 보낸 의견
      { user_id: 'a2', created_at: at('2026-09-16', '09:00'), replied_at: at('2026-09-17', '09:00') },
    ],
    peerViews: [{ class_id: 'cA', created_at: at('2026-11-27', '09:00') }, { class_id: T, created_at: at('2026-11-27', '09:00') }],
    showcaseViews: [{ student_id: 'b1', created_at: at('2026-11-27', '09:00') }, { student_id: 'x1', created_at: at('2026-11-27', '09:00') }],
    tutor: [{ user_id: 'a1', used_date: D, count: 3 }, { user_id: 'x1', used_date: D, count: 5 }, { user_id: 'a2', used_date: '2026-11-26', count: 7 }],
    examples: [{ user_id: 'a1', created_at: at('2026-11-27', '10:00') }, { user_id: 'x1', created_at: at('2026-11-27', '10:00') }],
    dbBytes: 100 * 1024 * 1024, subsRows: 12345,
  }
  const nowMs = Date.parse(at(D, '15:00')) + 30000   // 15:00:30에 만듦
  const rep = O.buildReport(data, D, { nowMs, prevBacklog: { messages: 0, feedback: 3, reports: 1, total: 4 }, weekVerdicts: ['green', 'yellow', 'green', 'red'] })
  const m = rep.metrics
  eq('제출 수: 구간 시작 정각은 넣고 끝 정각과 시험 반은 뺀다', [m.usage.submissions, m.usage.first, m.usage.rewrite], [7, 4, 3])
  eq('쓴 학급·교사·학생', [m.usage.classes, m.usage.teachers, m.usage.students], [3, 3, 4])
  eq('많이 쓴 학급 1위는 학교와 반 이름', m.usage.top[0], { name: '가나초 5학년 1반', n: 5 })
  eq('수업일 평균: 20편 미만인 날을 빼고 평균(20·30·40 → 30)', [m.usage.lessonAvg, m.usage.lessonDays], [30, 3])
  eq('새 교사·학급·학생(시험 반 학급·학생 제외)', [m.growth.newTeachers, m.growth.newClasses, m.growth.newStudents], [1, 1, 1])
  eq('누계(시험 반 제외)', [m.growth.totalTeachers, m.growth.totalClasses, m.growth.totalStudents], [4, 4, 5])
  eq('최근 14일 가입 교사 2명 중 첫 수업 2명', [m.growth.recentTeachers14, m.growth.recentTeachersActivated], [2, 2])
  eq('처음 글을 쓴 학급', m.growth.firstEver, [{ name: '다라초 6학년 2반' }])
  eq('다시 돌아온 학급(26일 만에)', m.growth.returned, [{ name: '마바초 4학년 3반', gapDays: 26 }])
  eq('14일 넘게 조용한 학급: 학교·반 이름과 마지막 제출 날짜', [m.growth.quietCount, m.growth.quiet], [1, [{ name: '사아초 3학년 4반', last: '2026-11-05', total: 1 }]])
  eq('최근 7일 활동 학급', m.growth.active7, 3)
  eq('첫 글 평균(점수 없는 보류 글 제외): (60+80+50)/3', [m.effect.firstAvgPct, m.effect.firstN], [63.3, 3])
  eq('수정본을 낸 학생 비율 2/4', [m.effect.rewriteStudents, m.effect.rewriteStudentPct], [2, 50])
  eq('수정 뒤 오름·같음·내림', [m.effect.up, m.effect.same, m.effect.down], [1, 1, 1])
  eq('글 모음: 켠 학급 1, 열람 1(시험 반 제외)', [m.features.peerOn, m.features.peerViews, m.features.peerViewClasses], [1, 1, 1])
  eq('전국 챌린지: 참여 학급 1, 글 1, 상위 글 열람 1', [m.features.challengeClasses, m.features.challengeSubs, m.features.showcaseViews], [1, 1, 1])
  eq('자동 받기·퀴즈·챗봇·예시', [m.features.autoSupplyOn, m.features.quiz, m.features.tutorUsers, m.features.tutorCount, m.features.examples], [1, null, 1, 3, 1])
  eq('시도 수(진행 중·시험 반 제외)와 대기', [m.stability.attempts, m.stability.p50, m.stability.max, m.stability.over60], [3, 5000, 70000, 1])
  eq('결과 못 받음', [m.stability.open, m.stability.openMaxClass], [1, 1])
  eq('구간 시간: 빈 값은 0으로 읽지 않는다', [m.stability.seg.precheck.n, m.stability.seg.grade.n, m.stability.seg.save.n], [1, 1, 0])
  eq('보류', [m.stability.deferred, m.stability.deferredBy, m.stability.deferredMaxClass], [1, { busy503: 1 }, 1])
  eq('지금 pending(시험 반 제외, 4시간 지나 15분 넘음)', [m.stability.pendingNow, m.stability.stalePending, m.stability.failedGrades], [1, 1, 0])
  eq('오류 종류별(앞 구간·시험 반 제외)', m.stability.errors, { api_error: 3, auth_bounce: 1 })
  eq('채점 서버 오류는 채점 호출만', [m.stability.gradeErrors, m.stability.gradeErrorsMaxClass], [2, 2])
  eq('오류 3건 이상 몰린 학급', m.stability.clusters, [{ name: '가나초 5학년 1반', n: 3 }])
  eq('신고 사유 칩별·의심 교정·안전 필터', [m.quality.reports, m.quality.reportTags, m.quality.alertsNew, m.quality.safety], [1, { '점수가 이상해요': 1 }, 1, 1])
  eq('오늘 새로 온 것: 교사 쪽지 1 + 의견 1 + 신고 1', [m.waiting.newMessages, m.waiting.newFeedback, m.waiting.newReports, m.waiting.newTotal], [1, 1, 1, 3])
  eq('카드 앞면 숫자는 오늘 새로 온 것', m.headline.newWaiting, 3)
  eq('쌓인 것: 읽지 않은 교사 쪽지 1, 답 없는 의견 2(학생 1·교사 1), 미해결 신고 2', m.waiting.backlog, { messages: 1, feedback: 2, feedbackStudent: 1, feedbackTeacher: 1, reports: 2, total: 5 })
  eq('오늘 새로 온 의견을 보낸 사람 역할로 나눈다(학생 1·교사 0)', [m.waiting.newFeedbackStudent, m.waiting.newFeedbackTeacher], [1, 0])
  { const r2 = O.buildReport(data, D, { nowMs, prevBacklog: { messages: 0, feedback: 3, feedbackStudent: 3, feedbackTeacher: 0, reports: 1, total: 4 } }).metrics.waiting
    eq('전날 보고에 나눈 값이 있으면 나눈 증감도 낸다', [r2.delta.feedbackStudent, r2.delta.feedbackTeacher], [-2, 1]) }
  { const rows = O.sectionsOf(m).find(s => s.key === 'waiting').rows
    eq('8번에 학생 의견과 교사 의견이 따로 있다', rows.filter(r => /의견/.test(r.label)).map(r => `${r.label}: ${r.value}`), ['답 없는 학생 의견: 1건', '답 없는 교사 의견: 1건'])
    rec('8번 새로 온 것 줄에도 나눠 적는다', rows[0].value === '3건 (교사 쪽지 1 · 학생 의견 1 · 교사 의견 0 · 신고 1)', rows[0].value) }
  eq('전날 대비 증감', m.waiting.delta, { messages: 1, feedback: -1, reports: 1, total: 1 })
  eq('가장 오래 기다린 것', m.waiting.oldest, { date: '2026-09-15', kind: '교사 의견' })
  eq('호출 추정 최고 학급: 누른 횟수 6 + 첫 글 2', m.resources.callsTop, { name: '가나초 5학년 1반', calls: 8, pct: 2 })
  eq('DB 용량 20%·줄 수', [m.resources.dbPct, m.resources.subsRows], [20, 12345])
  eq('판정: 15분 넘은 대기 1건으로 노랑', [rep.verdict, m.reasons.map(r => r.key)], ['yellow', ['stale']])
  eq('주간(금요일): 요일별 제출', m.weekly.days.map(d => d.n), [20, 30, 40, 10, 7])
  eq('주간: 한 주 합계', m.weekly.total, 107)
  rec('주간: 새로 생긴 일 3줄', m.weekly.news.length === 3 && m.weekly.news[2] === '이번 주 판정은 빨강 1일, 노랑 2일이에요.', m.weekly.news[2])
  eq('목요일 보고에는 주간이 없다', O.buildReport(data, '2026-11-26', { nowMs }).metrics.weekly, null)
  eq('문장 3줄', rep.lines.length, 3)
  eq('문장 1: 평균과 비교(사실만)', rep.lines[0], '제출 7편으로 최근 3 수업일 평균(30편)보다 적어요.')
  rec('문장에 대시와 추측 말이 없다', !rep.lines.concat(m.weekly.news).some(l => /—|때문|같아요\.|보여요|듯/.test(l)), rep.lines.join(' / '))
  eq('비교 말: 평균의 115% 이상·85% 이하·그 사이', [O.compareWord(115, 100), O.compareWord(85, 100), O.compareWord(100, 100), O.compareWord(5, 0)], ['보다 많아요', '보다 적어요', '과 비슷해요', null])
  { const z = O.buildReport({ ...data, subs: [], subsAll: [], attempts: [], logs: [], pendingRows: [] }, D, { nowMs })
    eq('제출 0건인 날: 초록 + "제출이 없었어요"', [z.verdict, z.lines[0]], ['green', '이 구간에는 제출이 없었어요.']) }
  { const h = O.buildReport(data, D, { nowMs, historical: true }).metrics
    eq('지난 날짜 채우기: 누계·쌓인 것·지금 pending·DB 용량·켠 학급 수는 비운다',
      [h.growth.totalTeachers, h.waiting.backlog, h.waiting.oldest, h.stability.pendingNow, h.resources.dbBytes, h.resources.subsRows, h.features.peerOn, h.features.autoSupplyOn],
      [null, null, null, null, null, null, null, null])
    eq('지난 날짜 채우기: 구간 안 수치는 그대로', [h.usage.submissions, h.waiting.newTotal, h.stability.gradeErrors], [7, 3, 2]) }
  { const p = O.buildReport(data, D, { nowMs: Date.parse(at(D, '10:05')) }).metrics
    eq('15시 전에 만들면 중간 보고(지금까지만 센다)', [p.window.partial, p.usage.submissions], [true, 3]) }
  { const secs = O.sectionsOf(m)
    eq('자세히 구획: 2~10번', secs.map(s => s.title.split('.')[0]), ['2', '3', '4', '5', '6', '7', '8', '9', '10'])
    rec('숫자마다 설명 한 줄', secs.every(s => s.rows.every(r => typeof r.info === 'string' && r.info.length > 5)) && O.headlineOf(m).every(h => h.info.length > 5))
    rec('화면 문구에 대시가 없다', !JSON.stringify(secs).includes('—') && !JSON.stringify(O.headlineOf(m)).includes('—'))
    const q = secs.find(s => s.key === 'growth').lists.find(l => l.title === '14일 넘게 조용한 학급')
    rec('조용한 학급 목록은 학교·반 이름으로 펼쳐 본다', q && q.items[0] === '사아초 3학년 4반 · 마지막 제출 2026-11-05 · 누적 1편', q && q.items[0])
    rec('DB 용량 설명에 한도가 가정값이라고 적는다', secs.find(s => s.key === 'resources').rows.find(r => r.label === 'DB 용량').info.includes('한도 500MB는 가정값이에요'))
    rec('퀴즈는 "기록 없음"', secs.find(s => s.key === 'features').rows.find(r => r.label === '맞춤법 퀴즈').value === '기록 없음')
    eq('카드 앞면 숫자 4개', O.headlineOf(m).map(h => h.label), ['제출 수', '쓴 학급', '거의 모두(95%) 대기', '오늘 새로 온 것']) }
  rec('보고에 학생 id·시험 반 id가 들어가지 않는다', !/"(a1|a2|b1|c1|d1|x1)"/.test(JSON.stringify(rep)) && !JSON.stringify(rep).includes(T))

  // ── ④ 즉시 알림 ──
  const kinds = (c) => O.alertKindsOf({ gradeErrors: 0, gradeErrorsMaxClass: 0, deferred: 0, open: 0, openMaxClass: 0, ...c }).map(k => k.kind)
  eq('알림 없음(평소: 오류 3건·못 받음 2건)', kinds({ gradeErrors: 3, gradeErrorsMaxClass: 3, open: 2, openMaxClass: 2 }), [])
  eq('채점 실패: 10분에 10건', kinds({ gradeErrors: 10, gradeErrorsMaxClass: 2 }), ['grade_fail'])
  eq('채점 실패: 한 학급 5건', kinds({ gradeErrors: 5, gradeErrorsMaxClass: 5 }), ['grade_fail'])
  eq('보류 저장 5건', kinds({ deferred: 5 }), ['deferred'])
  eq('결과 못 받음 한 학급 3건', kinds({ open: 3, openMaxClass: 3 }), ['no_result'])
  eq('세 종류 동시', kinds({ gradeErrors: 20, deferred: 9, open: 7 }), ['grade_fail', 'deferred', 'no_result'])
  rec('알림 제목은 종류마다 고정(30분 중복 판정 키)', new Set(Object.values(O.ALERT_TITLES)).size === 3 && Object.values(O.ALERT_TITLES).every(t => t.startsWith(O.ALERT_TITLE_PREFIX)))
  eq('같은 종류 30분에 1회', [O.alertCooldownOk(null, 1e9), O.alertCooldownOk(1e9 - 29 * 60000, 1e9), O.alertCooldownOk(1e9 - 30 * 60000, 1e9)], [true, false, true])

  // ── ⑤ 코드 배선 ──
  const srv = read('lib/opsReport.server.js'), alertSrv = read('lib/opsAlert.server.js'), ga = read('pages/api/grading-attempt.js')
  const cron = read('pages/api/cron-ops-report.js'), api = read('pages/api/admin-ops-report.js'), card = read('components/OpsReportCard.js')
  const selects = [...(srv + alertSrv).matchAll(/\.select\('([^']*)'/g)].map(x => x[1]).join(' | ')
  rec('서버가 읽는 컬럼에 글 본문·실명·쪽지·의견 본문이 없다', !/essay_text|realname|nickname|username|\bbody\b|\bcontent\b|feedback_|reply_text|\*/.test(selects), selects)
  rec('크론: CRON_SECRET이 없으면 500, 다르면 401', /if \(!cronSecret\) return res\.status\(500\)/.test(cron) && /!== `Bearer \$\{cronSecret\}`\) return res\.status\(401\)/.test(cron))
  rec('크론: 구간이 끝난 날짜를 덮어쓰기로 저장', cron.includes('closedReportDate(Date.now())') && srv.includes("upsert(row, { onConflict: 'report_date' })"))
  rec('vercel.json: 매일 06:00 UTC', JSON.parse(read('vercel.json')).crons.some(c => c.path === '/api/cron-ops-report' && c.schedule === '0 6 * * *'))
  rec('만들기 API: 관리자만', api.includes("me.role !== 'admin'") && api.includes('getUser(accessToken)'))
  rec('지난 날짜 채우기: 이미 있는 날짜는 건드리지 않고 historical로 만든다', srv.includes('!haveSet.has(k)') && srv.includes("source: 'backfill', historical: true"))
  rec('즉시 알림 검사는 grading-attempt 한 곳에서 기다리지 않고 부른다', ga.includes('runOpsAlertCheck(admin)') && !/await\s+runOpsAlertCheck/.test(ga) && ga.includes('waitUntil(p)'))
  rec('알림 검사는 던지지 않는다(전체 try/catch) + 1분 간격', /export async function runOpsAlertCheck[\s\S]*?try \{[\s\S]*?\} catch \(e\) \{/.test(alertSrv) && alertSrv.includes('CHECK_EVERY_MS'))
  rec('시험 알림: 제목 앞에 [시험], 실제 알림 제목과 겹치지 않는다', O.ALERT_TEST_TITLE.startsWith('[시험] ') && O.ALERT_TEST_TITLE.includes(O.ALERT_TITLE_PREFIX) && !Object.values(O.ALERT_TITLES).includes(O.ALERT_TEST_TITLE))
  rec('시험 알림: 관리자 확인 뒤 sendOpsAlert로 보낸다(30분 검사 없음)', /me\.role !== 'admin'[\s\S]*action === 'test_alert'[\s\S]*sendOpsAlert\(admin, \{ title: ALERT_TEST_TITLE/.test(api) && !api.includes('alertCooldownOk'))
  rec('카드: 붉은 띠는 [시험] 제목도 잡고, 시험 버튼이 있다', card.includes(".like('title', `%${ALERT_TITLE_PREFIX}%`)") && card.includes('알림 시험 보내기'))
  rec('알림 보내기는 sendOpsAlert 한 함수', (alertSrv.match(/from\('notifications'\)\.insert/g) || []).length === 1 && alertSrv.includes('export async function sendOpsAlert'))
  rec('채점 경로(pages/api/ai.js)는 운영 보고·알림 코드를 부르지 않는다', !/opsAlert|opsReport/.test(read('pages/api/ai.js')))
  rec('카드는 진입 때 보고 1행만 읽는다(limit 1), 목록은 펼칠 때', card.includes(".order('report_date', { ascending: false }).limit(1)") && card.includes('if (open && list === null) loadList()'))
  rec('카드는 DB에 직접 쓰지 않는다', !/\.(insert|update|upsert|delete)\(/.test(card))
  rec('카드: 만든 시각 표시와 보고 없음 안내', card.includes('만든 시각') && card.includes('보고가 아직 없어요. [지금 보고 만들기]를 눌러 주세요.'))
  rec('학생·교사 화면은 운영 보고를 부르지 않는다', (() => {
    const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(f => f.isDirectory() ? walk(d + '/' + f.name) : [d + '/' + f.name])
    return ![...walk('pages/student'), ...walk('pages/teacher')].some(f => /opsReport|OpsReportCard|opsAlert/.test(read(f)))
  })())

  const failed = results.filter(r => !r.pass)
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  ← ${r.detail}`}`)
  console.log(`\n${results.length - failed.length}/${results.length} PASS`)
  process.exit(failed.length ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
