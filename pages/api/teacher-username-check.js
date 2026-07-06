// step381: 교사 가입 아이디 중복확인 (서버 전용)
// 실이메일 가입 전환으로 합성 이메일 충돌에 의한 중복 감지가 사라져, 가입 전 명시 확인이 필요.
// 학생·교사가 같은 아이디 네임스페이스를 쓰므로 role 무관 profiles.username 전체 대조.
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용돼요' })
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 오류' })

  const uname = String(req.body?.username || '').trim().toLowerCase()
  if (!uname || uname.length < 2 || uname.length > 50 || /[@\s]/.test(uname)) {
    return res.status(400).json({ error: '아이디 형식이 올바르지 않아요' })
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { count, error } = await admin.from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('username', uname)
  if (error) return res.status(500).json({ error: '확인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.' })

  return res.status(200).json({ taken: (count || 0) > 0 })
}
