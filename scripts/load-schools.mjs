// 전국 초등학교를 NEIS에서 받아 Supabase schools 테이블에 적재 — step167
//
// 1회성(가끔 갱신) 스크립트. 멱등 upsert(onConflict: code)라 재실행해도 안전.
//   - NEIS schoolInfo를 pSize=1000으로 페이징(초등학교 ~6,341개 → 7페이지)
//   - {code,name,region,address}로 정규화 후 schools에 500건씩 upsert
//
// 실행: node scripts/load-schools.mjs
//
// 필요한 환경변수 (.env.local에서 자동으로 읽음. 없으면 셸 환경변수 사용):
//   - NEIS_API_KEY
//   - NEXT_PUBLIC_SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY   ← 실제 service_role 키 필요 (플레이스홀더면 실패)

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// .env.local 간이 파서 (새 의존성 없이). 이미 셸에 있는 환경변수는 덮어쓰지 않음.
function loadEnvLocal() {
  try {
    const txt = readFileSync(join(ROOT, '.env.local'), 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (!m) continue // 주석(#...)·빈 줄은 건너뜀
      const key = m[1]
      let val = m[2]
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  } catch (e) {
    console.warn('.env.local 읽기 실패(셸 환경변수로 직접 넣었다면 무시 가능):', e.message)
  }
}
loadEnvLocal()

const NEIS_KEY = process.env.NEIS_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

function die(msg) { console.error('❌ ' + msg); process.exit(1) }
if (!NEIS_KEY) die('NEIS_API_KEY 없음 (.env.local 확인)')
if (!SUPABASE_URL) die('NEXT_PUBLIC_SUPABASE_URL 없음 (.env.local 확인)')
if (!SERVICE_KEY || /서비스롤|service[-_]?key|placeholder/i.test(SERVICE_KEY)) {
  die('SUPABASE_SERVICE_ROLE_KEY가 비었거나 플레이스홀더예요. .env.local에 실제 service_role 키를 넣어주세요.')
}

const ENDPOINT = 'https://open.neis.go.kr/hub/schoolInfo'
const PAGE_SIZE = 1000
const UPSERT_CHUNK = 500
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function fetchPage(pIndex) {
  const url = `${ENDPOINT}?KEY=${encodeURIComponent(NEIS_KEY)}`
    + `&Type=json&pIndex=${pIndex}&pSize=${PAGE_SIZE}`
    + `&SCHUL_KND_SC_NM=${encodeURIComponent('초등학교')}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`NEIS HTTP ${r.status} (pIndex=${pIndex})`)
  const j = await r.json()
  const result = j?.schoolInfo?.[0]?.head?.[1]?.RESULT || j?.RESULT
  if (result && result.CODE && result.CODE !== 'INFO-000') {
    throw new Error(`NEIS ${result.CODE}: ${result.MESSAGE} (pIndex=${pIndex})`)
  }
  const total = j?.schoolInfo?.[0]?.head?.[0]?.list_total_count || 0
  const rows = j?.schoolInfo?.[1]?.row || []
  return { total, rows }
}

function normalize(row) {
  return {
    code: row.SD_SCHUL_CODE || '',
    name: row.SCHUL_NM || '',
    region: row.ATPT_OFCDC_SC_NM || '',
    address: row.ORG_RDNMA || '',
    updated_at: new Date().toISOString(),
  }
}

async function main() {
  console.log('▶ NEIS에서 전국 초등학교 목록을 가져옵니다...')

  const first = await fetchPage(1)
  const total = first.total
  if (!total) die('NEIS 응답에 학교가 없습니다. 키/네트워크를 확인하세요.')
  const pages = Math.ceil(total / PAGE_SIZE)
  console.log(`  총 ${total}개, ${pages}페이지`)

  const byCode = new Map()
  const collect = (rows) => {
    for (const row of rows) {
      if (row?.SCHUL_KND_SC_NM !== '초등학교') continue
      const s = normalize(row)
      if (s.code && s.name) byCode.set(s.code, s) // code 중복 시 마지막 값으로 (멱등)
    }
  }
  collect(first.rows)

  for (let p = 2; p <= pages; p++) {
    await sleep(200) // NEIS에 예의상 약간의 간격
    const { rows } = await fetchPage(p)
    collect(rows)
    console.log(`  페이지 ${p}/${pages} 수집 (누적 ${byCode.size}개)`)
  }

  const schools = [...byCode.values()]
  console.log(`▶ 정규화 완료: ${schools.length}개. Supabase에 upsert 시작...`)

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let done = 0
  for (let i = 0; i < schools.length; i += UPSERT_CHUNK) {
    const chunk = schools.slice(i, i + UPSERT_CHUNK)
    const { error } = await supabase.from('schools').upsert(chunk, { onConflict: 'code' })
    if (error) die(`upsert 실패 (offset ${i}): ${error.message}`)
    done += chunk.length
    console.log(`  upsert ${done}/${schools.length}`)
  }

  console.log(`✅ 완료: ${schools.length}개 학교를 schools 테이블에 적재했습니다.`)
}

main().catch(e => die(e?.message || String(e)))
