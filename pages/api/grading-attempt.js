// ============================================
// step666: 채점 시도 기록 — 학생이 [제출]을 누른 순간부터 결과를 받을 때까지를 1행으로 남긴다.
// ============================================
// 배경: submissions.grading_ms는 결과를 받은 시도만 재서, 실패하거나 포기한 시도가 어디에도 남지 않았다.
//   POST { accessToken, action:'start', topicId, phase:'first'|'rewrite', attempt }
//     → 같은 학생·주제·attempt의 미완료 행이 30분 안에 있으면 tries +1, 없으면 새 행
//   POST { accessToken, action:'done', topicId, attempt, submissionId, path }
//     → 그 미완료 행에 종료 시각·대기(ms)·경로·제출 id를 채운다
// 원칙: 측정 전용. 학생 화면은 응답을 기다리지 않고(발사 후 망각) 실패해도 제출 흐름에 영향이 없다.
//   글 본문·실명·번호는 받지도 저장하지도 않는다. 표는 RLS 정책 없음(서비스 롤 전용).
import { createClient } from '@supabase/supabase-js'
import { ATTEMPT_JOIN_MS, segmentFields } from '../../lib/gradingTiming'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { accessToken, action, topicId, phase, attempt, submissionId, path } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (action !== 'start' && action !== 'done') return res.status(400).json({ error: 'action이 올바르지 않아요' })
  if (!UUID_RE.test(String(topicId || ''))) return res.status(400).json({ error: '주제 정보가 필요해요' })
  const attemptNo = Math.floor(Number(attempt))
  if (!Number.isFinite(attemptNo) || attemptNo < 1 || attemptNo > 50) return res.status(400).json({ error: 'attempt가 올바르지 않아요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 누락' })
  const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  try {
    const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
    if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
    const userId = userData.user.id
    const { data: me } = await admin.from('profiles').select('role, class_id').eq('id', userId).maybeSingle()
    if (!me || me.role !== 'student') return res.status(200).json({ ok: false, skipped: 'not_student' })

    const now = new Date()
    const since = new Date(now.getTime() - ATTEMPT_JOIN_MS).toISOString()
    // 이어 붙일(또는 완료 처리할) 미완료 행: 같은 학생·주제·attempt, 마지막 누름이 30분 안
    const { data: openRows, error: openErr } = await admin.from('grading_attempts')
      .select('id, started_at, tries')
      .eq('user_id', userId).eq('topic_id', topicId).eq('attempt', attemptNo)
      .is('finished_at', null).gte('last_try_at', since)
      .order('last_try_at', { ascending: false }).limit(1)
    if (openErr) throw openErr
    const open = openRows && openRows[0]

    if (action === 'start') {
      if (open) {
        const { error } = await admin.from('grading_attempts')
          .update({ tries: (Number(open.tries) || 1) + 1, last_try_at: now.toISOString() })
          .eq('id', open.id).is('finished_at', null)
        if (error) throw error
        return res.status(200).json({ ok: true, joined: true })
      }
      const { error } = await admin.from('grading_attempts').insert({
        user_id: userId, class_id: me.class_id || null, topic_id: topicId,
        phase: phase === 'rewrite' ? 'rewrite' : 'first', attempt: attemptNo,
        started_at: now.toISOString(), last_try_at: now.toISOString(), tries: 1,
      })
      if (error) throw error
      return res.status(200).json({ ok: true, joined: false })
    }

    // done
    if (!open) return res.status(200).json({ ok: false, skipped: 'no_open_row' })
    const waitMs = Math.max(0, now.getTime() - new Date(open.started_at).getTime())
    const base = {
      finished_at: now.toISOString(), wait_ms: waitMs,
      path: path ? String(path).slice(0, 40) : null,
      submission_id: UUID_RE.test(String(submissionId || '')) ? submissionId : null,
    }
    // step668: 구간 시간(서버가 잰 값을 학생 화면이 그대로 전달). 0~10분 범위의 숫자만 받는다.
    const seg = segmentFields(req.body?.timing)
    let { error } = await admin.from('grading_attempts').update({ ...base, ...seg }).eq('id', open.id).is('finished_at', null)
    if (error && Object.keys(seg).length > 0) {
      // 구간 컬럼(step668 SQL)이 아직 없으면 기존 값만 저장한다
      ;({ error } = await admin.from('grading_attempts').update(base).eq('id', open.id).is('finished_at', null))
    }
    if (error) throw error
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('grading-attempt 오류:', e?.message || e)
    return res.status(200).json({ ok: false, error: 'record_failed' })   // 측정 실패는 화면에 오류로 보이지 않게 200
  }
}
