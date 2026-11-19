// step686: 알림 생성 실패 기록 + 교사 코멘트 추천 조회 조건의 회귀 게이트 (읽기 전용)
//
// ▶ lib/notify.js · lib/notifyCore.js · 알림을 만드는 화면(관리자·교사·학생) · pages/teacher/submissions.js 코멘트 추천 수정 시 커밋 전 필수:
//     node scripts/gate-notify.js
//   고정하는 것: 알림 생성은 공용 함수 한 길로만, 실패({ error }·던짐)는 기록하고 던지지 않음, 화면 동작(허용 저장 등)은 불변,
//               기록에 받는 사람·제목·본문을 남기지 않음, 코멘트 추천 조회는 학급 학생 조건을 건다.

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const root = path.join(__dirname, '..')
  const N = await import(pathToFileURL(path.join(root, 'lib/notifyCore.js')).href)
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' })
  const args = { p_recipient: 'u1', p_type: 'rewrite_allowed', p_title: '제목', p_body: '본문', p_link: '/x' }
  const origWarn = console.warn; console.warn = () => {}

  { const logs = []; let called = null
    const r = await N.sendNotificationWith(async (name, a) => { called = { name, a }; return { error: null } }, (x) => logs.push(x), args, '/teacher/submissions')
    rec('성공: create_notification을 받은 값 그대로 부르고 기록은 없다', r.ok === true && called.name === 'create_notification' && called.a === args && logs.length === 0) }
  { const logs = []
    const r = await N.sendNotificationWith(async () => ({ error: { message: 'not allowed' } }), (x) => logs.push(x), args, '/teacher/submissions')
    rec('거절({ error }): ok=false, 기록 1건(notify_fail)', r.ok === false && logs.length === 1 && logs[0].errorType === 'notify_fail' && logs[0].page === '/teacher/submissions')
    rec('기록 문구에 유형과 오류 문구가 들어간다', logs[0].message === '알림 생성 실패(rewrite_allowed): not allowed', logs[0].message)
    rec('기록에 받는 사람·제목·본문이 없다', !JSON.stringify(logs[0]).includes('u1') && !JSON.stringify(logs[0]).includes('제목') && !JSON.stringify(logs[0]).includes('본문') && JSON.stringify(logs[0].context) === '{"type":"rewrite_allowed"}') }
  { const logs = []; let threw = false, r
    try { r = await N.sendNotificationWith(async () => { throw new TypeError('Failed to fetch') }, (x) => logs.push(x), args, null) } catch (_) { threw = true }
    rec('던짐(연결 실패): 밖으로 던지지 않고 기록', !threw && r.ok === false && logs.length === 1 && logs[0].message.includes('Failed to fetch')) }
  { let threw = false, r
    try { r = await N.sendNotificationWith(async () => ({ error: { message: 'x' } }), () => { throw new Error('기록 실패') }, args, null) } catch (_) { threw = true }
    rec('기록이 실패해도 던지지 않는다', !threw && r.ok === false) }
  { let threw = false, r
    try { r = await N.sendNotificationWith(async () => ({ error: { message: 'x' } }), () => Promise.reject(new Error('기록 실패')), args, null) } catch (_) { threw = true }
    rec('기록이 거절(비동기)돼도 던지지 않는다', !threw && r.ok === false) }
  { const logs = []; let n = 0
    const r = await N.sendNotificationWith(async () => { n++; return {} }, (x) => logs.push(x), { p_type: 'stamp' }, null)
    rec('받는 사람이 비어 있으면 부르지 않고 기록', n === 0 && r.ok === false && logs.length === 1) }
  console.warn = origWarn

  // ── 호출부 전수 ──
  const files = ['pages/admin/index.js', 'pages/student/history.js', 'pages/student/index.js', 'pages/teacher/grammar-backfill.js', 'pages/teacher/index.js', 'pages/teacher/messages.js', 'pages/teacher/submissions.js']
  const want = { 'pages/admin/index.js': 3, 'pages/student/history.js': 1, 'pages/student/index.js': 3, 'pages/teacher/grammar-backfill.js': 1, 'pages/teacher/index.js': 1, 'pages/teacher/messages.js': 1, 'pages/teacher/submissions.js': 4 }
  let direct = 0
  const walk = (d) => { for (const f of fs.readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = d + '/' + f.name; if (f.isDirectory()) walk(rel); else if (/\.js$/.test(f.name) && rel !== 'lib/notify.js' && rel !== 'lib/notifyCore.js') { const s = read(rel); direct += (s.match(/\.rpc\(\s*'create_notification'/g) || []).length } } }
  for (const d of ['pages', 'components', 'lib']) walk(d)
  rec('화면·공용 코드에 create_notification 직접 호출이 없다(공용 함수 한 길)', direct === 0, 'direct=' + direct)
  for (const f of files) {
    const s = read(f)
    const n = (s.match(/await sendNotification\(/g) || []).length
    rec(`${f}: 공용 함수 호출 ${want[f]}곳 + import`, n === want[f] && s.includes("import { sendNotification } from '../../lib/notify'"), 'n=' + n)
  }
  const notify = read('lib/notify.js')
  rec('공용 함수: 실패 기록은 lib/errorLog(엿보기 생략 규칙 포함)를 쓴다', notify.includes("import { logError } from './errorLog'") && notify.includes('sendNotificationWith((name, a) => supabase.rpc(name, a), logError, args, page)'))

  // ── 수정 허용: 화면 동작 불변 ──
  const ts = read('pages/teacher/submissions.js')
  const allow = ts.slice(ts.indexOf('const allowExtraRewrite = async (sub) => {'), ts.indexOf('const allowExtraRewrite = async (sub) => {') + 900)
  rec('수정 허용: 저장 → (실패면 멈춤) → 알림(기다리지 않음) → "허용되었어요" 순서 불변',
    allow.indexOf("update({ extra_rewrite_allowed: true }).eq('id', sub.id)") < allow.indexOf("if (error) return alert('실패: ' + error.message)") &&
    allow.indexOf("if (error) return alert('실패: ' + error.message)") < allow.indexOf('notifyRewriteAllowed(sub)') &&
    allow.indexOf('notifyRewriteAllowed(sub)') < allow.indexOf("alert('✅ 추가 수정이 허용되었어요!')") && !allow.includes('await notifyRewriteAllowed'))
  rec('수정 허용 알림: 유형·문구·링크 불변', ts.includes("p_type: 'rewrite_allowed',\n        p_title: '✏️ 선생님이 수정 기회를 주셨어요!',\n        p_body: '글을 다시 고칠 수 있어요',"))

  // ── 코멘트 추천 조회 ──
  rec('코멘트 추천: 학급 학생 id 조건을 건다', ts.includes("if (classStudentIds.length > 0) recentQ = recentQ.in('user_id', classStudentIds)"))
  rec('코멘트 추천: 나머지 조건·정렬·개수 불변', /let recentQ = supabase\.from\('submissions'\)\n\s+\.select\('teacher_comment'\)\n\s+\.not\('teacher_comment', 'is', null\)\n\s+\.neq\('id', submission\.id\)\n/.test(ts) && /await recentQ\n\s+\.order\('teacher_comment_at', \{ ascending: false \}\)\n\s+\.limit\(15\)/.test(ts))
  rec('코멘트 추천: 학급 학생 id를 넘겨준다', ts.includes('classStudentIds={topicStudents.map(g => g.profile.id).filter(Boolean)}') && ts.includes('maskNames = [], classStudentIds = [] }) {'))

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
