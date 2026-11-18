// step677: 인터넷 끊김 자동 재전송과 "조회 실패를 없음으로 읽지 않기" 2차분의 회귀 게이트 (읽기 전용)
//
// ▶ lib/netRetry.js · lib/aiClient.js · pages/api/ai.js · 학생 홈 제출부 · 교사 주제 관리·학생 글 보기 · 로그인 2곳 수정 시 커밋 전 실행:
//     node scripts/gate-net-retry.js
//   고정하는 것: 재전송은 연결 실패(fetch가 던짐)에만 1회, 채점 요청이 두 번 처리돼도 제출 행은 중복되지 않는다(서버는 제출 행을 만들지 않음),
//               수정본도 첫 글처럼 로딩 표시를 조회보다 먼저 켠다, 조회 실패면 멈춘다(잠금 풀림·새 주제 등록·"회원 정보 없음"·전원 "미제출" 없음).

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const root = path.join(__dirname, '..')
  const N = await import(pathToFileURL(path.join(root, 'lib/netRetry.js')).href)
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' })
  const noWait = async () => {}

  // ── 재전송 도우미 ──
  rec('승인값: 2.5초 뒤 1회만', N.NET_RETRY_DELAY_MS === 2500 && N.NET_RETRY_MAX === 1)
  { let n = 0; const r = await N.fetchWithNetRetry(async () => { n++; return { ok: true } }, { wait: noWait })
    rec('연결되면 한 번만 보낸다', n === 1 && r.ok === true) }
  { let n = 0; const r = await N.fetchWithNetRetry(async () => { n++; if (n === 1) throw new TypeError('Failed to fetch'); return { ok: true } }, { wait: noWait })
    rec('연결 실패면 한 번 더 보내고 그 응답을 돌려준다', n === 2 && r.ok === true) }
  { let n = 0, msg = ''; try { await N.fetchWithNetRetry(async () => { n++; throw new TypeError('Failed to fetch ' + n) }, { wait: noWait }) } catch (e) { msg = e.message }
    rec('두 번 다 실패하면 마지막 오류를 던진다(세 번째 전송 없음)', n === 2 && msg === 'Failed to fetch 2') }
  { let n = 0; const r = await N.fetchWithNetRetry(async () => { n++; return { ok: false, status: 503 } }, { wait: noWait })
    rec('서버가 답한 오류(503 등)는 재전송하지 않는다', n === 1 && r.status === 503) }
  { let waited = null; await N.fetchWithNetRetry(async () => { if (waited === null) throw new Error('x'); return {} }, { wait: async (ms) => { waited = ms } })
    rec('재전송 전에 2.5초 기다린다', waited === 2500) }

  // ── 호출부 ──
  const ai = read('lib/aiClient.js')
  rec('AI 호출: fetch가 재전송 도우미를 거친다(1곳)', (ai.match(/fetchWithNetRetry\(\(\) => fetch\('\/api\/ai'/g) || []).length === 1 && (ai.match(/fetch\('\/api\/ai'/g) || []).length === 1)
  rec('AI 호출: 재전송까지 실패하면 종전 안내 문구 그대로', ai.includes("throw new Error('인터넷 연결을 확인해주세요. 잠시 후 다시 시도해주세요.')") && ai.includes("fail('fetch 실패: '"))
  rec('AI 호출: 401 복구·보류 전환 전달은 그대로', ai.includes('if (res.status === 401) {') && ai.includes('err.defer = data?.defer === true'))

  // ── 중복 안전: 서버 채점 경로는 제출 행을 만들거나 고치지 않는다 ──
  const api = read('pages/api/ai.js')
  const writes = [...api.matchAll(/from\('([a-z_]+)'\)\s*\.(insert|update|upsert|delete)\(/g)].map(m => `${m[1]}.${m[2]}`)
  rec('서버(/api/ai): submissions에 쓰지 않는다(읽기만)', !writes.some(w => w.startsWith('submissions.')) && !/from\('submissions'\)[\s\S]{0,40}\.(insert|update|upsert|delete)\(/.test(api), writes.join(', '))
  rec('서버(/api/ai): 쓰는 표는 기록용 3종뿐', [...new Set(writes)].sort().join(',') === 'correction_alerts.insert,error_logs.insert,notifications.insert', writes.join(', '))
  const home = read('pages/student/index.js')
  const first = home.slice(home.indexOf('const submitEssay = async () => {'), home.indexOf('// 수정본 제출'))
  const rwStart = home.indexOf('const submitRewrite = async () => {')
  const rw = home.slice(rwStart, home.indexOf("console.error('수정본 제출 오류:'", rwStart))
  rec('첫 글: 제출 행 저장은 AI 결과를 받은 뒤 한 곳, 그 전에 중복 확인 조회', first.indexOf("await callAI('grading'") > 0 && first.indexOf(".select('id').eq('user_id', user.id).eq('topic_id', todayTopic.id)") < first.indexOf("await callAI('grading'"))
  rec('수정본: 회차는 제출 직전 DB 조회로 정하고(추측 금지) AI 결과 뒤에 한 번 저장', rw.indexOf("select('attempt, extra_rewrite_allowed')") < rw.indexOf("await callAI('rewriteGrading'") && rw.indexOf("await callAI('rewriteGrading'") < rw.indexOf("await runGradedSave({ kind: 'rewrite'") && (rw.match(/await runGradedSave\(/g) || []).length === 1 && !rw.includes('.insert('))   // step684: 저장은 runGradedSave(공용) 한 곳으로 옮김
  rec('연타 잠금(submittingRef)은 두 제출 모두 첫 await 전에 건다', /submittingRef\.current = true[^\n]*\n\s*setSubmitting\(true\)/.test(first) && /submittingRef\.current = true\n\s*setRewriting\(true\)/.test(rw))

  // ── 로딩 표시 순서 ──
  rec('수정본: 로딩 표시를 조회보다 먼저 켠다(첫 글과 같은 순서)', rw.indexOf('setRewriting(true)') > 0 && rw.indexOf('setRewriting(true)') < rw.indexOf("select('attempt, extra_rewrite_allowed')") && (rw.match(/setRewriting\(true\)/g) || []).length === 1)
  rec('수정본: 조회 뒤 멈추는 3곳(조회 실패·수정 불가·횟수 소진)에서 로딩을 끈다', (rw.slice(0, rw.indexOf("markGradingAttempt('start'")).match(/submittingRef\.current = false[^\n]*\n\s*setRewriting\(false\)/g) || []).length === 3)
  rec('첫 글: 로딩 표시가 중복 확인 조회보다 먼저', first.indexOf('setSubmitting(true)') < first.indexOf(".select('id').eq('user_id', user.id).eq('topic_id', todayTopic.id)"))

  // ── 조회 실패면 멈춘다 ──
  const topics = read('pages/teacher/topics.js')
  const save = topics.slice(topics.indexOf('const saveTopic = async () => {'), topics.indexOf('const deleteTopic = async'))
  const edit = topics.slice(topics.indexOf('const loadTopicForEdit = async (t) => {'), topics.indexOf('const saveTopic = async () => {'))
  rec('주제 편집 열기: 제출 수 조회의 error를 보고 실패면 잠근다', /const \{ count, error: cntErr \} = await retryOnce\(/.test(edit) && /if \(cntErr\) throw cntErr/.test(edit) && /catch \{ setEditLocked\(true\) \}/.test(edit))
  rec('주제 저장: 기존 주제 조회가 실패하면 저장을 멈춘다(새 주제로 등록하지 않음)', /if \(exErr\) \{ setSaving\(false\); alert\(TOPIC_LOAD_FAIL\); return \}/.test(save) && save.indexOf('if (exErr)') < save.indexOf("from('topics').insert({"))
  rec('주제 저장: 제출 수 재확인이 실패하면 저장을 멈춘다(잠금이 풀린 채 저장하지 않음)', /if \(cntErr\) \{ setSaving\(false\); alert\(TOPIC_LOAD_FAIL\); return \}/.test(save) && save.indexOf('if (cntErr)') < save.indexOf("from('topics').update(payload)") && !/const \{ count \} = await supabase/.test(save))
  rec('주제 저장: 잠금이면 제목·평가 기준을 빼는 규칙은 그대로', save.includes('if (!locked) {') && save.includes('payload.title = title.trim()') && save.includes('payload.rubrics = rubrics'))
  for (const [p, select] of [['pages/student/login.js', "select('role, realname')"], ['pages/teacher/login.js', "select('role, realname, is_banned')"]]) {
    const s = read(p)
    rec(`${p}: 프로필 조회 실패는 "회원 정보 없음"이 아니라 다시 시도 안내`, s.includes(`await retryOnce(() => supabase.from('profiles').${select}.eq('id', loginData.user.id).maybeSingle())`) && s.indexOf('if (profErr) {') > 0 && s.indexOf('if (profErr) {') < s.indexOf('if (!profile) {') && s.includes("throw new Error('회원 정보를 불러오지 못했어요. 다시 시도해 주세요.')"))
    rec(`${p}: 프로필이 정말 없을 때의 종전 안내는 그대로`, /if \(!profile\) \{\n\s*await supabase\.auth\.signOut\(\{ scope: 'local' \}\)/.test(s) && s.includes('회원 정보를 찾을 수 없어요.'))
  }
  const subs = read('pages/teacher/submissions.js')
  rec('학생 글 보기: 학생·제출 조회 4곳이 재시도 1회를 거치고 실패면 멈춘다', (subs.match(/if \(stuErr\) \{ alert\(LOAD_FAIL_SUBS\); return \}/g) || []).length === 2 && (subs.match(/if \(subErr\) \{ alert\(LOAD_FAIL_SUBS\); return \}/g) || []).length === 2 && !/const \{ data: subs \} = await supabase\.from\('submissions'\)\.select\('\*'\)\.eq\('topic_id', topic\.id\)/.test(subs))
  rec('학생 글 보기: 멈추는 판정이 "미제출" 목록을 만들기(setTopicStudents) 전', (() => { const a = subs.indexOf('const openTopic = async (topic'); const seg = subs.slice(a, a + 2500); return seg.indexOf('if (subErr)') > 0 && seg.indexOf('if (subErr)') < seg.indexOf('setTopicStudents(groups)') })())
  rec('학생 글 보기: 조회 조건 불변', (subs.match(/\.eq\('topic_id', topic\.id\)\.in\('user_id', studentIds\)\.is\('deleted_at', null\)/g) || []).length === 2 && subs.includes(".eq('class_id', classInfo.id).eq('role', 'student'))") && subs.includes(".eq('class_id', cls.id).eq('role', 'student'))"))
  rec('안내 문구', subs.includes("'학생 글을 불러오지 못했어요. 다시 시도해 주세요.'") && topics.includes("'주제 정보를 불러오지 못했어요. 다시 시도해 주세요.\\n입력한 내용은 그대로 있어요.'"))

  // ── ⓘ 문구 통일(채점 시간 표) ──
  const admin = read('pages/admin/index.js')
  const cols = admin.slice(admin.indexOf('const COLS = ['), admin.indexOf('const cell = (v, tone)'))
  rec('채점 시간 표: 보통·거의 모두·가장 오래 문구가 진짜 대기 표와 같다', cols.includes("tip: '빠른 순서로 줄 세웠을 때 한가운데 학생의 시간이에요. 절반은 이보다 빨리 받았어요. 평균이 아니에요.'") && cols.includes("tip: '100명 중 95명은 이 시간 안에 받았어요. 가장 느린 5명만 더 걸렸어요. 평균이 아니에요.'") && cols.includes("tip: '가장 오래 기다린 한 번의 시간이에요.'"))

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
