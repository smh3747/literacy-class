import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

export default function TeacherHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code)').eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut()
      router.push('/teacher/login')
      return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    setLoading(false)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500">로딩 중...</div></div>

  return (
    <>
      <Head><title>선생님 화면 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
          {classInfo && (
            <div className="bg-primary-light border border-primary rounded-2xl p-5">
              <div className="text-sm text-primary-dark font-semibold mb-1">📋 우리 학급</div>
              <div className="text-xl font-bold text-primary-dark mb-2">{classInfo.name}</div>
              <div className="text-sm text-primary-dark">
                학생 가입 코드: <span className="text-2xl font-mono font-bold tracking-widest">{classInfo.code}</span>
              </div>
              <p className="text-xs text-gray-700 mt-2">학생들에게 이 코드를 알려주세요. 가입 시 입력해야 해요.</p>
            </div>
          )}

          <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
            <div className="text-5xl mb-3">👩‍🏫</div>
            <h2 className="text-xl font-bold mb-2">{user.realname} 선생님 환영합니다!</h2>
            <p className="text-gray-600">학생 일괄 등록, 주제 관리 등은 다음 단계에서 추가됩니다.</p>
          </div>
        </main>
      </div>
    </>
  )
}
