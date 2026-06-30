import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import ConsentDocument from '../../components/ConsentDocument'
import { getEffectiveProfile } from '../../lib/impersonation'

export default function ParentConsent() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [consentStats, setConsentStats] = useState(null)  // 🆕 step292: 동의 현황(조회만)
  const [loading, setLoading] = useState(true)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    // 🆕 step292: 임퍼소네이션 고려(?as= 시 해당 교사 학급 기준)
    const { profile } = await getEffectiveProfile('*, classes:class_id(id, name, grade)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    // 🆕 step292: 동의 현황 — 전체/동의완료(consent_received)/미동의. 조회만(쓰기 없음).
    if (profile.classes?.id) {
      try {
        const { data: studs } = await supabase.from('profiles')
          .select('consent_received, is_hidden')
          .eq('class_id', profile.classes.id).eq('role', 'student')
        const active = (studs || []).filter(s => !s.is_hidden)
        const total = active.length
        const consented = active.filter(s => s.consent_received === true).length
        setConsentStats({ total, consented, notConsented: total - consented })
      } catch (e) { /* 현황 조회 실패해도 인쇄는 가능 */ }
    }
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
            <div className="flex items-center gap-3 flex-wrap justify-end">
              {consentStats && (
                <span className="text-sm text-gray-600">
                  동의 <strong className="text-gray-900">{consentStats.consented}/{consentStats.total}</strong>명
                  {consentStats.notConsented > 0 && (
                    <span className="ml-2 text-rose-600 font-bold">· 미동의 {consentStats.notConsented}명</span>
                  )}
                </span>
              )}
              <button onClick={printDoc} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium">
                🖨️ 인쇄하기 (A4 한 장)
              </button>
            </div>
          </div>
        </div>

        <main className="max-w-3xl mx-auto px-4 py-6">
          {/* step296: 학년·반은 미리 인쇄(grade+className 함께 — grade 없으면 학급명만), 번호·학생성명·학부모 성명/서명은 빈 줄(손 기입). student 미전달. */}
          <ConsentDocument grade={classInfo?.grade} className={classInfo?.name} />
        </main>
      </div>
    </>
  )
}
