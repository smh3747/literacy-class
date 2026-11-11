// ============================================
// step673: 관리자 "🧪 시험 학생으로 열기" — 시험 전용 학생의 일회용 로그인 링크 발급 (관리자 전용)
// ============================================
//   POST { accessToken, slot(1|2) } → { url }   url = /test-student?th=<일회용 토큰 해시>
//   안전:
//     - 호출자가 admin인지 서버에서 확인한다.
//     - 학생 id·아이디를 입력으로 받지 않는다. 칸 번호(slot)만 받고, 대상은 lib/testStudent.js 상수에서 정한다.
//     - 발급 전: 프로필(시험 반·학생·지정 아이디)과 인증 계정 이메일을 대조한다. 발급 뒤: 링크가 가리키는 계정 id를 다시 대조한다.
//     - 발급할 때마다 누가·언제·어느 칸을 test_student_opens에 기록한다. 기록에 실패하면 링크를 내주지 않는다.
//   링크는 한 번만 쓸 수 있고 시간이 지나면 만료된다(Supabase 일회용 토큰).
import { createClient } from '@supabase/supabase-js'
import { TEST_CLASS_ID, TEST_TAB_PATH, testUsernameOfSlot, testEmailOfSlot, testStudentRefusal } from '../../lib/testStudent'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { accessToken, slot } = req.body || {}
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

  const username = testUsernameOfSlot(slot)
  const email = testEmailOfSlot(slot)
  if (!username || !email) return res.status(400).json({ error: '시험 학생 칸 번호가 올바르지 않아요' })

  try {
    // 1) 프로필: 시험 반 + 지정 아이디로만 찾는다
    const { data: profile } = await admin.from('profiles')
      .select('id, role, class_id, username, deleted_at')
      .eq('class_id', TEST_CLASS_ID).eq('username', username).maybeSingle()
    if (!profile) return res.status(404).json({ error: '시험 학생 계정이 아직 없어요. scripts/make-test-students.mjs로 먼저 만들어 주세요.' })

    // 2) 인증 계정 대조(발급 전)
    const { data: au, error: auErr } = await admin.auth.admin.getUserById(profile.id)
    const authUser = auErr ? null : au?.user
    const before = testStudentRefusal({ slot, profile, authUser })
    if (before) return res.status(403).json({ error: `시험 학생으로 확인되지 않아 열 수 없어요 (${before})` })

    // 3) 기록 먼저. 실패하면 발급하지 않는다.
    const { error: logErr } = await admin.from('test_student_opens')
      .insert({ admin_id: userData.user.id, student_id: profile.id, slot })
    if (logErr) return res.status(500).json({ error: '발급 기록을 남기지 못해 열지 않았어요. migrations/step673-test-student-opens.sql 적용을 확인해 주세요.' })

    // 4) 일회용 링크 발급 → 링크가 가리키는 계정 재대조
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const tokenHash = link?.properties?.hashed_token
    if (linkErr || !tokenHash) return res.status(500).json({ error: '로그인 링크를 만들지 못했어요' })
    const after = testStudentRefusal({ slot, profile, authUser, linkUserId: link?.user?.id ?? null })
    if (after) return res.status(403).json({ error: `시험 학생으로 확인되지 않아 열 수 없어요 (${after})` })

    return res.status(200).json({ url: `${TEST_TAB_PATH}?th=${encodeURIComponent(tokenHash)}` })
  } catch (e) {
    console.error('admin-test-student 오류:', e?.message || e)
    return res.status(500).json({ error: '시험 학생 창을 열지 못했어요' })
  }
}
