// 동의 비밀번호 폴백 규칙 (단일 출처)
// 교사가 동의 비번을 설정했으면 그 값, 비웠으면(빈값/null) 학급코드가 정답이다.
//  ※ ClassSettings(표시·안내문)·parent-consent(제출 검증)·consent-verify-child(확인)가
//    반드시 같은 규칙을 써야 한다 — 안 그러면 "안내문엔 적혀있는데 거부" 사고.
//
// parent-consent.js 의 기존 인라인 규칙과 글자 그대로 동일:
//   (cls.consent_password && trim !== '') ? trim(consent_password)
//                                          : trim(cls.code || normalizedCode || '')
//
// normalizedCode: 호출처에서 이미 정규화한 학급코드(대문자/trim). cls.code 가 비어 있을 때의 폴백.

export function effectiveConsentPassword(cls, normalizedCode) {
  if (!cls) return String(normalizedCode || '').trim()
  return (cls.consent_password && String(cls.consent_password).trim() !== '')
    ? String(cls.consent_password).trim()
    : String(cls.code || normalizedCode || '').trim()
}
