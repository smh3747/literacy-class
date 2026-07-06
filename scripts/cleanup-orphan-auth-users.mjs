// step387: 고아 auth 계정 정리 — profiles 행이 없는 auth.users 잔재 (반쪽 삭제 버그의 기존 잔재)
//
// 기존 영구 삭제가 profiles만 지워 auth.users가 남았고, 같은 이메일 재가입이 signUp에서 충돌했다.
// 이 스크립트는 profiles가 없는 auth 계정 중 생성 1일 경과분을 고아로 판정한다.
//
// 실행: node scripts/cleanup-orphan-auth-users.mjs           ← dry-run (목록만, 삭제 없음)
//       node scripts/cleanup-orphan-auth-users.mjs --apply   ← 실제 삭제
// service_role 필요(.env.local). 멱등: 재실행 시 남은 고아만 다시 나열.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const APPLY = process.argv.includes('--apply')
const ONE_DAY_AGO = Date.now() - 24 * 3600 * 1000

const mask = (email) => {
  const [l, d] = String(email || '').split('@')
  if (!d) return '(없음)'
  return `${(l || '').slice(0, 2)}***@${d}`
}

async function run() {
  // 1) auth.users 전수 (페이지네이션)
  const authUsers = []
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) { console.error('listUsers 실패:', error.message); process.exit(1) }
    authUsers.push(...(data?.users || []))
    if (!data?.users || data.users.length < 1000) break
    page++
  }
  console.log(`auth.users 전체: ${authUsers.length}명`)

  // 2) profiles 존재 여부 배치 확인
  const ids = authUsers.map(u => u.id)
  const existing = new Set()
  for (let i = 0; i < ids.length; i += 100) {  // 100개 청크 (uuid 500개는 URL 길이 초과)
    const chunk = ids.slice(i, i + 100)
    const { data, error } = await admin.from('profiles').select('id').in('id', chunk)
    if (error) { console.error('profiles 조회 실패:', error.message); process.exit(1) }
    ;(data || []).forEach(r => existing.add(r.id))
  }

  // 3) 고아 판정: profiles 없음 + 생성 1일 경과 (가입 직후 정상 계정 오탐 방지)
  const orphans = authUsers.filter(u =>
    !existing.has(u.id) && new Date(u.created_at).getTime() < ONE_DAY_AGO
  )
  console.log(`고아 후보(프로필 없음 + 생성 1일 경과): ${orphans.length}명`)
  orphans.forEach(u => {
    console.log(`  - ${u.id.slice(0, 8)}…  ${mask(u.email)}  생성 ${String(u.created_at).slice(0, 10)}`)
  })

  if (!APPLY) {
    console.log('\ndry-run 완료 (삭제 없음). 실제 삭제는 --apply 로 실행하세요.')
    return
  }

  // 4) --apply: 삭제
  let ok = 0, fail = 0
  for (const u of orphans) {
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error) { fail++; console.error(`  삭제 실패 ${u.id.slice(0, 8)}…: ${error.message}`) }
    else ok++
  }
  console.log(`\n삭제 완료: ${ok}명, 실패: ${fail}명`)
}

run().catch(e => { console.error('FATAL', e.message); process.exit(1) })
