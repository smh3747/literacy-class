import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import ConsentForm from '../../components/ConsentForm'

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

  useEffect(() => {
    checkSession()
  }, [])

  const checkSession = async () => {
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

  const handleSubmit = async () => {
    if (!username || !password) return setError('아이디와 비밀번호를 입력해주세요')
    if (mode === 'signup' && !classCode) return setError('학급 코드를 입력해주세요')

    setLoading(true)
    setError('')
    const email = `${username.toLowerCase()}@writing.class`

    try {
      if (mode === 'login') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        router.push('/student')
      } else {
        const { data: classData } = await supabase.from('classes').select('id, name').eq('code', classCode).maybeSingle()
        if (!classData) {
          setError('학급 코드가 잘못됐어요. 선생님께 확인해주세요')
          setLoading(false)
          return
        }
        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) {
          if (err.message.includes('already')) setError('이미 가입된 아이디예요')
          else setError(err.message)
          setLoading(false)
          return
        }
        await supabase.from('profiles').insert({
          id: data.user.id, username: username.toLowerCase(), realname: username, role: 'student', class_id: classData.id
        })
        router.push('/student')
      }
    } catch(e) {
      setError(e.message || '오류가 발생했어요')
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
              <button onClick={() => { setMode('login'); setError(''); setStep('form'); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'login' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                로그인
              </button>
              <button onClick={() => { setMode('signup'); setError(''); setStep('form'); }}
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
                      className="w-full p-3 border border-gray-200 rounded-lg text-center tracking-widest font-mono"
                      maxLength="6"
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
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  {mode === 'login' && <p className="text-xs text-gray-500 mt-1">처음이세요? 초기 비밀번호는 <strong>1234</strong></p>}
                </div>
                {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
                <button
                  onClick={() => mode === 'signup' ? setStep('consent') : handleSubmit()}
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
