import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import ApiKeyManager from '../../components/ApiKeyManager'
import ClassSettings from '../../components/ClassSettings'
import PasswordChangeModal from '../../components/PasswordChangeModal'
import ProfileEditModal from '../../components/ProfileEditModal'
import QrCodeModal from '../../components/QrCodeModal'

export default function TeacherHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [stats, setStats] = useState({ students: 0, topics: 0, reports: 0, todayApiCalls: 0 })
  const [loading, setLoading] = useState(true)
  const [showPwModal, setShowPwModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes(id, name, code, grade, ranking_enabled, board_scope)').eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    
    if (profile.classes?.id) {
      const [s, t] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true })
          .eq('class_id', profile.classes.id).eq('role', 'student')
          .or('is_hidden.is.null,is_hidden.eq.false'),
        supabase.from('topics').select('id', { count: 'exact', head: true }).eq('teacher_id', profile.id)
      ])
      // 신고된 제출물 수 (우리 학급 학생들의 것만, 숨김 제외)
      let reportCount = 0
      // 오늘 API 호출 추정량 (오늘 제출 수 × 2)
      let todayApiCalls = 0
      try {
        const { data: studentIds } = await supabase.from('profiles')
          .select('id').eq('class_id', profile.classes.id).eq('role', 'student')
          .or('is_hidden.is.null,is_hidden.eq.false')
        if (studentIds && studentIds.length > 0) {
          const ids = studentIds.map(x => x.id)
          const { count } = await supabase.from('submissions')
            .select('id', { count: 'exact', head: true })
            .in('user_id', ids).eq('reported', true)
          reportCount = count || 0

          // 오늘 (한국 시간 기준이 아니라 PST 자정 기준 - 한도 리셋 시점)
          // PST 자정 = 한국 시간 17:00. 그 이후가 "오늘"
          const now = new Date()
          const utcMs = now.getTime() + now.getTimezoneOffset() * 60000
          const pstOffset = -8 * 3600000 // PST = UTC-8 (DST 무시, 대략적)
          const pstNow = new Date(utcMs + pstOffset)
          const pstToday = new Date(pstNow.getFullYear(), pstNow.getMonth(), pstNow.getDate())
          const pstTodayUtc = pstToday.getTime() - pstOffset
          const todayStartIso = new Date(pstTodayUtc).toISOString()

          const { count: subCount } = await supabase.from('submissions')
            .select('id', { count: 'exact', head: true })
            .in('user_id', ids)
            .gte('created_at', todayStartIso)
          // 각 제출 = 채점(1) + 예시 생성(1) = 약 2회 호출
          todayApiCalls = (subCount || 0) * 2
        }
      } catch(e) { /* 컬럼 없으면 무시 */ }
      setStats({ students: s.count || 0, topics: t.count || 0, reports: reportCount, todayApiCalls })
    }
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const regenerateClassCode = async () => {
    if (!classInfo) return
    if (!confirm(`학급 가입 코드를 재발급할까요?\n\n현재: ${classInfo.code}\n\n⚠️ 재발급하면 기존 코드는 사용할 수 없어요. 학생들에게 새 코드를 알려야 해요!`)) return
    
    try {
      let newCode, attempts = 0
      while (attempts < 10) {
        newCode = String(Math.floor(1000 + Math.random() * 9000))
        const { data: existing } = await supabase.from('classes').select('id').eq('code', newCode).maybeSingle()
        if (!existing) break
        attempts++
      }
      
      const { error } = await supabase.from('classes').update({ code: newCode }).eq('id', classInfo.id)
      if (error) throw error
      
      setClassInfo({ ...classInfo, code: newCode })
      alert(`✅ 새 학급 코드: ${newCode}\n\n학생들에게 새 코드를 알려주세요!`)
    } catch(e) {
      alert('재발급 실패: ' + e.message)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500">로딩 중...</div></div>

  return (
    <>
      <Head><title>선생님 화면 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
          <div className="flex items-start justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-xl font-bold">{user.realname} 선생님 환영합니다!</h2>
              <p className="text-sm text-gray-600 mt-1">
                {user.role === 'admin' ? '👑 관리자' : '👩‍🏫 담임 교사'}
                {user.school && <span className="ml-2 text-gray-500">· {user.school}</span>}
              </p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => setShowProfileModal(true)} className="text-xs text-gray-600 hover:text-primary px-3 py-1 rounded-full border border-gray-200">
                  ✏️ 내 정보 수정
                </button>
                <button onClick={() => setShowPwModal(true)} className="text-xs text-gray-600 hover:text-primary px-3 py-1 rounded-full border border-gray-200">
                  🔐 비밀번호 변경
                </button>
              </div>
            </div>
            {user.role === 'admin' && (
              <Link href="/admin" className="text-sm bg-purple-100 text-purple-700 px-4 py-2 rounded-lg font-medium hover:bg-purple-200">
                🛡️ 관리자 모드
              </Link>
            )}
          </div>

          {/* 학급 정보 카드 */}
          {classInfo && (
            <div className="bg-primary-light border-2 border-primary rounded-2xl p-5">
              <div className="text-xs text-primary-dark font-semibold mb-1">📋 우리 학급</div>
              <div className="text-2xl font-bold text-primary-dark mb-3">{classInfo.name}</div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-xs text-primary-dark mb-1">학생 가입 코드</div>
                  <div className="text-3xl font-mono font-bold tracking-widest text-primary-dark">{classInfo.code}</div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-primary-dark">학생 <strong>{stats.students}</strong>명</div>
                  <div className="text-primary-dark">주제 <strong>{stats.topics}</strong>개</div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                <p className="text-xs text-gray-700">학생들에게 위 코드를 알려주세요</p>
                <div className="flex gap-2">
                  <button onClick={() => setShowQrModal(true)}
                    className="text-xs bg-white border border-primary text-primary px-3 py-1 rounded-full hover:bg-primary-light font-medium">
                    📱 QR코드 보기
                  </button>
                  <button onClick={regenerateClassCode}
                    className="text-xs bg-white border border-primary text-primary px-3 py-1 rounded-full hover:bg-primary-light">
                    🔄 코드 재발급
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* API 키 관리 */}
          <ApiKeyManager classId={classInfo?.id} />

          {/* 오늘 API 사용량 (추정) */}
          {/* 사용량 카드: 한도 가까울 때만 표시 (정상 운영 중엔 안 보임) */}
          {stats.todayApiCalls >= 40 && (() => {
            const dangerThreshold = 80
            const isDanger = stats.todayApiCalls >= dangerThreshold
            return (
              <div className={`rounded-2xl p-4 shadow-sm border ${
                isDanger ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'
              }`}>
                <div className="flex items-start gap-3">
                  <div className="text-2xl flex-shrink-0">
                    {isDanger ? '🚨' : '⚠️'}
                  </div>
                  <div className="flex-1">
                    <h3 className={`font-bold text-sm ${
                      isDanger ? 'text-red-900' : 'text-amber-900'
                    }`}>
                      오늘 AI 사용량 — 약 {stats.todayApiCalls}회
                    </h3>
                    <p className={`text-xs mt-1 ${
                      isDanger ? 'text-red-800' : 'text-amber-800'
                    }`}>
                      {isDanger
                        ? '한도에 가까워졌어요. 한도 도달 시 자동으로 다른 모델로 전환됩니다. 자정(한국 시간 오후 5시)에 자동 리셋돼요.'
                        : '사용량이 많아지고 있어요. 한도 도달 시 자동으로 다른 모델로 전환되니 안심하셔도 돼요.'}
                    </p>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* 학급 설정 (랭킹/게시판) */}
          {classInfo && <ClassSettings classInfo={classInfo} onUpdate={checkAuth} />}

          {/* 메뉴 */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Link href="/teacher/topics" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📚</div>
              <h3 className="font-bold mb-1">주제 관리</h3>
              <p className="text-xs text-gray-500">오늘의 글쓰기 주제 등록</p>
            </Link>
            <Link href="/teacher/students" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">👥</div>
              <h3 className="font-bold mb-1">학생 관리</h3>
              <p className="text-xs text-gray-500">학급명렬표 일괄 등록</p>
            </Link>
            <Link href="/teacher/status" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📋</div>
              <h3 className="font-bold mb-1">제출 현황</h3>
              <p className="text-xs text-gray-500">오늘 누가 냈는지 한눈에</p>
            </Link>
            <Link href="/teacher/submissions" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📝</div>
              <h3 className="font-bold mb-1">학생 글 보기</h3>
              <p className="text-xs text-gray-500">주제별 학생 글 + 피드백</p>
            </Link>
            <Link href="/teacher/parent-consent" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📋</div>
              <h3 className="font-bold mb-1">학부모 동의서</h3>
              <p className="text-xs text-gray-500">인쇄 / PDF 다운로드</p>
            </Link>
            <Link href="/teacher/student-growth" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📊</div>
              <h3 className="font-bold mb-1">학생 성장 그래프</h3>
              <p className="text-xs text-gray-500">학급/학생별 점수 추이</p>
            </Link>
            <Link href="/teacher/feedback-reports" className={`bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border ${
              stats.reports > 0 ? 'border-amber-300 ring-2 ring-amber-200' : 'border-gray-100'
            } relative`}>
              <div className="text-3xl mb-2">🚨</div>
              <h3 className="font-bold mb-1">피드백 신고함
                {stats.reports > 0 && (
                  <span className="ml-2 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                    {stats.reports}
                  </span>
                )}
              </h3>
              <p className="text-xs text-gray-500">학생이 신고한 AI 피드백</p>
            </Link>
            <Link href="/teacher/grammar-backfill" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📝</div>
              <h3 className="font-bold mb-1">맞춤법 일괄 적용</h3>
              <p className="text-xs text-gray-500">과거 글에 빨간 밑줄 추가</p>
            </Link>
            <Link href="/teacher/help" className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📖</div>
              <h3 className="font-bold mb-1">도움말 / FAQ</h3>
              <p className="text-xs text-gray-500">사용 방법 + 문제 해결</p>
            </Link>
          </div>
        </main>
        {showPwModal && <PasswordChangeModal onClose={() => setShowPwModal(false)} />}
        {showProfileModal && <ProfileEditModal user={user} onClose={() => setShowProfileModal(false)} onUpdate={checkAuth} />}
        {showQrModal && classInfo && (
          <QrCodeModal
            classCode={classInfo.code}
            className={classInfo.name}
            onClose={() => setShowQrModal(false)}
          />
        )}
      </div>
    </>
  )
}
