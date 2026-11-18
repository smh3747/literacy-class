// step683: 학생 홈 "틀 먼저 + 조회 3단계 + 오늘 주제 카드 잠깐 적어 두기"의 회귀 게이트 (읽기 전용)
//
// ▶ lib/homeCache.js · components/StudentHomeFrame.js · pages/student/index.js 진입부 · 학생 화면 로그아웃 수정 시 커밋 전 필수:
//     node scripts/gate-home-frame.js
//   고정하는 것: 기기에 적는 것은 주제 카드 4칸뿐(점수·제출 여부 없음), 키에 학생 id와 날짜, 다른 학생·지난 날짜 것은 읽지 않고 지움,
//               로그아웃 때 삭제, 틀 화면에는 입력 칸·누를 버튼이 없음, 맞춤법 상태 별도 조회 없음, 조회 실패면 재시도 화면.

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    _keys: () => [...m.keys()],
  }
}

;(async () => {
  const root = path.join(__dirname, '..')
  const H = await import(pathToFileURL(path.join(root, 'lib/homeCache.js')).href)
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' })

  const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
  const D = '2026-11-18', D0 = '2026-11-17'
  const topic = { id: 't1', title: '가을 소풍', description: '소풍에서 있었던 일을 써요.', date: D, rubrics: [{ score: 10 }], max_rewrites: 2, lock_enabled: true, teacher_id: 'x', myMaxAttempt: 2 }

  // ── 키와 필드 ──
  rec('적는 필드는 4개뿐(id·title·description·date)', JSON.stringify(H.HOME_TOPIC_FIELDS) === JSON.stringify(['id', 'title', 'description', 'date']))
  rec('키에 학생 id와 날짜가 들어간다', H.homeTopicKey(A, D) === `lc-home-topic:${A}:${D}`)
  rec('학생 id나 날짜가 이상하면 키를 만들지 않는다', H.homeTopicKey('', D) === null && H.homeTopicKey(A, '오늘') === null && H.homeTopicKey(null, null) === null)
  { const p = H.pickHomeTopicFields(topic)
    rec('주제 행에서 4칸만 고른다(평가 기준·수정 횟수·시간 잠금·회차는 버림)', JSON.stringify(Object.keys(p)) === JSON.stringify(['id', 'title', 'description', 'date']), JSON.stringify(Object.keys(p))) }
  rec('제목이 없는 주제는 고르지 않는다', H.pickHomeTopicFields({ id: 't' }) === null && H.pickHomeTopicFields(null) === null)

  // ── 쓰기·읽기 ──
  { const s = fakeStorage()
    rec('쓰기 성공', H.writeHomeTopic(s, A, D, topic) === true)
    const raw = s.getItem(H.homeTopicKey(A, D))
    rec('저장된 글자에 점수·제출·수정·잠금 관련 칸이 없다', !/score|attempt|rewrite|lock|rubric|grade|submit/i.test(raw), raw)
    const r = H.readHomeTopic(s, A, D)
    rec('같은 학생·같은 날이면 읽힌다', r && r.title === '가을 소풍' && r.date === D)
    rec('다른 학생으로는 읽히지 않는다', H.readHomeTopic(s, B, D) === null)
    rec('다른 날짜로는 읽히지 않는다', H.readHomeTopic(s, A, D0) === null) }
  { const s = fakeStorage()
    rec('지난 날짜의 주제는 적지 않는다', H.writeHomeTopic(s, A, D, { ...topic, date: D0 }) === false && s.length === 0) }
  { const s = fakeStorage({ [H.homeTopicKey(A, D)]: JSON.stringify({ id: 't1', title: '옛 주제', description: '', date: D0 }) })
    rec('키는 오늘인데 내용의 날짜가 다르면 버린다', H.readHomeTopic(s, A, D) === null) }
  { const s = fakeStorage({ [H.homeTopicKey(A, D)]: '{깨진 글자' })
    rec('깨진 값은 null(던지지 않음)', H.readHomeTopic(s, A, D) === null) }
  rec('저장소가 없어도 던지지 않는다', H.readHomeTopic(null, A, D) === null && H.writeHomeTopic(null, A, D, topic) === false && H.sweepHomeTopic(null, A, D) === 0 && H.clearHomeTopic(null) === 0)
  { const bad = { get length() { throw new Error('x') }, key() { throw new Error('x') }, getItem() { throw new Error('x') }, setItem() { throw new Error('x') }, removeItem() { throw new Error('x') } }
    let threw = false; try { H.readHomeTopic(bad, A, D); H.writeHomeTopic(bad, A, D, topic); H.sweepHomeTopic(bad, A, D); H.clearHomeTopic(bad) } catch (_) { threw = true }
    rec('저장소가 던져도(사생활 보호 모드 등) 밖으로 새지 않는다', !threw) }

  // ── 지우기 ──
  { const s = fakeStorage({ 'lc-other': '1' })
    H.writeHomeTopic(s, A, D, topic); H.writeHomeTopic(s, B, D, topic); s.setItem(H.homeTopicKey(A, D0), '{}')
    const n = H.sweepHomeTopic(s, A, D)
    rec('진입 정리: 다른 학생·지난 날짜 것만 지우고 내 오늘 것은 남긴다', n === 2 && s.getItem(H.homeTopicKey(A, D)) && !s.getItem(H.homeTopicKey(B, D)) && !s.getItem(H.homeTopicKey(A, D0)), 'n=' + n)
    rec('진입 정리: 다른 용도의 저장값은 건드리지 않는다', s.getItem('lc-other') === '1')
    const c = H.clearHomeTopic(s)
    rec('로그아웃 정리: 전부 지운다(다른 용도는 유지)', c === 1 && s._keys().join() === 'lc-other', s._keys().join()) }

  // ── 틀 화면 ──
  const frame = read('components/StudentHomeFrame.js')
  rec('틀 화면: 입력 칸이 없다', !/<textarea|<input/.test(frame))
  rec('틀 화면: 누를 수 있는 버튼·링크가 없다', !/<button|onClick|<Link|<a /.test(frame))
  rec('틀 화면: 조회를 하지 않는다', !/supabase|fetch\(|useEffect/.test(frame))
  rec('틀 화면: 문구', frame.includes('글쓰기 칸을 준비하고 있어요. 잠깐만 기다려 주세요.') && frame.includes('불러오는 중이에요...') && frame.includes('📅 오늘의 글쓰기'))
  rec('틀 화면: 점수·제출 상태를 보여 주지 않는다', !/점|제출|수정/.test(frame.slice(frame.indexOf('export default'))))

  // ── 학생 홈 진입부 ──
  const home = read('pages/student/index.js')
  rec('학생 홈: 로딩 중에는 틀 화면을 그린다', home.includes('if (loading) return <StudentHomeFrame topic={frameTopic} />') && !home.includes('>로딩 중...</div></div>'))
  rec('학생 홈: 틀 화면은 조회 실패 화면보다 앞, 본 화면보다 앞', home.indexOf('if (loading) return <StudentHomeFrame') < home.indexOf('if (loadError) return (') && home.indexOf('if (loadError) return (') < home.indexOf('<Header user={user} onLogout={logout} />'))
  const auth = home.slice(home.indexOf('const checkAuth = async () => {'), home.indexOf('const loadPeerShareFor'))
  rec('학생 홈: 진입 때 다른 학생·지난 날짜 카드를 지우고 내 오늘 카드만 읽는다', auth.includes('sweepHomeTopic(store, uid, todayStr())') && auth.includes('readHomeTopic(store, uid, todayStr())'))
  rec('학생 홈: 엿보기에서는 카드를 읽지 않는다', /if \(!isImpersonatingNow\(\)\) \{\n\s+const store = homeStorage\(\)/.test(auth))
  rec('학생 홈: ?topic= 진입(지난 주제)에서는 카드를 보여 주지 않는다', auth.includes('router.query?.topic ? null : readHomeTopic('))
  rec('학생 홈: 카드 읽기는 프로필 조회보다 앞(틀이 먼저 뜬다)', auth.indexOf('readHomeTopic(') < auth.indexOf("supabase.from('profiles')"))
  const load = home.slice(home.indexOf('const loadTodayTopic = async'), home.indexOf('const logout = async'))
  rec('학생 홈: 카드 쓰기는 오늘 주제 경로에서만, 엿보기 제외', /if \(!isImpersonatingNow\(\)\) \{\n\s+if \(topic\) writeHomeTopic\(homeStorage\(\), profile\.id, today, topic\)\n\s+else clearHomeTopic\(homeStorage\(\)\)/.test(load))
  rec('학생 홈: 적어 둔 카드로 화면 상태를 정하지 않는다(setTodayTopic·setStep에 쓰지 않음)', !/setTodayTopic\(frameTopic|setStep\([^)]*frameTopic|setEssay\([^)]*frameTopic/.test(home) && (home.match(/frameTopic/g) || []).length === 2, 'frameTopic 등장 ' + (home.match(/frameTopic/g) || []).length)
  rec('학생 홈: 로그아웃 때 카드를 지운다(로그아웃 요청보다 앞)', /clearHomeTopic\(homeStorage\(\)\)[^\n]*\n\s+await supabase\.auth\.signOut\(\{ scope: 'local' \}\); router\.push\('\/'\)/.test(home))
  for (const f of ['history', 'quiz', 'ranking']) {
    const s = read(`pages/student/${f}.js`)
    rec(`${f}: 로그아웃 때 카드를 지운다`, /clearHomeTopic\(homeStorage\(\)\)[^\n]*\n\s+await supabase\.auth\.signOut\(\{ scope: 'local' \}\); router\.push\('\/'\)/.test(s))
  }

  // ── 조회 단계 줄이기 ──
  rec('학생 홈: 화면 컬럼 목록에 맞춤법 검사 상태가 들어 있다', /const SUB_VIEW_COLS = '[^']*grade_status, strict_status'/.test(home))
  rec('학생 홈: 맞춤법 상태 별도 조회가 없다', !load.includes(".select('strict_status')"))
  rec('학생 홈: 회차만 받는 조회가 진입 경로에 없다', !load.includes(".select('topic_id, attempt')"))
  rec('학생 홈: 오늘 주제들의 내 글을 한 번에 받는다(조건 불변)', /\.select\(SUB_VIEW_COLS\)\.eq\('user_id', profile\.id\)\.in\('topic_id', topicIds\)\n\s+\.is\('deleted_at', null\)\.order\('attempt', \{ ascending: true \}\)/.test(load))
  rec('학생 홈: 그 조회가 실패하면 재시도 화면으로(제출 없음으로 추측하지 않음)', load.includes('if (mySubsErr) throw mySubsErr') && load.includes('setLoadError(true)'))
  rec('학생 홈: 오늘 주제 경로는 받은 글에서 골라 쓰고 다시 조회하지 않는다', load.includes('? { data: todaySubsAll.filter(s => s.topic_id === topic.id), error: null }'))
  rec('학생 홈: 지난 주제·?topic= 경로는 종전 조회 그대로(조건 불변)', /\.select\(SUB_VIEW_COLS\)\n\s+\.eq\('user_id', profile\.id\)\.eq\('topic_id', topic\.id\)\.order\('attempt', \{ ascending: true \}\)\n\s+\.is\('deleted_at', null\)/.test(load))
  rec('학생 홈: 이미 제출했나 조회 실패는 여전히 재시도 화면', load.includes('if (existingErr) throw existingErr'))
  rec('학생 홈: 맞춤법 상태는 종전처럼 첫 글만 있을 때만 남긴다', load.includes('if (maxAttempt !== 1 || !last.strict_status) delete last.strict_status'))
  rec('학생 홈: 오늘 주제·지난 주제·미확인 코멘트는 동시에 시작한다', load.indexOf('const todayTopicsP = ') < load.indexOf('const pendingP = ') && load.indexOf('const unreadP = ') < load.indexOf('await todayTopicsP'))
  rec('학생 홈: 오늘 주제 조회 실패는 여전히 재시도 화면', load.includes('if (todayTopicsErr) throw todayTopicsErr'))
  { const n = (load.match(/from\('submissions'\)/g) || []).length
    rec('학생 홈: 주제 불러오기 안의 제출 조회는 2곳(오늘 묶음 1 + 지난 주제 경로 1)', n === 2, 'n=' + n) }

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
