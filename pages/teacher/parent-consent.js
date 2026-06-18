import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import ConsentDocument from '../../components/ConsentDocument'

export default function ParentConsent() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(name)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }
  const printDoc = () => window.print()

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>학부모 동의서 - 다온클래스</title></Head>

      <div className="min-h-screen bg-gray-50">
        <div className="no-print">
          <Header user={user} onLogout={logout} />
          <div className="max-w-3xl mx-auto px-4 py-4 flex justify-between items-center">
            <Link href="/teacher" className="text-sm text-gray-600">← 선생님 메인</Link>
            <button onClick={printDoc} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium">
              🖨️ 인쇄하기 (A4 한 장)
            </button>
          </div>
        </div>

        <main className="max-w-3xl mx-auto px-4 py-6">
          {/* 공용 양식 컴포넌트 — props 없이 빈 양식(기존 종이 인쇄와 동일) */}
          <ConsentDocument school={user.school} className={classInfo?.name} />
        </main>
      </div>
    </>
  )
}
