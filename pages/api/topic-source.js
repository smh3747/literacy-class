// 🔁 step613: 공유 추천 로그 → 원 주제의 설명·평가 기준·최소 글자 수 (교사용 읽기 전용)
// 다른 교사의 topics 행은 RLS(top_select, step150)상 클라이언트가 읽지 못해 공유 카드의 resulting_topic 조인이 null이다.
// 여기서 service role로 읽어 안전한 필드만 돌려준다 — 교사 실명·teacher_id·학급명·class_id는 반환하지 않는다(익명 원칙).
//   입력: { accessToken, logId }
//   조건: 로그에 resulting_topic_id가 있어야 한다(= 등록까지 간 로그, 전체 공유 대상). 없으면 404 { reason: 'no_topic' }.
//         원 주제가 삭제됐으면(ON DELETE SET NULL로 비워짐) 같은 404 → 호출부는 기존 AI 생성 경로로 폴백.
//   출력: { ok, source: { description, rubrics, min_length, grade } }  — grade는 로그의 학급(classes.grade), 없으면 null.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken, logId } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (typeof logId !== 'string' || !UUID_RE.test(logId)) return res.status(400).json({ error: '추천 기록 정보가 올바르지 않아요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: profile } = await admin.from('profiles')
    .select('role').eq('id', userData.user.id).maybeSingle()
  if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
    return res.status(403).json({ error: '선생님만 사용할 수 있어요' })
  }

  const { data: log, error: logErr } = await admin.from('topic_suggestion_logs')
    .select('resulting_topic_id, class_id').eq('id', logId).maybeSingle()
  if (logErr) {
    console.error('topic-source 로그 조회 실패:', logErr.message)
    return res.status(500).json({ error: '추천 기록을 불러오지 못했어요' })
  }
  if (!log?.resulting_topic_id) return res.status(404).json({ error: '원 주제가 없어요', reason: 'no_topic' })

  const { data: topic, error: topicErr } = await admin.from('topics')
    .select('description, rubrics, min_length').eq('id', log.resulting_topic_id).maybeSingle()
  if (topicErr) {
    console.error('topic-source 주제 조회 실패:', topicErr.message)
    return res.status(500).json({ error: '원 주제를 불러오지 못했어요' })
  }
  if (!topic) return res.status(404).json({ error: '원 주제가 없어요', reason: 'no_topic' })

  let grade = null
  if (log.class_id) {
    const { data: cls } = await admin.from('classes').select('grade').eq('id', log.class_id).maybeSingle()
    grade = Number.isInteger(cls?.grade) ? cls.grade : null
  }

  return res.status(200).json({
    ok: true,
    source: {
      description: topic.description || '',
      rubrics: Array.isArray(topic.rubrics) ? topic.rubrics : [],
      min_length: Number(topic.min_length) || 30,
      grade,
    },
  })
}
