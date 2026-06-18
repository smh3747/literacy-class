// 교사 동의서 뷰어 (F-2) — 제출된 학부모 동의 이력을 학생별로 열람.
// 데이터: 교사 RLS로 consents를 본인 학급(class_id) 직접 SELECT(별도 API 불필요, step193 정책).
//   좌측 학생 목록(동의 제출자) + 우측 상세(보호자명·동의일시·출처·동의항목·서명).
//   키보드 ←/→로 학생 이동(submissions.js 패턴). ★PII(서명·보호자명)는 임퍼소네이션 중 접근 차단.
// ⚠️ 화면 뷰어만 — PDF 출력은 F-3에서 이 화면에 버튼으로 추가 예정.
// 전제: step209(consents.source) 적용. 기존 데이터·온라인 동의 경로 불변(읽기 전용).
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import Header from '../../../../components/Header'
import ImpersonationBanner from '../../../../components/ImpersonationBanner'
import { displayStudentName } from '../../../../lib/displayName'
import { getEffectiveProfile, withImpersonation } from '../../../../lib/impersonation'
import { toKST } from '../../../../lib/timeFormat'

// 동의 항목 코드 → 한글 라벨
const ITEM_LABELS = { privacy: '개인정보 수집·이용', ai_processing: 'AI 처리(Gemini)', terms: '이용약관' }

