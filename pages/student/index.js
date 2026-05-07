import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

export default function StudentHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      router.push('/student/login')
      return
    }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle()
    if (!profile || profile.role !== 'student') {
      await supabase.auth.signOut()
      router.push('/student/login')
      return
    }
    setUser(profile)
    setLoading(false)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500">로딩 중...</div></div>

  return (
    <>
      <Head><title>학생 화면 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
            <div className="text-6xl mb-4">🎒</div>
            <h2 className="text-xl font-bold mb-2">{user.realname}님, 환영해요!</h2>
            <p className="text-gray-600">글쓰기 기능은 다음 단계에서 추가됩니다.</p>
          </div>
        </main>
      </div>
    </>
  )
}
