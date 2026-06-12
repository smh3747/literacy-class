import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { code, role } = req.body

  const ADMIN_CODE = process.env.ADMIN_SECRET_CODE
  const TEACHER_CODE = process.env.TEACHER_SECRET_CODE

  if (role === 'admin') {
    if (code !== ADMIN_CODE) return res.status(403).json({ error: '관리자 코드가 틀렸어요' })

    // admin 중복가입 확인 (step148 RLS로 클라이언트에서 확인 불가능해져 서버로 이동)
    // service_role로 RLS 우회 조회 — 키 없으면 확인 생략(구버전 동작과 동일한 수준)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceKey) {
      const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
      const { data: existingAdmin } = await supabaseAdmin.from('profiles')
        .select('id').eq('role', 'admin').limit(1).maybeSingle()
      if (existingAdmin) {
        return res.status(409).json({ error: '관리자는 이미 가입되어 있어요' })
      }
    }
  } else if (role === 'teacher') {
    if (code !== TEACHER_CODE) return res.status(403).json({ error: '교사 가입 코드가 틀렸어요' })
  } else {
    return res.status(400).json({ error: '잘못된 요청이에요' })
  }

  return res.status(200).json({ ok: true })
}
