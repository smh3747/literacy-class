// step387: 교사 영구 삭제 — profiles + auth.users 완전 삭제 (관리자 전용)
// 기존 purgeTeacher는 profiles만 지워 auth.users가 고아로 남았고, 같은 이메일 재가입이
// signUp에서 충돌했다("이미 사용 중인 이메일" — 아이디 문제로 보이는 반쪽 삭제 버그).
// 안전장치: 대상이 휴지통(deleted_at 설정)에 있는 교사/관리자일 때만 실행.
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용돼요' })
  if (!supabaseUrl || !serviceKey || !anonKey) return res.status(500).json({ error: '서버 설정 오류' })

  const { teacherId, accessToken } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (!teacherId) return res.status(400).json({ error: '대상이 지정되지 않았어요' })

  try {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })

    // 요청자 인증 + admin 확인 (reset-teacher-password 가드 패턴)
    const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
    if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
    const { data: requester } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
    if (!requester || requester.role !== 'admin') {
      return res.status(403).json({ error: '관리자만 영구 삭제할 수 있어요' })
    }

    // 대상 검증: 휴지통에 있는 교사/관리자만 (학생·휴지통 밖 삭제 방지)
    const { data: target } = await admin.from('profiles')
      .select('id, role, deleted_at').eq('id', teacherId).maybeSingle()
    if (!target) return res.status(404).json({ error: '대상을 찾을 수 없어요' })
    if (target.role === 'student') return res.status(400).json({ error: '학생 계정은 이 경로로 삭제할 수 없어요' })
    if (!target.deleted_at) return res.status(400).json({ error: '휴지통에 있는 계정만 영구 삭제할 수 있어요' })

    // profiles 먼저 명시 삭제 (FK cascade 의존 없이), 이어서 auth 계정 삭제 (반쪽 삭제 방지)
    const { error: pErr } = await admin.from('profiles').delete().eq('id', teacherId)
    if (pErr) return res.status(500).json({ error: '삭제 실패: ' + pErr.message })

    const { error: aErr } = await admin.auth.admin.deleteUser(teacherId)
    if (aErr) {
      console.error('auth 계정 삭제 실패(프로필은 삭제됨):', teacherId, aErr.message)
      return res.status(500).json({ error: '계정 일부만 삭제됐어요. 잠시 후 다시 시도해주세요.' })
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('admin-purge-teacher 오류:', e?.message)
    return res.status(500).json({ error: '삭제에 실패했어요. 잠시 후 다시 시도해주세요.' })
  }
}
