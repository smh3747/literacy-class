// 학부모 동의서 관리 — 학생관리에서 분리한 교사 전용 화면 (step207-B)
// ★ConsentPanel은 그대로 재사용(폴백·안내문 단일 출처 유지) — 위치만 students.js에서 이리 옮김.
//   진입: /teacher/students/consent. 교사 가드는 students.js와 동일 패턴(getEffectiveProfile).
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import Header from '../../../components/Header'
import ImpersonationBanner from '../../../components/ImpersonationBanner'
import ConsentPanel from '../../../components/ConsentPanel'
import { getEffectiveProfile, withImpersonation } from '../../../lib/impersonation'

export default function StudentsConsentPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name, code, grade, login_username_prefix)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)
    if (profile.classes?.id) {
      const { data } = await supabase.from('profiles')
        .select('realname, is_hidden').eq('class_id', profile.classes.id).eq('role', 'student')
      setStudents(data || [])
    }
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  // 동의 대기(잠긴) 학생 수 — students.js와 동일 기준(realname 빈값, step188)
  const locked = students.filter(s => !s.is_hidden && !(s.realname && String(s.realname).trim())).length

  return (
    <>
      <Head><title>학부모 동의서 관리 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user.realname} targetSchool={user.school} />}
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center gap-3">
            <Link href={withImpersonation('/teacher/students')} className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">학부모 동의서 관리</h1>
          </div>

          {classInfo && (
            <div className="bg-primary-light border border-primary rounded-2xl p-4 text-sm text-primary-dark">
              <strong>{classInfo.name}</strong>
              {locked > 0
                ? <span className="ml-2 text-blue-700">· 동의 대기 {locked}명</span>
                : <span className="ml-2 text-gray-500">· 모든 학생 표시 준비 완료</span>}
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm p-4 rounded-2xl leading-relaxed">
            🔒 동의받으면 그 학생만 실명으로 표시돼요. <strong>동의는 선택이에요</strong> — 받지 않아도 닉네임으로 안전하게 수업을 진행할 수 있어요.
          </div>

          {classInfo && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
              <ConsentPanel classInfo={classInfo} readOnly={isImpersonating} />
            </div>
          )}

          {/* 종이 동의서(인쇄/PDF)는 별도 화면 — step207-C에서 통합 예정 */}
          <Link href={withImpersonation('/teacher/parent-consent')}
            className="block bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition text-sm">
            🖨️ 종이 동의서가 필요하면 → <strong>인쇄용 동의서(A4 한 장)</strong>
          </Link>
        </main>
      </div>
    </>
  )
}
