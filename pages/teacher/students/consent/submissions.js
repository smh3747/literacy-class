// 교사 동의서 뷰어 (F-2, 양식형) — 학급 전체 학생을 동의서 양식 한 장으로 열람·인쇄(F-3).
//   좌측: 전체 학생 목록 + 동의 상태 배지(🔗온라인/🖨종이/미동의). 우측: 채워진/빈 동의서 양식.
//   데이터: 교사 RLS로 profiles·consents 직접 SELECT(읽기 전용, API 불필요).
//   인쇄: ConsentDocument의 @media print가 "이 양식만" A4 한 장으로(주변 UI는 .no-print).
// ★PII 가드: 임퍼소네이션(admin 사칭) 중에는 동의서 미로드(접근 차단).
// 전제: step209(consents.source) 적용. 기존 데이터·온라인 동의 경로 불변.
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import Header from '../../../../components/Header'
import ImpersonationBanner from '../../../../components/ImpersonationBanner'
import ConsentDocument from '../../../../components/ConsentDocument'
import KeyNavHint from '../../../../components/KeyNavHint'
import { displayStudentName } from '../../../../lib/displayName'
import { getEffectiveProfile, withImpersonation } from '../../../../lib/impersonation'

export default function ConsentSubmissionsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])          // [{ student, valid }] — 전체 학생(번호순)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name, code, grade)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)
    // ★PII 보호: 임퍼소네이션 중에는 동의서를 불러오지 않음(접근 차단).
    if (!imp && profile.classes?.id) {
      await loadData(profile.classes.id)
    }
    setLoading(false)
  }

  const loadData = async (classId) => {
    // 전체 학생 (consent_received·realname·nickname·number 포함)
    const { data: studs } = await supabase.from('profiles').select('*')
      .eq('class_id', classId).eq('role', 'student')
    // 동의 이력 → student_id로 매핑
    const { data: consents } = await supabase.from('consents')
      .select('id, student_id, parent_name, signature, consent_items, source, consented_at')
      .eq('class_id', classId)
      .order('consented_at', { ascending: false })
    const byStudent = {}
    for (const c of consents || []) {
      if (!byStudent[c.student_id]) byStudent[c.student_id] = []
      byStudent[c.student_id].push(c)
    }
    const list = (studs || [])
      .filter(s => !s.is_hidden)
      .map(s => ({
        student: s,
        // 유효 동의 = 철회 제외 최신 (배지는 consent_received로, 양식 채움은 이 행으로)
        valid: (byStudent[s.id] || []).find(c => c.parent_name !== '(동의 철회)') || null,
      }))
      .sort((a, b) => {
        const na = parseInt(a.student.number) || 999, nb = parseInt(b.student.number) || 999
        if (na !== nb) return na - nb
        return displayStudentName(a.student).localeCompare(displayStudentName(b.student))
      })
    setRows(list)
    if (list.length > 0) setSelectedId(list[0].student.id)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 키보드 ←/→ 네비 (submissions.js 패턴)
  const currentIdx = selectedId ? rows.findIndex(r => r.student.id === selectedId) : -1
  const goPrev = () => { if (currentIdx > 0) { setSelectedId(rows[currentIdx - 1].student.id); window.scrollTo({ top: 0 }) } }
  const goNext = () => { if (currentIdx >= 0 && currentIdx < rows.length - 1) { setSelectedId(rows[currentIdx + 1].student.id); window.scrollTo({ top: 0 }) } }
  useEffect(() => {
    if (isImpersonating) return
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'textarea' || tag === 'input' || tag === 'select') return
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentIdx, rows.length, isImpersonating])

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  const selected = rows.find(r => r.student.id === selectedId) || null
  const consentedCount = rows.filter(r => r.student.consent_received === true).length

  // 선택 학생 → ConsentDocument props
  const docProps = (() => {
    if (!selected) return null
    const s = selected.student
    const isConsented = s.consent_received === true
    if (!isConsented) {
      return { school: user.school, className: classInfo?.name, grade: classInfo?.grade, student: s, status: 'none' }
    }
    const v = selected.valid
    const source = v?.source || 'paper'   // 동의됐는데 이력 없으면(구·자가가입) 종이로 간주
    return {
      school: user.school, className: classInfo?.name, grade: classInfo?.grade, student: s,
      parentName: v?.parent_name || '', signature: v?.signature || null,
      consentItems: v?.consent_items || (isConsented ? ['privacy', 'ai_processing'] : []),
      consentedAt: v?.consented_at || s.consent_received_at || null,
      status: source,
    }
  })()

  return (
    <>
      <Head><title>제출된 동의서 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <div className="no-print"><ImpersonationBanner targetName={user.realname} targetSchool={user.school} /></div>}
        <div className="no-print"><Header user={user} onLogout={logout} /></div>
        <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
          <div className="no-print flex items-center gap-3">
            <Link href={withImpersonation('/teacher/students/consent')} className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">제출된 동의서</h1>
            {classInfo && <span className="text-sm text-gray-500">· {classInfo.name}</span>}
          </div>

          {/* ★PII 보호: 임퍼소네이션 중에는 접근 차단 */}
          {isImpersonating ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-sm text-amber-900">
              📖 읽기 전용(관리자 열람) 중에는 보호자 성함·서명 등 개인정보가 담긴 동의서를 볼 수 없어요.
              담임 선생님 본인 계정으로 로그인해 확인해주세요.
            </div>
          ) : rows.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 shadow-sm text-center text-sm text-gray-500">
              등록된 학생이 없어요.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* 좌측: 전체 학생 + 동의 상태 (인쇄 제외) */}
              <div className="no-print sm:col-span-1 bg-white rounded-2xl p-3 shadow-sm border border-gray-100 h-fit">
                <p className="text-xs text-gray-500 px-1 mb-2">동의 {consentedCount}/{rows.length}명</p>
                <ul className="space-y-1">
                  {rows.map(r => {
                    const isSel = r.student.id === selectedId
                    const consented = r.student.consent_received === true
                    const isPaper = (r.valid?.source || 'paper') === 'paper'
                    return (
                      <li key={r.student.id}>
                        <button onClick={() => setSelectedId(r.student.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 ${isSel ? 'bg-primary-light text-primary-dark font-semibold' : 'hover:bg-gray-50'}`}>
                          <span>{r.student.number ? `${r.student.number}. ` : ''}{displayStudentName(r.student)}</span>
                          {consented
                            ? <span className="text-xs flex-shrink-0">{isPaper ? '🖨' : '🔗'}<span className="text-green-600 ml-0.5">동의</span></span>
                            : <span className="text-xs text-gray-400 flex-shrink-0">⬜ 미동의</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* 우측: 선택 학생 동의서 양식 + 인쇄 버튼 */}
              <div className="sm:col-span-2 space-y-3">
                {selected && (
                  <>
                    <div className="no-print flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button onClick={goPrev} disabled={currentIdx <= 0}
                          className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-40">← 이전</button>
                        <button onClick={goNext} disabled={currentIdx >= rows.length - 1}
                          className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-40">다음 →</button>
                        <KeyNavHint label="동의서 넘기기" storageKey="lc-consentnav-hint-dismissed" teacherId={user?.id} />
                      </div>
                      <button onClick={() => window.print()}
                        className="px-4 py-1.5 bg-primary text-white rounded-lg text-sm font-medium">🖨 인쇄 / PDF 저장</button>
                    </div>

                    {selected.student.consent_received !== true && (
                      <div className="no-print bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-600">
                        아직 동의 전입니다. 아래는 빈 양식이에요 — 인쇄해서 가정으로 보내거나, 동의를 받으면 자동으로 채워집니다.
                      </div>
                    )}

                    {docProps && <ConsentDocument {...docProps} />}
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
