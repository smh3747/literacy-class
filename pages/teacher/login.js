import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { getAuthErrorMessage } from '../../lib/authErrors'
import ConsentForm from '../../components/ConsentForm'

// 로컬 스토리지 키
const SAVED_USERNAME_KEY = 'lc-saved-username-teacher'
const NO_AUTO_LOGIN_KEY = 'lc-no-auto-login'
const SESSION_ACTIVE_KEY = 'lc-session-active'

export default function TeacherLogin() {
  const router = useRouter()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [realname, setRealname] = useState('')
  const [password, setPassword] = useState('')
  const [secretCode, setSecretCode] = useState('')
  const [className, setClassName] = useState('')
  const [school, setSchool] = useState('')
  const [signupRole, setSignupRole] = useState('teacher')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('form')
  const [checkingAuth, setCheckingAuth] = useState(true)
  // 새 옵션
  const [saveUsername, setSaveUsername] = useState(false)
  const [autoLogin, setAutoLogin] = useState(true)

  // 🆕 비밀번호 초기화 요청 모달
  const [showResetRequest, setShowResetRequest] = useState(false)
  const [resetForm, setResetForm] = useState({ username: '', realname: '', school: '', contact: '' })
  const [resetSubmitting, setResetSubmitting] = useState(false)

  const submitResetRequest = async () => {
    if (!resetForm.username.trim() || !resetForm.realname.trim()) {
      alert('아이디와 이름은 꼭 입력해주세요')
      return
    }
    setResetSubmitting(true)
    try {
      const { error } = await supabase.from('password_reset_requests').insert({
        username: resetForm.username.trim().toLowerCase(),
        realname: resetForm.realname.trim(),
        school: resetForm.school.trim() || null,
        contact: resetForm.contact.trim() || null,
      })
      if (error) throw error
      alert(
        '✅ 초기화 요청이 접수됐어요!\n\n' +
        '관리자가 확인 후 임시 비밀번호를 만들어서\n' +
        '남겨주신 연락 방법으로 전달드릴게요.\n\n' +
        '⚠️ 그동안 새로 가입하지 마세요 —\n' +
        '재가입하면 기존 학급·학생·글과 연결이 끊겨요.'
      )
      setShowResetRequest(false)
      setResetForm({ username: '', realname: '', school: '', contact: '' })
    } catch(e) {
      alert('요청 실패: ' + (e.message || '잠시 후 다시 시도해주세요'))
    }
    setResetSubmitting(false)
  }
  // 가입 시 동의 체크 (한 화면에 같이 표시)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SAVED_USERNAME_KEY)
      if (saved) {
        setUsername(saved)
        setSaveUsername(true)
      }
      const noAuto = localStorage.getItem(NO_AUTO_LOGIN_KEY) === 'true'
      setAutoLogin(!noAuto)
    }
    checkSession()
  }, [])

  const checkSession = async () => {
    try {
      // 자동 로그인 OFF + 새 브라우저 세션 → 강제 로그아웃
      if (typeof window !== 'undefined') {
        const noAutoLogin = localStorage.getItem(NO_AUTO_LOGIN_KEY) === 'true'
        const sessionActive = sessionStorage.getItem(SESSION_ACTIVE_KEY) === 'true'
        if (noAutoLogin && !sessionActive) {
          await supabase.auth.signOut()
          setCheckingAuth(false)
          return
        }
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { data: profile, error: profileErr } = await supabase.from('profiles')
          .select('role, deleted_at').eq('id', session.user.id).maybeSingle()

        // 🆕 자동 복구: 세션은 있는데 profile이 없거나 조회 실패 → 깨끗하게 로그아웃
        if (profileErr || !profile) {
          console.warn('[auto-recovery] 세션은 있지만 profile 없음 → 정리:', profileErr?.message)
          await supabase.auth.signOut()
          setCheckingAuth(false)
          return
        }

        // 🆕 삭제된 계정은 강제 로그아웃
        if (profile.deleted_at) {
          await supabase.auth.signOut()
          setError('이 계정은 관리자에 의해 삭제되었어요.\n관리자에게 문의해주세요.')
          setCheckingAuth(false)
          return
        }

        // 🆕 자동 복구: 역할이 학생 등 잘못된 경우도 정리
        if (profile.role === 'teacher' || profile.role === 'admin') {
          router.replace('/teacher')
          return
        }
        // 그 외 (student 등) → signOut 후 로그인 폼
        console.warn('[auto-recovery] role 불일치 → 정리:', profile.role)
        await supabase.auth.signOut()
      }
    } catch (e) {
      console.error('checkSession 오류 → 깨끗한 상태로 복구:', e)
      try { await supabase.auth.signOut() } catch(_) {}
    }
    setCheckingAuth(false)
  }

  const persistOptions = () => {
    if (typeof window === 'undefined') return
    if (saveUsername && username) {
      localStorage.setItem(SAVED_USERNAME_KEY, username)
    } else {
      localStorage.removeItem(SAVED_USERNAME_KEY)
    }
    if (autoLogin) {
      localStorage.removeItem(NO_AUTO_LOGIN_KEY)
      sessionStorage.removeItem(SESSION_ACTIVE_KEY)
    } else {
      localStorage.setItem(NO_AUTO_LOGIN_KEY, 'true')
      sessionStorage.setItem(SESSION_ACTIVE_KEY, 'true')
    }
  }

  // form onSubmit: 엔터키든 버튼이든 다 여기로
  // setTimeout 0ms: 마지막 onChange의 setState가 반영된 뒤 실행되도록 보장
  const handleFormSubmit = (e) => {
    if (e?.preventDefault) e.preventDefault()
    if (loading) return
    setTimeout(() => {
      if (mode === 'signup') {
        if (!username || !password || !realname || !className || !secretCode || !school) {
          setError('모든 항목을 입력해주세요')
          return
        }
        if (password.length < 6) {
          setError('비밀번호는 6자 이상이어야 해요')
          return
        }
        if (!agreeTerms || !agreePrivacy) {
          setError('이용약관과 개인정보처리방침에 동의해주세요')
          return
        }
        handleSubmit()
      } else {
        handleSubmit()
      }
    }, 0)
  }

  // 추가 안전망: input에서 엔터 직접 캐치
  const handleEnter = (e) => {
    if (e.key !== 'Enter') return
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    handleFormSubmit(e)
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError('')
    const email = `${username.toLowerCase()}@writing.class`

    try {
      if (mode === 'login') {
        const { data: loginData, error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        
        const { data: profile } = await supabase.from('profiles').select('role, realname, is_banned').eq('id', loginData.user.id).maybeSingle()
        
        if (!profile) {
          await supabase.auth.signOut()
          throw new Error('회원 정보를 찾을 수 없어요. 가입을 먼저 해주세요.')
        }
        
        if (profile.is_banned) {
          await supabase.auth.signOut()
          throw new Error('이 계정은 관리자에 의해 차단되었어요. 문의: 사이트 운영자')
        }
        
        if (profile.role === 'student') {
          await supabase.auth.signOut()
          throw new Error(`이 계정은 학생 계정이에요!\n\n${profile.realname}님, "🎒 학생이에요" 버튼으로 다시 들어가주세요.`)
        }
        
        if (profile.role !== 'teacher' && profile.role !== 'admin') {
          await supabase.auth.signOut()
          throw new Error('선생님/관리자 권한이 없는 계정이에요.')
        }
        
        persistOptions()
        router.push('/teacher')
      } else {
        const codeRes = await fetch('/api/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: secretCode, role: signupRole })
        })
        if (!codeRes.ok) {
          const data = await codeRes.json()
          throw new Error(data.error || '가입 코드가 잘못됐어요')
        }

        // admin 중복가입 확인은 /api/verify-code(서버)에서 수행 (step148 RLS로 이동)

        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) {
          if (err.message.includes('already')) throw new Error('이미 가입된 아이디예요')
          throw err
        }

        // step149 RLS: 타 학급 코드는 안 보이므로 중복확인은 서버 라우트로
        let newCode, attempts = 0
        while (attempts < 10) {
          newCode = String(Math.floor(1000 + Math.random() * 9000))
          const dupRes = await fetch('/api/class-lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkCode: newCode })
          })
          const { exists } = await dupRes.json()
          if (!exists) break
          attempts++
        }

        const { data: newClass, error: classErr } = await supabase.from('classes')
          .insert({ name: className.trim(), code: newCode, teacher_id: data.user.id, school: school.trim() })
          .select().single()
        if (classErr) throw new Error('학급 생성 실패: ' + classErr.message)

        await supabase.from('profiles').insert({
          id: data.user.id, username: username.toLowerCase(), realname: realname.trim(), school: school.trim(), role: signupRole, class_id: newClass.id
        })

        persistOptions()
        router.push('/teacher')
      }
    } catch(e) {
      const errMsg = getAuthErrorMessage(e, mode === 'signup' ? 'signup' : 'teacherLogin')
      setError(errMsg)
      setLoading(false)
    }
  }

  if (checkingAuth) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500 text-sm">로딩 중...</div></div>

  return (
    <>
      <Head><title>선생님 로그인 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-md mx-auto flex items-center gap-3">
            <Link href="/" className="text-gray-600 hover:text-gray-900">←</Link>
            <h1 className="text-base font-bold">선생님 로그인</h1>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="text-center mb-6">
              <div className="text-5xl mb-2">👩‍🏫</div>
              <h2 className="text-xl font-bold">{mode === 'login' ? '선생님 로그인' : '선생님 가입'}</h2>
            </div>

            <div className="flex gap-2 mb-6 bg-gray-100 rounded-xl p-1">
              <button type="button" onClick={() => { setMode('login'); setError(''); setStep('form'); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'login' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                로그인
              </button>
              <button type="button" onClick={() => { setMode('signup'); setError(''); setStep('form'); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'signup' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                회원가입
              </button>
            </div>

            <div className="space-y-3">
                {mode === 'signup' && (
                  <>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 leading-relaxed">
                      👋 처음 오셨나요? 아래 정보를 채우면 <strong>나만의 학급</strong>이 만들어져요.
                      가입 후 학생 등록 → API 키 등록 순서로 안내해드릴게요.
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">가입 유형</label>
                      <select value={signupRole} onChange={e => setSignupRole(e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-lg">
                        <option value="teacher">담임 교사</option>
                        <option value="admin">관리자 (운영자)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        💡 대부분 <strong>담임 교사</strong>예요. 관리자는 앱 운영자만 선택하세요.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {signupRole === 'admin' ? '관리자 코드' : '교사 가입 코드'}
                      </label>
                      <input type="password" value={secretCode} onChange={e => setSecretCode(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="가입 코드" />
                      <p className="text-xs text-gray-500 mt-1">
                        💡 앱을 소개해준 분(운영자)에게 받은 코드예요. 모르면 운영자에게 문의하세요.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">이름</label>
                      <input type="text" value={realname} onChange={e => setRealname(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="실명 (예: 김선생)" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">학교명</label>
                      <input type="text" value={school} onChange={e => setSchool(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="예: 한국초등학교" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">학급 이름</label>
                      <input type="text" value={className} onChange={e => setClassName(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="예: 5학년 1반" />
                      <p className="text-xs text-gray-500 mt-1">
                        💡 가입하면 이 학급이 자동으로 만들어져요. 나중에 학급을 더 추가할 수도 있어요.
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">아이디</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg" placeholder="영문 아이디 (예: kim2024)" autoComplete="username" />
                  {mode === 'signup' && (
                    <p className="text-xs text-gray-500 mt-1">
                      💡 영문·숫자로 짧고 기억하기 쉽게. 로그인할 때 매번 쓰는 아이디예요.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">비밀번호</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg" placeholder={mode === 'signup' ? '6자 이상' : '비밀번호'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                  {mode === 'signup' && (
                    <p className="text-xs text-gray-500 mt-1">
                      💡 잊지 않도록 기억해주세요. 잊으면 운영자가 초기화해드려요.
                    </p>
                  )}
                </div>

                {/* 옵션 체크박스 (로그인 모드일 때만) */}
                {mode === 'login' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveUsername}
                        onChange={e => setSaveUsername(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span>아이디 저장</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoLogin}
                        onChange={e => setAutoLogin(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span>자동 로그인</span>
                    </label>
                  </div>
                )}

                {/* 가입 모드: 동의 체크박스 (한 화면에 같이) */}
                {mode === 'signup' && (
                  <div className="space-y-2 pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-600">가입 전 동의해주세요</p>
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded font-medium text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agreeTerms && agreePrivacy}
                        onChange={() => {
                          const all = !(agreeTerms && agreePrivacy)
                          setAgreeTerms(all); setAgreePrivacy(all)
                        }}
                        className="w-4 h-4"
                      />
                      <span>모두 동의합니다 (필수)</span>
                    </label>
                    <div className="space-y-1.5 px-1">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agreeTerms}
                          onChange={e => setAgreeTerms(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span>
                          (필수) <Link href="/terms" target="_blank" className="text-primary underline">이용약관</Link>에 동의합니다
                        </span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agreePrivacy}
                          onChange={e => setAgreePrivacy(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span>
                          (필수) <Link href="/privacy" target="_blank" className="text-primary underline">개인정보처리방침</Link>에 동의합니다
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded whitespace-pre-line border border-red-200">{error}</div>}
                <button
                  type="button"
                  onClick={handleFormSubmit}
                  disabled={loading}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark disabled:opacity-50"
                >
                  {loading ? '처리 중...' : (mode === 'login' ? '로그인' : '가입하기')}
                </button>
              </div>

            <div className="mt-4 text-center space-y-1.5">
              {mode === 'login' && (
                <p className="text-xs text-gray-500">
                  🔑 비밀번호를 잊으셨나요?{' '}
                  <button
                    type="button"
                    onClick={() => setShowResetRequest(true)}
                    className="text-blue-600 font-medium underline hover:text-blue-800">
                    초기화 요청하기
                  </button>
                  <br />
                  <span className="text-amber-700">재가입하지 마세요</span>
                  <span className="text-gray-400"> — 기존 학급·학생·글과 연결이 끊겨요.</span>
                </p>
              )}
              <Link href="/api-key-guide" className="text-xs text-gray-500 hover:text-primary inline-block">
                Gemini API 키 발급 방법 →
              </Link>
            </div>
          </div>
        </main>

        {/* 🆕 비밀번호 초기화 요청 모달 */}
        {showResetRequest && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => !resetSubmitting && setShowResetRequest(false)}>
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-2xl"
              onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900">🔑 비밀번호 초기화 요청</h3>
              <p className="text-xs text-gray-500 leading-relaxed">
                관리자가 확인 후 임시 비밀번호를 만들어 전달해드려요.
                본인 확인을 위해 가입할 때 쓴 정보를 입력해주세요.
              </p>
              <input
                type="text"
                placeholder="아이디 (필수)"
                value={resetForm.username}
                onChange={e => setResetForm({ ...resetForm, username: e.target.value })}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="이름 (필수)"
                value={resetForm.realname}
                onChange={e => setResetForm({ ...resetForm, realname: e.target.value })}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="학교 (선택)"
                value={resetForm.school}
                onChange={e => setResetForm({ ...resetForm, school: e.target.value })}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              />
              <input
                type="text"
                placeholder="연락 방법 (선택: 전화, 카톡 ID 등)"
                value={resetForm.contact}
                onChange={e => setResetForm({ ...resetForm, contact: e.target.value })}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              />
              <p className="text-[11px] text-gray-400">
                연락 방법을 안 남기면 함께 아는 분(동료 선생님 등)을 통해 전달될 수 있어요.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowResetRequest(false)}
                  disabled={resetSubmitting}
                  className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm disabled:opacity-50">
                  취소
                </button>
                <button
                  onClick={submitResetRequest}
                  disabled={resetSubmitting}
                  className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                  {resetSubmitting ? '접수 중...' : '요청 보내기'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
