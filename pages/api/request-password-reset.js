// step386: 비밀번호 재설정 요청 — 아이디+이메일 쌍이 일치할 때만 재설정 메일 발송.
// 응답은 결과와 무관하게 항상 동일(계정 존재·이메일 일치 여부 비노출).
import { createClient } from '@supabase/supabase-js'
import { isValidEmail } from '../../lib/email'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const SAME = { ok: true }  // 어떤 경우에도 동일 응답

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용돼요' })
  if (!supabaseUrl || !serviceKey || !anonKey) return res.status(500).json({ error: '서버 설정 오류' })

  const uname = String(req.body?.username || '').trim().toLowerCase()
  const email = String(req.body?.email || '').trim().toLowerCase()
  // 형식 불량도 동일 응답 (비노출 원칙 — 메일만 안 감)
  if (!uname || !isValidEmail(email)) return res.status(200).json(SAME)

  try {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    // 1) 아이디 → 프로필 (교사/관리자만)
    const { data: prof } = await admin.from('profiles').select('id, role').eq('username', uname).maybeSingle()
    if (!prof || (prof.role !== 'teacher' && prof.role !== 'admin')) return res.status(200).json(SAME)

    // 2) auth 이메일과 쌍 일치 확인
    const { data: userData } = await admin.auth.admin.getUserById(prof.id)
    const authEmail = (userData?.user?.email || '').toLowerCase()
    if (!authEmail || authEmail.endsWith('@writing.class') || authEmail !== email) {
      return res.status(200).json(SAME)
    }

    // 3) 일치할 때만 재설정 메일 발송
    const origin = (process.env.NEXT_PUBLIC_SITE_URL || req.headers.origin || '').replace(/\/$/, '')
    const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    await anon.auth.resetPasswordForEmail(authEmail, origin ? { redirectTo: `${origin}/reset-password` } : undefined)

    return res.status(200).json(SAME)
  } catch (e) {
    console.error('request-password-reset 오류:', e?.message)
    return res.status(200).json(SAME)  // 오류도 동일 응답 (비노출)
  }
}
