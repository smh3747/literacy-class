// Supabase Auth + 일반 에러를 사용자 친화적 한글 메시지로 변환
// 베타 운영하면서 자주 보이는 에러들 대응

/**
 * 에러 객체나 메시지를 받아 사용자에게 보여줄 친절한 한글 메시지로 변환
 * @param {Error|object|string} err - 에러
 * @param {string} context - 'login' | 'signup' | 'reset' | 'general'
 * @returns {string} 사용자에게 보여줄 메시지
 */
export function getAuthErrorMessage(err, context = 'general') {
  if (!err) return '알 수 없는 오류가 발생했어요'

  const raw = (typeof err === 'string') ? err : (err.message || err.error_description || err.error || '')
  const status = err?.status || err?.statusCode
  const code = err?.code

  // 로그인 자격 증명 실패
  if (raw.includes('Invalid login credentials') || raw.includes('invalid_credentials')) {
    if (context === 'teacherLogin') {
      return '아이디 또는 비밀번호가 잘못됐어요.\n다시 확인해주세요.\n\n' +
        '🔑 비밀번호를 잊으셨나요?\n' +
        '새로 가입하지 마시고 관리자(개발자)에게 초기화를 요청하세요.\n' +
        '재가입하면 기존 학급·학생·글과 연결이 끊겨요!\n\n' +
        '💡 처음이라면 회원가입을 먼저 해주세요.'
    }
    // step206: '회원가입 먼저'를 1순위에서 내림 — 명렬표 학급 학생이 오타 후 새 계정(유령) 만드는 것 방지.
    return '아이디 또는 비밀번호가 잘못됐어요.\n다시 확인해주세요.\n\n💡 아이디 오타가 아닌지 확인하고, 모르겠으면 선생님께 물어보세요.\n(처음 가입하는 학급이면 "회원가입" 탭을 눌러요.)'
  }

  // 이미 가입된 사용자 (422)
  if (raw.includes('already registered') || raw.includes('already been registered') ||
      raw.includes('User already') || raw.includes('already exists') || raw.toLowerCase().includes('duplicate')) {
    if (context === 'signup') {
      return '이미 가입된 아이디예요!\n\n👉 "로그인" 탭으로 가서 로그인해주세요.\n비밀번호를 잊으셨다면 선생님께 초기화 요청하세요.'
    }
    return '이미 가입된 계정이에요.'
  }

  // 비밀번호 너무 짧음
  if (raw.includes('Password should be at least') || raw.includes('password_too_short') || raw.includes('weak_password')) {
    const match = raw.match(/at least (\d+)/)
    const minLen = match ? match[1] : '6'
    return `비밀번호는 ${minLen}자 이상이어야 해요.`
  }

  // 이메일 형식 오류
  if (raw.includes('Unable to validate email') || raw.includes('Invalid email')) {
    return '아이디 형식이 잘못됐어요.\n영문/숫자만 사용해주세요.'
  }

  // 이메일 인증 안 됨
  if (raw.includes('Email not confirmed') || raw.includes('email_not_confirmed')) {
    return '이메일 인증이 필요해요. 선생님 또는 관리자에게 문의해주세요.'
  }

  // 사용자 없음
  if (raw.includes('User not found') || raw.includes('user does not exist') || raw.includes('user_not_found')) {
    // step206: 오타 확인·선생님 문의를 앞세움(명렬표 학급 유령 방지). 가입은 보조 안내로.
    return '입력한 아이디로 만든 계정이 없어요.\n\n💡 아이디 오타가 아닌지 확인하거나 선생님께 문의해주세요.\n(처음 가입하는 학급이면 "회원가입" 탭으로 가입하세요.)'
  }

  // 비밀번호 변경 시 이전과 같음
  if (raw.includes('same as the existing') || raw.includes('same_password')) {
    return '현재 비밀번호와 같은 비밀번호로 변경할 수 없어요.'
  }

  // Rate limit (너무 많은 시도)
  if (raw.includes('rate limit') || raw.includes('too many') || raw.includes('Email rate limit') || status === 429) {
    return '잠시 후 다시 시도해주세요.\n(짧은 시간에 너무 많이 시도했어요)'
  }

  // 네트워크
  if (raw.includes('Network') || raw.includes('Failed to fetch') || raw.includes('NetworkError')) {
    return '네트워크 연결을 확인해주세요.\nWiFi나 데이터가 켜져 있는지 살펴주세요.'
  }

  // 세션 만료
  if (raw.includes('JWT expired') || raw.includes('token expired') || raw.includes('session expired')) {
    return '로그인이 만료됐어요.\n다시 로그인해주세요.'
  }

  // Supabase 422 (일반적 회원가입 거부)
  if (status === 422 || raw.includes('422')) {
    if (context === 'signup') {
      return '회원가입에 실패했어요.\n\n자주 보이는 원인:\n· 이미 가입된 아이디\n· 비밀번호가 너무 짧음 (6자 이상)\n· 아이디 형식 오류'
    }
    return '요청이 거부됐어요. 다시 시도해주세요.'
  }

  // 학급 코드 관련
  if (raw.includes('학급 코드') || raw.includes('class code')) {
    return raw // 우리 시스템 메시지는 그대로
  }

  // 권한 없음
  if (status === 403 || raw.includes('not authorized') || raw.includes('Forbidden')) {
    return '권한이 없어요.\n다시 로그인해보세요.'
  }

  // 그 외: 원본 메시지 표시 (개발자가 디버깅할 수 있게)
  return raw || '알 수 없는 오류가 발생했어요. 다시 시도해주세요.'
}
