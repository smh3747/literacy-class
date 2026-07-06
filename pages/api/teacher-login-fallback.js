// step381: 아이디→실이메일 해석 로그인 폴백 (서버 전용)
// 신규 교사는 auth 이메일이 실이메일이라 합성 이메일(username@writing.class) 로그인이 실패한다.
// 이 API가 service role로 username→auth 이메일을 해석해 로그인하고 세션 토큰만 돌려준다.
// 보안: 이메일은 절대 반환하지 않음(수집 공격 차단). 실패는 전부 같은 문구(존재 여부 비노출).
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const FAIL = { error: '아이디 또는 비밀번호가 맞지 않아요' }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용돼요' })
  if (!supabaseUrl || !serviceKey || !anonKey) return res.status(500).json({ error: '서버 설정 오류' })

  const uname = String(req.body?.username || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!uname || !password) return res.status(401).json(FAIL)

  try {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    // 1) 아이디 → 프로필 (교사/관리자만 — 학생 로그인 흐름 침범 금지)
    const { data: prof } = await admin.from('profiles').select('id, role').eq('username', uname).maybeSingle()
    if (!prof || (prof.role !== 'teacher' && prof.role !== 'admin')) return res.status(401).json(FAIL)

    // 2) 프로필 id → auth 이메일. 합성 이메일이면 폴백 무의미(1차 경로에서 이미 실패한 것)
    const { data: userData } = await admin.auth.admin.getUserById(prof.id)
    const email = userData?.user?.email
    if (!email || email.endsWith('@writing.class')) return res.status(401).json(FAIL)

    // 3) 실이메일로 로그인 시도 → 세션 토큰만 반환
    const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data, error: signErr } = await anon.auth.signInWithPassword({ email, password })
    if (signErr || !data?.session) return res.status(401).json(FAIL)

    return res.status(200).json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })
  } catch (e) {
    console.error('teacher-login-fallback 오류:', e?.message)
    return res.status(401).json(FAIL)
  }
}
