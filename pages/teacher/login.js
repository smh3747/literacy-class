import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
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
      if (profile?.role === 'teacher' || profile?.role === 'admin') {
        router.replace('/teacher')
        return
      }
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
        setStep('consent')
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

        if (signupRole === 'admin') {
          const { data: existingAdmin } = await supabase.from('profiles').select('id').eq('role', 'admin').limit(1).maybeSingle()
          if (existingAdmin) throw new Error('관리자는 이미 가입되어 있어요')
        }

        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) {
          if (err.message.includes('already')) throw new Error('이미 가입된 아이디예요')
          throw err
        }

        let newCode, attempts = 0
        while (attempts < 10) {
          newCode = String(Math.floor(1000 + Math.random() * 9000))
          const { data: existing } = await supabase.from('classes').select('id').eq('code', newCode).maybeSingle()
          if (!existing) break
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
      let errMsg = e.message || '오류가 발생했어요'
      if (errMsg.includes('Invalid login credentials')) {
        errMsg = '아이디 또는 비밀번호가 잘못됐어요.\n다시 확인해주세요.'
      } else if (errMsg.includes('Email not confirmed')) {
        errMsg = '이메일 인증이 필요해요. 관리자에게 문의해주세요.'
      } else if (errMsg.includes('User not found') || errMsg.includes('user does not exist')) {
        errMsg = '가입되지 않은 아이디예요. 회원가입을 해주세요.'
      } else if (errMsg.includes('Network')) {
        errMsg = '네트워크 연결을 확인해주세요.'
      }
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

            {mode === 'signup' && step === 'consent' ? (
              <>
                <p className="text-sm text-gray-600 mb-4">가입 전 아래 항목에 동의해주세요</p>
                <ConsentForm onComplete={handleSubmit} />
              </>
            ) : (
              <div className="space-y-3">
                {mode === 'signup' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">가입 유형</label>
                      <select value={signupRole} onChange={e => setSignupRole(e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-lg">
                        <option value="teacher">담임 교사</option>
                        <option value="admin">관리자 (운영자)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {signupRole === 'admin' ? '관리자 코드' : '교사 가입 코드'}
                      </label>
                      <input type="password" value={secretCode} onChange={e => setSecretCode(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="가입 코드" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">이름</label>
                      <input type="text" value={realname} onChange={e => setRealname(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="실명" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">학교명</label>
                      <input type="text" value={school} onChange={e => setSchool(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="예: 하랑초등학교" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">학급 이름</label>
                      <input type="text" value={className} onChange={e => setClassName(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="예: 5학년 1반" />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">아이디</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg" placeholder="영문 아이디" autoComplete="username" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">비밀번호</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg" placeholder={mode === 'signup' ? '6자 이상' : '비밀번호'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
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

            <div className="mt-4 text-center">
              <Link href="/api-key-guide" className="text-xs text-gray-500 hover:text-primary">
                Gemini API 키 발급 방법 →
              </Link>
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
