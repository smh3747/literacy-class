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
import { decryptName, encryptName } from '../../lib/encryptName'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { studentIds, accessToken, action } = req.body || {}
  // 기본 unlock(동의 처리) — 기존 동작 보존. lock=재잠금, teacher_confirm=회색지대 증빙 마커.
  const mode = action === 'lock' ? 'lock'
    : action === 'teacher_confirm' ? 'teacher_confirm'
    : 'unlock'
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
  const results = { unlocked: [], consentOnly: [], alreadyDone: [], unlockFailed: [], relocked: [], confirmed: [], skipped: [] }

  for (const studentId of ids) {
    try {
      // 3) 대상 학생 조회 + 담임 검증
      const { data: stu } = await supabaseAdmin.from('profiles')
        .select('id, class_id, role, consent_received, realname')
        .eq('id', studentId)
        .maybeSingle()
      if (!stu || stu.role !== 'student') { results.skipped.push(studentId); continue }

      if (!isAdmin) {
        const { data: cls } = await supabaseAdmin.from('classes')
          .select('teacher_id').eq('id', stu.class_id).maybeSingle()
        if (!cls || cls.teacher_id !== uid) { results.skipped.push(studentId); continue }
      }

      // ===== 재잠금(동의 철회) 분기 — action:'lock' =====
      // ★복구 보장: ①빈값 스킵 ②암호화 성공 ③pending_names 저장 성공 — 셋 다 통과한 뒤에만 realname 비움.
      //   하나라도 실패하면 realname을 그대로 두고 skipped 기록(절대 파괴 안 함).
      if (mode === 'lock') {
        // ① 빈값 스킵 — 이미 닉네임 상태(잠김) 또는 자가가입(realname 없음): 재잠금할 실명 없음.
        //    단, 동의 플래그가 켜져 있으면(자가가입 consentOnly 등) 철회는 반영해 내려준다(realname 불변).
        if (!stu.realname || !String(stu.realname).trim()) {
          if (stu.consent_received === true) {
            await supabaseAdmin.from('profiles').update({ consent_received: false, consent_received_at: null }).eq('id', studentId)
          }
          results.skipped.push(studentId); continue
        }
        // ② 선(先)암호화 — 실패(키 없음 등)면 realname 유지 + 스킵
        let enc = null
        try { enc = encryptName(String(stu.realname)) } catch (e) { console.error('encryptName 실패:', studentId, e?.message); enc = null }
        if (!enc) { results.skipped.push(studentId); continue }
        // ③ pending_names upsert(저장) 성공 후에만 realname 비움 (PK=student_id)
        const { error: pnErr } = await supabaseAdmin.from('pending_names')
          .upsert({ student_id: studentId, class_id: stu.class_id, enc_name: enc }, { onConflict: 'student_id' })
        if (pnErr) { console.error('pending_names upsert 실패:', studentId, pnErr.message); results.skipped.push(studentId); continue }
        // ④ 저장 확인 후 realname 비우고 동의 해제
        const { error: upErr } = await supabaseAdmin.from('profiles').update({
          realname: '', consent_received: false, consent_received_at: null,
        }).eq('id', studentId)
        if (upErr) { console.error('consent-paper lock update 실패:', studentId, upErr.message); results.skipped.push(studentId); continue }
        // ⑤ 철회 이력 (서명·동의항목 없음)
        const { error: cErr } = await supabaseAdmin.from('consents').insert({
          student_id: studentId, class_id: stu.class_id,
          parent_name: '(동의 철회)', signature: null,
          consent_items: [], source: 'paper', consented_at: now,
        })
        if (cErr) console.error('consent-paper 철회 이력 insert 실패:', studentId, cErr.message)
        results.relocked.push(studentId)
        continue
      }

      // ===== 회색지대 "확인 처리" 분기 — action:'teacher_confirm' =====
      //   consent_received=true인데 consents 기록이 없는(증빙 공백) 학생에게 교사 확인 마커를 남긴다.
      //   ★lock/unlock 경로는 건드리지 않음. 마커 insert만(realname·consent_received·pending_names 무변경).
      if (mode === 'teacher_confirm') {
        // 가드: 이미 consents 행이 하나라도 있으면 skip(회색지대 아님 + teacher_confirm 중복 방지 = 멱등)
        const { count: cCount } = await supabaseAdmin.from('consents')
          .select('id', { count: 'exact', head: true }).eq('student_id', studentId)
        if ((cCount || 0) > 0) { results.skipped.push(studentId); continue }
        // 마커 행 insert (동의 증빙 = 교사 확인) — unlock의 source='paper' 패턴 차용
        const { error: cErr } = await supabaseAdmin.from('consents').insert({
          student_id: studentId, class_id: stu.class_id,
          parent_name: '(교사 확인)', signature: null,
          consent_items: ['privacy', 'ai_processing'],
          source: 'teacher_confirm', consented_at: now,
        })
        if (cErr) { console.error('consent-paper teacher_confirm insert 실패:', studentId, cErr.message); results.skipped.push(studentId); continue }
        results.confirmed.push(studentId)
        continue
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
  return res.status(200).json({ ok: true, action: mode, results })
}
