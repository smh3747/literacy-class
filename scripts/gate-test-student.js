// step673: 관리자 "🧪 시험 학생으로 열기" 회귀 게이트 (읽기 전용 — lib·api는 import/본문 읽기만)
//
// ▶ lib/testStudent.js · pages/api/admin-test-student.js · lib/supabase.js(세션 저장 위치) 수정 시 커밋 전 실행:
//     node scripts/gate-test-student.js
//   고정하는 것: 실제 학생으로는 어떤 경우에도 전환되지 않는다(대상은 상수의 칸 번호로만), 시험 창만 세션을 따로 둔다,
//               엿보기 쓰기 차단은 그대로다.

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const root = path.join(__dirname, '..')
  const t = await import(pathToFileURL(path.join(root, 'lib/testStudent.js')).href)
  const d = await import(pathToFileURL(path.join(root, 'lib/gradeDefer.js')).href)
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' })

  const CLASS = 'f0b64c29-1ec2-45a0-aa20-887b74c991b3'
  const REAL_CLASS = '630e95ed-efc3-4a29-919c-7896d0687dfb'
  const good = { id: 'u1', role: 'student', class_id: CLASS, username: 'sihum6975a', deleted_at: null }
  const goodAuth = { id: 'u1', email: 'sihum6975a@writing.class' }

  // ── 상수 ──
  rec('시험 반은 6975 한 반(id 고정)', t.TEST_CLASS_ID === CLASS)
  rec('시험 학생 아이디는 2개·형식 고정', t.TEST_STUDENT_USERNAMES.join(',') === 'sihum6975a,sihum6975b' && t.TEST_STUDENT_USERNAMES.every(u => /^[a-z0-9_-]{4,20}$/.test(u)))
  rec('시험 반은 채점 보류 시범 학급에도 들어 있다(#보류시험 동작)', d.isDeferClass(t.TEST_CLASS_ID) && d.shouldForceDefer({ classId: t.TEST_CLASS_ID, essay: '#보류시험' }))

  // ── 칸 번호 ──
  rec('칸 1·2만 아이디로 바뀐다', t.testUsernameOfSlot(1) === 'sihum6975a' && t.testUsernameOfSlot(2) === 'sihum6975b')
  rec('칸 번호가 0·3·음수·소수·문자열·객체·없음이면 null', [0, 3, -1, 1.5, '1', '2', {}, [], null, undefined, NaN, true].every(s => t.testUsernameOfSlot(s) === null && t.testEmailOfSlot(s) === null))
  rec('이메일은 아이디@writing.class', t.testEmailOfSlot(1) === 'sihum6975a@writing.class' && t.testEmailOfSlot(2) === 'sihum6975b@writing.class')

  // ── 프로필 판정: 실제 학생은 통과하지 못한다 ──
  rec('지정 시험 학생은 통과', t.isTestStudentProfile(good))
  rec('다른 반 학생(아이디가 같아도) 거부', !t.isTestStudentProfile({ ...good, class_id: REAL_CLASS }))
  rec('시험 반의 다른 학생(grc5101 등) 거부', !t.isTestStudentProfile({ ...good, username: 'grc5101' }))
  rec('교사·관리자 역할 거부', !t.isTestStudentProfile({ ...good, role: 'teacher' }) && !t.isTestStudentProfile({ ...good, role: 'admin' }))
  rec('삭제된 계정·빈 값·학급 없음 거부', !t.isTestStudentProfile({ ...good, deleted_at: '2026-11-11T00:00:00Z' }) && !t.isTestStudentProfile(null) && !t.isTestStudentProfile({}) && !t.isTestStudentProfile({ ...good, class_id: null }))

  // ── 발급 최종 판정 ──
  const R = t.testStudentRefusal
  rec('정상: 발급 전 null, 발급 뒤(링크 id 일치) null', R({ slot: 1, profile: good, authUser: goodAuth }) === null && R({ slot: 1, profile: good, authUser: goodAuth, linkUserId: 'u1' }) === null)
  rec('칸 번호 불량 → bad_slot', R({ slot: 9, profile: good, authUser: goodAuth }) === 'bad_slot' && R({ profile: good, authUser: goodAuth }) === 'bad_slot' && R() === 'bad_slot')
  rec('실제 학생 프로필 → not_test_student', R({ slot: 1, profile: { ...good, class_id: REAL_CLASS }, authUser: goodAuth }) === 'not_test_student' && R({ slot: 1, profile: { ...good, username: 'grc5101' }, authUser: goodAuth }) === 'not_test_student' && R({ slot: 1, profile: null, authUser: goodAuth }) === 'not_test_student')
  rec('칸과 프로필 아이디가 다르면 → slot_mismatch', R({ slot: 2, profile: good, authUser: goodAuth }) === 'slot_mismatch')
  rec('인증 계정 id가 다르거나 없으면 → auth_mismatch', R({ slot: 1, profile: good, authUser: { id: 'u2', email: goodAuth.email } }) === 'auth_mismatch' && R({ slot: 1, profile: good, authUser: null }) === 'auth_mismatch')
  rec('인증 계정 이메일이 지정 이메일이 아니면 → email_mismatch', R({ slot: 1, profile: good, authUser: { id: 'u1', email: 'real@school.kr' } }) === 'email_mismatch' && R({ slot: 1, profile: good, authUser: { id: 'u1' } }) === 'email_mismatch')
  rec('링크가 다른 계정을 가리키면 → link_mismatch(null 포함)', R({ slot: 1, profile: good, authUser: goodAuth, linkUserId: 'u9' }) === 'link_mismatch' && R({ slot: 1, profile: good, authUser: goodAuth, linkUserId: null }) === 'link_mismatch')

  // ── 서버 API 본문(구조 고정) ──
  const api = read('pages/api/admin-test-student.js')
  const bodyLine = (api.match(/const \{([^}]*)\} = req\.body/) || [])[1] || ''
  rec('API는 요청에서 accessToken·slot만 꺼낸다(학생 id·아이디·이메일 입력 없음)', bodyLine.replace(/\s/g, '') === 'accessToken,slot' && (api.match(/req\.body/g) || []).length === 1 && !/req\.query/.test(api), bodyLine)
  rec('API는 관리자 확인을 한다', /me\.role !== 'admin'/.test(api) && /auth\.getUser\(accessToken\)/.test(api))
  rec('API의 프로필 조회는 시험 반 + 지정 아이디 조건', /\.eq\('class_id', TEST_CLASS_ID\)\.eq\('username', username\)/.test(api))
  rec('API의 링크 발급 이메일은 상수에서만 온다', /const email = testEmailOfSlot\(slot\)/.test(api) && /generateLink\(\{ type: 'magiclink', email \}\)/.test(api) && (api.match(/generateLink\(/g) || []).length === 1)
  const iLog = api.indexOf("from('test_student_opens')"), iLink = api.indexOf('generateLink('), iBefore = api.indexOf('testStudentRefusal({ slot, profile, authUser })')
  rec('순서: 발급 전 대조 → 기록 → 링크 발급', iBefore > 0 && iLog > iBefore && iLink > iLog)
  rec('기록 실패면 발급하지 않는다', /if \(logErr\) return res\.status\(500\)/.test(api))
  rec('발급 뒤 링크 계정 재대조', /testStudentRefusal\(\{ slot, profile, authUser, linkUserId:/.test(api))
  rec('API는 계정을 만들거나 고치지 않는다', !/createUser|updateUserById|deleteUser|\.update\(|\.delete\(|\.upsert\(/.test(api))

  // ── 시험 창의 세션 분리 ──
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m } }
  const s1 = store()
  rec('평소 탭(/student·/admin·/teacher)은 시험 창이 아니다', !t.isTestTab({ pathname: '/student', sessionStore: s1 }) && !t.isTestTab({ pathname: '/admin', sessionStore: s1 }) && !t.isTestTab({ pathname: '/teacher', sessionStore: s1 }) && s1.m.size === 0)
  const s2 = store()
  rec('착지 주소(/test-student)로 들어온 탭은 시험 창이 되고, 그 탭에서 /student로 가도 유지', t.isTestTab({ pathname: '/test-student', sessionStore: s2 }) && t.isTestTab({ pathname: '/student', sessionStore: s2 }))
  rec('저장소가 없거나 오류가 나면 시험 창 아님(종전 동작)', !t.isTestTab({ pathname: '/test-student' }) && !t.isTestTab() && !t.isTestTab({ pathname: '/test-student', sessionStore: { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } } }))
  rec('세션 저장 이름: 평소와 시험 창이 다르다', t.AUTH_STORAGE_KEY === 'literacy-class-auth' && t.TEST_AUTH_STORAGE_KEY !== t.AUTH_STORAGE_KEY)
  const sup = read('lib/supabase.js')
  rec('lib/supabase.js: 시험 창만 sessionStorage, 평소는 localStorage·기존 저장 이름', /testTab \? window\.sessionStorage : window\.localStorage/.test(sup) && /storageKey: testTab \? TEST_AUTH_STORAGE_KEY : AUTH_STORAGE_KEY/.test(sup))

  // ── 엿보기 쓰기 차단 불변 ──
  rec('엿보기 쓰기 차단 그대로(쓰기 4종·rpc 허용 목록)', /const WRITE_METHODS = \['update', 'insert', 'delete', 'upsert'\]/.test(sup) && /if \(isImpersonatingInBrowser\(\) && !READ_RPCS\.has\(fn\)\)/.test(sup) && /new URLSearchParams\(window\.location\.search\)\.has\('as'\)/.test(sup))
  const land = read('pages/test-student.js')
  rec('착지 화면은 토큰으로 로그인만 한다(DB 쓰기·엿보기 없음)', /verifyOtp\(\{ token_hash: th/.test(land) && !/\.from\(|\.rpc\(|[?&]as=/.test(land))

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
