// step673: 시험 반(6975)에 시험 전용 학생 2명을 만든다. 관리자 "🧪 시험 학생으로 열기"가 이 계정으로만 로그인한다.
//
//   미리 보기(아무것도 안 바꿈):  node scripts/make-test-students.mjs
//   실제로 만들기:               node scripts/make-test-students.mjs --apply
//
//   필요: .env.local의 NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
//   만드는 것: 인증 계정(아이디@writing.class, 비밀번호는 무작위라 아무도 모른다 → 관리자 버튼으로만 들어감)
//             + profiles 행(학생·시험 반·닉네임 "시험 학생 N"·번호 98/99·실명 없음)
//   이미 있으면 건너뛴다. 여러 번 실행해도 안전하다.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { TEST_CLASS_ID, TEST_STUDENT_USERNAMES, TEST_STUDENT_NICKNAMES, TEST_EMAIL_DOMAIN } from '../lib/testStudent.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const APPLY = process.argv.includes('--apply')
const NUMBERS = ['98', '99']

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: cls, error: clsErr } = await db.from('classes').select('id, name, code, school, deleted_at').eq('id', TEST_CLASS_ID).maybeSingle()
if (clsErr || !cls) { console.error('시험 반을 찾지 못했어요:', clsErr?.message || TEST_CLASS_ID); process.exit(1) }
if (cls.code !== '6975' || cls.deleted_at) { console.error('시험 반 확인 실패(코드 6975가 아니거나 삭제됨):', cls.code); process.exit(1) }
console.log(`시험 반: ${cls.school || ''} ${cls.name} (코드 ${cls.code})  ${APPLY ? '[실제 적용]' : '[미리 보기 — 바꾸지 않음]'}`)

for (let i = 0; i < TEST_STUDENT_USERNAMES.length; i++) {
  const username = TEST_STUDENT_USERNAMES[i]
  const email = `${username}@${TEST_EMAIL_DOMAIN}`
  const { data: existing } = await db.from('profiles').select('id, role, class_id').eq('username', username)
  if (existing && existing.length) {
    const p = existing[0]
    const ok = p.role === 'student' && p.class_id === TEST_CLASS_ID
    console.log(`- ${username}: 이미 있음 → ${ok ? '시험 반 학생으로 확인, 건너뜀' : '⚠ 다른 반·다른 역할의 계정이 이 아이디를 쓰고 있어요. 손대지 않았어요.'}`)
    continue
  }
  if (!APPLY) { console.log(`- ${username}: 만들 예정 (닉네임 "${TEST_STUDENT_NICKNAMES[i]}", 번호 ${NUMBERS[i]})`); continue }

  const password = crypto.randomBytes(24).toString('base64url')   // 출력·저장하지 않는다
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) { console.log(`- ${username}: 인증 계정 생성 실패 → ${error.message}`); continue }
  const row = {
    id: data.user.id, username, realname: '', role: 'student', class_id: TEST_CLASS_ID,
    number: NUMBERS[i], nickname: TEST_STUDENT_NICKNAMES[i],
    consent_received: true, consent_received_at: new Date().toISOString(), must_change_password: false,
  }
  const { error: pErr } = await db.from('profiles').insert(row)
  if (pErr) {
    await db.auth.admin.deleteUser(data.user.id)   // 방금 만든 계정만 되돌린다
    console.log(`- ${username}: 프로필 저장 실패(계정 되돌림) → ${pErr.message}`)
    continue
  }
  console.log(`- ${username}: 만들었어요 (닉네임 "${TEST_STUDENT_NICKNAMES[i]}", 번호 ${NUMBERS[i]})`)
}
if (!APPLY) console.log('\n실제로 만들려면 --apply를 붙여 다시 실행하세요.')
