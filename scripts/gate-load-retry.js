// step676: 조회 실패를 "없어요"로 보이지 않게 하는 수리의 회귀 게이트 (읽기 전용 — lib는 import, 화면은 본문 읽기만)
//
// ▶ lib/loadRetry.js · components/LoadFailNotice.js · components/InfoTip.js · pages/admin/index.js의 조회·ⓘ 설명 수정 시 커밋 전 실행:
//     node scripts/gate-load-retry.js
//   고정하는 것: 실패하면 한 번만 더 시도한다, 던진 오류도 { error }로 바뀐다, 관리자 "학생 글"·첫 묶음 목록은 실패를 빈 목록으로 덮지 않는다,
//               ⓘ 설명은 누르거나 올리면 뜨고 문구가 정해진 그대로다.

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const root = path.join(__dirname, '..')
  const L = await import(pathToFileURL(path.join(root, 'lib/loadRetry.js')).href)
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' })
  const noWait = async () => {}

  // ── retryOnce ──
  { let n = 0; const r = await L.retryOnce(async () => { n++; return { data: [1], error: null } }, { wait: noWait })
    rec('성공하면 한 번만 부르고 결과 그대로', n === 1 && r.data[0] === 1 && !r.error) }
  { let n = 0; const r = await L.retryOnce(async () => { n++; return n === 1 ? { data: null, error: { message: 'timeout' } } : { data: [2], error: null } }, { wait: noWait })
    rec('실패하면 한 번 더 해서 성공 결과를 돌려준다', n === 2 && r.data[0] === 2 && !r.error) }
  { let n = 0; const r = await L.retryOnce(async () => { n++; return { data: null, error: { message: 'timeout' } } }, { wait: noWait })
    rec('두 번 다 실패하면 error를 돌려준다(세 번째 시도 없음)', n === 2 && r.error && r.error.message === 'timeout') }
  { let n = 0; const r = await L.retryOnce(async () => { n++; throw new Error('Failed to fetch') }, { wait: noWait })
    rec('던진 오류도 { error }로 바뀐다(묶음 조회가 깨지지 않음)', n === 2 && r.error && r.error.message === 'Failed to fetch' && r.data === null) }
  { let n = 0; const r = await L.retryOnce(async () => { n++; return undefined }, { wait: noWait })
    rec('응답이 비면 실패로 본다', n === 2 && !!r.error) }
  { let waited = null; await L.retryOnce(async () => ({ data: null, error: { message: 'x' } }), { wait: async (ms) => { waited = ms } })
    rec('재시도 전 기다리는 시간은 0.8초', waited === 800 && L.LOAD_RETRY_DELAY_MS === 800) }
  { let n = 0; const mk = () => { n++; return { then: (ok) => ok({ data: [], error: null, count: 3 }) } }
    const r = await L.retryOnce(mk, { wait: noWait })
    rec('조회 객체(thenable)를 매번 새로 만들어 기다린다, count도 그대로', n === 1 && r.count === 3) }
  rec('공용 문구', L.LOAD_FAIL_TEXT === '불러오지 못했어요. 다시 시도해 주세요.')
  rec('실패 목록 한 줄', L.loadFailLine(['선생님', '학급']) === '선생님, 학급 목록을 불러오지 못했어요. 다시 시도해 주세요.' && L.loadFailLine([]) === '' && L.loadFailLine(null) === '')

  // ── 화면 구조 ──
  const admin = read('pages/admin/index.js')
  const notice = read('components/LoadFailNotice.js')
  const tip = read('components/InfoTip.js')
  rec('실패 안내: 공용 문구 + [다시 시도] 버튼', notice.includes('LOAD_FAIL_TEXT') && notice.includes('다시 시도') && notice.includes('onRetry'))

  const inner = admin.slice(admin.indexOf('function AdminSubmissionsInner()'), admin.indexOf('function StudentPeekLink'))
  rec('학생 글: error를 안 보고 data만 쓰던 조회가 없다', !/const \{ data \} = await query/.test(inner) && !/const \{ data: classData \} = await supabase/.test(inner) && !/const \{ data: classStudents \} = await supabase/.test(inner))
  rec('학생 글: 조회 3건(학급·학급 학생·글)이 재시도 1회를 거치고 실패면 실패 표시', (inner.match(/retryOnce\(/g) || []).length === 3 && /if \(classRes\.error\) return fail\(\)/.test(inner) && /if \(stuRes\.error\) return fail\(\)/.test(inner) && /if \(subErr\) return fail\(\)/.test(inner))
  rec('학생 글: 실패 표시는 빈 목록 문구보다 먼저 판정하고 [다시 시도]는 같은 조회', inner.indexOf('loadError ? (') > 0 && inner.indexOf('loadError ? (') < inner.indexOf("'학생 글이 없어요'") && /<LoadFailNotice onRetry=\{load\} \/>/.test(inner))
  rec('학생 글: 실패 때 목록을 비우지 않는다(fail은 표시와 로딩 해제만)', /const fail = \(\) => \{ setLoadError\(true\); setLoading\(false\) \}/.test(inner))
  rec('학생 글: 조회 조건 불변(정렬·상한·학급·기간·상태)', inner.includes(".limit(selectedClass !== 'all' ? 2000 : (groupBy !== 'flat' ? 1000 : 200))") && inner.includes("if (subStatusFilter === 'active') query = query.is('deleted_at', null)") && inner.includes("query = query.gte('created_at', kstDayStartUTC(kstTodayStr()))") && inner.includes(".eq('class_id', selectedClass).eq('role', 'student')"))

  const loadAll = admin.slice(admin.indexOf('const loadAll = async () => {'), admin.indexOf('// ── step637-B: 탭별 지연 로딩'))
  rec('첫 묶음: 목록·합산 6건이 재시도 1회를 거친다', (loadAll.match(/retryOnce\(\(\) => supabase/g) || []).length === 6)
  rec('첫 묶음: 실패한 목록은 덮어쓰지 않는다', /if \(!teachersRes\.error\) \{ setTeachers\(activeTeachers\); setTrashedTeachers\(trashedTeachers\) \}/.test(loadAll) && /if \(!classesRes\.error\) \{ setClasses\(activeClasses\); setTrashedClasses\(trashedClasses\) \}/.test(loadAll) && /if \(!feedbackRes\.error\) setFeedbacks\(feedbacksWithAuthor\)/.test(loadAll))
  rec('첫 묶음: 못 불러온 합산 숫자는 앞 값을 유지', /students: studentsRes\.error \? prev\.students :/.test(loadAll) && /submissions: submissionsRes\.error \? prev\.submissions :/.test(loadAll) && /today: todayRes\.error \? prev\.today :/.test(loadAll))
  rec('첫 묶음: 시험 반 빼기 조회에 조인이 없다', !/!inner\(class_id\)/.test(loadAll) && /\.in\('user_id', testIds\)/.test(loadAll))
  rec('빈 목록 문구 7곳 앞에 실패 판정이 있다', ["loadFail.includes('선생님') && teachers.length === 0", "loadFail.includes('학급') && classes.length === 0", "loadFail.includes('의견') && feedbacks.length === 0", 'lazyFail.shared ? (', 'lazyFail.copies ? (', 'supplyList.error ? (', 'msgData.error ? ('].every(k => admin.includes(k)))
  rec('실패 배너: 무엇을 못 불러왔는지 + 다시 시도는 loadAll', admin.includes('loadFailLine(loadFail)') && /await loadAll\(\) \} finally \{ setReloading\(false\) \}/.test(admin))

  // ── ⓘ 설명 ──
  rec('ⓘ: 마우스는 올리면, 터치·클릭은 누르면, 키보드는 초점으로 열린다', tip.includes("e.pointerType === 'mouse'") && tip.includes('onClick=') && tip.includes('onFocus={place}') && tip.includes("e.key === 'Escape'"))
  rec('ⓘ: 표 상자에 잘리지 않게 화면 기준 위치', tip.includes("position: 'fixed'") && tip.includes('getBoundingClientRect'))
  rec('ⓘ: 채점 시간 블록에 title 속성 ⓘ가 남아 있지 않다', !/title=\{c\.tip\}/.test(admin) && !/title=\{SEG_TIP\[k\]\}/.test(admin) && !/title=\{PATH_TIP\[k\]/.test(admin))
  const TIPS = [
    '학생이 [제출]을 처음 누른 횟수예요. 다시 누른 것은 한 번으로 묶어요.',
    '빠른 순서로 줄 세웠을 때 한가운데 학생의 시간이에요. 절반은 이보다 빨리 받았어요. 평균이 아니에요.',
    '100명 중 95명은 이 시간 안에 받았어요. 가장 느린 5명만 더 걸렸어요. 평균이 아니에요.',
    '가장 오래 기다린 한 번의 시간이에요.',
    '눌렀지만 끝내 결과를 받지 못한 횟수예요.',
    '처음 누른 뒤 10분 넘게 걸린 횟수예요.',
    '결과를 받을 때까지 [제출]을 누른 횟수예요.',
  ]
  rec('ⓘ 문구 7개가 정해진 그대로', TIPS.every(t => admin.includes(`'${t}'`)), TIPS.filter(t => !admin.includes(`'${t}'`)).join(' / '))
  rec('ⓘ: 진짜 대기 표 머리(일별·학급별 공용)·누른 횟수·구간 표 머리와 행에 붙어 있다', /A_COLS\.map\(c => <th[^>]*>\{c\.label\} <InfoTip text=\{c\.tip\}/.test(admin) && admin.includes('<InfoTip text={A_TIP.tries}') && admin.includes('<InfoTip text={A_TIP.p50}') && admin.includes('<InfoTip text={A_TIP.p95}') && admin.includes('<InfoTip text={SEG_TIP[k]}'))

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`) }
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
