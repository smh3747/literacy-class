// 종이 동의 처리 API (묶음 F-0) — 교사가 종이 동의서를 받아 "동의서 ✓"로 켤 때 호출.
//
// 온라인(/api/parent-consent)과 달리 부모 세션이 없고 교사가 대신 처리하므로,
// 교사 accessToken으로 인증 + 담임 검증 후 service_role로 RLS를 우회해 처리한다.
// 해제 로직은 parent-consent.js 142~174줄과 동일(잠금 해제 단일 규칙 재사용):
//   pending_names.enc_name → decryptName → profiles.realname 채움 → pending_names 삭제.
//
// 학생별 처리(8단계):
//   1) env  2) 교사 인증  3) 담임 검증(class_id)  4) 멱등 가드(이미 동의+잠금없음 → 스킵)
//   5) 실명 해제(pending_names 있을 때만 복호화)  6) consent_received=true 보장
//   7) consents 이력 insert(source='paper')  8) 결과 집계 응답
// ★ 지목된 studentIds만 처리. 다른 반·온라인 경로·기존 데이터 불변. 응답에 실명 등 PII 미포함.
//
// 사전 조건(SQL): step187(pending_names), step193(consents), step209(consents.source).
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//           SUPABASE_SERVICE_ROLE_KEY, NAME_ENCRYPTION_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import { decryptName } from '../../lib/encryptName'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { studentIds, accessToken } = req.body || {}
  const ids = Array.isArray(studentIds) ? studentIds.filter(Boolean) : []
  if (ids.length === 0) return res.status(400).json({ error: '대상 학생이 없어요' })
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  // 1) env
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 2) 교사 인증 (anon 클라이언트로 토큰 검증 → uid·role)
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }
  const uid = userData.user.id
  const { data: requester } = await supabaseAdmin.from('profiles')
    .select('role').eq('id', uid).maybeSingle()
  if (!requester || (requester.role !== 'teacher' && requester.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }
  const isAdmin = requester.role === 'admin'

  const now = new Date().toISOString()
  // 결과 집계: 상태별 studentId 모음
  const results = { unlocked: [], consentOnly: [], alreadyDone: [], unlockFailed: [], skipped: [] }

  for (const studentId of ids) {
    try {
      // 3) 대상 학생 조회 + 담임 검증
      const { data: stu } = await supabaseAdmin.from('profiles')
        .select('id, class_id, role, consent_received')
        .eq('id', studentId)
        .maybeSingle()
      if (!stu || stu.role !== 'student') { results.skipped.push(studentId); continue }

      if (!isAdmin) {
        const { data: cls } = await supabaseAdmin.from('classes')
          .select('teacher_id').eq('id', stu.class_id).maybeSingle()
        if (!cls || cls.teacher_id !== uid) { results.skipped.push(studentId); continue }
      }

      // 4) 멱등 가드 — pending_names 조회
      const { data: pn } = await supabaseAdmin.from('pending_names')
        .select('enc_name').eq('student_id', studentId).maybeSingle()

      // 이미 동의됨 + 잠금 없음 → 완전 스킵(realname·consents 무변경)
      if (!pn && stu.consent_received === true) {
        results.alreadyDone.push(studentId)
        continue
      }

      let status = null

      if (pn) {
        // 5) 실명 해제 — enc_name 복호화 (있을 때만)
        let realname = null
        try {
          realname = pn.enc_name ? decryptName(pn.enc_name) : null
        } catch (e) {
          console.error('decryptName 실패:', studentId, e?.message)
          realname = null
        }

        if (realname) {
          const { error: upErr } = await supabaseAdmin.from('profiles').update({
            realname,
            consent_received: true,
            consent_received_at: now,
          }).eq('id', studentId)
          if (upErr) { results.skipped.push(studentId); continue }
          // 잠금 행 삭제(마지막 — 중간 실패 시 재시도 여지)
          await supabaseAdmin.from('pending_names').delete().eq('student_id', studentId)
          status = 'unlocked'
        } else {
          // 복호화 실패/키 없음 — realname은 못 채우지만 consent_received는 켜고 교사에게 안내
          const { error: upErr } = await supabaseAdmin.from('profiles').update({
            consent_received: true, consent_received_at: now,
          }).eq('id', studentId)
          if (upErr) { results.skipped.push(studentId); continue }
          status = 'unlockFailed'
        }
      } else {
        // pending_names 없음(자가가입 등) — realname 건드리지 않고 consent_received만 보장
        const { error: upErr } = await supabaseAdmin.from('profiles').update({
          consent_received: true, consent_received_at: now,
        }).eq('id', studentId)
        if (upErr) { results.skipped.push(studentId); continue }
        status = 'consentOnly'
      }

      // 7) consents 이력 insert (종이 제출 — 서명 없음)
      const { error: cErr } = await supabaseAdmin.from('consents').insert({
        student_id: studentId,
        class_id: stu.class_id,
        parent_name: '(종이 제출)',
        signature: null,
        consent_items: ['privacy', 'ai_processing'],
        source: 'paper',
        consented_at: now,
      })
      if (cErr) {
        // 실명·동의는 이미 처리됨 — 이력 실패는 로깅만(상태는 유지)
        console.error('consent-paper consents insert 실패:', studentId, cErr.message)
      }

      if (status === 'unlocked') results.unlocked.push(studentId)
      else if (status === 'unlockFailed') results.unlockFailed.push(studentId)
      else results.consentOnly.push(studentId)
    } catch (e) {
      console.error('consent-paper student 처리 실패:', studentId, e?.message || e)
      results.skipped.push(studentId)
    }
  }

  // 8) 집계 응답 (PII 없음 — studentId만)
  return res.status(200).json({ ok: true, results })
}
