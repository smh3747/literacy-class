import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import ApiKeyManager from '../../components/ApiKeyManager'
import ClassSettings from '../../components/ClassSettings'
import PasswordChangeModal from '../../components/PasswordChangeModal'
import ProfileEditModal from '../../components/ProfileEditModal'
import StudentLoginInfoCard from '../../components/StudentLoginInfoCard'
import SetupChecklist from '../../components/SetupChecklist'
import ImpersonationBanner from '../../components/ImpersonationBanner'
import { getEffectiveProfile, withImpersonation } from '../../lib/impersonation'
import { toKST } from '../../lib/timeFormat'

export default function TeacherHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [stats, setStats] = useState({ students: 0, topics: 0, reports: 0, todayApiCalls: 0 })
  const [studentSamples, setStudentSamples] = useState([])  // 🆕 안내 카드용 학생 일부
  const [topicCount, setTopicCount] = useState(0)            // 🆕 셋업 체크리스트용
  const [studentCountTotal, setStudentCountTotal] = useState(0)  // 🆕 셋업 체크리스트용
  const [hasApiKey, setHasApiKey] = useState(false)          // 🆕 셋업 체크리스트용 (값 자체는 안 가져옴)
  const apiKeyRef = useRef(null)                              // 🆕 셋업 체크리스트에서 스크롤
  const loginHintRef = useRef(null)                           // 🆕 로그인 안내 카드 스크롤
  const [apiOpenSignal, setApiOpenSignal] = useState(0)       // 🆕 카드 자동 펼침 신호
  const [loginHintOpenSignal, setLoginHintOpenSignal] = useState(0)
  const [guideTarget, setGuideTarget] = useState(null)        // 🆕 손가락 포인터 대상 ('api'|'loginHint')

  // 공통: 카드로 스크롤 + 자동 펼침 + 빨간 깜빡임 + 손가락 포인터
  const guideToCard = (ref, which) => {
    if (!ref.current) return
    // 1) 자동 펼침 신호
    if (which === 'api') setApiOpenSignal(s => s + 1)
    if (which === 'loginHint') setLoginHintOpenSignal(s => s + 1)
    // 2) 펼침 후 위치 안정되면 스크롤 (살짝 딜레이)
    setTimeout(() => {
      if (!ref.current) return
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // 3) 빨간 테두리 깜빡임 + 손가락
      ref.current.classList.add('guide-highlight')
      setGuideTarget(which)
      setTimeout(() => {
        if (ref.current) ref.current.classList.remove('guide-highlight')
        setGuideTarget(null)
      }, 4500)
    }, 150)
  }

  const scrollToApiKey = () => guideToCard(apiKeyRef, 'api')
  const scrollToLoginHint = () => guideToCard(loginHintRef, 'loginHint')
  const [loading, setLoading] = useState(true)
  const [showPwModal, setShowPwModal] = useState(false)
  const [mustChangePw, setMustChangePw] = useState(false)  // 🆕 step161: 초기화 후 강제 변경
  const [showProfileModal, setShowProfileModal] = useState(false)
  // 🆕 step163: 표준학교코드 없는 기존 교사 재선택 배너
  const [showSchoolBanner, setShowSchoolBanner] = useState(false)
  // 🆕 임퍼소네이션 상태 (와이프 피드백 5번)
  const [isImpersonating, setIsImpersonating] = useState(false)
  // 🆕 step205-C: 내 의견에 달린 운영자 답변 알림
  const [replyNotifs, setReplyNotifs] = useState([])
  const [showReplies, setShowReplies] = useState(false)

  useEffect(() => { checkAuth() }, [])

  // 내 의견 중 답변 달린 것만 조회 (fb_select 완화로 본인 행 읽기 가능).
  // ⚠️ 임퍼소네이션 중엔 세션이 admin이라 본인 행 판정이 어긋나므로 비활성.
  useEffect(() => {
    if (!user?.id || isImpersonating) return
    let alive = true
    ;(async () => {
      try {
        const { data } = await supabase.from('feedback')
          .select('id, content, reply_text, replied_at, reply_read_at')
          .eq('user_id', user.id)
          .not('reply_text', 'is', null)
          .order('replied_at', { ascending: false })
        if (alive) setReplyNotifs(data || [])
      } catch (e) { /* 무시 */ }
    })()
    return () => { alive = false }
  }, [user?.id, isImpersonating])

  // 답변 읽음 처리 (서비스롤 API — 본인 user_id 행만 갱신, fb_update는 admin-only라 직접 못 씀)
  const markRepliesRead = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      await fetch('/api/feedback-mark-read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token }),
      })
      const now = new Date().toISOString()
      setReplyNotifs(prev => prev.map(r => ({ ...r, reply_read_at: r.reply_read_at || now })))
    } catch (e) { /* 무시 */ }
  }

  const checkAuth = async () => {
    // 🆕 임퍼소네이션 고려한 profile 조회
    const { profile, isImpersonating: imp } = await getEffectiveProfile(
      '*, classes:class_id(id, name, code, grade, ranking_enabled, board_scope, login_hint_enabled, login_username_prefix, login_default_password, tutor_chat_enabled, self_signup_enabled)'
    )
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)

    // 🆕 step161: 비번 초기화된 계정이면 변경 모달 자동 노출 (임퍼소네이션 중엔 제외)
    if (profile.must_change_password && !imp) {
      setMustChangePw(true)
      setShowPwModal(true)
    }

    // 🆕 step163: 표준학교코드가 없는 기존 교사면 "학교 다시 선택" 배너 1회 노출
    //   (임퍼소네이션 중엔 쓰기 불가하므로 제외 / "나중에" 누르면 localStorage로 끔)
    if (!imp && profile.role === 'teacher' && !profile.school_code) {
      const dismissed = typeof window !== 'undefined' &&
        localStorage.getItem('lc-school-banner-dismissed-' + profile.id) === '1'
      setShowSchoolBanner(!dismissed)
    } else {
      setShowSchoolBanner(false)
    }

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

        // 🆕 셋업 체크리스트용 학생 수
        setStudentCountTotal(studentIds?.length || 0)

        // 🆕 셋업 체크리스트용 주제 수
        const { count: tc } = await supabase.from('topics')
          .select('id', { count: 'exact', head: true })
          .eq('teacher_id', profile.id)
        setTopicCount(tc || 0)

        // 🆕 셋업 체크리스트용 API 키 존재 여부 (값은 안 가져옴 - 보안)
        // 키 서버격리(step153~): class_secrets 기준 (교사는 RLS로 본인 학급 조회 가능)
        try {
          const { data: keyCheck } = await supabase.from('class_secrets')
            .select('class_id').eq('class_id', profile.classes.id).maybeSingle()
          setHasApiKey(!!keyCheck)
        } catch(e) {
          setHasApiKey(false)
        }

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
      // step149 RLS: 타 학급 코드는 안 보이므로 중복확인은 서버 라우트로
      let newCode, attempts = 0
      while (attempts < 10) {
        newCode = String(Math.floor(1000 + Math.random() * 9000))
        const dupRes = await fetch('/api/class-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkCode: newCode })
        })
        const { exists } = await dupRes.json()
        if (!exists) break
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
      <Head><title>선생님 화면 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user.realname} targetSchool={user.school} />}
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
          {/* 🆕 step161: 비번 초기화된 계정 — 변경 강하게 유도 */}
          {mustChangePw && !showPwModal && (
            <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-red-900 font-medium">
                🔐 임시 비밀번호(123456)로 로그인했어요. 보안을 위해 비밀번호를 꼭 바꿔주세요.
              </p>
              <button onClick={() => setShowPwModal(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 flex-shrink-0">
                지금 변경하기
              </button>
            </div>
          )}
          {/* 🆕 step205-C: 내 의견에 달린 운영자 답변 알림 (안 읽은 게 있거나 펼친 상태일 때) */}
          {!isImpersonating && replyNotifs.length > 0 && (replyNotifs.some(r => !r.reply_read_at) || showReplies) && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-semibold text-blue-900">
                  💬 보내주신 의견에 답변이 도착했어요
                  {(() => {
                    const n = replyNotifs.filter(r => !r.reply_read_at).length
                    return n > 0 ? <span className="ml-1 text-blue-700">({n}건)</span> : null
                  })()}
                </p>
                {!showReplies ? (
                  <button onClick={() => { setShowReplies(true); markRepliesRead() }}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 flex-shrink-0">
                    답변 보기
                  </button>
                ) : (
                  <button onClick={() => setShowReplies(false)}
                    className="text-xs text-blue-700 underline flex-shrink-0">접기</button>
                )}
              </div>
              {showReplies && (
                <div className="mt-3 space-y-3">
                  {replyNotifs.map(r => (
                    <div key={r.id} className="bg-white rounded-lg p-3 border border-blue-100">
                      <p className="text-xs text-gray-500 mb-1">내 의견</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap mb-2">{r.content}</p>
                      <p className="text-xs text-blue-700 font-medium mb-1">
                        💬 운영자 답변{r.replied_at && <span className="text-gray-400 font-normal ml-1">· {toKST(r.replied_at)}</span>}
                      </p>
                      <p className="text-sm text-blue-900 whitespace-pre-wrap bg-blue-50 rounded p-2">{r.reply_text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
                <p className="text-xs text-gray-700">👇 아래 학생 안내 카드에 QR · 로그인 방법이 함께 있어요</p>
                <div className="flex gap-2">
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

          {/* 🆕 첫 셋업 체크리스트 (신규 선생님 안내) */}
          {!isImpersonating && (
            <SetupChecklist
              classInfo={classInfo}
              teacherId={user?.id}
              hasApiKey={hasApiKey}
              studentCount={studentCountTotal}
              topicCount={topicCount}
              hasLoginHint={!!(classInfo?.login_hint_enabled && classInfo?.login_username_prefix)}
              onScrollToApi={scrollToApiKey}
              onScrollToLoginHint={scrollToLoginHint}
            />
          )}

          {/* 🆕 step163: 학교 다시 선택 안내 배너 (표준학교코드 없는 기존 교사) */}
          {showSchoolBanner && (
            <div className="rounded-2xl p-4 shadow-sm border bg-blue-50 border-blue-300">
              <div className="flex items-start gap-3">
                <div className="text-2xl flex-shrink-0">🏫</div>
                <div className="flex-1">
                  <h3 className="font-bold text-sm text-blue-900">학교를 공식 명칭으로 다시 선택해주세요</h3>
                  <p className="text-xs text-blue-800 mt-1">
                    아이디·비밀번호 찾기가 정확히 되려면 학교를 목록에서 한 번 골라주시면 돼요. 1분이면 끝나요!
                  </p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setShowProfileModal(true)}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700">
                      지금 선택하기
                    </button>
                    <button
                      onClick={() => {
                        if (typeof window !== 'undefined' && user?.id) {
                          localStorage.setItem('lc-school-banner-dismissed-' + user.id, '1')
                        }
                        setShowSchoolBanner(false)
                      }}
                      className="px-3 py-2 border border-blue-200 text-blue-700 rounded-lg text-xs font-medium">
                      나중에
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 🆕 학생 로그인 안내 카드 (와이프 피드백: 학생이 "선생님 아이디 뭐예요?" 안 물어보게) */}
          {classInfo && (
            <div ref={loginHintRef} className="rounded-2xl transition-all relative">
              {guideTarget === 'loginHint' && <div className="guide-pointer">👇</div>}
              <StudentLoginInfoCard
                classInfo={classInfo}
                students={studentSamples}
                isImpersonating={isImpersonating}
                onUpdate={checkAuth}
                openSignal={loginHintOpenSignal}
              />
            </div>
          )}

          {/* API 키 관리 (임퍼소네이션 중 가림 — 다른 선생님 키를 건드리면 안 됨) */}
          {!isImpersonating && (
            <div ref={apiKeyRef} className="rounded-2xl transition-all relative">
              {guideTarget === 'api' && <div className="guide-pointer">👇</div>}
              <ApiKeyManager classId={classInfo?.id} openSignal={apiOpenSignal} />
            </div>
          )}

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
            <Link href={withImpersonation("/teacher/record")} className="bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition border border-gray-100">
              <div className="text-3xl mb-2">📝</div>
              <h3 className="font-bold mb-1">생기부 평어 도우미</h3>
              <p className="text-xs text-gray-500">학생 글 기반 평어 초안 생성</p>
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
        {showPwModal && (
          <PasswordChangeModal
            onClose={() => setShowPwModal(false)}
            onSuccess={async () => {
              if (!mustChangePw) return
              try {
                await supabase.from('profiles').update({ must_change_password: false }).eq('id', user.id)
                setMustChangePw(false)
              } catch (e) { /* 플래그 해제 실패해도 변경은 성공 */ }
            }}
          />
        )}
        {showProfileModal && <ProfileEditModal user={user} onClose={() => setShowProfileModal(false)} onUpdate={checkAuth} />}
      </div>
    </>
  )
}
