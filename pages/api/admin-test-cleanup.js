// ============================================
// step674: 관리자 "🧹 시험 글 정리" — 지정된 시험 학생의 글만 휴지통으로 (관리자 전용)
// ============================================
//   POST { accessToken } → { moved }
//   대상: 시험 반(lib/testStudent.js TEST_CLASS_ID)의 지정 아이디(TEST_STUDENT_USERNAMES) 학생이 쓴 글 중 휴지통에 없는 것.
//   학생 id·학급을 입력으로 받지 않는다. 시험 반의 다른 학생(기존 계정) 글과 실제 학급 글은 건드리지 않는다.
//   완전 삭제가 아니다. 기존 휴지통 흐름과 같은 3필드(deleted_at·deleted_by·delete_reason)만 채운다.
import { createClient } from '@supabase/supabase-js'
import { TEST_CLASS_ID, TEST_STUDENT_USERNAMES, TEST_CLEANUP_REASON, isTestStudentProfile } from '../../lib/testStudent'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { accessToken } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY가 없어요.' })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
  if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  const { data: me } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (!me || me.role !== 'admin') return res.status(403).json({ error: '관리자만 쓸 수 있어요' })

  try {
    const { data: found, error: pErr } = await admin.from('profiles')
      .select('id, role, class_id, username, deleted_at')
      .eq('class_id', TEST_CLASS_ID).in('username', TEST_STUDENT_USERNAMES)
    if (pErr) throw pErr
    const ids = (found || []).filter(isTestStudentProfile).map(p => p.id)
    if (ids.length === 0) return res.status(200).json({ moved: 0 })

    const { data: moved, error: uErr } = await admin.from('submissions')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userData.user.id, delete_reason: TEST_CLEANUP_REASON })
      .in('user_id', ids).is('deleted_at', null)
      .select('id')
    if (uErr) throw uErr
    return res.status(200).json({ moved: (moved || []).length })
  } catch (e) {
    console.error('admin-test-cleanup 오류:', e?.message || e)
    return res.status(500).json({ error: '시험 글을 정리하지 못했어요' })
  }
}
