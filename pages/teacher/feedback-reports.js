import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import { toKST } from '../../lib/timeFormat'
import { displayStudentName } from '../../lib/displayName'
import ImpersonationBanner from '../../components/ImpersonationBanner'
import { getEffectiveProfile, withImpersonation, assertWritable } from '../../lib/impersonation'

export default function FeedbackReports() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('open') // open / all
  const [isImpersonating, setIsImpersonating] = useState(false)  // 🆕 step569: 엿보기 지원

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    // step569: ?as= 엿보기 지원 — 읽기는 대상 교사 기준(getEffectiveProfile)
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut({ scope: 'local' }); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    await loadReports(profile)
    setLoading(false)
  }

  const loadReports = async (profile) => {
    if (!profile?.classes?.id) return
    // 우리 학급 학생들의 신고된 제출물만 (숨김 학생 제외)
    const { data: students } = await supabase.from('profiles')
      .select('id, realname, nickname, username, number, is_hidden')
      .eq('class_id', profile.classes.id).eq('role', 'student')
    const visibleStudents = (students || []).filter(s => !s.is_hidden)
    if (!visibleStudents) return

    const ids = visibleStudents.map(s => s.id)
    if (ids.length === 0) return

    const { data: subs } = await supabase.from('submissions')
      .select('*')
      .in('user_id', ids)
      .eq('reported', true)
      .is('deleted_at', null)
      .order('reported_at', { ascending: false })

    // 학생 정보 매핑
    const studentMap = {}
    visibleStudents.forEach(s => { studentMap[s.id] = s })
    const enriched = (subs || []).map(s => ({ ...s, student: studentMap[s.user_id] }))
    setReports(enriched)
  }

  const dismissReport = async (subId) => {
    if (!assertWritable()) return  // step569: 엿보기 쓰기 차단
    if (!confirm('이 신고를 해제(닫기)할까요?\n학생 화면에서는 다시 신고 버튼이 보이지 않습니다.')) return
    try {
      const { error } = await supabase.from('submissions').update({
        reported: false,
        report_reason: null,
        reported_at: null
      }).eq('id', subId)
      if (error) throw error
      await loadReports(user)
    } catch(e) {
      alert('실패: ' + e.message)
    }
  }

  const logout = async () => {
    if (isImpersonating) { router.push('/admin'); return }  // step569: 엿보기 중 로그아웃 = 관리자 복귀
    await supabase.auth.signOut({ scope: 'local' }); router.push('/')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>피드백 신고함 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user?.realname} targetSchool={user?.school} />}
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href={withImpersonation('/teacher')} className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">🚨 AI 피드백 신고함</h1>
          </div>

          {/* step569: 엿보기 읽기 전용 안내 (students.js 관행) */}
          {isImpersonating && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              📖 읽기 전용입니다. 신고 확인 완료 처리는 차단되어 있어요.
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            학생이 "이 피드백 이상해요" 버튼을 누르면 여기에 모입니다.<br/>
            피드백 품질 모니터링용이며, 학생 글을 직접 확인하시고 추가 지도해 주세요.
          </div>

          {reports.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center text-gray-500">
              <div className="text-4xl mb-2">✨</div>
              <p className="text-sm">현재 신고된 피드백이 없어요</p>
              <p className="text-xs text-gray-400 mt-1">학생들이 피드백에 만족하고 있는 것 같네요!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map(r => (
                <div key={r.id} className="bg-white rounded-2xl p-5 shadow-sm space-y-3 border-l-4 border-amber-400">
                  <div className="flex justify-between items-start flex-wrap gap-2">
                    <div>
                      <div className="text-sm">
                        <strong>{displayStudentName(r.student)}</strong>
                        {r.student?.number && <span className="text-gray-500 ml-2">{r.student.number}번</span>}
                        <span className="text-gray-500 ml-2 text-xs">({r.student?.username})</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        주제: {r.topic_title || '?'} · 신고일: {toKST(r.reported_at)}
                      </div>
                    </div>
                    <button onClick={() => dismissReport(r.id)} disabled={isImpersonating}
                      className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded disabled:opacity-50">
                      ✓ 확인 완료
                    </button>
                  </div>

                  {r.report_reason && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                      <div className="text-xs font-bold text-red-700 mb-1">학생이 남긴 사유</div>
                      <p className="text-red-900">{r.report_reason}</p>
                    </div>
                  )}

                  <details className="text-sm">
                    <summary className="cursor-pointer text-gray-600 hover:text-gray-900 text-xs">
                      📄 학생 글 + AI 피드백 보기
                    </summary>
                    <div className="mt-3 space-y-3">
                      <div className="bg-gray-50 rounded p-3">
                        <div className="text-xs font-bold text-gray-700 mb-1">학생 글 ({r.total_score}/{r.max_score}점)</div>
                        <p className="text-sm whitespace-pre-wrap">{r.essay_text}</p>
                      </div>
                      <div className="bg-blue-50 rounded p-3">
                        <div className="text-xs font-bold text-blue-900 mb-1">💬 종합 의견</div>
                        <p className="text-sm text-blue-900">{r.feedback_overall}</p>
                      </div>
                      <div className="bg-green-50 rounded p-3">
                        <div className="text-xs font-bold text-green-900 mb-1">⭐ 잘한 점</div>
                        <p className="text-sm text-green-900 whitespace-pre-wrap">{r.feedback_good}</p>
                      </div>
                      <div className="bg-amber-50 rounded p-3">
                        <div className="text-xs font-bold text-amber-900 mb-1">🌱 발전 점</div>
                        <p className="text-sm text-amber-900 whitespace-pre-wrap">{r.feedback_improve}</p>
                      </div>
                    </div>
                  </details>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  )
}
