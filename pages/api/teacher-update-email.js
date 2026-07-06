// step386: 계정 복구용 이메일 등록·교체 (서버 직접 교체)
// updateUser({email})는 Secure email change 기본값이 옛 주소(가짜 @writing.class)에도 확인 메일을
// 요구해 기존 교사가 영구 블록됨 → accessToken + 현재 비밀번호 재인증 후 admin API로 즉시 교체.
// 가입 폼과 동일하게 미검증 이메일 수용(오타 위험 동일 수준). 이메일 형식은 lib/email.js 단일 소스.
import { createClient } from '@supabase/supabase-js'
import { isValidEmail } from '../../lib/email'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용돼요' })
  if (!supabaseUrl || !serviceKey || !anonKey) return res.status(500).json({ error: '서버 설정 오류' })

  const { email, currentPassword, accessToken } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (!currentPassword) return res.status(400).json({ error: '현재 비밀번호를 입력해주세요' })

  const newEmail = String(email || '').trim().toLowerCase()
  if (!isValidEmail(newEmail)) return res.status(400).json({ error: '이메일 형식을 확인해주세요' })

  try {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })

    // 1) 요청자 인증 (본인만 — 자기 계정의 이메일만 바꿀 수 있음)
    const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
    if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
    const uid = userData.user.id

    const { data: prof } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle()
    if (!prof || (prof.role !== 'teacher' && prof.role !== 'admin')) {
      return res.status(403).json({ error: '선생님 계정만 이메일을 등록할 수 있어요' })
    }

    // 2) 현재 비밀번호 재인증 (탈취된 세션만으로 복구 이메일을 바꾸는 것 방지)
    const { data: cur } = await admin.auth.admin.getUserById(uid)
    const currentEmail = cur?.user?.email
    if (!currentEmail) return res.status(500).json({ error: '계정 정보를 확인하지 못했어요' })
    const { error: reauthErr } = await anon.auth.signInWithPassword({ email: currentEmail, password: currentPassword })
    if (reauthErr) return res.status(401).json({ error: '현재 비밀번호가 맞지 않아요' })

    // 3) 이메일 교체 (확인 메일 없이 즉시 — email_confirm: true)
    const { error: upErr } = await admin.auth.admin.updateUserById(uid, { email: newEmail, email_confirm: true })
    if (upErr) {
      const msg = (upErr.message || '').toLowerCase()
      if (msg.includes('already') || msg.includes('duplicate') || msg.includes('exists')) {
        return res.status(400).json({ error: '이미 사용 중인 이메일이에요' })
      }
      console.error('이메일 교체 실패:', upErr.message)
      return res.status(500).json({ error: '이메일 등록에 실패했어요. 잠시 후 다시 시도해주세요.' })
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('teacher-update-email 오류:', e?.message)
    return res.status(500).json({ error: '이메일 등록에 실패했어요. 잠시 후 다시 시도해주세요.' })
  }
}
