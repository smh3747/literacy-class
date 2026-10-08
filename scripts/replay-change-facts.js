// step608: 실제 제출 기록으로 변경 사실(lib/changeFacts.js) 재계산 — 읽기 전용(DB는 select만, lib는 import만).
//
// ▶ 실행:  node scripts/replay-change-facts.js [옵션]
//   --env=<경로>      .env.local 위치(기본: 저장소 루트의 .env.local). 셸 환경변수가 있으면 그쪽이 우선.
//   --user=<uuid> --topic=<uuid>   특정 학생·주제의 제출을 created_at 순으로 가져와 연속 쌍(1→2, …)을 재계산.
//   --class=<학교명 또는 반 이름 부분 문자열> --date=YYYY-MM-DD   해당 날짜(KST)에 그 학급에서 낸 제출을 학생·주제별로 묶어 모두 재계산.
//                     예: --class=송림 (classes.school) / --class="5학년 6반" (classes.name)
//   --min=<n>         --class 모드에서 제출 n회 이상인 학생·주제만(기본 2).
//
// 필요한 값: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// 출력에는 글자 수·추가/삭제 개수·notationOnly·점수만 나온다. 글 본문·이름·아이디는 출력하지 않는다(id는 앞 8자리만).

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const ROOT = path.join(__dirname, '..')
const args = process.argv.slice(2)
const argVal = (name) => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }

function loadEnv(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let val = m[2]
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (process.env[m[1]] === undefined) process.env[m[1]] = val
    }
  } catch (e) { console.warn(`환경 파일 읽기 실패(${file}): ${e.message}`) }
}

const short = (id) => String(id || '').slice(0, 8)
const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length) }

;(async () => {
  loadEnv(argVal('env') ? path.resolve(argVal('env')) : path.join(ROOT, '.env.local'))
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없어요. --env=<.env.local 경로>로 알려 주세요.')
    process.exitCode = 1
    return
  }
  const { computeChangeFacts } = await import(pathToFileURL(path.join(ROOT, 'lib', 'changeFacts.js')).href)
  const { createClient } = require('@supabase/supabase-js')
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const SELECT = 'id, user_id, topic_id, essay_text, total_score, created_at'
  let rows = []
  const user = argVal('user'), topic = argVal('topic'), cls = argVal('class'), date = argVal('date')
  if (user && topic) {
    const { data, error } = await db.from('submissions').select(SELECT)
      .eq('user_id', user).eq('topic_id', topic).is('deleted_at', null)
      .order('created_at', { ascending: true })
    if (error) { console.error('조회 실패:', error.message); process.exitCode = 1; return }
    rows = data || []
  } else if (cls && date) {
    // 학교 이름은 classes.school, 반 이름은 classes.name('5학년 6반') — 둘 다 부분 일치로 찾는다.
    const { data: classes, error: ce } = await db.from('classes').select('id, name, school')
      .or(`school.ilike.%${cls}%,name.ilike.%${cls}%`).is('deleted_at', null)
    if (ce) { console.error('학급 조회 실패:', ce.message); process.exitCode = 1; return }
    if (!classes?.length) { console.error(`'${cls}'를 포함하는 학급(학교명·반 이름)이 없어요.`); process.exitCode = 1; return }
    console.log(`학급 ${classes.length}개 매칭: ${classes.map(c => `${c.school || ''} ${c.name}`.trim()).join(', ')}`)
    const { data: students, error: pe } = await db.from('profiles').select('id')
      .in('class_id', classes.map(c => c.id)).eq('role', 'student')
    if (pe) { console.error('학생 조회 실패:', pe.message); process.exitCode = 1; return }
    const ids = (students || []).map(s => s.id)
    if (!ids.length) { console.error('학생이 없어요.'); process.exitCode = 1; return }
    // KST 하루 = UTC 전날 15:00 ~ 당일 15:00
    const start = new Date(`${date}T00:00:00+09:00`).toISOString()
    const end = new Date(`${date}T23:59:59.999+09:00`).toISOString()
    const { data, error } = await db.from('submissions').select(SELECT)
      .in('user_id', ids).is('deleted_at', null)
      .gte('created_at', start).lte('created_at', end)
      .order('created_at', { ascending: true })
    if (error) { console.error('제출 조회 실패:', error.message); process.exitCode = 1; return }
    rows = data || []
  } else {
    console.error('--user=<uuid> --topic=<uuid> 또는 --class=<학급명> --date=YYYY-MM-DD 를 주세요.')
    process.exitCode = 1
    return
  }

  const min = Number(argVal('min') || 2)
  const groups = new Map()
  for (const r of rows) {
    const k = `${r.user_id}|${r.topic_id}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(r)
  }
  const targets = [...groups.values()].filter(g => g.length >= min).sort((a, b) => b.length - a.length)
  console.log(`제출 ${rows.length}건 · 학생·주제 묶음 ${groups.size}개 · ${min}회 이상 ${targets.length}개\n`)

  let notationPairs = 0, totalPairs = 0
  for (const g of targets) {
    console.log(`▶ 학생 ${short(g[0].user_id)} · 주제 ${short(g[0].topic_id)} · ${g.length}회`)
    console.log(`  ${pad('쌍', 6)}${pad('점수', 10)}${pad('글자(정규화)', 16)}${pad('Δ%', 6)}${pad('추가', 5)}${pad('삭제', 5)}${pad('편집거리', 9)}notationOnly`)
    for (let i = 1; i < g.length; i++) {
      const prev = g[i - 1], cur = g[i]
      const f = computeChangeFacts(prev.essay_text, cur.essay_text)
      totalPairs++
      if (f?.notationOnly) notationPairs++
      const score = `${prev.total_score ?? '-'}→${cur.total_score ?? '-'}`
      console.log(`  ${pad(`${i}→${i + 1}`, 6)}${pad(score, 10)}${pad(f ? `${f.prevChars}→${f.curChars}` : '계산 불가', 16)}${pad(f ? `${f.deltaPct > 0 ? '+' : ''}${f.deltaPct}` : '-', 6)}${pad(f ? f.addedCount : '-', 5)}${pad(f ? f.removedCount : '-', 5)}${pad(f ? (f.normEditDistance ?? '>허용') : '-', 9)}${f ? f.notationOnly : '-'}`)
    }
    console.log('')
  }
  console.log(`연속 쌍 ${totalPairs}개 중 표기만 변경(notationOnly=true) ${notationPairs}개`)
})().catch(e => { console.error('실행 실패:', e); process.exitCode = 1 })
