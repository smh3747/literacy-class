// 동의 흔적 판정 (서버 전용 · 읽기 전용)
//
// "잠긴 적 없는(pending_names 행이 없는) 학생"이 진짜 '이미 동의'인지 가르는 단일 규칙.
// 닉네임-잠금 도입 이전 등록된 기존 학생은 실명이 평문으로 들어갔고 pending_names가 없어,
// pending_names 유무만으로 판정하면 전부 "이미 동의"로 오판된다(실명 무단 노출).
//
// 규칙: consents 기록이 있거나 profiles.consent_received=true 이면 '동의 흔적 있음'.
//   → 흔적이 있을 때만 alreadyConsented 로 본다.
// parent-consent.js · consent-verify-child.js 가 동일하게 사용(복제 금지).
// ⚠️ 이 함수는 조회만 한다 — 어떤 쓰기도 하지 않는다.

export async function hasConsentTrace(supabaseAdmin, studentId) {
  // 1) consents 이력 존재?
  try {
    const { count } = await supabaseAdmin.from('consents')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId)
    if ((count || 0) > 0) return true
  } catch (e) { /* 무시 — 아래 플래그로 폴백 */ }
  // 2) profiles.consent_received 플래그
  try {
    const { data: prof } = await supabaseAdmin.from('profiles')
      .select('consent_received').eq('id', studentId).maybeSingle()
    return prof?.consent_received === true
  } catch (e) {
    return false
  }
}
