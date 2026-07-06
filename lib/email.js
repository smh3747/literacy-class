// step384: 이메일 형식 검증 단일 소스 (클라이언트·서버 공용, 순수 함수)
// 기존 /.+@.+\..+/ 는 비앵커·관대해서 kim@school.c, 공백 포함, 이중 @, 한글 등이
// 전부 통과했다(가입 우회 버그 원인). 앵커드·엄격 규칙으로 교체:
// 로컬파트(영문·숫자·._%+-), 도메인 라벨(영문·숫자·-), TLD 영문 2자 이상.
export const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/

export function isValidEmail(email) {
  const v = String(email || '').trim()
  return EMAIL_RE.test(v) && !v.toLowerCase().endsWith('@writing.class')
}

// 가입 폼 도메인 선택 옵션
export const EMAIL_DOMAINS = ['naver.com', 'gmail.com', 'daum.net', 'hanmail.net']
