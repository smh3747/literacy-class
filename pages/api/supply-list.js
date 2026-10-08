// 🌏 step611: 발행된 전국 챌린지 주제 목록 (교사용 읽기 전용)
// 공급 원본은 teacher_id=관리자인 topics 행이라 RLS(top_select)상 교사 클라이언트가 읽지 못한다.
// 여기서 service role로 읽어 안전한 컬럼만 돌려준다(class-lookup 관행: 교사 실명·teacher_id 등 미포함).
//   - published_at이 있고 지금 이전인 것만(예약분 제외). 최근 30개.
//   - isToday: published_at이 오늘(KST) 창 안 → 교사 홈 원클릭(step477)과 같은 "오늘 발행분" 판정.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import { kstTodayYmd, kstYmdOf } from '../../lib/supplyBands'

const LIMIT = 30

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

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

  const now = new Date()
  const { data: rows, error } = await admin.from('topics')
    .select('id, title, description, rubrics, min_length, supply_grade, published_at')
    .not('supply_type', 'is', null)
    .not('published_at', 'is', null)
    .lte('published_at', now.toISOString())
    .order('published_at', { ascending: false })
    .limit(LIMIT)
  if (error) {
    console.error('supply-list 조회 실패:', error.message)
    return res.status(500).json({ error: '전국 주제를 불러오지 못했어요' })
  }

  const today = kstTodayYmd(now)
  const items = (rows || []).map(r => {
    const publishedYmd = kstYmdOf(r.published_at)
    return {
      id: r.id,
      title: r.title,
      description: r.description || '',
      rubrics: Array.isArray(r.rubrics) ? r.rubrics : [],
      min_length: Number(r.min_length) || 30,
      supply_grade: r.supply_grade || '공통',
      published_at: r.published_at,
      publishedYmd,
      isToday: publishedYmd === today,
    }
  })
  return res.status(200).json({ ok: true, items })
}
