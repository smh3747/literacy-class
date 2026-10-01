// 실험: 첫 채점(채점+맞춤법 통합 호출)이 맞춤법 전용 호출(grammarStrict)보다 얼마나 덜 잡는가 실측.
// 이중 호출 도입 여부의 근거 자료. 읽기 전용 — DB는 select만, lib는 import만(수정 안 함).
//
// ▶ 실행:  node scripts/experiment-strict-vs-grading.js [옵션]
//   --env=<경로>   .env.local 위치(기본: 저장소 루트의 .env.local). 셸 환경변수가 있으면 그쪽이 우선.
//   --no-ai        AI 호출 없이 저장 건수·규칙 엔진 단독 건수만(키가 없을 때 자동으로 이 모드)
//   --sample=<id앞8자>  저장 교정 샘플 10개를 볼 글(기본 8c13de95)
//   --ids=a,b,c    대상 submission id 앞 8자리 목록 교체
//
// 필요한 값: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SYSTEM_GEMINI_API_KEY(AI 비교용).
//
// 조건을 실제 파이프라인(pages/api/ai.js type 'grammarStrict')과 같게 맞춘다:
//   grammarStrictPrompt → callGeminiStructured(SCHEMAS.grammarOnly, { taskType: 'grading', maxTokens: 4000, temperature: 0 })
//   → mergeCorrectionsDetailed(AI corrections, essay)
//
// 읽을 때 주의:
//   - 저장된 corrections는 채점 당시의 규칙 엔진으로 병합된 값이고, strict는 지금 규칙 엔진으로 병합한다.
//     그 사이 추가된 규칙만큼 strict가 유리하다. 그래서 strict만 찾은 항목에 [규칙] 표시를 붙여 AI 몫과 구분한다.
//   - 같은 곳을 다른 범위로 잡은 경우("않나" vs "잘 않나")는 서로 다른 항목으로 센다(합집합이 조금 부풀 수 있음).
//   - 출력에는 학생 글 조각(교정 대상 낱말)이 나온다. 글 전문·이름은 조회하지도 출력하지도 않는다.

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const nodeModule = require('module')

const ROOT = path.join(__dirname, '..')
const DEFAULT_IDS = ['ac167c6a', '89076402', '39904d3d', '8c13de95', 'ae30a80f', 'efca615d', 'f7c761fe', '03c2d223',
  'd78f6b9f', '86fa57ac', '3fca6e76', '413edee7', '92e656ec', 'd0b3a39d', '3a07324f']

const args = process.argv.slice(2)
const argVal = (name) => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null }
const NO_AI_FLAG = args.includes('--no-ai')
const SAMPLE_ID = argVal('sample') || '8c13de95'
const IDS = (argVal('ids') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const TARGET_IDS = IDS.length ? IDS : DEFAULT_IDS

// .env.local 간이 파서(scripts/load-schools.mjs와 같은 방식). 이미 셸에 있는 환경변수는 덮어쓰지 않음.
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
    return true
  } catch (e) {
    console.warn(`환경 파일 읽기 실패(${file}): ${e.message}`)
    return false
  }
}

// lib/gemini.js는 './apiThrottle'처럼 확장자 없는 상대 경로를 import한다(Next 번들러용).
// node 단독 실행에서는 못 찾으므로, lib를 고치지 않고 해석 훅으로 '.js'를 붙여 준다.
function registerExtensionlessHook() {
  if (typeof nodeModule.registerHooks !== 'function') {
    throw new Error('node 22.15 이상이 필요해요(module.registerHooks 없음)')
  }
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (e) {
        if (specifier.startsWith('.') && !path.extname(specifier)) return nextResolve(`${specifier}.js`, context)
        throw e
      }
    },
  })
}

const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ')
const fmt = (c) => `${norm(c.original)} → ${norm(c.correction)}`
const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length) }

