// step381: 비밀번호 재설정 페이지 — 재설정 메일 링크로 진입
// 메일 링크의 recovery 토큰을 supabase가 자동 처리(detectSessionInUrl)하면 임시 세션이 생기고,
// 그 세션으로 updateUser({ password })를 호출해 비밀번호를 바꾼다. 완료 후 로그아웃·로그인 안내.
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import PasswordInput from '../components/PasswordInput'

export default function ResetPassword() {
  const [phase, setPhase] = useState('checking')  // checking | ready | done | invalid
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [myUsername, setMyUsername] = useState('')  // 🆕 step386: 아이디 찾기 겸용(recovery 세션에서 자기조회)

  // 진입 검사: recovery 토큰 처리를 기다렸다가 세션이 생기면 폼, 3초 내 없으면 무효 링크 안내
  useEffect(() => {
    let settled = false
    const ready = () => { if (!settled) { settled = true; setPhase('ready'); loadUsername() } }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) ready()
    })
    supabase.auth.getSession().then(({ data: { session } }) => { if (session) ready() })
    const timer = setTimeout(async () => {
      if (settled) return
      const { data: { session } } = await supabase.auth.getSession()
      settled = true
      if (session) { setPhase('ready'); loadUsername() } else { setPhase('invalid') }
    }, 3000)

    return () => { sub.subscription.unsubscribe(); clearTimeout(timer) }
  }, [])

  // 🆕 step386: 본인 아이디 표시 (RLS prof_select: id=auth.uid() 자기조회, signOut 전에만 가능)
  const loadUsername = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) return
      const { data } = await supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle()
      if (data?.username) setMyUsername(data.username)
    } catch {}
  }

  // 🆕 step386: 아이디만 확인하고 나가기 (recovery 세션 정리 후 로그인으로)
  const exitToLogin = async () => {
    try { await supabase.auth.signOut() } catch {}
    window.location.href = '/teacher/login'
  }

  const submit = async () => {
    setError('')
    if (pw.length < 6) return setError('비밀번호는 6자 이상으로 정해주세요.')
    if (pw !== pw2) return setError('두 비밀번호가 서로 달라요. 같은 비밀번호를 입력해주세요.')
    setSaving(true)
    const { error: err } = await supabase.auth.updateUser({ password: pw })
    setSaving(false)
    if (err) {
      // 같은 비밀번호 재사용 등 — 존댓말 일반 안내
      setError('비밀번호를 바꾸지 못했어요. 이전과 다른 비밀번호로 다시 시도해주세요.')
      return
    }
    await supabase.auth.signOut()
    setPhase('done')
  }

  return (
    <>
      <Head><title>비밀번호 재설정 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 w-full max-w-sm">
          <h1 className="text-lg font-bold mb-4">🔑 비밀번호 재설정</h1>

          {phase === 'checking' && (
            <p className="text-sm text-gray-500">확인 중이에요. 잠시만 기다려주세요.</p>
          )}

          {phase === 'invalid' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 break-keep">
                링크가 만료됐거나 올바르지 않아요. 로그인 화면에서 재설정 메일을 다시 요청해주세요.
              </p>
              <Link href="/teacher/login"
                className="block w-full py-2.5 bg-primary text-white rounded-xl font-semibold text-center text-sm">
                로그인 화면으로 가기
              </Link>
            </div>
          )}

          {phase === 'ready' && (
            <div className="space-y-3">
              {/* 🆕 step386: 아이디 표시 (아이디 찾기 겸용) */}
              {myUsername && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="text-sm text-blue-900 break-keep">
                    회원님의 아이디는 <strong className="font-bold">{myUsername}</strong>이에요.
                  </p>
                  <button onClick={exitToLogin}
                    className="mt-2 text-xs text-blue-700 underline hover:text-blue-900">
                    아이디 확인만 하고 로그인하러 가기
                  </button>
                </div>
              )}
              <p className="text-sm text-gray-600 break-keep">새 비밀번호를 정해주세요. 6자 이상이면 돼요.</p>
              <PasswordInput value={pw} onChange={e => setPw(e.target.value)}
                placeholder="새 비밀번호" autoComplete="new-password"
                className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-primary focus:outline-none" />
              {/* step430: 실시간 길이 표시(기존 submit 6자 검증의 표시판) */}
              {pw && (pw.length >= 6
                ? <p className="text-xs text-green-600">✓ 6자 이상</p>
                : <p className="text-xs text-gray-400">6자 이상 입력해주세요</p>)}
              <PasswordInput value={pw2} onChange={e => setPw2(e.target.value)}
                placeholder="새 비밀번호 확인" autoComplete="new-password"
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-primary focus:outline-none" />
              {pw2 && (pw2 === pw
                ? <p className="text-xs text-green-600">✓ 새 비밀번호와 일치해요</p>
                : <p className="text-xs text-red-600">새 비밀번호가 일치하지 않아요</p>)}
              {error && <p className="text-xs text-red-600 break-keep">{error}</p>}
              <button onClick={submit} disabled={saving}
                className="w-full py-2.5 bg-primary text-white rounded-xl font-semibold text-sm disabled:opacity-50">
                {saving ? '바꾸는 중...' : '비밀번호 바꾸기'}
              </button>
            </div>
          )}

          {phase === 'done' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 break-keep">
                ✅ 비밀번호를 바꿨어요. 새 비밀번호로 로그인해주세요.
              </p>
              <Link href="/teacher/login"
                className="block w-full py-2.5 bg-primary text-white rounded-xl font-semibold text-center text-sm">
                로그인하러 가기
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
