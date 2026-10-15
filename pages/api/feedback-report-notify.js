// step631: 학생 피드백 신고("🚨 이 피드백 이상해요") → 관리자 전원 종 알림
// 배경: 신고는 담임에게만 가서(step348 create_notification 'report') 운영자가 품질 사고를 늦게 알았다.
//   학생 세션은 profiles RLS상 admin 목록을 못 읽으므로 서버(service role)가 대신 보낸다(supply-report.js step518 관행).
// 입력: POST { accessToken, submissionId }. 학생만. 본인 제출·reported=true·삭제 아님·신고 2분 이내일 때만.
// 알림: type 'report' 재사용(notifications_type_check 11종 고정 — 새 type 금지, step541 규칙). 제목에 학교·반·번호만, 본문·실명·글 내용 없음.
//   링크는 그 담임의 엿보기 신고함(/teacher/feedback-reports?as={teacher_id}). 담임 본인이 admin이면 제외(담임 알림은 이미 감).
// 실패는 전부 조용히(클라이언트가 결과를 쓰지 않음 — 학생 흐름 불변).
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RECENT_MS = 2 * 60 * 1000   // reported_at이 이보다 오래됐으면 거부(도배 방지)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken, submissionId } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (typeof submissionId !== 'string' || !UUID_RE.test(submissionId)) return res.status(400).json({ error: '글 정보가 올바르지 않아요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })

  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  const uid = userData.user.id

  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: profile } = await admin.from('profiles').select('role, number, class_id').eq('id', uid).maybeSingle()
  if (!profile || profile.role !== 'student') return res.status(403).json({ error: '학생만 쓸 수 있어요' })

  // 본인 제출 + 방금 신고된 글인지(서버가 다시 확인 — 클라이언트 주장만으로 알림을 만들지 않는다)
  const { data: sub } = await admin.from('submissions')
    .select('id, user_id, reported, reported_at, deleted_at').eq('id', submissionId).maybeSingle()
  if (!sub || sub.user_id !== uid) return res.status(403).json({ error: '내 글이 아니에요' })
  if (sub.deleted_at || sub.reported !== true || !sub.reported_at) return res.status(400).json({ error: '신고된 글이 아니에요' })
  if (Date.now() - new Date(sub.reported_at).getTime() > RECENT_MS) return res.status(400).json({ error: '신고 알림 시간이 지났어요' })

  try {
    let className = '', teacherId = null, school = ''
    if (profile.class_id) {
      const { data: cls } = await admin.from('classes').select('name, teacher_id').eq('id', profile.class_id).maybeSingle()
      className = cls?.name || ''
      teacherId = cls?.teacher_id || null
      if (teacherId) {
        const { data: t } = await admin.from('profiles').select('school').eq('id', teacherId).maybeSingle()
        school = t?.school || ''
      }
    }
    const { data: admins } = await admin.from('profiles').select('id').eq('role', 'admin')
    const where = [school, className].filter(Boolean).join(' ')
    const title = `🚨 피드백 신고 · ${where || '학급 미상'} ${profile.number ? profile.number + '번' : '학생'}`
    const link = teacherId ? `/teacher/feedback-reports?as=${teacherId}` : '/admin'
    const rows = (admins || [])
      .filter(a => a.id !== teacherId)   // 담임이 admin이면 중복 방지
      .map(a => ({ recipient_id: a.id, type: 'report', title, link }))
    if (rows.length > 0) {
      const { error } = await admin.from('notifications').insert(rows)
      if (error) console.warn('피드백 신고 관리자 알림 실패(무시):', error.message)
    }
    return res.status(200).json({ ok: true, sent: rows.length })
  } catch (e) {
    console.warn('피드백 신고 관리자 알림 실패(무시):', e?.message)
    return res.status(200).json({ ok: true, sent: 0 })
  }
}
