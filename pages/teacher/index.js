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
import ImpersonationBanner from '../../components/ImpersonationBanner'
import StudentLoginInfoCard from '../../components/StudentLoginInfoCard'
import { getEffectiveProfile, withImpersonation } from '../../lib/impersonation'

export default function TeacherHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [stats, setStats] = useState({ students: 0, topics: 0, reports: 0, todayApiCalls: 0 })
  const [studentSamples, setStudentSamples] = useState([])  // 🆕 안내 카드용 학생 일부
  const [loading, setLoading] = useState(true)
  const [showPwModal, setShowPwModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  // 🆕 임퍼소네이션 상태 (와이프 피드백 5번)
  const [isImpersonating, setIsImpersonating] = useState(false)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    // 🆕 임퍼소네이션 고려한 profile 조회
    const { profile, isImpersonating: imp } = await getEffectiveProfile(
      '*, classes(id, name, code, grade, ranking_enabled, board_scope, login_hint_enabled, login_username_prefix, login_default_password)'
    )
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)
    
    if (profile.classes?.id) {
      const [s, t, samples] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true })
          .eq('class_id', profile.classes.id).eq('role', 'student')
          .or('is_hidden.is.null,is_hidden.eq.false'),
        supabase.from('topics').select('id', { count: 'exact', head: true }).eq('teacher_id', profile.id),
        // 🆕 안내 카드용 학생 username 일부 (최대 5명)
        supabase.from('profiles').select('username').eq('class_id', profile.classes.id).eq('role', 'student')
          .or('is_hidden.is.null,is_hidden.eq.false').limit(5)
      ])
      setStudentSamples(samples?.data || [])
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
            .is('deleted_at', null)
          reportCount = count || 0

          // 오늘 (PT 자정 기준 - Gemini 한도 리셋 시점)
          // PT는 PST/PDT 자동 전환되므로 Intl API로 정확히 계산
          // PT 자정 = 한국 시간 오후 4시 (PDT, 3~11월) / 오후 5시 (PST, 11~3월)
          const getPTMidnightUTC = () => {
            const now = new Date()
            // 현재 PT 시간 컴포넌트 추출
            const ptFormatter = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Los_Angeles',
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
              hour12: false
            })
            const parts = ptFormatter.formatToParts(now)
            const get = (type) => parts.find(p => p.type === type).value
            const ptYear = parseInt(get('year'))
            const ptMonth = parseInt(get('month'))
            const ptDay = parseInt(get('day'))
            const ptHour = parseInt(get('hour'))
            const ptMin = parseInt(get('minute'))
            const ptSec = parseInt(get('second'))

            // PT 기준으로 "오늘 00:00"이 UTC로 몇 시인지 역산
            // 현재 PT 시각과 PT 00:00의 차이를 계산
            const ptElapsedSec = ptHour * 3600 + ptMin * 60 + ptSec
            // 현재 UTC에서 ptElapsedSec만큼 빼면 PT 자정의 UTC
            return new Date(now.getTime() - ptElapsedSec * 1000)
          }

          const todayStartIso = getPTMidnightUTC().toISOString()

          const { count: subCount } = await supabase.from('submissions')
            .select('id', { count: 'exact', head: true })
            .in('user_id', ids)
            .gte('created_at', todayStartIso)
            .is('deleted_at', null)
          // 각 제출 = 채점(1) + 예시 생성(1) = 약 2회 호출
          todayApiCalls = (subCount || 0) * 2
        }
      } catch(e) { /* 컬럼 없으면 무시 */ }
      setStats({ students: s.count || 0, topics: t.count || 0, reports: reportCount, todayApiCalls })
    }
    setLoading(false)
  }

  const logout = async () => {
    // 임퍼소네이션 중에는 로그아웃 대신 관리자 페이지로 (실제 로그아웃 방지)
    if (isImpersonating) { router.push('/admin'); return }
    await supabase.auth.signOut(); router.push('/')
  }

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

  // 현재 시즌 기준 한국 리셋 시간 계산 (PT 자정 = 한국 오후 4시 PDT / 오후 5시 PST)
  // Intl API로 자동 계산하므로 매년 서머타임 전환 자동 반영
  const getKoreanResetTime = () => {
    // 오늘 PT 00:00이 한국 시간으로 몇 시인지
    const now = new Date()
    const ptFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    })
    const parts = ptFormatter.formatToParts(now)
    const ptHour = parseInt(parts.find(p => p.type === 'hour').value)
    const ptMin = parseInt(parts.find(p => p.type === 'minute').value)
    const ptSec = parseInt(parts.find(p => p.type === 'second').value)
    const ptElapsedSec = ptHour * 3600 + ptMin * 60 + ptSec
    const ptMidnightUtc = new Date(now.getTime() - ptElapsedSec * 1000)
    // 한국 시간으로 표시
    const kFormatter = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false
    })
    const kr = kFormatter.format(ptMidnightUtc) // "16:00" or "17:00"
    const [h] = kr.split(':')
    return `오후 ${parseInt(h) - 12}시`
  }

  return (
    <>
      <Head><title>선생님 화면 - 문해력 수업</title></Head>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user.realname} targetSchool={user.school} />}
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
                {!isImpersonating && (
                  <>
                    <button onClick={() => setShowProfileModal(true)} className="text-xs text-gray-600 hover:text-primary px-3 py-1 rounded-full border border-gray-200">
                      ✏️ 내 정보 수정
                    </button>
                    <button onClick={() => setShowPwModal(true)} className="text-xs text-gray-600 hover:text-primary px-3 py-1 rounded-full border border-gray-200">
                      🔐 비밀번호 변경
                    </button>
                  </>
                )}
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
                  {!isImpersonating && (
                    <button onClick={regenerateClassCode}
                      className="text-xs bg-white border border-primary text-primary px-3 py-1 rounded-full hover:bg-primary-light">
                      🔄 코드 재발급
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 🆕 학생 로그인 안내 카드 (와이프 피드백: 학생이 "선생님 아이디 뭐예요?" 안 물어보게) */}
          {classInfo && (
            <StudentLoginInfoCard
              classInfo={classInfo}
              students={studentSamples}
              isImpersonating={isImpersonating}
              onUpdate={checkAuth}
            />
          )}

          {/* API 키 관리 (임퍼소네이션 중 가림 — 다른 선생님 키를 건드리면 안 됨) */}
          {!isImpersonating && <ApiKeyManager classId={classInfo?.id} />}

          {/* 오늘 API 사용량 (추정) */}
          {/* 사용량 카드: 진짜 한도 임박할 때만 표시
             합계 한도 약 560 RPD 기준
             - 300회 이상: 절반 이상 사용 (주황 경계)
             - 450회 이상: 80% 사용 (빨강 위험) */}
          {stats.todayApiCalls >= 300 && (() => {
            const dangerThreshold = 450
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
                        ? `한도에 가까워졌어요. 한도 도달 시 자동으로 다른 모델로 전환됩니다. 자정(한국 시간 ${getKoreanResetTime()})에 자동 리셋돼요.`
                        : '사용량이 많아지고 있어요. 한도 도달 시 자동으로 다른 모델로 전환되니 안심하셔도 돼요.'}
                    </p>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* 학급 설정 (랭킹/게시판) */}
          {classInfo && !isImpersonating && <ClassSettings classInfo={classInfo} onUpdate={checkAuth} />}

          {/* 메뉴 */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Link href={withImpersonation("/teacher/topics")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📚</div>
              <h3 className="font-bold mb-1">주제 관리</h3>
              <p className="text-xs text-gray-500">오늘의 글쓰기 주제 등록</p>
            </Link>
            <Link href={withImpersonation("/teacher/students")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">👥</div>
              <h3 className="font-bold mb-1">학생 관리</h3>
              <p className="text-xs text-gray-500">학급명렬표 일괄 등록</p>
            </Link>
            <Link href={withImpersonation("/teacher/status")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📋</div>
              <h3 className="font-bold mb-1">제출 현황</h3>
              <p className="text-xs text-gray-500">오늘 누가 냈는지 한눈에</p>
            </Link>
            <Link href={withImpersonation("/teacher/submissions")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📝</div>
              <h3 className="font-bold mb-1">학생 글 보기</h3>
              <p className="text-xs text-gray-500">주제별 학생 글 + 피드백</p>
            </Link>
            <Link href={withImpersonation("/teacher/parent-consent")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📋</div>
              <h3 className="font-bold mb-1">학부모 동의서</h3>
              <p className="text-xs text-gray-500">인쇄 / PDF 다운로드</p>
            </Link>
            <Link href={withImpersonation("/teacher/student-growth")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📊</div>
              <h3 className="font-bold mb-1">학생 성장 그래프</h3>
              <p className="text-xs text-gray-500">학급/학생별 점수 추이</p>
            </Link>
            <Link href={withImpersonation("/teacher/feedback-reports")} className={`bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border ${
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
            <Link href={withImpersonation("/teacher/grammar-backfill")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📝</div>
              <h3 className="font-bold mb-1">맞춤법 일괄 적용</h3>
              <p className="text-xs text-gray-500">과거 글에 빨간 밑줄 추가</p>
            </Link>
            <Link href={withImpersonation("/teacher/trash")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">🗑️</div>
              <h3 className="font-bold mb-1">쓰레기통</h3>
              <p className="text-xs text-gray-500">삭제한 글 복원 / 영구 삭제</p>
            </Link>
            <Link href={withImpersonation("/teacher/help")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
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
