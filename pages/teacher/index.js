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
import StudentFeedbackCard from '../../components/StudentFeedbackCard'
import ImpersonationBanner from '../../components/ImpersonationBanner'
import PasswordInput from '../../components/PasswordInput'
import { isValidEmail } from '../../lib/email'
import { getAuthErrorMessage } from '../../lib/authErrors'
import { SAMPLE_TASTE } from '../../lib/sampleFeedback'
import { getEffectiveProfile, withImpersonation, assertWritable } from '../../lib/impersonation'
import { toKST } from '../../lib/timeFormat'
import { callAI } from '../../lib/aiClient'

export default function TeacherHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [stats, setStats] = useState({ students: 0, topics: 0, reports: 0, todayApiCalls: 0, todaySubmissions: 0 })
  const [studentSamples, setStudentSamples] = useState([])  // 🆕 안내 카드용 학생 일부
  const [topicCount, setTopicCount] = useState(0)            // 🆕 셋업 체크리스트용
  const [studentCountTotal, setStudentCountTotal] = useState(0)  // 🆕 셋업 체크리스트용
  const [hasApiKey, setHasApiKey] = useState(false)          // 🆕 셋업 체크리스트용 (값 자체는 안 가져옴)
  const apiKeyRef = useRef(null)                              // 🆕 셋업 체크리스트에서 스크롤
  const loginHintRef = useRef(null)                           // 🆕 로그인 안내 카드 스크롤
  const [apiOpenSignal, setApiOpenSignal] = useState(0)       // 🆕 카드 자동 펼침 신호
  const [loginHintOpenSignal, setLoginHintOpenSignal] = useState(0)
  const [guideTarget, setGuideTarget] = useState(null)        // 🆕 손가락 포인터 대상 ('api'|'loginHint')
  const settingsRef = useRef(null)                            // 🆕 step290: 학급 설정 스크롤(드로어)
  // 🆕 step291: 우측 드로어(데스크탑 lg+)에 패널 1개만 — 'login'|'api'|'settings'|null. 모바일은 인라인이라 무관.
  const [activePanel, setActivePanel] = useState(null)
  // 🆕 step386: 복구용 이메일 미등록 배너 (합성 이메일 교사에게만, 닫기 유지)
  const [recoveryEmailMissing, setRecoveryEmailMissing] = useState(false)
  const [recoveryBannerHidden, setRecoveryBannerHidden] = useState(true)
  // 🆕 step453: 비번 초기화 후 강제 설정 모달(새 비번+이메일, 닫기 불가)
  const [mustSetup, setMustSetup] = useState(false)
  const [hasRealEmail, setHasRealEmail] = useState(false)   // 실이메일 등록 계정이면 이메일 입력 생략
  const [setupPw, setSetupPw] = useState('')
  const [setupPw2, setSetupPw2] = useState('')
  const [setupEmail, setSetupEmail] = useState('')
  const [setupSaving, setSetupSaving] = useState(false)
  const [setupError, setSetupError] = useState('')
  // 🆕 step380: 파운딩 멤버 사전 신청 (결제 아님, 관심 등록만). loaded=조회 성공(테이블 미생성이면 false→카드 숨김)
  // 🆕 step382: response('interested'|'not_sure') 응답 구분 추가
  const [preorder, setPreorder] = useState({ loaded: false, done: false, response: null })
  const [preorderHidden, setPreorderHidden] = useState(true)  // 깜빡임 방지 기본 숨김, localStorage로 복원
  const [preorderSaving, setPreorderSaving] = useState(false)
  // 🆕 다음 걸음 카드 — 막힌 지점별 온보딩 설문·안내 (card_type별 평생 1회, 브리핑과 별개 state)
  const [nextStepCard, setNextStepCard] = useState(null)      // 'review'|'no_students'|'no_topics'|'no_class_run'|null
  const [reviewPick, setReviewPick] = useState(null)          // review 카드: 선택한 이모지(good|soso|bad)
  const [reviewComment, setReviewComment] = useState('')      // review 카드: 한 줄 의견(선택)
  const [reviewFollowup, setReviewFollowup] = useState(null)  // review 후속: null | 'ask'(사전신청 이어묻기) | 'thanks'

  // 툴바 토글: 같은 버튼 다시 누르면 닫힘 (스크롤 없음 → 깜빡임 제거)
  const togglePanel = (panel) => setActivePanel(prev => (prev === panel ? null : panel))

  // SetupChecklist 동선: 해당 패널만 열고 자동 펼침 신호 + (모바일) 인라인 스크롤 + 👇 잠깐
  const guideToPanel = (panel, which) => {
    setActivePanel(panel)
    if (which === 'api') setApiOpenSignal(s => s + 1)
    if (which === 'loginHint') setLoginHintOpenSignal(s => s + 1)
    setTimeout(() => {
      const ref = panel === 'api' ? apiKeyRef : loginHintRef
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setGuideTarget(which)
      setTimeout(() => setGuideTarget(null), 4500)
    }, 150)
  }

  const scrollToApiKey = () => guideToPanel('api', 'api')
  const scrollToLoginHint = () => guideToPanel('login', 'loginHint')
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
  // 🆕 step287: 안내 배너(심의/학부모동의) 펼침 — 모바일 탭 토글용(데스크탑은 CSS hover 병행)
  const [openGuide, setOpenGuide] = useState(null)  // 'simui' | 'consent' | null
  // 🆕 step280: 신규 교사 맛보기(샘플 피드백) 노출 여부
  const [showTaste, setShowTaste] = useState(false)

  // 맛보기 닫기 — 교사별 영구 숨김 (SetupChecklist 닫기 패턴과 동일, 반드시 teacherId 포함)
  const dismissTaste = () => {
    setShowTaste(false)
    if (typeof window !== 'undefined' && user?.id) {
      try { localStorage.setItem('lc-taste-feedback-dismissed:' + user.id, '1') } catch {}
    }
  }

  useEffect(() => { checkAuth() }, [])

  // 🆕 step386: 복구용 이메일 등록 여부 — 본인 세션(비임퍼소네이션)에서만, 합성 이메일이면 배너
  // 🆕 step453: 닫기=영구 아님 — 타임스탬프 저장, 7일 지나면 재노출(옛 값 '1'은 자동 재노출됨).
  //   실이메일 여부(hasRealEmail)는 강제 설정 모달의 이메일 생략 판정에도 공용.
  useEffect(() => {
    if (!user?.id || user.role !== 'teacher' || isImpersonating) return
    try {
      const ts = Number(localStorage.getItem('lc-recovery-email-banner-dismissed:' + user.id) || 0)
      setRecoveryBannerHidden(Date.now() - ts < 7 * 24 * 3600 * 1000)
    } catch { setRecoveryBannerHidden(false) }
    ;(async () => {
      const { data: { user: au } } = await supabase.auth.getUser()
      if (!au || au.id !== user.id) return
      const missing = (au.email || '').endsWith('@writing.class')
      setRecoveryEmailMissing(missing)
      setHasRealEmail(!missing)
    })()
  }, [user?.id, isImpersonating, showProfileModal])  // 모달 닫힘 후 재평가(등록 완료 시 배너 소멸)

  const dismissRecoveryBanner = () => {
    setRecoveryBannerHidden(true)
    if (user?.id) { try { localStorage.setItem('lc-recovery-email-banner-dismissed:' + user.id, String(Date.now())) } catch {} }
  }

  // 🆕 step453: 강제 설정 저장 — ①새 비번으로 변경 ②(필요 시) 새 비번으로 재인증해 이메일 등록
  //   ③두 플래그(must_setup_at·must_change_password) 해제. 단계별 실패는 모달 유지+에러 표시.
  const submitSetup = async () => {
    if (setupSaving) return
    setSetupError('')
    if (setupPw.length < 6) return setSetupError('새 비밀번호는 6자 이상이어야 해요')
    if (setupPw !== setupPw2) return setSetupError('새 비밀번호가 일치하지 않아요')
    const needEmail = !hasRealEmail
    const email = setupEmail.trim().toLowerCase()
    if (needEmail && !isValidEmail(email)) return setSetupError('이메일 주소를 정확히 입력해주세요')
    setSetupSaving(true)
    try {
      // ① 비밀번호 먼저 변경 (이후 이메일 API 재인증은 새 비번으로 통과)
      const { error: pwErr } = await supabase.auth.updateUser({ password: setupPw })
      if (pwErr) throw new Error(getAuthErrorMessage(pwErr))  // step454: 영어 날것 노출 방지
      // ② 이메일 등록 (기존 teacher-update-email 흐름 재사용)
      if (needEmail) {
        const { data: { session } } = await supabase.auth.getSession()
        const r = await fetch('/api/teacher-update-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, currentPassword: setupPw, accessToken: session?.access_token }),
        })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || '이메일 등록 실패')
      }
      // ③ 플래그 해제 (step161 잔존 배너 방지 위해 must_change_password도 함께)
      await supabase.from('profiles')
        .update({ must_setup_at: null, must_change_password: false })
        .eq('id', user.id)
      setMustSetup(false)
      setMustChangePw(false)
      setSetupPw(''); setSetupPw2(''); setSetupEmail('')
      // step454: 이메일 등록 완료 즉시 배너 판정 갱신 — updateUserById(email_confirm: true)라 대기 상태 없이 교체 완료
      if (needEmail) { setHasRealEmail(true); setRecoveryEmailMissing(false) }
    } catch (e) {
      setSetupError(e?.message || '저장에 실패했어요. 잠시 후 다시 시도해주세요.')
    }
    setSetupSaving(false)
  }

  // 🆕 step380: 사전 신청 상태 조회 — 테이블·컬럼 미생성(SQL 미실행)이면 loaded=false 유지로 카드 자체 숨김
  useEffect(() => {
    if (!user?.id || user.role !== 'teacher') return
    try { setPreorderHidden(!!localStorage.getItem('lc-founding-preorder-dismissed:' + user.id)) } catch { setPreorderHidden(false) }
    ;(async () => {
      const { data, error } = await supabase.from('preorders').select('id, response').eq('teacher_id', user.id).maybeSingle()
      if (error) return
      setPreorder({ loaded: true, done: !!data, response: data?.response || null })
    })()
  }, [user?.id])

  // 🆕 step380: 사전 신청 — 교사당 1회. 🆕 step382: 응답 구분('interested'|'not_sure') 기록.
  //   unique 위반(23505)은 이미 응답한 것 — 재조회로 실제 응답을 읽어 표시(다기기에서 다른 버튼 눌렀을 때 정확)
  const submitPreorder = async (response) => {
    if (preorderSaving || !user?.id) return
    setPreorderSaving(true)
    const { error } = await supabase.from('preorders').insert({ teacher_id: user.id, response })
    if (!error) {
      setPreorderSaving(false)
      setPreorder({ loaded: true, done: true, response })
      return
    }
    if (error.code === '23505') {
      const { data } = await supabase.from('preorders').select('response').eq('teacher_id', user.id).maybeSingle()
      setPreorderSaving(false)
      setPreorder({ loaded: true, done: true, response: data?.response || response })
      return
    }
    setPreorderSaving(false)
    alert('신청 처리에 문제가 생겼어요. 잠시 후 다시 시도해주세요.')
  }
  const dismissPreorder = () => {
    setPreorderHidden(true)
    if (user?.id) { try { localStorage.setItem('lc-founding-preorder-dismissed:' + user.id, '1') } catch {} }
  }
  const reopenPreorder = () => {
    setPreorderHidden(false)
    if (user?.id) { try { localStorage.removeItem('lc-founding-preorder-dismissed:' + user.id) } catch {} }
  }

  // 🆕 옛 전역 체크리스트 키 1회 청소 (step220 이전 잔재 — 계정 섞임 혼란 유발)
  //   ⚠️ 정확히 이 키만 제거. 교사별 키(lc-setup-checklist-hidden:<id>)는 절대 건드리지 않음.
  useEffect(() => {
    try { localStorage.removeItem('lc-setup-checklist-hidden') } catch {}
  }, [])

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

  // 🆕 교사 아침 브리핑 — 홈 열 때 lazy 생성. 우리 반 직전(임계값 이상 채점완료) 주제의
  //   공통 부족점 1개 + 지도 멘트를 AI로 만들어 종 알림으로. 주제당 1회(source_topic_id 캐시)로 비용 방어.
  //   호출부에서 !imp && hasApiKey 가드. 모든 실패는 무시(홈 로딩 안 깨지게), await 안 함.
  const BRIEFING_PCT = 0.7  // visible 학생 중 이 비율 이상 채점완료돼야 대상 주제
  const maybeGenerateBriefing = async (profile) => {
    try {
      const classId = profile?.classes?.id
      if (!classId) return

      // 캐시 상태(중복방지 마커)
      const { data: cls } = await supabase.from('classes')
        .select('morning_briefing_source_topic_id').eq('id', classId).maybeSingle()
      const cachedSourceId = cls?.morning_briefing_source_topic_id || null

      // visible 학생
      const { data: studs } = await supabase.from('profiles')
        .select('id, is_hidden').eq('class_id', classId).eq('role', 'student')
      const studentIds = (studs || []).filter(s => !s.is_hidden).map(s => s.id)
      if (studentIds.length < 2) return

      // 교사 주제 (최신순)
      const { data: topics } = await supabase.from('topics')
        .select('id, date, title, rubrics').eq('teacher_id', profile.id)
        .order('date', { ascending: false }).limit(50)
      if (!topics || topics.length === 0) return
      const topicIds = topics.map(t => t.id)

      // 채점완료 제출 (total_score 존재)
      const { data: subs } = await supabase.from('submissions')
        .select('topic_id, user_id, scores, feedback_improve, corrections, total_score')
        .in('topic_id', topicIds).in('user_id', studentIds)
        .is('deleted_at', null).not('total_score', 'is', null)
      if (!subs || subs.length === 0) return

      const byTopic = {}
      subs.forEach(s => { (byTopic[s.topic_id] = byTopic[s.topic_id] || []).push(s) })

      // 대상 주제: 고유 채점완료 제출자 ≥ 임계값인 가장 최근 주제
      const need = Math.max(2, Math.floor(studentIds.length * BRIEFING_PCT))
      let sourceTopic = null, sourceSubs = null
      for (const t of topics) {
        const list = byTopic[t.id]
        if (!list) continue
        const uniq = new Set(list.map(x => x.user_id)).size
        if (uniq >= need) { sourceTopic = t; sourceSubs = list; break }
      }
      if (!sourceTopic) return
      if (sourceTopic.id === cachedSourceId) return  // 이미 처리한 주제

      // 학생별 요약 (가장 낮은 기준·개선점·맞춤법 수)
      const rubrics = Array.isArray(sourceTopic.rubrics) ? sourceTopic.rubrics : []
      const students = sourceSubs.map(s => {
        const scores = Array.isArray(s.scores) ? s.scores : []
        let lowIdx = -1, lowRatio = 2
        scores.forEach((sc, i) => {
          const max = rubrics[i]?.score || 0
          const ratio = max > 0 ? sc / max : 1
          if (ratio < lowRatio) { lowRatio = ratio; lowIdx = i }
        })
        return {
          lowRubric: lowIdx >= 0 ? (rubrics[lowIdx]?.name || `기준 ${lowIdx + 1}`) : '',
          lowScore: lowIdx >= 0 ? `${scores[lowIdx]}/${rubrics[lowIdx]?.score ?? '?'}` : '',
          improve: (s.feedback_improve || '').slice(0, 200),
          correctionCount: Array.isArray(s.corrections) ? s.corrections.length : 0,
        }
      })

      const gradeText = profile.classes?.grade ? `초등 ${profile.classes.grade}학년` : '초등학생'
      const result = await callAI('briefing', { gradeText, topicTitle: sourceTopic.title, students })
      const { weakness, student_line } = result || {}
      const line = (student_line || '').trim()
      if (!line) return  // AI 실패 시 저장·알림 안 함

      // 2층 문구: 교사용 문맥 + 학생에게 그대로 읽어줄 한 문장(\n으로 분리 저장 → 종 알림에서 박스 렌더)
      const w = (weakness || '').trim()
      const title = '📊 학생 글 분석 결과가 나왔어요'
      const intro = w
        ? `지난 글에서는 '${w}' 부분이 조금 아쉬웠어요. 오늘은 학생들에게 이 문장으로 지도해 주세요.`
        : `학생 글 분석이 끝났어요. 오늘은 학생들에게 이 문장으로 지도해 주세요.`
      const body = `${intro}\n"${line}"`

      // 캐시 저장 (본인 학급 update, RLS 허용)
      await supabase.from('classes').update({
        morning_briefing_text: body,
        morning_briefing_source_topic_id: sourceTopic.id,
      }).eq('id', classId)

      // 종 알림 (비차단)
      try {
        await supabase.rpc('create_notification', {
          p_recipient: profile.id,
          p_type: 'briefing',
          p_title: title,
          p_body: body,
          p_link: '/teacher/topics',
        })
      } catch (e) { console.warn('브리핑 알림 실패(무시):', e?.message) }
    } catch (e) {
      console.warn('브리핑 생성 실패(무시):', e?.message)
    }
  }

  // 🆕 다음 걸음 카드 판정 — 교사의 막힌 지점(학생 0명·주제 0개·수업 0회·후기 대상)에 맞는 카드 1장.
  //   card_type별 평생 1회(onboarding_responses에 행 있으면 재노출 안 함). 비차단, 실패는 조용히.
  //   쿼리: 응답 이력 1회 + (주제 있을 때만) 주제 id·제출 소량 2회.
  const maybeShowNextStepCard = async (profile, { students, topics }) => {
    try {
      const { data: resp, error } = await supabase.from('onboarding_responses')
        .select('card_type').eq('teacher_id', profile.id)
      if (error) return  // 테이블 미생성 등 — 카드 자체를 포기
      const answered = new Set((resp || []).map(r => r.card_type))
      if (answered.size >= 4) return

      let type = null
      if (topics === 0) {
        // 주제 0개면 review/no_class_run 불가능 — 추가 쿼리 없이 판정
        type = students === 0 ? 'no_students' : 'no_topics'
      } else {
        const { data: tps } = await supabase.from('topics')
          .select('id').eq('teacher_id', profile.id).limit(100)
        const ids = (tps || []).map(t => t.id)
        if (ids.length === 0) return
        const { data: subs } = await supabase.from('submissions')
          .select('topic_id, total_score').in('topic_id', ids)
          .is('deleted_at', null).limit(1000)
        const gradedTopics = new Set((subs || []).filter(x => x.total_score != null).map(x => x.topic_id))
        if (gradedTopics.size >= 3) type = 'review'                    // 채점완료 주제 3개 이상 → 후기
        else if (students === 0) type = 'no_students'
        else if ((subs || []).length === 0) type = 'no_class_run'
        // 그 외(수업 1~2회)는 카드 없음
      }
      if (type && !answered.has(type)) setNextStepCard(type)
    } catch (e) {
      console.warn('다음 걸음 카드 판정 실패(무시):', e?.message)
    }
  }

  // 🆕 다음 걸음 모달(막힌 3종) ESC 닫기 — ✕·오버레이 클릭과 동일하게 dismissed 기록
  useEffect(() => {
    if (!nextStepCard || nextStepCard === 'review') return
    const onKey = (e) => { if (e.key === 'Escape') recordOnboarding(nextStepCard, 'dismissed') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nextStepCard])

  // 다음 걸음 카드 응답 기록 — 한 번의 insert(RLS가 update 차단이라 저장은 1회로 끝). 실패해도 카드만 숨김.
  //   keepOpen: review good 경로처럼 카드를 유지한 채 기록만 할 때 true(닫기는 호출부 책임).
  const recordOnboarding = async (cardType, response, comment, keepOpen = false) => {
    if (!keepOpen) setNextStepCard(null)
    try {
      assertWritable()
      await supabase.from('onboarding_responses').insert({
        teacher_id: user?.id, card_type: cardType, response, comment: comment || null,
      })
    } catch (e) {
      console.warn('온보딩 응답 저장 실패(무시):', e?.message)
    }
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

    // 🆕 step453: 초기화된 계정은 닫기 불가 설정 모달(새 비번+이메일) 우선 — step161 모달과 배타
    if (profile.must_setup_at && !imp) {
      setMustSetup(true)
    } else if (profile.must_change_password && !imp) {
      // 🆕 step161: 비번 초기화된 계정이면 변경 모달 자동 노출 (임퍼소네이션 중엔 제외)
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
      // 🆕 다음 걸음 카드 — 본인 세션(비임퍼소네이션)에서만, 비차단(await 안 함). API키 불필요.
      if (!imp) maybeShowNextStepCard(profile, { students: s?.count || 0, topics: t?.count || 0 })
      // 신고된 제출물 수 (우리 학급 학생들의 것만, 숨김 제외)
      let reportCount = 0
      // 오늘 API 호출 추정량 (오늘 제출 수 × 2)
      let todayApiCalls = 0
      let todaySubmissions = 0  // 🆕 step315: 오늘 제출 수(새 쿼리 없이 subCount 재사용)
      try {
        const { data: studentIds } = await supabase.from('profiles')
          .select('id').eq('class_id', profile.classes.id).eq('role', 'student')
          .or('is_hidden.is.null,is_hidden.eq.false')

        // 🆕 셋업 체크리스트용 학생 수
        setStudentCountTotal(studentIds?.length || 0)

        // 🆕 step280: 맛보기(샘플 피드백) 노출 판정
        //   임퍼소네이션 아님 + 안 닫음 + 아직 실제 AI 피드백 0건(feedback_overall 존재하는 제출 없음)
        if (!imp) {
          const tasteDismissed = typeof window !== 'undefined' &&
            localStorage.getItem('lc-taste-feedback-dismissed:' + profile.id) === '1'
          if (tasteDismissed) {
            setShowTaste(false)
          } else {
            let seenFeedback = false
            try {
              if (studentIds && studentIds.length > 0) {
                // 존재 여부만 — limit 1, 무거운 집계 금지
                const { data: fbRow } = await supabase.from('submissions')
                  .select('id')
                  .in('user_id', studentIds.map(x => x.id))
                  .not('feedback_overall', 'is', null)
                  .is('deleted_at', null)
                  .limit(1)
                seenFeedback = !!(fbRow && fbRow.length > 0)
              }
            } catch { seenFeedback = false }
            setShowTaste(!seenFeedback)
          }
        } else {
          setShowTaste(false)
        }

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
          // 🆕 교사 아침 브리핑: 본인 세션(비임퍼소네이션)+키 있을 때만 lazy 생성(비차단, await 안 함)
          if (!imp && !!keyCheck) maybeGenerateBriefing(profile)
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
          // 각 제출 = 채점(1) + 예시 생성(1) = 약 2회 호출 (Gemini 한도 추정 — PT 자정 기준 유지)
          todayApiCalls = (subCount || 0) * 2
          // 🆕 step319: 카드용 "오늘 제출 수"는 한국(KST) 자정 기준으로 따로 카운트
          const kstNow = new Date(Date.now() + 9 * 3600 * 1000)
          const kstMidnightUtc = new Date(kstNow.toISOString().slice(0, 10) + 'T00:00:00+09:00').toISOString()
          const { count: kstSubCount } = await supabase.from('submissions')
            .select('id', { count: 'exact', head: true })
            .in('user_id', ids)
            .gte('created_at', kstMidnightUtc)
            .is('deleted_at', null)
          todaySubmissions = kstSubCount || 0
        }
      } catch(e) { /* 컬럼 없으면 무시 */ }
      setStats({ students: s.count || 0, topics: t.count || 0, reports: reportCount, todayApiCalls, todaySubmissions })
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

  // 🆕 step315: 신규/정착 판정 (SetupChecklist 5단계 done 조건과 동일)
  const setupDone =
    !!classInfo &&
    hasApiKey &&
    studentCountTotal > 0 &&
    topicCount > 0 &&
    !!(classInfo?.login_hint_enabled && classInfo?.login_username_prefix)

  // 🆕 step335: 순서 재배치용 — 심의/동의 배너·메뉴 grid만 const로 추출(내부 로직·props 불변). setupDone에 따라 위치만 다름.
  const bannersBlock = (
    <div className="grid sm:grid-cols-2 gap-3">
      {/* ① 학교운영위 심의 */}
      <div className="group relative bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <button type="button" onClick={() => setOpenGuide(openGuide === 'simui' ? null : 'simui')}
          className="w-full text-left flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-gray-800">🏛️ 학교운영위원회 심의가 궁금하신가요?</span>
          <span className="text-xs text-gray-400 flex-shrink-0">{openGuide === 'simui' ? '▲' : 'ⓘ'}</span>
        </button>
        <div className={`${openGuide === 'simui' ? 'block' : 'hidden'} sm:group-hover:block mt-2 text-xs text-gray-600 leading-relaxed`}>
          학급에서 선생님 재량으로 쓰는 건 심의 대상이 아니에요. 학교운영위원회 심의는 학교가 이 도구를 정규 교육과정 교재로 공식 채택할 때만 해당돼요. 다만 학교마다 기준이 조금 다를 수 있으니, 걱정되면 소속 학교에 한번 확인해 보세요.
        </div>
      </div>
      {/* ② 학부모 동의 (+ 액션 2개) */}
      <div className="group relative bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <button type="button" onClick={() => setOpenGuide(openGuide === 'consent' ? null : 'consent')}
          className="w-full text-left flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-gray-800">👨‍👩‍👧 학부모 동의가 궁금하신가요?</span>
          <span className="text-xs text-gray-400 flex-shrink-0">{openGuide === 'consent' ? '▲' : 'ⓘ'}</span>
        </button>
        <div className={`${openGuide === 'consent' ? 'block' : 'hidden'} sm:group-hover:block mt-2 text-xs text-gray-600 leading-relaxed space-y-2`}>
          <p>학부모 동의는 선택이에요. 안 받으셔도 모든 기능을 그대로 쓸 수 있어요. 다만 학생 실명을 쓰시려면 동의가 필요한데, 만 14세 미만은 개인정보보호법 때문이에요. 동의 전까지는 닉네임으로 운영되고, 동의를 받으면 실명으로 바뀌어요. 학급 명렬표(나이스)로 등록하는 것도 안전해요. 실명은 선생님 화면에만 보이고 외부로 나가지 않아요.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={withImpersonation("/teacher/students?mode=register")} className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg font-medium hover:bg-primary-dark">📋 학생 등록하러 가기</Link>
            <Link href={withImpersonation("/teacher/students/consent")} className="text-xs bg-white border border-primary text-primary px-3 py-1.5 rounded-lg font-medium hover:bg-primary-light">✍️ 학부모 온라인 동의서 받기</Link>
          </div>
        </div>
      </div>
    </div>
  )

  const menuGrid = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      <Link href={withImpersonation("/teacher/topics")} className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">📚</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">주제 관리</h3>
          <p className="text-xs text-gray-500">오늘의 글쓰기 주제 등록</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/students")} className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">👥</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">학생 관리</h3>
          <p className="text-xs text-gray-500">학급 명렬표 일괄 등록 · 학부모 동의 관리</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/status")} className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">📋</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">제출 현황</h3>
          <p className="text-xs text-gray-500">오늘 누가 냈는지 한눈에</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/submissions")} className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">📝</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">학생 글 보기</h3>
          <p className="text-xs text-gray-500">주제별 학생 글 + 피드백</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/student-growth")} className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">📊</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">학생 성장 그래프</h3>
          <p className="text-xs text-gray-500">학급/학생별 점수 추이</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/ranking")} className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">🏆</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">우리 반 랭킹</h3>
          <p className="text-xs text-gray-500">평균 점수·제출 수·성장도 순위</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/record")} className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">📝</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">생기부 평어 도우미</h3>
          <p className="text-xs text-gray-500">학생 글 기반 평어 초안 생성</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/feedback-reports")} className={`lg:hidden bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border ${
        stats.reports > 0 ? 'border-amber-300 ring-2 ring-amber-200' : 'border-gray-100'
      } relative flex items-center gap-3`}>
        <div className="text-2xl flex-shrink-0">🚨</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">피드백 신고함
            {stats.reports > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                {stats.reports}
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500">학생이 신고한 AI 피드백</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/grammar-backfill")} className="lg:hidden bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">📝</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">맞춤법 일괄 적용</h3>
          <p className="text-xs text-gray-500">과거 글에 빨간 밑줄 추가</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/trash")} className="lg:hidden bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">🗑️</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">쓰레기통</h3>
          <p className="text-xs text-gray-500">삭제한 글 복원 / 영구 삭제</p>
        </div>
      </Link>
      <Link href={withImpersonation("/teacher/help")} className="lg:hidden bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition border border-gray-100 flex items-center gap-3">
        <div className="text-2xl flex-shrink-0">📖</div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm">도움말 / FAQ</h3>
          <p className="text-xs text-gray-500">사용 방법 + 문제 해결</p>
        </div>
      </Link>
    </div>
  )

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

          {/* 🆕 다음 걸음 카드(review만 인라인 배너 — '부탁'이라 모달 반감 방지. 막힌 3종은 하단 모달)
              good 응답 후엔 같은 자리에서 사전 신청 이어묻기(reviewFollowup) — 만족 직후가 최적 타이밍 */}
          {!isImpersonating && nextStepCard === 'review' && (
            <div className="relative bg-white border-2 border-indigo-200 rounded-2xl p-5">
              {reviewFollowup === 'thanks' ? (
                <p className="text-sm font-semibold text-indigo-900">🙏 감사해요! 준비되면 가장 먼저 안내드릴게요.</p>
              ) : reviewFollowup === 'ask' ? (
                <>
                  {/* 후속만 건너뛰는 ✕ — review 기록은 이미 저장돼 재노출 없음, preorders 기록 없음 */}
                  <button onClick={() => setNextStepCard(null)} aria-label="닫기"
                    className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 transition text-lg leading-none">✕</button>
                  <h3 className="font-bold text-indigo-900 pr-6">좋게 봐주셔서 감사해요! 🎟 정식 출시 전 사전 신청도 관심 있으세요?</h3>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {[['interested', '관심 있어요'], ['not_sure', '아직 잘 모르겠어요']].map(([v, label]) => (
                      <button key={v} disabled={preorderSaving}
                        onClick={async () => {
                          await submitPreorder(v)
                          setReviewFollowup('thanks')
                          setTimeout(() => setNextStepCard(null), 2500)
                        }}
                        className={`text-sm px-3.5 py-2 rounded-xl font-semibold transition disabled:opacity-50 ${v === 'interested'
                          ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : 'border-2 border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <button onClick={() => recordOnboarding('review', 'dismissed')} aria-label="닫기"
                    className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 transition text-lg leading-none">✕</button>
                  <h3 className="font-bold text-indigo-900 pr-6">💬 다온클래스, 써보니 어떠세요?</h3>
                  <p className="text-sm text-gray-600 mt-1">벌써 여러 번 수업하셨어요. 선생님 의견이 큰 힘이 돼요.</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {[['good', '😀 좋아요'], ['soso', '🙂 보통이에요'], ['bad', '😐 아쉬워요']].map(([v, label]) => (
                      <button key={v} onClick={() => setReviewPick(v)}
                        className={`text-sm px-3.5 py-2 rounded-xl border-2 transition ${reviewPick === v
                          ? 'border-indigo-400 bg-indigo-50 font-semibold'
                          : 'border-gray-200 hover:bg-gray-50'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {reviewPick && (
                    <div className="flex gap-2 mt-3">
                      <input type="text" value={reviewComment} onChange={e => setReviewComment(e.target.value)}
                        placeholder="한 줄 의견 (선택)" maxLength={200}
                        className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2" />
                      <button onClick={() => {
                          const comment = reviewComment.trim()
                          if (reviewPick === 'good') {
                            recordOnboarding('review', 'good', comment, true)   // 카드 유지한 채 기록
                            if (preorder.loaded && preorder.done) {             // 이미 사전신청 응답함 → 감사만
                              setReviewFollowup('thanks')
                              setTimeout(() => setNextStepCard(null), 2500)
                            } else {
                              setReviewFollowup('ask')                          // 사전신청 이어묻기
                            }
                          } else {
                            recordOnboarding('review', reviewPick, comment)     // soso/bad: 후속 없이 닫힘
                          }
                        }}
                        className="text-sm bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition shrink-0">
                        보내기
                      </button>
                    </div>
                  )}
                  {reviewPick && (
                    <p className="text-[11px] text-gray-400 mt-1.5">남겨주신 소감은 학교·성함을 가린 익명으로 서비스 소개에 인용될 수 있어요</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* 심의/동의 배너 (원래 위치: 학급 카드 위, 항상 표시) */}
          {bannersBlock}

          {/* 🆕 step386: 복구용 이메일 등록 배너 (합성 이메일 교사에게만, 등록 기능은 내 정보 수정에) */}
          {/* 🆕 step453: 강제 모달 대상(must_setup_at)은 배너 생략(중복 방지). 닫기=7일 뒤 재노출 */}
          {user?.role === 'teacher' && !isImpersonating && recoveryEmailMissing && !recoveryBannerHidden && !mustSetup && (
            <div className="relative bg-blue-50 border border-blue-200 rounded-2xl p-4">
              <button onClick={dismissRecoveryBanner} aria-label="닫기"
                className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 transition text-lg leading-none">✕</button>
              <p className="text-sm text-blue-900 break-keep pr-6 mb-2">
                📧 이메일을 등록하면 비밀번호를 잊어도 스스로 바로 재설정할 수 있어요.
              </p>
              <button onClick={() => setShowProfileModal(true)}
                className="bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-blue-700 transition">
                1분 만에 등록하기
              </button>
            </div>
          )}

          {/* 🆕 step380: 파운딩 멤버 사전 신청 카드 — 🆕 step382: 가격 없는 관심 등록 + 2버튼 응답 */}
          {user?.role === 'teacher' && preorder.loaded && !preorderHidden && (
            <div className="relative bg-white border-2 border-indigo-200 rounded-2xl p-5">
              <button onClick={dismissPreorder} aria-label="닫기"
                className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 transition text-lg leading-none">✕</button>
              {preorder.done ? (
                <h3 className="font-bold text-indigo-900 pr-6">
                  {preorder.response === 'not_sure'
                    ? '💬 알려주셔서 고마워요. 더 좋아진 모습으로 다시 안내드릴게요'
                    : '✅ 등록 완료! 준비되면 가장 먼저 안내드릴게요'}
                </h3>
              ) : (
                <>
                  <h3 className="font-bold text-indigo-900 mb-1 pr-6">2학기, 다온클래스 유료 플랜을 준비하고 있어요</h3>
                  <p className="text-sm text-gray-700 leading-relaxed break-keep mb-3">
                    다온클래스를 안정적으로 오래 운영하기 위해 2학기부터 유료 플랜을 준비 중이에요.
                    미리 신청해 주시는 선생님께는 가장 좋은 조건(파운딩 멤버 혜택)으로 먼저 안내드려요.
                    결제가 아니라 관심 등록이에요.
                  </p>
                  {!isImpersonating && (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => submitPreorder('interested')} disabled={preorderSaving}
                        className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition disabled:opacity-50">
                        {preorderSaving ? '처리 중...' : '관심 있어요'}
                      </button>
                      <button onClick={() => submitPreorder('not_sure')} disabled={preorderSaving}
                        className="bg-gray-100 text-gray-700 text-sm font-semibold px-4 py-2 rounded-xl hover:bg-gray-200 transition disabled:opacity-50">
                        아직 잘 모르겠어요
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

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
              {/* 🆕 step345: 학년 미설정 유도 — 학년 평균 비교(성장 그래프)를 보려면 학년 필요 */}
              {!classInfo.grade && (
                <button onClick={() => togglePanel('settings')}
                  className="mt-3 w-full text-left text-xs text-primary-dark bg-white/60 hover:bg-white rounded-lg px-3 py-2">
                  🎓 학년을 설정하면 학년 평균 비교를 볼 수 있어요. <span className="underline font-medium">학급 설정에서 입력</span>
                </button>
              )}
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

          {/* 🆕 step315: 정착 교사용 오늘 현황 카드 (신규 쿼리 없이 stats 재사용) */}
          {setupDone && (
            <div className="bg-white border-2 border-primary rounded-2xl p-5">
              <div className="text-xs text-primary-dark font-semibold mb-1">📅 오늘 우리 반</div>
              {stats.todaySubmissions === 0 ? (
                <p className="text-sm text-gray-700 mt-1">아직 오늘 제출이 없어요. 학생들에게 오늘 주제를 안내해 보세요.</p>
              ) : (
                <p className="text-base font-bold text-gray-900 mt-1">오늘 {stats.todaySubmissions}건 제출 · 학생 {stats.students}명</p>
              )}
              {stats.reports > 0 && (
                <p className="text-sm font-semibold text-rose-600 mt-2">🚨 신고된 피드백 {stats.reports}건 확인이 필요해요</p>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                <Link href={withImpersonation('/teacher/status')} className="text-sm bg-primary text-white px-3 py-1.5 rounded-lg font-medium hover:bg-primary-dark">제출 현황 보기</Link>
                <Link href={withImpersonation('/teacher/submissions')} className="text-sm bg-white border border-primary text-primary px-3 py-1.5 rounded-lg font-medium hover:bg-primary-light">학생 글 보기</Link>
                {stats.todaySubmissions === 0 && (
                  <Link href={withImpersonation('/teacher/topics')} className="text-sm bg-white border border-primary text-primary px-3 py-1.5 rounded-lg font-medium hover:bg-primary-light">주제 관리</Link>
                )}
              </div>
            </div>
          )}

          {/* 🆕 첫 셋업 체크리스트 (신규 선생님 안내 — 정착이면 숨김) */}
          {!isImpersonating && !setupDone && (
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

          {/* 🆕 step280: 신규 교사용 맛보기 — 실제 피드백을 한 번도 못 본 교사에게만(설정 전 가치 체감) */}
          {/* step281: 점선 프레임 + "예시" 뱃지로 실제 데이터 카드와 시각적으로 명확히 구분 */}
          {!isImpersonating && showTaste && (
            <div className="rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50/60 p-3 sm:p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs font-bold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
                  👀 예시 미리보기
                </span>
                <button onClick={dismissTaste}
                  className="text-xs text-gray-500 hover:bg-white/70 px-2 py-1 rounded flex-shrink-0">
                  ✖ 닫기
                </button>
              </div>
              <p className="text-xs text-violet-800/80">학생이 글을 쓰면 이런 피드백이 자동으로 달려요. (아래는 예시예요)</p>
              <StudentFeedbackCard
                sub={SAMPLE_TASTE.sub}
                topic={SAMPLE_TASTE.topic}
                headerLabel="📋 맛보기 — AI가 이렇게 채점·피드백해요"
              />
            </div>
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

          {/* 🆕 step290: 보조 패널 묶음 — <lg 인라인(현행 유지) / lg+ 우측 드로어(툴바로 열기) */}
          {/* step291: <lg 인라인(3개 다 보임) / lg+ 드로어(activePanel 1개만 보임). 단일 마운트, 가시성만 CSS 제어 */}
          <aside className={`space-y-5 lg:fixed lg:top-0 lg:right-0 lg:h-screen lg:w-[420px] lg:max-w-[90vw] lg:bg-white lg:shadow-xl lg:overflow-y-auto lg:z-40 lg:p-5 lg:space-y-4 lg:transition-transform ${activePanel ? 'lg:translate-x-0' : 'lg:translate-x-full'}`}>
            {/* 드로어 헤더(데스크탑만) */}
            <div className="hidden lg:flex items-center justify-between">
              <span className="text-sm font-bold text-gray-700">
                {activePanel === 'api' ? '🔑 Gemini 키' : activePanel === 'settings' ? '⚙️ 학급 설정' : '📋 학생 로그인 안내'}
              </span>
              <button onClick={() => setActivePanel(null)}
                className="text-gray-500 hover:bg-gray-100 rounded p-1 text-sm">✖ 닫기</button>
            </div>

            {/* 🆕 학생 로그인 안내 카드 (와이프 피드백: 학생이 "선생님 아이디 뭐예요?" 안 물어보게) */}
            {classInfo && (
              <div ref={loginHintRef} className={`rounded-2xl transition-all relative ${activePanel === 'login' ? 'lg:block' : 'lg:hidden'}`}>
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
              <div ref={apiKeyRef} className={`rounded-2xl transition-all relative ${activePanel === 'api' ? 'lg:block' : 'lg:hidden'}`}>
                {guideTarget === 'api' && <div className="guide-pointer">👇</div>}
                <ApiKeyManager classId={classInfo?.id} openSignal={apiOpenSignal} />
              </div>
            )}

            {/* 학급 설정 (랭킹/게시판) */}
            {classInfo && !isImpersonating && (
              <div ref={settingsRef} className={`rounded-2xl transition-all relative ${activePanel === 'settings' ? 'lg:block' : 'lg:hidden'}`}>
                <ClassSettings classInfo={classInfo} onUpdate={checkAuth} />
              </div>
            )}
          </aside>

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
                        ? `한도에 가까워졌어요. 자정(한국 시간 ${getKoreanResetTime()})에 자동으로 리셋돼요.`
                        : '사용량이 많아지고 있어요. 자정에 리셋되니 너무 걱정 마세요.'}
                    </p>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* 메뉴 (원래 위치: 페이지 하단, 항상 표시) */}
          {menuGrid}

          {/* 🆕 step380: 사전 신청 카드 재진입 링크 — 닫은 경우에만 하단 한 줄 (과한 노출 없음) */}
          {user?.role === 'teacher' && preorder.loaded && preorderHidden && (
            <div className="text-center">
              <button onClick={reopenPreorder}
                className="text-xs text-gray-400 hover:text-gray-600 underline transition">
                파운딩 멤버 사전 신청 안내 다시 보기
              </button>
            </div>
          )}
        </main>

        {/* 🆕 step291: 우측 세로 툴바 (데스크탑 lg+ 전용) — 아이콘+라벨. 모바일은 위 인라인 패널/메뉴 유지 */}
        <div className="hidden lg:flex flex-col gap-1.5 fixed right-3 top-1/2 -translate-y-1/2 z-30">
          {!isImpersonating && (
            <button onClick={() => togglePanel('api')} title="Gemini 키 등록·관리"
              className={`w-24 py-1.5 rounded-xl bg-white shadow-md border hover:bg-gray-50 flex flex-col items-center gap-0.5 ${activePanel === 'api' ? 'border-primary ring-2 ring-primary/30' : 'border-gray-200'}`}>
              <span className="text-lg leading-none">🔑</span><span className="text-[10px] text-gray-600 text-center leading-tight">API 키 관리</span>
            </button>
          )}
          <button onClick={() => togglePanel('login')} title="학생 로그인 안내"
            className={`w-24 py-1.5 rounded-xl bg-white shadow-md border hover:bg-gray-50 flex flex-col items-center gap-0.5 ${activePanel === 'login' ? 'border-primary ring-2 ring-primary/30' : 'border-gray-200'}`}>
            <span className="text-lg leading-none">📋</span><span className="text-[10px] text-gray-600 text-center leading-tight">학생 로그인 안내</span>
          </button>
          {!isImpersonating && (
            <button onClick={() => togglePanel('settings')} title="학급 설정"
              className={`w-24 py-1.5 rounded-xl bg-white shadow-md border hover:bg-gray-50 flex flex-col items-center gap-0.5 ${activePanel === 'settings' ? 'border-primary ring-2 ring-primary/30' : 'border-gray-200'}`}>
              <span className="text-lg leading-none">⚙️</span><span className="text-[10px] text-gray-600 text-center leading-tight">학급 설정</span>
            </button>
          )}
          <Link href={withImpersonation("/teacher/feedback-reports")} title="피드백 신고함"
            className="relative w-24 py-1.5 rounded-xl bg-white shadow-md border border-gray-200 hover:bg-gray-50 flex flex-col items-center gap-0.5">
            <span className="text-lg leading-none">🚨</span><span className="text-[10px] text-gray-600 text-center leading-tight">오류 신고함</span>
            {stats.reports > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{stats.reports}</span>
            )}
          </Link>
          <Link href={withImpersonation("/teacher/grammar-backfill")} title="맞춤법 일괄 적용"
            className="w-24 py-1.5 rounded-xl bg-white shadow-md border border-gray-200 hover:bg-gray-50 flex flex-col items-center gap-0.5">
            <span className="text-lg leading-none">📝</span><span className="text-[10px] text-gray-600 text-center leading-tight">맞춤법 일괄 검사</span>
          </Link>
          <Link href={withImpersonation("/teacher/trash")} title="쓰레기통"
            className="w-24 py-1.5 rounded-xl bg-white shadow-md border border-gray-200 hover:bg-gray-50 flex flex-col items-center gap-0.5">
            <span className="text-lg leading-none">🗑️</span><span className="text-[10px] text-gray-600 text-center leading-tight">삭제된 글 확인</span>
          </Link>
          <Link href={withImpersonation("/teacher/help")} title="도움말 / FAQ"
            className="w-24 py-1.5 rounded-xl bg-white shadow-md border border-gray-200 hover:bg-gray-50 flex flex-col items-center gap-0.5">
            <span className="text-lg leading-none">📖</span><span className="text-[10px] text-gray-600 text-center leading-tight">도움말</span>
          </Link>
        </div>
        {/* 드로어 오버레이 (데스크탑만) */}
        {activePanel && <div className="hidden lg:block fixed inset-0 bg-black/30 z-30" onClick={() => setActivePanel(null)} />}

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

        {/* 🆕 step453: 비번 초기화 후 강제 설정 모달 — 닫기 불가(✕·배경 클릭·ESC 없음). 완료해야 해제 */}
        {mustSetup && !isImpersonating && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full">
              <h3 className="text-lg font-bold mb-2">🔐 새 비밀번호와 이메일을 설정해주세요</h3>
              <p className="text-sm text-gray-600 break-keep mb-4">
                임시 비밀번호로 로그인하셨어요. 새 비밀번호를 정하고, 다음부터 스스로 재설정할 수 있게 이메일을 등록해 주세요.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">새 비밀번호</label>
                  <PasswordInput value={setupPw} onChange={e => setSetupPw(e.target.value)}
                    placeholder="6자 이상" autoComplete="new-password"
                    className="w-full p-3 border border-gray-200 rounded-lg" />
                  {setupPw && (setupPw.length >= 6
                    ? <p className="text-xs text-green-600 mt-1">✓ 6자 이상</p>
                    : <p className="text-xs text-gray-400 mt-1">6자 이상 입력해주세요</p>)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">새 비밀번호 확인</label>
                  <PasswordInput value={setupPw2} onChange={e => setSetupPw2(e.target.value)}
                    autoComplete="new-password"
                    className="w-full p-3 border border-gray-200 rounded-lg" />
                  {setupPw2 && (setupPw2 === setupPw
                    ? <p className="text-xs text-green-600 mt-1">✓ 새 비밀번호와 일치해요</p>
                    : <p className="text-xs text-red-600 mt-1">새 비밀번호가 일치하지 않아요</p>)}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">이메일</label>
                  {hasRealEmail ? (
                    <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">등록됨 ✓ 새 비밀번호만 정하면 돼요</p>
                  ) : (
                    <input type="email" value={setupEmail} onChange={e => setSetupEmail(e.target.value)}
                      placeholder="예: kim@naver.com" autoComplete="email"
                      className="w-full p-3 border border-gray-200 rounded-lg" />
                  )}
                </div>
                {setupError && <div className="text-sm text-red-600 bg-red-50 p-2 rounded whitespace-pre-wrap">{setupError}</div>}
                <button onClick={submitSetup} disabled={setupSaving}
                  className="w-full py-2.5 bg-primary text-white rounded-xl font-semibold text-sm disabled:opacity-50">
                  {setupSaving ? '저장 중...' : '설정 완료'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 🆕 다음 걸음 모달 — 막힌 분기 3종(no_students·no_topics·no_class_run). '도움'이라 모달 정당(수업 0회라 방해할 작업 없음).
            ✕·오버레이 클릭·ESC 모두 dismissed 기록(평생 1회). review는 위 인라인 배너. 패턴=PasswordChangeModal */}
        {!isImpersonating && nextStepCard && nextStepCard !== 'review' && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
            onClick={() => recordOnboarding(nextStepCard, 'dismissed')}>
            <div className="relative bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <button onClick={() => recordOnboarding(nextStepCard, 'dismissed')} aria-label="닫기"
                className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 transition text-lg leading-none">✕</button>

              {nextStepCard === 'no_students' && (
                <div>
                  <h3 className="font-bold text-indigo-900 pr-6">🙋 학생 등록에서 멈추셨네요. 뭐가 걸리세요?</h3>
                  <p className="text-sm text-gray-600 mt-1">알려주시면 그 부분부터 쉽게 만들게요.</p>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {[['roster_hassle', '명렬표 입력이 번거로워요'], ['consent_burden', '학부모 동의가 부담돼요'], ['just_looking', '아직 둘러보는 중이에요']].map(([v, label]) => (
                      <button key={v} onClick={() => recordOnboarding('no_students', v)}
                        className="text-sm px-3.5 py-2 rounded-xl border-2 border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 transition">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {nextStepCard === 'no_topics' && (
                <div>
                  <h3 className="font-bold text-indigo-900 pr-6">✏️ 무슨 주제로 시작할지 고민되시죠?</h3>
                  <p className="text-sm text-gray-600 mt-1">다른 선생님들이 검증한 추천 주제로 1분 만에 등록할 수 있어요.</p>
                  <button onClick={() => { recordOnboarding('no_topics', 'clicked'); router.push('/teacher/topics') }}
                    className="mt-3 text-sm bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition">
                    ✨ 추천 주제로 바로 시작하기
                  </button>
                </div>
              )}

              {nextStepCard === 'no_class_run' && (
                <div>
                  <h3 className="font-bold text-indigo-900 pr-6">🕐 언제 쓰면 좋을지 고민되시죠?</h3>
                  <div className="text-sm text-gray-600 mt-2 space-y-1">
                    <p>🌅 아침 활동: 주 1~2회, 등교 후 10분 글쓰기 루틴으로</p>
                    <p>📖 수업 시간: 국어·도덕 글쓰기 활동을 공책 대신 여기서</p>
                  </div>
                  <p className="text-sm text-gray-600 mt-2">검사는 AI가 먼저 해두니, 선생님은 확인만 하시면 돼요.</p>
                  <button onClick={() => { recordOnboarding('no_class_run', 'clicked'); scrollToLoginHint() }}
                    className="mt-3 text-sm bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition">
                    📄 학생 로그인 안내 보기
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
