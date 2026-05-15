import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { getAuthErrorMessage } from '../../lib/authErrors'
import ConsentForm from '../../components/ConsentForm'

// 로컬 스토리지 키
const SAVED_USERNAME_KEY = 'lc-saved-username'
const NO_AUTO_LOGIN_KEY = 'lc-no-auto-login'
const SESSION_ACTIVE_KEY = 'lc-session-active'

export default function StudentLogin() {
  const router = useRouter()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [classCode, setClassCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('form')
  const [checkingAuth, setCheckingAuth] = useState(true)
  // 새 옵션
  const [saveUsername, setSaveUsername] = useState(false)
  const [autoLogin, setAutoLogin] = useState(true)

  useEffect(() => {
    // 저장된 아이디 / 자동 로그인 설정 복원
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
      const { data: profile } = await supabase.from('profiles')
        .select('role').eq('id', session.user.id).maybeSingle()
      if (profile?.role === 'student') {
        router.replace('/student')
        return
      }
    }
    setCheckingAuth(false)
  }

  // 옵션 저장 (로그인/가입 성공 직후 호출)
  const persistOptions = () => {
    if (typeof window === 'undefined') return
    // 아이디 저장
    if (saveUsername && username) {
      localStorage.setItem(SAVED_USERNAME_KEY, username)
    } else {
      localStorage.removeItem(SAVED_USERNAME_KEY)
    }
    // 자동 로그인
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
        if (!username || !password || !classCode) {
          setError('모든 항목을 입력해주세요')
          return
        }
        setStep('consent')
      } else {
        handleSubmit()
      }
    }, 0)
  }

  // 추가 안전망: input에서 엔터 직접 캐치 (IME는 무시)
  const handleEnter = (e) => {
    if (e.key !== 'Enter') return
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    handleFormSubmit(e)
  }

  const handleSubmit = async () => {
    if (!username || !password) return setError('아이디와 비밀번호를 입력해주세요')
    if (mode === 'signup' && !classCode) return setError('학급 코드를 입력해주세요')

    setLoading(true)
    setError('')
    const email = `${username.toLowerCase()}@writing.class`

    try {
      if (mode === 'login') {
        const { data: loginData, error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        
        const { data: profile } = await supabase.from('profiles').select('role, realname').eq('id', loginData.user.id).maybeSingle()
        
        if (!profile) {
          await supabase.auth.signOut()
          throw new Error('회원 정보를 찾을 수 없어요. 가입을 먼저 해주세요.')
        }
        
        if (profile.role === 'teacher' || profile.role === 'admin') {
          await supabase.auth.signOut()
          throw new Error(`이 계정은 선생님 계정이에요!\n\n${profile.realname || ''}님, "👩‍🏫 선생님이에요" 버튼으로 다시 들어가주세요.`)
        }
        
        if (profile.role !== 'student') {
          await supabase.auth.signOut()
          throw new Error('학생 권한이 없는 계정이에요.')
        }
        
        persistOptions()
        router.push('/student')
      } else {
        const { data: classData } = await supabase.from('classes').select('id, name, is_active, school').eq('code', classCode).maybeSingle()
        if (!classData) {
          setError('학급 코드가 잘못됐어요. 선생님께 확인해주세요')
          setLoading(false)
          return
        }
        if (classData.is_active === false) {
          setError('이 학급은 현재 운영 중지 상태예요. 선생님께 문의해주세요.')
          setLoading(false)
          return
        }
        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) {
          setError(getAuthErrorMessage(err, 'signup'))
          setLoading(false)
          return
        }

        // 학급 내 기존 닉네임 가져와서 중복 안 되게 부여
        let nickname = null
        try {
          const { generateUniqueNickname } = await import('../../lib/nickname')
          const { data: existing } = await supabase.from('profiles')
            .select('nickname').eq('class_id', classData.id).eq('role', 'student')
          const used = (existing || []).map(p => p.nickname).filter(Boolean)
          nickname = generateUniqueNickname(used)
        } catch(e) { /* nickname 컬럼 없으면 무시 */ }

        const profileData = {
          id: data.user.id, username: username.toLowerCase(), realname: username,
          role: 'student', class_id: classData.id, school: classData.school || null
        }
        if (nickname) profileData.nickname = nickname

        await supabase.from('profiles').insert(profileData)
        persistOptions()
        router.push('/student')
      }
    } catch(e) {
      const errMsg = getAuthErrorMessage(e, mode === 'signup' ? 'signup' : 'login')
      setError(errMsg)
      setLoading(false)
    }
  }

  if (checkingAuth) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500 text-sm">로딩 중...</div></div>

  return (
    <>
      <Head><title>학생 로그인 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-md mx-auto flex items-center gap-3">
            <Link href="/" className="text-gray-600 hover:text-gray-900">←</Link>
            <h1 className="text-base font-bold">학생 로그인</h1>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="text-center mb-6">
              <div className="text-5xl mb-2">🎒</div>
              <h2 className="text-xl font-bold">{mode === 'login' ? '학생 로그인' : '학생 가입'}</h2>
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

            {mode === 'signup' && step === 'consent' ? (
              <>
                <p className="text-sm text-gray-600 mb-4">가입 전 아래 항목에 동의해주세요</p>
                <ConsentForm onComplete={handleSubmit} />
              </>
            ) : (
              <div className="space-y-3">
                {mode === 'signup' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">학급 코드</label>
                    <input
                      type="text"
                      placeholder="선생님께 받은 4자리"
                      value={classCode}
                      onChange={e => setClassCode(e.target.value)}
                      onKeyDown={handleEnter}
                      className="w-full p-3 border border-gray-200 rounded-lg text-center tracking-widest font-mono"
                      maxLength="6"
                      inputMode="numeric"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">아이디</label>
                  <input
                    type="text"
                    placeholder="영문 아이디"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">비밀번호</label>
                  <input
                    type="password"
                    placeholder={mode === 'signup' ? '6자 이상' : '비밀번호'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  {mode === 'login' && <p className="text-xs text-gray-500 mt-1">처음이세요? 초기 비밀번호는 <strong>123456</strong></p>}
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

                {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded whitespace-pre-line">{error}</div>}
                <button
                  type="button"
                  onClick={handleFormSubmit}
                  disabled={loading}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark disabled:opacity-50"
                >
                  {loading ? '처리 중...' : (mode === 'login' ? '로그인' : '다음')}
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