export default function ConsentSubmissionsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [groups, setGroups] = useState([])        // [{ student, consents: [...] }] — 동의 제출 학생만
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name, code)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)
    // ★PII 보호: 임퍼소네이션(admin 사칭) 중에는 동의서를 불러오지 않음(접근 차단).
    if (!imp && profile.classes?.id) {
      await loadConsents(profile.classes.id)
    }
    setLoading(false)
  }

  const loadConsents = async (classId) => {
    // 1) 학급 학생(이름 매핑용)
    const { data: studs } = await supabase.from('profiles')
      .select('id, realname, nickname, username, number, is_hidden')
      .eq('class_id', classId).eq('role', 'student')
    const studentMap = {}
    for (const s of studs || []) studentMap[s.id] = s
    // 2) 동의 이력 (교사 RLS로 직접 SELECT)
    const { data: rows } = await supabase.from('consents')
      .select('id, student_id, parent_name, signature, consent_items, source, consented_at')
      .eq('class_id', classId)
      .order('consented_at', { ascending: false })
    // 3) 학생별 묶기 (동의 제출 있는 학생만, 번호순)
    const byStudent = {}
    for (const r of rows || []) {
      if (!byStudent[r.student_id]) byStudent[r.student_id] = []
      byStudent[r.student_id].push(r)
    }
    const g = Object.keys(byStudent).map(sid => ({
      student: studentMap[sid] || { id: sid },
      consents: byStudent[sid],
    })).sort((a, b) => {
      const na = parseInt(a.student.number) || 999, nb = parseInt(b.student.number) || 999
      if (na !== nb) return na - nb
      return displayStudentName(a.student).localeCompare(displayStudentName(b.student))
    })
    setGroups(g)
    if (g.length > 0) setSelectedId(g[0].student.id)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 좌측 목록 인덱스 + 키보드 ←/→ 네비 (submissions.js 257~291 패턴)
  const currentIdx = selectedId ? groups.findIndex(g => g.student.id === selectedId) : -1
  const goPrev = () => { if (currentIdx > 0) { setSelectedId(groups[currentIdx - 1].student.id); window.scrollTo({ top: 0 }) } }
  const goNext = () => { if (currentIdx >= 0 && currentIdx < groups.length - 1) { setSelectedId(groups[currentIdx + 1].student.id); window.scrollTo({ top: 0 }) } }
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
  }, [currentIdx, groups.length, isImpersonating])

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  const selected = groups.find(g => g.student.id === selectedId) || null

  return (
    <>
      <Head><title>제출된 동의서 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user.realname} targetSchool={user.school} />}
        <Header user={user} onLogout={logout} />
        <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
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
          ) : groups.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 shadow-sm text-center text-sm text-gray-500">
              아직 제출된 동의서가 없어요. 온라인 링크를 보내거나 종이 동의서를 받아 처리하면 여기에 표시됩니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* 좌측: 동의 제출 학생 목록 */}
              <div className="sm:col-span-1 bg-white rounded-2xl p-3 shadow-sm border border-gray-100 h-fit">
                <p className="text-xs text-gray-500 px-1 mb-2">동의 제출 {groups.length}명 · <span className="text-gray-400">←/→ 이동</span></p>
                <ul className="space-y-1">
                  {groups.map(g => {
                    const isSel = g.student.id === selectedId
                    const withdrawn = g.consents[0]?.parent_name === '(동의 철회)'
                    return (
                      <li key={g.student.id}>
                        <button onClick={() => setSelectedId(g.student.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm ${isSel ? 'bg-primary-light text-primary-dark font-semibold' : 'hover:bg-gray-50'}`}>
                          {g.student.number ? `${g.student.number}. ` : ''}{displayStudentName(g.student)}
                          {g.consents.length > 1 && <span className="text-xs text-gray-400 ml-1">({g.consents.length})</span>}
                          {withdrawn && <span className="text-xs text-rose-500 ml-1">철회</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* 우측: 선택 학생 상세 */}
              <div className="sm:col-span-2 space-y-3">
                {selected && (
                  <>
                    <div className="bg-primary-light rounded-2xl p-4 flex items-center justify-between">
                      <h2 className="text-lg font-bold text-primary-dark">
                        {selected.student.number ? `${selected.student.number}번 ` : ''}{displayStudentName(selected.student)}
                      </h2>
                      <div className="flex gap-2">
                        <button onClick={goPrev} disabled={currentIdx <= 0}
                          className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-40">← 이전</button>
                        <button onClick={goNext} disabled={currentIdx >= groups.length - 1}
                          className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm disabled:opacity-40">다음 →</button>
                      </div>
                    </div>

                    {selected.consents.map(c => {
                      const isPaper = c.source === 'paper'
                      const isWithdraw = c.parent_name === '(동의 철회)'
                      const items = Array.isArray(c.consent_items) ? c.consent_items : []
                      return (
                        <div key={c.id} className={`bg-white rounded-2xl p-5 shadow-sm border ${isWithdraw ? 'border-rose-200' : 'border-gray-100'}`}>
                          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                            <div className="flex items-center gap-2">
                              {isWithdraw ? (
                                <span className="text-xs px-2 py-1 rounded-full bg-rose-100 text-rose-700">↩ 동의 철회</span>
                              ) : (
                                <span className={`text-xs px-2 py-1 rounded-full ${isPaper ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                                  {isPaper ? '🖨 종이' : '🔗 온라인'}
                                </span>
                              )}
                              <span className="text-sm font-medium text-gray-900">{c.parent_name || '(보호자명 없음)'}</span>
                            </div>
                            <span className="text-xs text-gray-500">{toKST(c.consented_at)}</span>
                          </div>

                          {/* 동의 항목 */}
                          {items.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              {items.map(it => (
                                <span key={it} className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                                  ✓ {ITEM_LABELS[it] || it}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* 서명 */}
                          {isWithdraw ? (
                            <span className="text-sm text-rose-600">동의가 철회된 기록이에요. (실명은 다시 닉네임으로 전환됨)</span>
                          ) : c.signature ? (
                            <div>
                              <p className="text-xs text-gray-500 mb-1">보호자 서명</p>
                              <img src={c.signature} alt="보호자 서명"
                                className="border border-gray-200 rounded-lg bg-white max-w-full" style={{ maxWidth: 600, height: 'auto' }} />
                            </div>
                          ) : (
                            <span className="text-sm text-gray-500">종이 제출 (서명 이미지 없음 — 원본 종이 동의서로 보관)</span>
                          )}
                        </div>
                      )
                    })}
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
