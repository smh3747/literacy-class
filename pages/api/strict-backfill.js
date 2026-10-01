// ============================================
// step600: 맞춤법 보완(폴링 트리거) — pending 글의 전용 검사를 나중에 실행
// ============================================
// Hobby 플랜(2분 크론 불가)이라 학생 결과 화면의 30초 폴링이 "상태 확인 + 보완 실행"을 겸한다.
//   POST { accessToken, submissionId }
//   → 글이 pending이 아니면 현 상태·corrections 그대로 반환
//   → pending이면 교사 60초 가드가 비어 있을 때만 전용 검사(학급 키·3.1 풀) 실행 → 저장 → done
//   → 가드 초과·429·타임아웃이면 pending 유지(다음 폴링에 재시도)
// 권한: 글의 주인(학생) / 그 학급 담임 / 관리자. 키는 서버에서만 조회, 응답에 키·모델명 없음.
import { createClient } from '@supabase/supabase-js'
import { backfillOne, getClassTeacherId, BACKFILL_TIMEOUT_MS } from '../../lib/strictCheck.server'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { accessToken, submissionId } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요. 페이지를 새로고침 해주세요.' })
  if (!submissionId || typeof submissionId !== 'string') return res.status(400).json({ error: '글 정보가 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })

  const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  try {
    const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
    if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요. 다시 로그인해주세요.' })
    const userId = userData.user.id
    const { data: me } = await admin.from('profiles').select('role, class_id').eq('id', userId).maybeSingle()
    if (!me) return res.status(403).json({ error: '사용자 정보를 찾을 수 없어요.' })

    const { data: sub } = await admin.from('submissions')
      .select('id, user_id, essay_text, corrections, strict_status, created_at')
      .eq('id', submissionId).maybeSingle()
    if (!sub) return res.status(404).json({ error: '글을 찾을 수 없어요' })

    // 권한: 본인 / 관리자 / 그 학생 학급의 담임
    let allowed = sub.user_id === userId || me.role === 'admin'
    if (!allowed && me.role === 'teacher') {
      const { data: owner } = await admin.from('profiles').select('class_id').eq('id', sub.user_id).maybeSingle()
      const teacherId = await getClassTeacherId(admin, owner?.class_id)
      allowed = !!teacherId && teacherId === userId
    }
    if (!allowed) return res.status(403).json({ error: '이 글을 볼 권한이 없어요' })

    if (sub.strict_status !== 'pending') {
      return res.status(200).json({ status: sub.strict_status || null, corrections: Array.isArray(sub.corrections) ? sub.corrections : [] })
    }
    const t0 = Date.now()
    const r = await backfillOne(admin, sub, { timeoutMs: BACKFILL_TIMEOUT_MS })
    console.log(`[strict-backfill] status=${r.status}${r.reason ? ` reason=${String(r.reason).slice(0, 60)}` : ''} ms=${Date.now() - t0}`)
    return res.status(200).json({
      status: r.status,
      ...(Array.isArray(r.corrections) ? { corrections: r.corrections } : {}),
    })
  } catch (e) {
    console.error('strict-backfill 오류:', e?.message || e)
    return res.status(500).json({ error: '보완 검사 중 오류가 발생했어요' })
  }
}
