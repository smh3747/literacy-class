// 📚 step619: 우리 반 글 모음 — 목록·교사 선택 서버 API
// 역할: ① 열람 조건 강제(학급 ON + 본인 제출 있음) ② 후보 선정 단일화(lib/peerShareSelect.js) ③ peer_share_overrides 전용 읽기·쓰기.
//   ※ submissions RLS(sub_select, step147)는 같은 학급 행을 이미 열어 두므로 이 API가 본문을 '숨기는' 장치는 아니다.
//      학생 응답에는 student_id·실명·submission_id를 넣지 않는다(닉네임·본문·순번만).
// 입력: POST { accessToken, topicId, action: 'list'|'show'|'hide', submissionId? }
// 학생: 자기 담임 주제만. OFF → { ok, enabled:false, items:[] } / 본인 제출 없음 → { ok, locked:true, items:[] }
// 교사: 본인 주제만(admin은 list만 — 엿보기 읽기 전용). show/hide는 overrides upsert·삭제 후 갱신 목록 반환(캐시 없음).
// SQL(step619) 미적용: 컬럼 조회 실패 → enabled:false로 응답(학생 무영향), 교사 쓰기는 안내 오류.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import { selectPeerShare, isEligible } from '../../lib/peerShareSelect'
import { nicknameFromSeed } from '../../lib/nickname'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SQL_HINT = '학급 설정 SQL(step619)을 먼저 적용해 주세요'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken, topicId, action = 'list', submissionId } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (typeof topicId !== 'string' || !UUID_RE.test(topicId)) return res.status(400).json({ error: '주제 정보가 올바르지 않아요' })
  if (!['list', 'show', 'hide'].includes(action)) return res.status(400).json({ error: '요청이 올바르지 않아요' })

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

  const { data: profile } = await admin.from('profiles').select('role, class_id').eq('id', uid).maybeSingle()
  if (!profile || !['student', 'teacher', 'admin'].includes(profile.role)) return res.status(403).json({ error: '사용할 수 없어요' })

  const { data: topic } = await admin.from('topics').select('id, teacher_id').eq('id', topicId).maybeSingle()
  if (!topic?.teacher_id) return res.status(404).json({ error: '주제를 찾을 수 없어요' })

  // 권한: 학생은 담임 주제만, 교사는 본인 주제만, admin은 list만(엿보기 읽기 전용)
  let classRow = null
  if (profile.role === 'student') {
    if (!profile.class_id) return res.status(403).json({ error: '학급 정보가 없어요' })
    const { data: cls } = await admin.from('classes').select('id, teacher_id').eq('id', profile.class_id).maybeSingle()
    if (!cls || cls.teacher_id !== topic.teacher_id) return res.status(403).json({ error: '우리 반 주제가 아니에요' })
    classRow = cls
    if (action !== 'list') return res.status(403).json({ error: '선생님만 바꿀 수 있어요' })
  } else if (profile.role === 'teacher') {
    if (topic.teacher_id !== uid) return res.status(403).json({ error: '담임 주제가 아니에요' })
  } else if (action !== 'list') {
    return res.status(403).json({ error: '엿보기에서는 바꿀 수 없어요' })
  }
  // 교사·admin: 주제 소유 교사의 학급(profiles.class_id 경유 — 교사 1명=학급 1개 관행)
  if (!classRow) {
    const { data: owner } = await admin.from('profiles').select('class_id').eq('id', topic.teacher_id).maybeSingle()
    if (owner?.class_id) {
      const { data: cls } = await admin.from('classes').select('id, teacher_id').eq('id', owner.class_id).maybeSingle()
      classRow = cls || null
    }
  }
  if (!classRow) return res.status(404).json({ error: '학급 정보가 없어요' })

  // 학급 설정(SQL 미적용이면 조회 실패 → OFF 취급)
  let enabled = false, showScore = false, settingsOk = true
  {
    const { data: cfg, error: cfgErr } = await admin.from('classes')
      .select('peer_share_enabled, peer_share_show_score').eq('id', classRow.id).maybeSingle()
    if (cfgErr) { settingsOk = false }
    else { enabled = cfg?.peer_share_enabled === true; showScore = cfg?.peer_share_show_score === true }
  }

  // 학생: OFF → 빈 응답, 본인 제출 없음 → locked
  if (profile.role === 'student') {
    if (!enabled) return res.status(200).json({ ok: true, enabled: false, showScore: false, items: [] })
    const { count } = await admin.from('submissions').select('id', { count: 'exact', head: true })
      .eq('topic_id', topicId).eq('user_id', uid).is('deleted_at', null)
    if (!(count > 0)) return res.status(200).json({ ok: true, enabled: true, locked: true, showScore, items: [] })
  }

  // 재료 조회: 주제 제출 전체(본문 제외) + 학급 학생 profiles + overrides
  const load = async () => {
    const { data: subs, error: subErr } = await admin.from('submissions')
      .select('id, user_id, total_score, attempt, created_at, deleted_at, paste_detected')
      .eq('topic_id', topicId)
    if (subErr) throw new Error('제출을 불러오지 못했어요')
    const { data: profs } = await admin.from('profiles')
      .select('id, nickname, username, number, is_hidden, realname')
      .eq('class_id', classRow.id).eq('role', 'student')
    let overrides = []
    if (settingsOk) {
      const { data: ov, error: ovErr } = await admin.from('peer_share_overrides')
        .select('submission_id, action').eq('topic_id', topicId)
      if (!ovErr) overrides = ov || []
    }
    return { subs: subs || [], profs: profs || [], overrides }
  }

  try {
    let { subs, profs, overrides } = await load()

    // 교사 선택 반영
    if (action === 'show' || action === 'hide') {
      if (!settingsOk) return res.status(400).json({ error: SQL_HINT })
      if (typeof submissionId !== 'string' || !UUID_RE.test(submissionId)) return res.status(400).json({ error: '글 정보가 올바르지 않아요' })
      const target = subs.find(s => s.id === submissionId)
      if (!target) return res.status(404).json({ error: '이 주제의 글이 아니에요' })
      const profById = Object.fromEntries(profs.map(p => [p.id, p]))
      const sel = selectPeerShare({ submissions: subs, profiles: profs, overrides })
      const isAuto = sel.auto.includes(submissionId)
      const current = overrides.find(o => o.submission_id === submissionId) || null
      let op = null   // { type: 'upsert', action } | { type: 'delete' }
      if (action === 'show') {
        if (isAuto) op = current?.action === 'exclude' ? { type: 'delete' } : null
        else {
          if (!isEligible(target, profById[target.user_id])) return res.status(400).json({ error: '학부모 동의 전이거나 점수가 없는 글은 공유할 수 없어요' })
          op = current?.action === 'add' ? null : { type: 'upsert', action: 'add' }
        }
      } else {
        if (isAuto) op = current?.action === 'exclude' ? null : { type: 'upsert', action: 'exclude' }
        else op = current?.action === 'add' ? { type: 'delete' } : null
      }
      if (op?.type === 'delete') {
        const { error } = await admin.from('peer_share_overrides').delete().eq('topic_id', topicId).eq('submission_id', submissionId)
        if (error) return res.status(500).json({ error: '저장에 실패했어요' })
      } else if (op?.type === 'upsert') {
        const { error } = await admin.from('peer_share_overrides')
          .upsert({ topic_id: topicId, submission_id: submissionId, action: op.action, teacher_id: uid }, { onConflict: 'topic_id,submission_id' })
        if (error) return res.status(500).json({ error: '저장에 실패했어요' })
      }
      ;({ subs, profs, overrides } = await load())
    }

    const sel = selectPeerShare({ submissions: subs, profiles: profs, overrides })

    if (profile.role === 'student') {
      const profById = Object.fromEntries(profs.map(p => [p.id, p]))
      const ids = sel.shown.map(x => x.submissionId)
      const { data: essays } = ids.length
        ? await admin.from('submissions').select('id, essay_text').in('id', ids)
        : { data: [] }
      const essayById = Object.fromEntries((essays || []).map(e => [e.id, e.essay_text || '']))
      const items = sel.shown.map((x, i) => {
        const p = profById[x.userId] || {}
        const nickname = String(p.nickname == null ? '' : p.nickname).trim() || nicknameFromSeed(p.username || x.userId)
        const item = { key: i + 1, nickname, essay: essayById[x.submissionId] || '', mine: x.userId === uid }
        if (showScore) item.score = x.score
        return item
      })
      return res.status(200).json({ ok: true, enabled: true, showScore, items })
    }

    // 교사·admin: 담임 권한 — userId·submissionId 포함(이름은 화면이 가진 profiles로 매핑). 본문 미포함(화면이 이미 가짐).
    return res.status(200).json({
      ok: true, enabled, showScore, settingsOk,
      items: sel.shown,
      autoIds: sel.auto, excludedAutoIds: sel.excludedAutoIds, addedIds: sel.addedIds,
    })
  } catch (e) {
    console.error('peer-share 실패:', e?.message)
    return res.status(500).json({ error: e?.message || '글 모음을 불러오지 못했어요' })
  }
}
