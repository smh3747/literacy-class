// step673: 관리자 "🧪 시험 학생으로 열기" 착지 화면.
//   주소의 일회용 토큰(th)으로 시험 학생 세션을 만든 뒤 /student로 보낸다.
//   이 주소로 들어온 탭은 lib/supabase.js가 세션을 탭 안(sessionStorage)에만 두므로 다른 창의 로그인을 건드리지 않는다.
//   토큰은 서버(pages/api/admin-test-student.js)가 지정된 시험 학생에게만 발급한다.
import { useEffect, useState } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

export default function TestStudentLanding() {
  const [message, setMessage] = useState('시험 학생으로 들어가는 중이에요...')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const th = new URLSearchParams(window.location.search).get('th')
      if (!th) { setFailed(true); setMessage('링크가 올바르지 않아요. 관리자 화면에서 다시 열어 주세요.'); return }
      // 주소창·기록에 토큰이 남지 않게 먼저 지운다
      try { window.history.replaceState(null, '', window.location.pathname) } catch (_) {}
      let { error } = await supabase.auth.verifyOtp({ token_hash: th, type: 'magiclink' })
      if (error) ({ error } = await supabase.auth.verifyOtp({ token_hash: th, type: 'email' }))
      if (!alive) return
      if (error) {
        setFailed(true)
        setMessage('링크가 만료됐거나 이미 한 번 쓴 링크예요. 관리자 화면에서 다시 열어 주세요.')
        return
      }
      window.location.replace('/student')
    })()
    return () => { alive = false }
  }, [])

  return (
    <>
      <Head><title>시험 학생 창 - 다온클래스</title><meta name="robots" content="noindex" /></Head>
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-sm w-full text-center">
          <p className="text-3xl mb-2">🧪</p>
          <p className={`text-sm ${failed ? 'text-red-600' : 'text-gray-700'}`}>{message}</p>
        </div>
      </div>
    </>
  )
}