;(async () => {
  loadEnv(argVal('env') ? path.resolve(argVal('env')) : path.join(ROOT, '.env.local'))
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  const GEMINI_KEY = process.env.SYSTEM_GEMINI_API_KEY || null
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 없어요. --env=<.env.local 경로>로 알려 주세요.')
    process.exitCode = 1
    return
  }
  const useAI = !NO_AI_FLAG && !!GEMINI_KEY
  if (!NO_AI_FLAG && !GEMINI_KEY) {
    console.warn('⚠️ SYSTEM_GEMINI_API_KEY가 없어 AI 비교를 건너뜁니다(저장 건수·규칙 엔진 단독 건수만 출력).')
  }

  registerExtensionlessHook()
  const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
  const { findRuleBasedErrors, mergeCorrectionsDetailed } = await imp('lib/koreanRules.js')
  const { grammarStrictPrompt } = await imp('lib/prompts.server.js')
  const { callGeminiStructured, SCHEMAS } = useAI ? await imp('lib/gemini.js') : {}
  const { createClient } = require('@supabase/supabase-js')
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  // 1) 조회(select만). id는 uuid라 like 연산이 안 되므로 앞 8자리 범위(gte/lte)로 접두 매칭한다.
  const rows = []
  for (const p of TARGET_IDS) {
    if (!/^[0-9a-f]{8}$/.test(p)) { console.warn(`건너뜀(앞 8자리 형식 아님): ${p}`); continue }
    const { data, error } = await db.from('submissions')
      .select('id, essay_text, corrections')
      .gte('id', `${p}-0000-0000-0000-000000000000`)
      .lte('id', `${p}-ffff-ffff-ffff-ffffffffffff`)
    if (error) { console.warn(`조회 실패 ${p}: ${error.message}`); continue }
    if (!data || data.length === 0) { console.warn(`없음: ${p}`); continue }
    if (data.length > 1) console.warn(`${p}: ${data.length}건 매칭 — 첫 행만 사용`)
    rows.push({ p, ...data[0] })
  }
  console.log(`대상 ${TARGET_IDS.length}건 중 ${rows.length}건 조회\n`)

  // 2) 글마다 strict 호출 + 규칙 병합(실제 파이프라인과 동일 조건)
  const results = []
  for (const r of rows) {
    const essay = typeof r.essay_text === 'string' ? r.essay_text : ''
    const saved = (Array.isArray(r.corrections) ? r.corrections : []).filter(c => c && norm(c.original))
    let ruleOnly = []
    try { ruleOnly = findRuleBasedErrors(essay) } catch (e) { console.warn(`${r.p} 규칙 엔진 실패: ${e.message}`) }
    let strict = null
    let aiError = null
    if (useAI && essay.trim()) {
      try {
        const res = await callGeminiStructured(GEMINI_KEY, grammarStrictPrompt({ essay }), SCHEMAS.grammarOnly,
          { taskType: 'grading', maxTokens: 4000, temperature: 0 })
        strict = mergeCorrectionsDetailed(Array.isArray(res?.corrections) ? res.corrections : [], essay).corrections
      } catch (e) {
        aiError = e?.message || String(e)
      }
      process.stderr.write(`  ${r.p} ${aiError ? '실패' : '완료'}\n`)
    }
    const savedKeys = new Set(saved.map(c => norm(c.original)))
    const ruleKeys = new Set(ruleOnly.map(c => norm(c.original)))
    const strictOnly = strict ? strict.filter(c => !savedKeys.has(norm(c.original))) : []
    const union = strict ? new Set([...savedKeys, ...strict.map(c => norm(c.original))]).size : null
    results.push({ p: r.p, chars: essay.replace(/\s/g, '').length, saved, strict, strictOnly, union, ruleOnly, ruleKeys, aiError })
  }

  // 3) 비교표
  console.log(`${pad('id', 10)}${pad('글자', 7)}${pad('저장', 6)}${pad('strict', 8)}${pad('합집합', 8)}${pad('strict만', 9)}규칙단독`)
  for (const x of results) {
    console.log(`${pad(x.p, 10)}${pad(x.chars, 7)}${pad(x.saved.length, 6)}${pad(x.strict ? x.strict.length : (x.aiError ? '실패' : '-'), 8)}`
      + `${pad(x.union ?? '-', 8)}${pad(x.strict ? x.strictOnly.length : '-', 9)}${x.ruleOnly.length}`)
  }
  console.log('\nstrict만 새로 찾은 항목 ([규칙] = 지금 규칙 엔진이 단독으로도 잡는 것, 표시 없음 = AI가 찾은 것):')
  for (const x of results) {
    if (x.aiError) { console.log(`  ${x.p}: 호출 실패 — ${x.aiError}`); continue }
    if (!x.strict) continue
    if (!x.strictOnly.length) { console.log(`  ${x.p}: 없음`); continue }
    console.log(`  ${x.p}:`)
    for (const c of x.strictOnly) console.log(`    · ${x.ruleKeys.has(norm(c.original)) ? '[규칙] ' : ''}${fmt(c)}`)
  }

  // 4) 합계(AI 비교는 호출 성공한 글만)
  const ok = results.filter(x => x.strict)
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)
  console.log(`\n합계(전체 ${results.length}건): 저장 ${sum(results, x => x.saved.length)} / 규칙 단독 ${sum(results, x => x.ruleOnly.length)}`)
  if (ok.length) {
    const sSaved = sum(ok, x => x.saved.length)
    const sStrict = sum(ok, x => x.strict.length)
    const sUnion = sum(ok, x => x.union)
    const sNewRule = sum(ok, x => x.strictOnly.filter(c => x.ruleKeys.has(norm(c.original))).length)
    const sNew = sum(ok, x => x.strictOnly.length)
    const pct = (a, b) => b > 0 ? `${a >= b ? '+' : ''}${Math.round((a - b) / b * 100)}%` : 'n/a'
    console.log(`합계(AI 비교 성공 ${ok.length}건): 저장 ${sSaved} vs strict ${sStrict} (${pct(sStrict, sSaved)}) vs 합집합 ${sUnion} (저장 대비 ${pct(sUnion, sSaved)})`)
    console.log(`  strict만 새로 찾은 ${sNew}건 = 규칙 ${sNewRule}건 + AI ${sNew - sNewRule}건`)
  } else {
    console.log('합계(AI 비교): 실행 안 됨')
  }

  // 5) 저장 교정 샘플 10개(정상/과잉 판단용)
  const sample = results.find(x => x.p === SAMPLE_ID)
  if (sample) {
    console.log(`\n저장 교정 샘플 — ${sample.p} (저장 ${sample.saved.length}건, ${sample.chars}자, 앞에서 10개):`)
    for (const c of sample.saved.slice(0, 10)) console.log(`  · ${fmt(c)}${norm(c.reason) ? `  (${norm(c.reason).slice(0, 60)})` : ''}`)
  }
})().catch(e => { console.error('실험 실행 오류:', e && e.message ? e.message : e); process.exitCode = 1 })
