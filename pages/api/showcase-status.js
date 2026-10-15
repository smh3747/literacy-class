// step632: 교사용 전국 소개 상태 조회 — 내 반 글이 supply_showcase에 어떤 상태로 올라가 있나
// 배경: supply_showcase는 RLS 정책 없음(서버 전용)이라 교사가 자기 반 글의 소개 여부를 볼 길이 없었다.
// 입력: POST { accessToken, topicId }. 교사=본인 주제만, admin=조회 허용(엿보기 읽기 전용), 학생 403.
// 범위: 이 주제(학급 복사본)의 제출 id 목록으로 in 절 봉인 → 다른 학급 행 0. 챌린지 주제가 아니면 challenge:false.
// 응답: { ok, challenge, items: { [submissionId]: { status, hidden, reason?, nicknameIssue? } }, counts: { showing, pending, held } }
//   review_reason은 rejected일 때만 120자(lib/showcaseStatus.js). 글 본문·학생 실명 없음.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import { buildShowcaseStatusMap } from '../../lib/showcaseStatus'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken, topicId } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (typeof topicId !== 'string' || !UUID_RE.test(topicId)) return res.status(400).json({ error: '주제 정보가 올바르지 않아요' })

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

  const { data: profile } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle()
  if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) return res.status(403).json({ error: '선생님만 볼 수 있어요' })

  const { data: topic } = await admin.from('topics').select('id, teacher_id, source_supply_id').eq('id', topicId).maybeSingle()
  if (!topic) return res.status(404).json({ error: '주제를 찾을 수 없어요' })
  if (profile.role === 'teacher' && topic.teacher_id !== uid) return res.status(403).json({ error: '담임 주제가 아니에요' })

  if (!topic.source_supply_id) return res.status(200).json({ ok: true, challenge: false, items: {}, counts: { showing: 0, pending: 0, held: 0 } })

  try {
    const { data: subs, error: subErr } = await admin.from('submissions').select('id').eq('topic_id', topicId)
    if (subErr) throw subErr
    const ids = (subs || []).map(s => s.id)
    let rows = []
    if (ids.length > 0) {
      const { data, error } = await admin.from('supply_showcase')
        .select('submission_id, review_status, review_reason, hidden')
        .eq('supply_topic_id', topic.source_supply_id)
        .in('submission_id', ids)
      if (error) throw error
      rows = data || []
    }
    const { items, counts } = buildShowcaseStatusMap(rows)
    return res.status(200).json({ ok: true, challenge: true, items, counts })
  } catch (e) {
    console.error('showcase-status 실패:', e?.message)
    return res.status(500).json({ error: '전국 소개 상태를 불러오지 못했어요' })
  }
}
