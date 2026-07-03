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
  // 가입 시 동의 체크 (한 화면에 같이 표시)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  // 🆕 QR 진입 시 학급 로그인 안내 (선생님이 설정한 경우)
  const [classHint, setClassHint] = useState(null) // { className, prefix, password, school }
  // 🆕 로그인 모드에서 "아이디 잊어버렸어요?" 토글 (학급 코드로 안내 받기)
  const [showHintLookup, setShowHintLookup] = useState(false)
  // 🆕 층2: 번호 → 아이디 자동완성 도우미 (배너 안, 번호만 입력)
  const [numberInput, setNumberInput] = useState('')

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

  // 🔗 URL 쿼리로 학급 코드 자동 입력 (?code=XXX)
  // - 학급 코드만 자동 채움 (로그인/가입은 학생이 선택)
  // - mode=signup 명시 시에만 가입 모드 자동 전환 (구버전 호환)
  // - 학급 로그인 안내가 설정되어 있으면 가져와서 표시
  useEffect(() => {
    if (!router.isReady) return
    const { code, mode: qMode } = router.query
    if (code && typeof code === 'string') {
      const upperCode = code.toUpperCase()
      setClassCode(upperCode)
      if (qMode === 'signup') {
        setMode('signup')
      }
      // 학급 정보 가져오기 (로그인 안내 표시용)
      loadClassHint(upperCode)
    }
  }, [router.isReady, router.query])

  const loadClassHint = async (code) => {
    try {
      // step149 RLS: 비로그인 classes 조회는 서버 라우트 경유 (api_key 비노출)
      const res = await fetch('/api/class-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const { class: data } = await res.json()
      if (data && data.login_hint_enabled && data.login_username_prefix) {
        setClassHint({
          className: data.name,
          school: data.school,
          prefix: data.login_username_prefix,
          password: data.login_default_password || '123456',
          // 🆕 층1: self_signup_enabled === false = 명렬표 학급(선생님이 미리 계정 생성 → 로그인만)
          selfSignup: data.self_signup_enabled !== false
        })
        // 🆕 명렬표 학급이면 가입 모드로 새지 않게 로그인 고정 (막다른 골목 방지)
        if (data.self_signup_enabled === false) setMode('login')
      } else {
        setClassHint(null)
      }
    } catch (e) {
      console.warn('학급 안내 로드 실패:', e)
    }
  }

  // 🆕 학급 코드를 입력하는 즉시 안내 로드 (코드 없이 들어와도 동작)
  useEffect(() => {
    const trimmed = (classCode || '').trim().toUpperCase()
    if (trimmed.length >= 4) {
      loadClassHint(trimmed)
    } else if (classHint) {
      setClassHint(null)
      setNumberInput('')
    }
  }, [classCode])

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
          // step206: '가입을 먼저' 유도 제거 — 명렬표 학급에서 잘못된 새 계정(유령) 생성을 부추기지 않도록.
          throw new Error('회원 정보를 찾을 수 없어요. 아이디 오타가 아닌지 확인하거나 선생님께 문의해주세요.')
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
        // step149 RLS: 가입은 비로그인이므로 서버 라우트로 학급 조회
        const lookupRes = await fetch('/api/class-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: classCode })
        })
        const { class: classData } = await lookupRes.json()
        if (!classData) {
          setError('학급 코드가 잘못됐어요. 선생님께 확인해주세요')
          setLoading(false)
          return
        }
        // 🆕 삭제된 학급은 가입 차단 (B4)
        if (classData.deleted_at) {
          setError('이 학급은 삭제되었어요. 선생님께 문의해주세요.')
          setLoading(false)
          return
        }
        if (classData.is_active === false) {
          setError('이 학급은 현재 운영 중지 상태예요. 선생님께 문의해주세요.')
          setLoading(false)
          return
        }
        // 🆕 step206: 명렬표 학급(자가가입 OFF)은 새 계정 생성을 막는다 — 유령계정 원천 차단.
        //   ★ false일 때만 막음(null/미적용 학급은 그대로 허용 → 순수 자가가입 학급 영향 0).
        //   ★ 로그인(기존 계정) 경로는 막지 않음 — 가입(새 계정)만 차단한다.
        if (classData.self_signup_enabled === false) {
          setError('이 학급은 선생님이 만든 아이디로 로그인만 가능해요.\n아이디 오타가 아닌지 확인해주세요.\n전학생이거나 아이디를 모르면 선생님께 문의하면 바로 만들어 주실 수 있어요.')
          setLoading(false)
          return
        }
        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) {
          setError(getAuthErrorMessage(err, 'signup'))
          setLoading(false)
          return
        }

        // 🆕 step197: 닉네임을 insert 전에 확정해 한 번에 저장 (자가가입도 잠금 모델과 동일하게
        //   realname엔 아이디 대신 빈값 → 화면은 displayStudentName이 닉네임을 표시).
        // generateUniqueNickname은 항상 비어있지 않은 문자열을 반환(중복 회피 30회 실패 시 숫자 접미사,
        //   DB접근·throw 없음) → 닉네임 누락 불가. 동급생 닉네임 조회는 best-effort(가입 전이라
        //   RLS상 대개 빈 결과 → 중복 회피는 약화되나 중복은 외관상 문제일 뿐, 교사가 '닉네임 변경'으로 조정 가능).
        let nickname
        try {
          const { generateUniqueNickname } = await import('../../lib/nickname')
          let used = []
          try {
            const { data: existing } = await supabase.from('profiles')
              .select('nickname').eq('class_id', classData.id).eq('role', 'student')
            used = (existing || []).map(p => p.nickname).filter(Boolean)
          } catch (_) { /* 조회 실패 → 빈 목록으로 생성(닉네임은 여전히 보장) */ }
          nickname = generateUniqueNickname(used)
        } catch (_) {
          // 극단 케이스(모듈 로드 실패 등) 폴백 — 닉네임이 절대 비지 않도록 직접 구성. 가입은 중단하지 않음.
          nickname = '새친구' + String(data.user.id).slice(0, 4)
        }

        const profileData = {
          id: data.user.id, username: username.toLowerCase(), realname: '', nickname,
          role: 'student', class_id: classData.id, school: classData.school || null
        }
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
      <Head><title>학생 로그인 - 다온클래스</title></Head>
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
              {/* 🆕 층1: 명렬표 학급(자가가입 OFF)은 회원가입이 막혀 있으므로 탭 자체를 숨겨 막다른 골목 제거 */}
              {!(classHint && classHint.selfSignup === false) && (
                <button type="button" onClick={() => { setMode('signup'); setError(''); setStep('form'); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'signup' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                  회원가입
                </button>
              )}
            </div>

            {/* 🆕 QR 진입 시 학급 로그인 안내 (선생님이 설정한 경우만 표시) */}
            {classHint && (() => {
              const formatNum = (n) => String(n).padStart(2, '0') // 무조건 2자리
              const roster = classHint.selfSignup === false        // 🆕 명렬표 학급(로그인만)
              // 🆕 층2: 번호 → 아이디 자동완성. 숫자만 남기고 1~99면 아래 아이디 칸을 채운다.
              const onNumberChange = (raw) => {
                const digits = (raw || '').replace(/[^0-9]/g, '').slice(0, 2)
                setNumberInput(digits)
                const n = parseInt(digits, 10)
                if (n >= 1 && n <= 99) setUsername(classHint.prefix + formatNum(n))
              }
              const previewId = (() => {
                const n = parseInt(numberInput, 10)
                return (n >= 1 && n <= 99) ? classHint.prefix + formatNum(n) : ''
              })()
              return (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                  <div className="text-sm font-bold text-blue-900 flex items-center gap-1">
                    👋 {classHint.className} 학생이라면
                  </div>
                  <div className="text-xs text-blue-800 space-y-2">
                    <div>
                      {/* 🆕 층1: 명렬표 학급은 계정이 이미 있으므로 "로그인" 안내(만들기 어감 제거) */}
                      <div className="font-semibold mb-1">
                        {roster ? '🆔 내 아이디로 로그인해요' : '🆔 아이디 만들기'}
                      </div>
                      <div className="pl-1">
                        {roster ? '아이디는 이렇게 생겼어요: ' : ''}
                        <span className="bg-white px-1.5 py-0.5 rounded font-mono">{classHint.prefix}</span>
                        {' + '}
                        <span className="text-blue-700 font-bold">본인 번호 (두 자리)</span>
                      </div>
                      <div className="pl-1 mt-1.5 bg-white rounded p-2 space-y-0.5">
                        <div className="text-blue-900 font-semibold mb-1">📌 예시 (번호 두 자리로 써요!)</div>
                        <div>• 1번이면 → <span className="font-mono bg-blue-100 px-1 rounded font-bold">{classHint.prefix}{formatNum(1)}</span></div>
                        <div>• 5번이면 → <span className="font-mono bg-blue-100 px-1 rounded font-bold">{classHint.prefix}{formatNum(5)}</span></div>
                        <div>• 12번이면 → <span className="font-mono bg-blue-100 px-1 rounded font-bold">{classHint.prefix}{formatNum(12)}</span></div>
                        <div>• 25번이면 → <span className="font-mono bg-blue-100 px-1 rounded font-bold">{classHint.prefix}{formatNum(25)}</span></div>
                      </div>
                      <div className="pl-1 mt-1 text-amber-700">
                        ⚠️ 1번은 <span className="font-mono">1</span>이 아니라 <span className="font-mono font-bold">01</span>이에요!
                      </div>
                    </div>

                    {/* 🆕 층2: 번호만 넣으면 아이디 자동 완성 → 아래 아이디 칸에 자동 입력 */}
                    <div className="bg-white rounded p-2 border border-blue-100">
                      <label className="block text-blue-900 font-semibold mb-1">✏️ 몇 번이에요? 번호만 넣으면 아이디가 완성돼요</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={2}
                          value={numberInput}
                          onChange={e => onNumberChange(e.target.value)}
                          placeholder="번호"
                          className="w-16 p-2 border border-blue-200 rounded text-center font-mono text-sm"
                        />
                        {previewId && (
                          <span className="text-blue-900">→ 내 아이디: <span className="font-mono font-bold bg-blue-100 px-1.5 py-0.5 rounded">{previewId}</span></span>
                        )}
                      </div>
                      {previewId && <div className="text-[11px] text-blue-600 mt-1">이제 아래에 비밀번호를 넣고 로그인하면 돼요.</div>}
                    </div>

                    <div>
                      <span className="font-semibold">🔑 비밀번호:</span>{' '}
                      <span className="bg-white px-1.5 py-0.5 rounded font-mono">{classHint.password}</span>
                      <span className="text-blue-600 ml-1">(로그인 후 꼭 바꿔주세요!)</span>
                    </div>
                  </div>
                </div>
              )
            })()}

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

                {/* 🆕 로그인 모드: 학급 코드 입력 옵션 (잊어버린 아이디 찾기) */}
                {mode === 'login' && !classHint && !showHintLookup && (
                  <button type="button"
                    onClick={() => setShowHintLookup(true)}
                    className="w-full text-xs text-gray-500 hover:text-blue-600 underline py-1">
                    아이디 잊어버렸어요? 학급 코드로 찾기
                  </button>
                )}
                {mode === 'login' && showHintLookup && !classHint && (
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <label className="block text-xs font-medium mb-1 text-gray-700">학급 코드 입력</label>
                    <input
                      type="text"
                      placeholder="선생님께 받은 4자리"
                      value={classCode}
                      onChange={e => setClassCode(e.target.value)}
                      className="w-full p-2 border border-gray-200 rounded text-center tracking-widest font-mono text-sm"
                      maxLength="6"
                      inputMode="numeric"
                      autoFocus
                    />
                    <p className="text-[11px] text-gray-500 mt-1">코드 입력하면 아래에 아이디 만드는 방법이 나와요</p>
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

                {/* 가입 모드: 동의 체크박스 */}
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
          </div>
        </main>
      </div>
    </>
  )
}
