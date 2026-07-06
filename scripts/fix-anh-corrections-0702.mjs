// 07-02 안않 오교정(않기→안 기) 저장분 corrections 정리 (일회성·멱등)
//
// 2026-07-02 작성 제출물 4건에 AI가 "않기"를 "안 기"로 잘못 교정한 항목이 저장돼
// 학생 글 화면에서 올바른 "않기"에 빨간 밑줄이 뜬다. 그 오교정 항목만 제거한다.
// 점수·본문·다른 교정은 불변. corrections 컬럼만, id 단건 UPDATE만.
//
// 실행: node scripts/fix-anh-corrections-0702.mjs
// service_role로 RLS 우회. .env.local 필요(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
// 멱등: 재실행 시 문제항목이 없으면 아무 것도 바꾸지 않는다.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// .env.local 간이 파서 (dotenv 미사용 — load-schools.mjs 선례)
function loadEnvLocal() {
  const env = {}
  const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  raw.split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  })
  return env
}

const env = loadEnvLocal()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('환경변수 누락: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

// 정리 대상 제출물 id (조사로 확정한 4건, id 명시 — WHERE 없는 UPDATE 금지)
const TARGET_IDS = [
  '62f1a248-f69d-4f97-b3cb-70f5e903acc1', // 뽀로로반 #4  (점수 85)
  '646e1554-0625-4962-8eb4-1087fedc00ef', // 뽀로로반 #7  (점수 75)
  '681de2bb-4c96-4d95-84d5-b463d4130925', // 뽀로로반 #19 (점수 75)
  '6b49bfdc-c33c-453c-8500-06b3c5e4bc79', // 5학년1반 #16 (점수 62)
]

// 제거 대상: 정확히 {original:"않기", correction:"안 기"} (게이트 dropAnhFalsePositives와 동일 결과)
const isBadAnh = (c) => c && c.original === '않기' && c.correction === '안 기'

async function run() {
  const { data: rows, error } = await sb
    .from('submissions')
    .select('id, corrections')
    .in('id', TARGET_IDS)
  if (error) { console.error('SELECT 실패:', JSON.stringify(error)); process.exit(1) }

  console.log(`대상 조회: ${rows.length}/${TARGET_IDS.length}건`)
  let updated = 0, skipped = 0
  for (const id of TARGET_IDS) {
    const row = rows.find(r => r.id === id)
    if (!row) { console.warn(`  [${id.slice(0, 8)}] 제출물 없음 → 스킵`); skipped++; continue }
    const corr = Array.isArray(row.corrections) ? row.corrections : []
    const next = corr.filter(c => !isBadAnh(c))
    const removed = corr.length - next.length

    if (removed === 0) { console.log(`  [${id.slice(0, 8)}] 문제항목 없음(이미 정리됨) → 스킵`); skipped++; continue }
    if (removed !== 1) { console.warn(`  [${id.slice(0, 8)}] 예상 밖 제거 개수 ${removed} → 안전 스킵`); skipped++; continue }

    // corrections만, id 단건 UPDATE (점수·본문·기타 컬럼 불변)
    const { error: upErr } = await sb.from('submissions').update({ corrections: next }).eq('id', id)
    if (upErr) { console.error(`  [${id.slice(0, 8)}] UPDATE 실패:`, JSON.stringify(upErr)); skipped++; continue }

    // 재-SELECT 검증
    const { data: after } = await sb.from('submissions').select('corrections').eq('id', id).maybeSingle()
    const stillBad = (after?.corrections || []).filter(isBadAnh).length
    console.log(`  [${id.slice(0, 8)}] corrections ${corr.length} → ${next.length} (제거 ${removed}), 남은 안않항목 ${stillBad}`)
    updated++
  }
  console.log(`\n완료: 수정 ${updated}건, 스킵 ${skipped}건`)
}

run().catch(e => { console.error('FATAL', e.message); process.exit(1) })
