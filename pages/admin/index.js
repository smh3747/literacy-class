import Head from 'next/head'
import React, { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import StudentFeedbackCard from '../../components/StudentFeedbackCard'
import { toKST, toKSTDate } from '../../lib/timeFormat'
import { callAI } from '../../lib/aiClient'
import { displayStudentName, displayStudentNameWithNumber } from '../../lib/displayName'

// 🆕 교사 활동 단계 분류 기준(일) — 방학엔 조정 예정. 이미 로드된 데이터의 파생 계산만(DB 무변경).
const ACTIVE_DAYS = 7
const COOLING_DAYS = 14
const STAGE_META = {
  active:  { emoji: '🟢', label: '활성',     desc: `최근 ${ACTIVE_DAYS}일 수업 사용`,                     badge: 'bg-green-100 text-green-700', ring: 'ring-green-400' },
  cooling: { emoji: '🟡', label: '식어감',   desc: `${ACTIVE_DAYS + 1}~${COOLING_DAYS}일 전 마지막 수업`, badge: 'bg-amber-100 text-amber-700', ring: 'ring-amber-400' },
  at_risk: { emoji: '🔴', label: '이탈 위험', desc: `${COOLING_DAYS}일 넘게 수업 없음`,                   badge: 'bg-red-100 text-red-700',     ring: 'ring-red-400' },
  dormant: { emoji: '⚪', label: '미정착',   desc: '학생 0명 또는 글 0건',                                badge: 'bg-gray-100 text-gray-600',   ring: 'ring-gray-400' },
}
// 교사 활동 단계: 마지막 글 활동(모든 학급 중 최근) 기준
const classifyTeacher = ({ totalStudents, totalSubs, lastActivity }) => {
  if (totalStudents === 0 || totalSubs === 0 || !lastActivity) return 'dormant'
  const d = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000)
  if (d <= ACTIVE_DAYS) return 'active'
  if (d <= COOLING_DAYS) return 'cooling'
  return 'at_risk'
}
// 🆕 step435: 접속 중 판정 — last_seen_at이 5분 이내(MessageBell 하트비트 주기와 동일 기준)
const ONLINE_MINUTES = 5
const isOnline = (lastSeenAt) => !!lastSeenAt && (Date.now() - new Date(lastSeenAt).getTime()) < ONLINE_MINUTES * 60 * 1000

// 진단 문구: 단계 × 로그인 신호 교차. 로그인 미로딩 시 교차 진단 생략(placeholder 정책 유지)
const diagnoseTeacher = (stage, { classCount, totalStudents, loginDays, lastLoginLoaded }) => {
  if (stage === 'at_risk') {
    if (!lastLoginLoaded) return null
    return (loginDays != null && loginDays <= 7) ? '로그인만 하고 수업 안 씀' : '발길 끊김'
  }
  if (stage === 'dormant') {
    if (classCount === 0) return null                  // 학급 자체가 없으면(관리자 계정 등) 진단 생략
    if (totalStudents === 0) return '학급만 만들고 멈춤'
    return '학생 등록 후 수업 안 함'                    // 학생 있고 글 0건
  }
  return null
}

// 🆕 다음 걸음 카드(교사 온보딩 설문) 응답 한글 라벨 — 사전 신청 탭 하단 섹션 표시용
const OB_CARD_LABELS = { review: '후기', no_students: '학생 등록', no_topics: '주제 시작', no_class_run: '첫 수업' }
const OB_RESP_LABELS = {
  good: '😀 좋아요', soso: '🙂 보통이에요', bad: '😐 아쉬워요',
  roster_hassle: '명렬표 번거로움', consent_burden: '동의 부담', just_looking: '둘러보는 중',
  clicked: '버튼 클릭', dismissed: '닫음 ✕',
}

// 🆕 step422: 캡쳐용 마스킹 라벨 — "경기 ○○초 신○○ 선생님" (렌더만, 저장 안 함)
//   학교는 시·도 접두 매칭 시 "지역 ○○초", 추출 불확실하면 "○○초등학교".
const REGION_PREFIXES = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주']
const maskTeacherLabel = (realname, school) => {
  const nm = (realname || '').trim()
  const maskedName = nm ? nm[0] + '○○' : '○○○'
  const sc = (school || '').trim()
  const region = REGION_PREFIXES.find(r => sc.startsWith(r))
  const schoolLabel = region ? `${region} ○○초` : '○○초등학교'
  return `${schoolLabel} ${maskedName} 선생님`
}

// 🆕 step422: 일괄 쪽지 {이름} 치환 미리보기 — 서버(api/admin-messages-bulk)와 동일 로직 유지
const fillName = (body, realname) => {
  const name = (typeof realname === 'string' && realname.trim()) ? realname.trim() : ''
  if (name) return body.replace(/\{이름\}/g, name)
  return body.replace(/\{이름\}\s*/g, '')
}

// 🆕 step371: 본문에서 original이 처음 등장하는 위치를 문장 단위(마침표·물음표·줄바꿈)로 잘라 반환.
//   경계가 없으면 그 방향만 앞뒤 40자로 clamp. before/match/after로 나눠 하이라이트에 쓴다. 표시 전용.
function extractContext(body, original) {
  if (!body || !original) return null
  const idx = body.indexOf(original)
  if (idx === -1) return null
  const isBoundary = (ch) => ch === '.' || ch === '?' || ch === '\n'
  const end0 = idx + original.length
  // 앞쪽 경계: idx 이전에서 가장 가까운 경계 다음 글자. 없으면 앞 40자.
  let start = -1
  for (let i = idx - 1; i >= 0; i--) { if (isBoundary(body[i])) { start = i + 1; break } }
  if (start === -1) start = Math.max(0, idx - 40)
  // 뒤쪽 경계: original 끝 이후 가장 가까운 경계까지 포함. 없으면 뒤 40자.
  let end = -1
  for (let i = end0; i < body.length; i++) { if (isBoundary(body[i])) { end = i + 1; break } }
  if (end === -1) end = Math.min(body.length, end0 + 40)
  return {
    before: body.slice(start, idx).replace(/^\s+/, ''),
    match: body.slice(idx, end0),
    after: body.slice(end0, end).replace(/\s+$/, ''),
  }
}

// 🆕 step371: 알림 1건의 맥락 상태 계산. 글 없음/삭제=gone, 본문에 original 없음=notfound, 찾음=ok(+before/match/after).
//   🆕 step398 후속: submission_id 없어도 차단 기록(C-2)이 저장해둔 blocked_essay_excerpt가 있으면 맥락으로 표시.
//   발췌 안에서 original을 찾으면 ok(하이라이트), 못 찾으면 excerpt(발췌 원문 그대로). 둘 다 없으면 skip.
function buildContext(a, subMap) {
  if (!a.submission_id) {
    const ex = a.blocked_essay_excerpt
    if (!ex) return { kind: 'skip' }
    const o = a.original == null ? '' : String(a.original)
    const t = String(ex)
    const i = o ? t.indexOf(o) : -1
    if (i === -1) return { kind: 'excerpt', text: t }
    return { kind: 'ok', before: t.slice(0, i), match: t.slice(i, i + o.length), after: t.slice(i + o.length) }
  }
  const sub = subMap[a.submission_id]
  if (!sub || sub.deleted_at) return { kind: 'gone' }
  const ctx = extractContext(sub.essay_text, a.original)
  if (!ctx) return { kind: 'notfound' }
  return { kind: 'ok', ...ctx }
}

// 🆕 step371: 알림 1건의 작성 학생 정보. submission→user→profile→class→담임 순으로 배치맵 조회.
//   🆕 step398 후속: submission 경로로 못 찾고 차단 기록의 blocked_user_id가 있으면 그걸로 폴백 조회.
//   이름은 displayStudentName(미동의=닉네임). 조회불가면 none. pending_names 미조회.
function buildStudent(a, subMap, profMap, classMap, teacherMap) {
  const sub = a.submission_id ? subMap[a.submission_id] : null
  let prof = sub && sub.user_id ? profMap[sub.user_id] : null
  if (!prof && a.blocked_user_id) prof = profMap[a.blocked_user_id] || null
  if (!prof) return { kind: 'none' }
  const name = displayStudentName(prof)
  const num = (prof.number != null && String(prof.number).trim() !== '') ? String(prof.number).trim() : ''
  const numName = num ? `${num}번 ${name}` : name
  const cls = prof.class_id ? classMap[prof.class_id] : null
  const teacher = cls && cls.teacher_id ? teacherMap[cls.teacher_id] : null
  return {
    kind: 'ok',
    school: teacher?.school || '',
    className: cls?.name || '',
    teacher: teacher?.realname || '',
    numName,
  }
}

export default function AdminHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState({ teachers: 0, classes: 0, students: 0, submissions: 0, today: 0, preorders: 0 })
  const [teachers, setTeachers] = useState([])
  const [teacherLastLogin, setTeacherLastLogin] = useState({})  // 🆕 step254: { userId: last_sign_in_at } (auth.users 읽기)
  const [lastLoginLoaded, setLastLoginLoaded] = useState(false)  // 🆕 step334: 마지막 로그인 비차단 로딩 완료 여부(로딩 중 placeholder)
  const [classes, setClasses] = useState([])
  const [trashedTeachers, setTrashedTeachers] = useState([])  // 🆕 휴지통 (B4)
  const [trashedClasses, setTrashedClasses] = useState([])
  const [sharedSuggestionLogs, setSharedSuggestionLogs] = useState([])  // 🆕 공유 추천 추적
  const [topicCopies, setTopicCopies] = useState([])  // 🆕 주제 공유 추적(누가 누구 주제를 가져갔나)
  const [resetRequests, setResetRequests] = useState([])  // 🆕 비밀번호 초기화 요청
  const [idLookups, setIdLookups] = useState({})  // 🆕 step161: 아이디 찾기 후보 { [reqId]: {loading, list} }
  const [selectedReqIds, setSelectedReqIds] = useState(new Set())  // 🆕 step162: 요청함 일괄 선택
  const [errorLogs, setErrorLogs] = useState([])  // 🆕 step155: 에러 로그 (최근 50건)
  const [errSeverity, setErrSeverity] = useState('all')  // 🆕 심각도: 'all' | 'action' | 'ignore'
  const [errType, setErrType] = useState('all')          // 🆕 종류: 'all' | error_type 값
  const [errView, setErrView] = useState('list')         // 🆕 보기: 'list' | 'byClass'
  const [logStudentNumbers, setLogStudentNumbers] = useState({})  // 🆕 에러로그 학생 번호 표시용 {user_id: number} (실명 미조회)
  const [suspectCount, setSuspectCount] = useState(0)      // 🆕 step359: 의심 교정 미해결 건수 (loadAll에서 count만)
  const [suspectAlerts, setSuspectAlerts] = useState([])   // 🆕 step359: 의심 교정 목록 (탭 열 때 로드)
  const [suspectLoaded, setSuspectLoaded] = useState(false)
  const [suspectError, setSuspectError] = useState(null)    // 🆕 step369: 목록 로드 실패 메시지 (조용한 소멸 방지)
  const [preorderList, setPreorderList] = useState({ loaded: false, rows: [], error: null })  // 🆕 step382: 사전 신청 명단 (탭 열 때 로드)
  const [onboardingRows, setOnboardingRows] = useState(null)  // 🆕 다음 걸음 카드 응답 (사전 신청 탭에서 함께 로드, null=미로드)
  const [reviewShowReal, setReviewShowReal] = useState(false) // 🆕 step423: 홍보용 리뷰 실명 병기 토글(기본 off, 렌더만)
  // 🆕 step422: 쪽지 탭 — msgs(전체 시간순)·status(처리됨)·profs(교사 배치 조인)
  const [msgData, setMsgData] = useState({ loaded: false, msgs: [], status: {}, profs: {} })
  const [msgSelected, setMsgSelected] = useState(null)   // 선택된 스레드 teacher_id
  const [msgReply, setMsgReply] = useState('')
  const [msgSending, setMsgSending] = useState(false)
  const [msgEditingId, setMsgEditingId] = useState(null)  // 🆕 step432: 인라인 수정 중인 쪽지 id
  const [msgEditDraft, setMsgEditDraft] = useState('')
  const [msgFilter, setMsgFilter] = useState('replied')  // replied(기본) | all | unresolved | unread — step428: 일괄 발송 250스레드 중 답장 온 것부터
  const [msgMasked, setMsgMasked] = useState(false)      // 캡쳐용 마스킹 모드(렌더만)
  const [bulkOpen, setBulkOpen] = useState(false)        // 일괄 쪽지 모달
  const [bulkStages, setBulkStages] = useState({ active: false, cooling: false, at_risk: false, dormant: false })
  const [bulkBody, setBulkBody] = useState('')
  const [bulkSending, setBulkSending] = useState(false)
  const [suspectMeta, setSuspectMeta] = useState({})        // 🆕 step371: { [alert.id]: { ctx, student } } 맥락 문장·작성 학생 정보 (표시 전용)
  const [suspectFilter, setSuspectFilter] = useState('전체') // 🆕 유형 필터 칩 — 클라이언트 표시 필터만(쿼리 불변)
  const [expandedTeacherId, setExpandedTeacherId] = useState(null)  // 🆕 선생님 펼침
  const [feedbacks, setFeedbacks] = useState([])
  const [showHiddenFeedback, setShowHiddenFeedback] = useState(false)
  const [showInactiveClasses, setShowInactiveClasses] = useState(false)  // 🆕 비활성 학급 표시 토글 (기본 OFF)
  const [classActivityFilter, setClassActivityFilter] = useState('all')  // 🆕 활동 상태: 'all' | 'active' | 'inactive' (보유값 기준)
  const [showBannedTeachers, setShowBannedTeachers] = useState(false)  // 🆕 차단 선생님 표시 토글 (기본 OFF)
  const [teacherSearch, setTeacherSearch] = useState('')  // 🆕 step249: 선생님 검색(이름·아이디·학교) — 클라 필터
  const [teacherStageFilter, setTeacherStageFilter] = useState(null)  // 🆕 활동 단계 카드 필터 (null=전체)
  const [teacherSort, setTeacherSort] = useState('recent')            // 🆕 recent|oldest_activity|students|subs
  const [classSearch, setClassSearch] = useState('')      // 🆕 step250: 학급 검색(학급명·담임·학교·코드) — 클라 필터
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState(new Set())
  const [replyDraft, setReplyDraft] = useState({})      // 🆕 피드백 답변 입력 { [id]: text }
  const [editingReply, setEditingReply] = useState(null) // 🆕 답변 수정 중인 피드백 id
  const [savingReplyId, setSavingReplyId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTabState] = useState('overview')

  // 탭을 URL 쿼리에 반영 (새로고침해도 유지)
  const setTab = (t) => {
    setTabState(t)
    router.replace({ pathname: router.pathname, query: { ...router.query, tab: t } }, undefined, { shallow: true })
  }

  // 첫 로드 시 URL의 tab 복원
  useEffect(() => {
    if (router.isReady && router.query.tab && router.query.tab !== tab) {
      setTabState(router.query.tab)
    }
  }, [router.isReady])

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', au.id).maybeSingle()
    if (!profile || profile.role !== 'admin') {
      alert('관리자만 접근 가능해요!')
      router.push('/teacher')
      return
    }
    setUser(profile)
    await loadAll()
    setLoading(false)
  }

  const loadAll = async () => {
    const today = new Date()
    // 🆕 '오늘' 경계 = KST 자정의 UTC 순간 (학생글 탭 'today' 필터 kstDayStartUTC와 동일 기준).
    //   기존엔 'KST날짜T00:00:00'(타임존 없음)이 UTC 자정으로 해석돼 KST 00~09시 글이 누락됐음.
    const kstYmd = new Date(today.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)  // KST 날짜
    const [ky, km, kd] = kstYmd.split('-').map(Number)
    const todayStartUTC = new Date(Date.UTC(ky, km - 1, kd) - 9 * 3600 * 1000).toISOString()

    const [teachersRes, classesRes, studentsRes, submissionsRes, todayRes, feedbackRes, preordersRes] = await Promise.all([
      supabase.from('profiles').select('*, classes:class_id(name, code)').in('role', ['teacher', 'admin']).order('created_at', { ascending: false }),
      supabase.from('classes').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').is('deleted_at', null),
      supabase.from('submissions').select('id', { count: 'exact', head: true }),
      supabase.from('submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayStartUTC),
      supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(200),
      // 🆕 step380: 파운딩 멤버 사전 신청 수 — head:true count 1건(병렬 배치 편승). 테이블 미생성이면 count 없음→0
      // 🆕 step382: interested(관심 있어요)만 카운트
      supabase.from('preorders').select('id', { count: 'exact', head: true }).eq('response', 'interested')
    ])

    if (classesRes.error) {
      console.error('학급 조회 실패:', classesRes.error)
    }

    // 학급별 담임 정보를 별도로 조회해서 매핑 (외래키 명시 안 함 - 더 안정적)
    const classes = classesRes.data || []
    // 🆕 step333: 학급별 통계는 admin_class_stats() RPC 한 번으로(기존 전량 수집·집계 루프 제거).
    //   반환: 학급별 student_count, submission_count, first_submission_count, last_activity_at, model_stats(jsonb).
    const classStatById = {}
    try {
      const { data: classStatRows, error: statErr } = await supabase.rpc('admin_class_stats')
      if (statErr) throw statErr
      ;(classStatRows || []).forEach(r => {
        const key = r.class_id ?? r.id      // 키 컬럼명 방어(class_id 우선, 없으면 id)
        if (key == null) return
        let ms = r.model_stats
        if (typeof ms === 'string') { try { ms = JSON.parse(ms) } catch { ms = null } }  // jsonb 문자열이면 파싱
        classStatById[key] = {
          student_count: r.student_count || 0,
          submission_count: r.submission_count || 0,
          first_submission_count: r.first_submission_count || 0,
          last_activity_at: r.last_activity_at || null,
          model_stats: (ms && typeof ms === 'object')
            ? { models: ms.models || {}, total: ms.total || 0, fallback: ms.fallback || 0 }
            : { models: {}, total: 0, fallback: 0 },
        }
      })
    } catch (e) { console.warn('admin_class_stats RPC 실패:', e?.message || e) }
    if (classes.length > 0) {
      const teacherIds = [...new Set(classes.map(c => c.teacher_id).filter(Boolean))]
      if (teacherIds.length > 0) {
        const { data: teacherProfiles } = await supabase.from('profiles')
          .select('id, realname, school').in('id', teacherIds)
        const tMap = {}
        ;(teacherProfiles || []).forEach(t => { tMap[t.id] = t })
        // classes에 담임 정보 붙이기
        classes.forEach(c => {
          if (c.teacher_id && tMap[c.teacher_id]) {
            c.teacher_profile = tMap[c.teacher_id]
          }
        })
      }
      // 🆕 step333: 학급별 학생 수 + 채점 모델 통계 (admin_class_stats RPC 결과 매핑 — 전 학급)
      classes.forEach(c => {
        const st = classStatById[c.id]
        c.student_count = st?.student_count || 0
        c.model_stats = st?.model_stats || { models: {}, total: 0, fallback: 0 }
      })
    }

    // 🆕 의견 작성자 정보 조회 (와이프 피드백 2번)
    let feedbacksWithAuthor = feedbackRes.data || []
    const feedbackUserIds = [...new Set(feedbacksWithAuthor.map(f => f.user_id).filter(Boolean))]
    if (feedbackUserIds.length > 0) {
      const { data: authorProfiles } = await supabase.from('profiles')
        .select('id, realname, role, school, username, class_id').in('id', feedbackUserIds)
      // class_id → 학급 이름 매핑
      const authorClassIds = [...new Set((authorProfiles || []).map(p => p.class_id).filter(Boolean))]
      let classNameMap = {}
      if (authorClassIds.length > 0) {
        const { data: authorClasses } = await supabase.from('classes')
          .select('id, name').in('id', authorClassIds)
        ;(authorClasses || []).forEach(c => { classNameMap[c.id] = c.name })
      }
      const authorMap = {}
      ;(authorProfiles || []).forEach(p => {
        authorMap[p.id] = { ...p, class_name: classNameMap[p.class_id] || null }
      })
      feedbacksWithAuthor = feedbacksWithAuthor.map(f => ({
        ...f,
        author: f.user_id ? authorMap[f.user_id] : null
      }))
    }

    // 🆕 활성·휴지통 분리 (B4)
    const allTeachers = teachersRes.data || []
    const activeTeachers = allTeachers.filter(t => !t.deleted_at)
    const trashedTeachers = allTeachers.filter(t => t.deleted_at)
    const activeClasses = classes.filter(c => !c.deleted_at)
    const trashedClasses = classes.filter(c => c.deleted_at)

    // 🆕 step333: 학급별 제출 통계 + 마지막 활동 시각 (admin_class_stats RPC 결과 매핑 — 활성 학급)
    activeClasses.forEach(c => {
      const st = classStatById[c.id]
      c.submission_count = st?.submission_count || 0
      c.first_submission_count = st?.first_submission_count || 0
      c.last_activity_at = st?.last_activity_at || null
    })

    // 🆕 키 서버격리(step153~): API 키 등록 여부는 class_secrets 기준 (admin은 RLS로 전체 조회 가능)
    try {
      const { data: secrets } = await supabase.from('class_secrets').select('class_id, api_key')
      const keyedClassIds = new Set((secrets || []).filter(s => s.api_key).map(s => s.class_id))
      activeClasses.forEach(c => { c.has_api_key = keyedClassIds.has(c.id) })
    } catch (e) {
      activeClasses.forEach(c => { c.has_api_key = !!c.api_key }) // 폴백: 동결된 classes.api_key
    }

    setTeachers(activeTeachers)
    setClasses(activeClasses)
    setTrashedTeachers(trashedTeachers)
    setTrashedClasses(trashedClasses)
    setFeedbacks(feedbacksWithAuthor)

    // 🆕 step334: 교사 마지막 로그인(auth.users.last_sign_in_at)은 보조 정보이고 조회가 느리므로(listUsers)
    //   비차단으로 처리 — 화면/setLoading을 막지 않고 백그라운드로 보내 응답 오면 해당 칼럼만 채운다.
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          const r = await fetch('/api/admin-last-logins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: session.access_token })
          })
          if (r.ok) {
            const j = await r.json()
            setTeacherLastLogin(j.lastLogins || {})
          }
        }
      } catch (e) { console.warn('마지막 로그인 로드 실패(보조 정보):', e?.message || e) }
      finally { setLastLoginLoaded(true) }
    })()

    setStats({
      teachers: activeTeachers.filter(t => t.role !== 'admin').length,
      classes: activeClasses.length,
      students: studentsRes.count || 0,
      submissions: submissionsRes.count || 0,
      today: todayRes.count || 0,
      preorders: preordersRes.count || 0  // 🆕 step380: 사전 신청 수
    })

    // 🆕 공유 추천 로드 (관리자 추적용 — 누가 뭘 공유했는지)
    try {
      const { data: sharedLogs } = await supabase.from('topic_suggestion_logs')
        .select('*, resulting_topic:topics(id, title, date), author:profiles!topic_suggestion_logs_teacher_id_fkey(realname, school, role)')
        .or('resulting_topic_id.not.is.null,is_shared.eq.true,shared_indexes.neq.[]')
        .order('created_at', { ascending: false })
        .limit(200)
      setSharedSuggestionLogs(sharedLogs || [])
    } catch(e) {
      console.warn('공유 추천 로드 실패:', e)
      setSharedSuggestionLogs([])
    }

    // 🆕 주제 공유 추적 로드 (관리자 전용 — 누가 누구 주제를 가져갔나). RLS로 admin만 전량 조회.
    try {
      const { data: copies } = await supabase.from('topic_copies')
        .select(`
          id, source_index, copied_at,
          copied_by:topic_copies_copied_by_teacher_id_fkey ( id, realname, school ),
          source_log:topic_copies_source_log_id_fkey (
            id, suggestions,
            author:topic_suggestion_logs_teacher_id_fkey ( id, realname, school )
          )
        `)
        .order('copied_at', { ascending: false })
        .limit(200)
      setTopicCopies(copies || [])
    } catch(e) {
      console.warn('주제 공유 추적 로드 실패:', e)
      setTopicCopies([])
    }

    // 🆕 비밀번호 초기화 요청 (pending만)
    try {
      const { data: pwReqs } = await supabase.from('password_reset_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50)
      setResetRequests(pwReqs || [])
    } catch(e) {
      // 테이블 미생성(SQL 미실행) 시 무시
      setResetRequests([])
    }

    // 🆕 step155: 에러 로그 (최근 50건)
    try {
      const { data: elogs } = await supabase.from('error_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      setErrorLogs(elogs || [])
      // 🆕 에러로그 학생의 '번호'만 표시용으로 조인 (⚠️ 실명 realname은 절대 조회하지 않음)
      const logUserIds = [...new Set((elogs || []).filter(e => e.role === 'student' && e.user_id).map(e => e.user_id))]
      if (logUserIds.length > 0) {
        const { data: nums } = await supabase.from('profiles').select('id, number').in('id', logUserIds)
        const nMap = {}
        ;(nums || []).forEach(p => { nMap[p.id] = p.number })
        setLogStudentNumbers(nMap)
      } else {
        setLogStudentNumbers({})
      }
    } catch(e) {
      // 테이블 미생성(SQL 미실행) 시 무시
      setErrorLogs([])
    }

    // 🔍 step359: 의심 교정(correction_alerts) 미해결 건수 — head:true count만(가벼움), 목록은 탭 열 때 로드
    try {
      const { count } = await supabase.from('correction_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('resolved', false)
      setSuspectCount(count || 0)
    } catch(e) {
      // 테이블 미생성(SQL 미실행) 시 무시
      setSuspectCount(0)
    }
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 🔍 step359: 의심 교정 목록 — 탭 열 때 1회만 로드 (첫 로딩 무게 안 늘림)
  // 🆕 step369: supabase-js는 실패해도 throw하지 않아 error를 직접 확인해야 함(기존엔 무시되어
  //   목록이 조용히 "없어요"로 위장됨). order도 DB 컬럼 의존을 없애고 클라이언트에서 정렬.
  useEffect(() => {
    if (tab !== 'corrections' || suspectLoaded) return
    ;(async () => {
      const { data, error } = await supabase.from('correction_alerts')
        .select('*')
        .eq('resolved', false)
        .limit(100)
      if (error) {
        setSuspectError(error.message || '알 수 없는 오류')
        setSuspectAlerts([])
      } else {
        setSuspectError(null)
        const rows = [...(data || [])].sort((a, b) =>
          new Date(b.created_at || b.submission_created_at || 0) - new Date(a.created_at || a.submission_created_at || 0))
        setSuspectAlerts(rows)
        // 🆕 step371: 맥락 문장·작성 학생 정보 배치 조회(1회, 행당 쿼리 금지). 실패해도 목록은 그대로.
        enrichSuspects(rows)
      }
      setSuspectLoaded(true)
    })()
  }, [tab, suspectLoaded])

  // 🆕 step382: 사전 신청 명단 — 탭 열 때 1회만, 배치 쿼리(행당 쿼리 없음). SELECT만(UPDATE/DELETE 없음).
  // 🆕 다음 걸음 카드 응답(onboarding_responses)도 같은 탭에서 함께 로드 — profiles 배치 조인 공유.
  useEffect(() => {
    if (tab !== 'preorders' || preorderList.loaded) return
    ;(async () => {
      const [{ data: pos, error }, obRes] = await Promise.all([
        supabase.from('preorders').select('teacher_id, response, created_at'),
        supabase.from('onboarding_responses').select('teacher_id, card_type, response, comment, created_at'),
      ])
      const obs = obRes?.error ? [] : (obRes?.data || [])   // 테이블 미생성 등이면 빈 목록
      const teacherIds = [...new Set([
        ...(pos || []).map(p => p.teacher_id),
        ...obs.map(o => o.teacher_id),
      ].filter(Boolean))]
      const profMap = {}, classMap = {}
      if (teacherIds.length > 0) {
        const { data: profs } = await supabase.from('profiles')
          .select('id, realname, school, role').in('id', teacherIds)
        ;(profs || []).forEach(p => { profMap[p.id] = p })
        const { data: cls } = await supabase.from('classes')
          .select('name, teacher_id').in('teacher_id', teacherIds).is('deleted_at', null)
        ;(cls || []).forEach(c => {
          classMap[c.teacher_id] = classMap[c.teacher_id] ? classMap[c.teacher_id] + ' · ' + c.name : c.name
        })
      }
      // 온보딩 응답은 사전 신청 실패와 무관하게 표시
      setOnboardingRows(obs
        .map(o => ({
          ...o,
          realname: profMap[o.teacher_id]?.realname || '(정보 없음)',
          school: profMap[o.teacher_id]?.school || '',
          role: profMap[o.teacher_id]?.role || '',   // 🆕 admin 응답 구분 배지용
        }))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)))
      if (error) {
        setPreorderList({ loaded: true, rows: [], error: error.message || '알 수 없는 오류' })
        return
      }
      const rows = (pos || [])
        .map(p => ({
          ...p,
          realname: profMap[p.teacher_id]?.realname || '(정보 없음)',
          school: profMap[p.teacher_id]?.school || '',
          className: classMap[p.teacher_id] || '',
        }))
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setPreorderList({ loaded: true, rows, error: null })
    })()
  }, [tab, preorderList.loaded])

  // 🆕 step422: 쪽지 탭 로드 — 탭 열 때 1회(messages+처리상태+교사 배치 조인 3쿼리)
  useEffect(() => {
    if (tab !== 'messages' || msgData.loaded) return
    ;(async () => {
      try {
        const [msgsRes, stsRes] = await Promise.all([
          supabase.from('messages')
            .select('id, teacher_id, sender_id, body, read_at, created_at, edited_at, deleted_at, is_bulk')
            .order('created_at', { ascending: true }).limit(1000),
          supabase.from('message_thread_status').select('teacher_id, resolved_at'),
        ])
        const msgs = msgsRes.data || []
        const status = {}
        ;(stsRes.data || []).forEach(s => { status[s.teacher_id] = s.resolved_at })
        const tids = [...new Set(msgs.map(m => m.teacher_id))]
        const profs = {}
        if (tids.length > 0) {
          const { data: ps } = await supabase.from('profiles').select('id, realname, school, role').in('id', tids)  // step434: role은 '대화 중' 관리자 본인 제외용
          ;(ps || []).forEach(p => { profs[p.id] = p })
        }
        setMsgData({ loaded: true, msgs, status, profs })
      } catch (e) {
        console.warn('쪽지 로드 실패:', e?.message)
        setMsgData({ loaded: true, msgs: [], status: {}, profs: {} })
      }
    })()
  }, [tab, msgData.loaded])

  // 🆕 step422: 스레드 열람 — 교사발 안읽음 read_at 갱신(+로컬 배지 반영)
  const openThread = async (tid) => {
    setMsgSelected(tid)
    const unreadIds = msgData.msgs
      .filter(m => m.teacher_id === tid && m.sender_id === tid && !m.read_at)
      .map(m => m.id)
    if (unreadIds.length === 0) return
    const now = new Date().toISOString()
    setMsgData(prev => ({ ...prev, msgs: prev.msgs.map(m => unreadIds.includes(m.id) ? { ...m, read_at: now } : m) }))
    try {
      await supabase.from('messages').update({ read_at: now }).in('id', unreadIds)
    } catch (e) { console.warn('쪽지 읽음 처리 실패(무시):', e?.message) }
  }

  // 🆕 step422: 답장 — insert 후 해당 교사에게 종 알림(type 'message', 비차단)
  const sendReply = async () => {
    const body = msgReply.trim()
    if (!body || msgSending || !msgSelected) return
    setMsgSending(true)
    try {
      const { data: ins, error } = await supabase.from('messages')
        .insert({ teacher_id: msgSelected, sender_id: user.id, body })
        .select('id, teacher_id, sender_id, body, read_at, created_at, edited_at, deleted_at').maybeSingle()
      if (error) throw error
      setMsgData(prev => ({ ...prev, msgs: [...prev.msgs, ins] }))
      setMsgReply('')
      try {
        await supabase.rpc('create_notification', {
          p_recipient: msgSelected,
          p_type: 'message',
          p_title: '관리자 답장이 도착했어요',
          p_body: body.slice(0, 100),
          p_link: '/teacher/messages',
        })
      } catch (e) { console.warn('답장 알림 실패(무시):', e?.message) }
    } catch (e) {
      alert('답장을 보내지 못했어요: ' + (e?.message || ''))
    }
    setMsgSending(false)
  }

  // 🆕 step432: 쪽지 수정·삭제 — sender 본인만(서버 재검증). 성공 시 로컬 반영.
  const callMessageEdit = async (messageId, action, body) => {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch('/api/message-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session?.access_token, messageId, action, body }),
    })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || '처리 실패')
    return j
  }
  const saveMsgEdit = async (m) => {
    const body = msgEditDraft.trim()
    if (!body) return
    try {
      const j = await callMessageEdit(m.id, 'edit', body)
      setMsgData(prev => ({ ...prev, msgs: prev.msgs.map(x => x.id === m.id ? { ...x, body, edited_at: j.edited_at } : x) }))
      setMsgEditingId(null)
    } catch (e) { alert('수정하지 못했어요: ' + e.message) }
  }
  const deleteMsg = async (m) => {
    if (!confirm('이 쪽지를 삭제할까요? 상대방 화면에서도 지워져요.')) return
    try {
      const j = await callMessageEdit(m.id, 'delete')
      setMsgData(prev => ({ ...prev, msgs: prev.msgs.map(x => x.id === m.id ? { ...x, deleted_at: j.deleted_at } : x) }))
      if (msgEditingId === m.id) setMsgEditingId(null)
    } catch (e) { alert('삭제하지 못했어요: ' + e.message) }
  }

  // 🆕 step422: 처리됨 토글 — message_thread_status upsert(관리자 전용 RLS)
  const toggleResolved = async (tid) => {
    const resolved_at = msgData.status[tid] ? null : new Date().toISOString()
    setMsgData(prev => ({ ...prev, status: { ...prev.status, [tid]: resolved_at } }))
    try {
      await supabase.from('message_thread_status')
        .upsert({ teacher_id: tid, resolved_at, updated_at: new Date().toISOString() })
    } catch (e) { console.warn('처리 상태 저장 실패(무시):', e?.message) }
  }

  // 🆕 step422: 일괄 쪽지 대상 — step414 classifyTeacher 재사용(차단 제외, admin 포함=본인 테스트 가능)
  const bulkTargets = () => {
    const picked = Object.entries(bulkStages).filter(([, v]) => v).map(([k]) => k)
    if (picked.length === 0) return []
    return teachers.filter(t => !t.is_banned).filter(t => {
      const myClasses = classes.filter(c => c.teacher_id === t.id)
      const totalStudents = myClasses.reduce((s, c) => s + (c.student_count || 0), 0)
      const totalSubs = myClasses.reduce((s, c) => s + (c.submission_count || 0), 0)
      const lastActivity = myClasses.reduce((max, c) => {
        if (!c.last_activity_at) return max
        return !max || c.last_activity_at > max ? c.last_activity_at : max
      }, null)
      return picked.includes(classifyTeacher({ totalStudents, totalSubs, lastActivity }))
    })
  }

  // 🆕 step422: 일괄 발송 — 반드시 N명 confirm 후 API 호출({이름} 치환은 서버에서)
  const sendBulk = async () => {
    const targets = bulkTargets()
    const body = bulkBody.trim()
    if (!body) return alert('내용을 입력해주세요')
    if (targets.length === 0) return alert('대상이 없어요. 단계를 선택해주세요.')
    if (!confirm(`${targets.length}명에게 발송합니다. 계속할까요?`)) return
    setBulkSending(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/admin-messages-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session?.access_token, teacherIds: targets.map(t => t.id), body }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || '발송 실패')
      alert(`발송 완료: 성공 ${j.sent}건 · 실패 ${j.failed}건`)
      setBulkOpen(false)
      setBulkBody('')
      setBulkStages({ active: false, cooling: false, at_risk: false, dormant: false })
      setMsgData(prev => ({ ...prev, loaded: false }))  // 목록 리로드
    } catch (e) {
      alert('일괄 발송 실패: ' + (e?.message || ''))
    }
    setBulkSending(false)
  }

  // 🆕 step371: 의심 교정 행 보강 — submission_id로 본문·작성자를 4개의 .in() 배치로만 조회.
  //   ① 맥락 문장(본문에서 original 위치의 문장) ② 학생 정보(학교·학급·담임·N번 이름).
  //   pending_names 복호화·조회 없음. displayStudentName으로 미동의=닉네임 처리.
  const enrichSuspects = async (rows) => {
    try {
      const subIds = [...new Set(rows.map(a => a.submission_id).filter(Boolean))]
      const subMap = {}
      if (subIds.length > 0) {
        const { data: subs } = await supabase.from('submissions')
          .select('id, user_id, essay_text, deleted_at').in('id', subIds)
        ;(subs || []).forEach(s => { subMap[s.id] = s })
      }
      // 🆕 step398 후속: submission 작성자 + 차단 기록 blocked_user_id(제출물 없는 행)를 한 배치로 조회
      const blockedUserIds = rows
        .filter(a => !a.submission_id && a.blocked_user_id)
        .map(a => a.blocked_user_id)
      const userIds = [...new Set([
        ...Object.values(subMap).map(s => s.user_id).filter(Boolean),
        ...blockedUserIds,
      ].filter(Boolean))]
      const profMap = {}
      if (userIds.length > 0) {
        const { data: profs } = await supabase.from('profiles')
          .select('id, realname, nickname, username, number, class_id').in('id', userIds)
        ;(profs || []).forEach(p => { profMap[p.id] = p })
      }
      const classIds = [...new Set(Object.values(profMap).map(p => p.class_id).filter(Boolean))]
      const classMap = {}
      if (classIds.length > 0) {
        const { data: cls } = await supabase.from('classes')
          .select('id, name, teacher_id').in('id', classIds)
        ;(cls || []).forEach(c => { classMap[c.id] = c })
      }
      const teacherIds = [...new Set(Object.values(classMap).map(c => c.teacher_id).filter(Boolean))]
      const teacherMap = {}
      if (teacherIds.length > 0) {
        const { data: ts } = await supabase.from('profiles')
          .select('id, realname, school').in('id', teacherIds)
        ;(ts || []).forEach(t => { teacherMap[t.id] = t })
      }
      const meta = {}
      rows.forEach(a => {
        meta[a.id] = {
          ctx: buildContext(a, subMap),
          student: buildStudent(a, subMap, profMap, classMap, teacherMap),
        }
      })
      setSuspectMeta(meta)
    } catch (e) {
      console.warn('의심 교정 보강 실패(무시):', e?.message)
    }
  }

  // 🔍 step359: 의심 교정 해결 처리 — 로컬 상태만 갱신(전체 재조회 없이 가볍게)
  const resolveAlert = async (id) => {
    const { error } = await supabase.from('correction_alerts').update({ resolved: true }).eq('id', id)
    if (error) return alert('해결 처리 실패: ' + error.message)
    setSuspectAlerts(prev => prev.filter(a => a.id !== id))
    setSuspectCount(c => Math.max(0, c - 1))
  }
  const resolveAllAlerts = async () => {
    if (!confirm(`미해결 의심 교정 ${suspectCount}건을 모두 해결 처리할까요?`)) return
    const { error } = await supabase.from('correction_alerts').update({ resolved: true }).eq('resolved', false)
    if (error) return alert('일괄 해결 실패: ' + error.message)
    setSuspectAlerts([])
    setSuspectCount(0)
  }
  // 🆕 같은 교정(유형+원문+교정) 묶음 카드의 일괄 해결 — 그룹 전체 id를 한 번의 .in()으로
  const resolveGroup = async (ids) => {
    const { error } = await supabase.from('correction_alerts').update({ resolved: true }).in('id', ids)
    if (error) return alert('해결 처리 실패: ' + error.message)
    setSuspectAlerts(prev => prev.filter(a => !ids.includes(a.id)))
    setSuspectCount(c => Math.max(0, c - ids.length))
  }

  const toggleTeacherBan = async (teacher) => {
    if (teacher.role === 'admin') return alert('관리자는 차단할 수 없어요')
    const action = teacher.is_banned ? '해제' : '차단'
    if (!confirm(`${teacher.realname} 선생님을 ${action}하시겠어요?\n\n${teacher.is_banned ? '해제하면 다시 로그인 가능해요' : '차단하면 로그인 불가능, 학급 운영 중지'}`)) return
    
    const { error } = await supabase.from('profiles').update({ is_banned: !teacher.is_banned }).eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert(`${action} 완료!`)
    await loadAll()
  }

  // 🆕 선생님 비밀번호 초기화 (비번 잊은 선생님 구제 — 재가입 사고 방지)
  const resetTeacherPassword = async (teacher) => {
    // step161: 비밀번호는 고정값 123456으로 표준화 (학생 초기 비번과 동일 체계)
    const FIXED_PW = '123456'
    if (!confirm(
      `${teacher.realname} 선생님의 비밀번호를 "${FIXED_PW}"로 초기화할까요?\n\n` +
      `아이디: ${teacher.username}\n\n` +
      `초기화 후 선생님은 로그인 시 비밀번호 변경을 안내받아요.`
    )) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/reset-teacher-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacherId: teacher.id,
          newPassword: FIXED_PW,
          accessToken: session?.access_token
        })
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || '초기화 실패')

      alert(
        `✅ 비밀번호가 ${FIXED_PW}으로 초기화됐어요.\n\n` +
        `선생님: ${teacher.realname} (아이디: ${teacher.username})\n\n` +
        `📋 요청자에게 "${FIXED_PW}으로 로그인 후 비밀번호를 꼭 바꾸세요"라고 안내해주세요.`
      )
    } catch(e) {
      alert('❌ 실패: ' + e.message)
    }
  }

  // 🆕 초기화 요청 처리 — username으로 선생님 찾아서 초기화 후 완료 처리
  const handleResetRequest = async (req) => {
    const target = teachers.find(t => t.username === req.username)
    if (!target) {
      if (confirm(
        `"${req.username}" 아이디의 선생님을 찾을 수 없어요.\n\n` +
        `(요청자가 아이디를 잘못 적었거나 학생 계정일 수 있어요)\n\n` +
        `이 요청을 완료 처리(목록에서 제거)할까요?`
      )) {
        await supabase.from('password_reset_requests')
          .update({ status: 'done', handled_at: new Date().toISOString() })
          .eq('id', req.id)
        await loadAll()
      }
      return
    }
    // 기존 초기화 흐름 재사용
    await resetTeacherPassword(target)
    // 처리 완료로 표시
    if (confirm('이 요청을 완료 처리할까요? (목록에서 사라져요)')) {
      await supabase.from('password_reset_requests')
        .update({ status: 'done', handled_at: new Date().toISOString() })
        .eq('id', req.id)
      await loadAll()
    }
  }

  // 🆕 step161: 요청 완료 처리(공통)
  const markRequestDone = async (req) => {
    if (!confirm('이 요청을 완료 처리할까요? (목록에서 사라져요)')) return
    await supabase.from('password_reset_requests')
      .update({ status: 'done', handled_at: new Date().toISOString() })
      .eq('id', req.id)
    await loadAll()
  }

  // 🆕 step161: 아이디 찾기 — 이름+학교로 교사 후보 조회 (동명이인 대비 복수 표시)
  const findIdCandidates = async (req) => {
    setIdLookups(prev => ({ ...prev, [req.id]: { loading: true, list: [] } }))
    try {
      // 이름으로 교사/관리자 검색 (학교는 표시로 대조 — 오타 대비 넓게)
      let q = supabase.from('profiles')
        .select('username, realname, school, role')
        .eq('realname', (req.realname || '').trim())
        .in('role', ['teacher', 'admin'])
      const { data } = await q
      setIdLookups(prev => ({ ...prev, [req.id]: { loading: false, list: data || [] } }))
    } catch (e) {
      setIdLookups(prev => ({ ...prev, [req.id]: { loading: false, list: [] } }))
    }
  }

  // 🆕 step162: 비번 초기화 API 호출 (단일/일괄 공용) — 123456 + must_change_password
  const resetPasswordApi = async (teacherId, token) => {
    try {
      const res = await fetch('/api/reset-teacher-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId, newPassword: '123456', accessToken: token })
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: result.error || '초기화 실패' }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message || '네트워크 오류' }
    }
  }

  // 🆕 step162: 선택 토글
  const toggleReqSelect = (id) => {
    setSelectedReqIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // 🆕 step162: 비번 초기화 일괄 처리 (reset_password 요청만 대상)
  const bulkResetPasswords = async (reqs) => {
    const targets = (reqs || []).filter(r => r.request_type !== 'find_id')
    if (targets.length === 0) {
      return alert('초기화할 비번 요청이 없어요.\n(아이디 찾기 요청은 일괄 초기화 대상이 아니에요.)')
    }
    if (!confirm(
      `${targets.length}건의 비밀번호를 "123456"으로 일괄 초기화할까요?\n\n` +
      `초기화 후 각 선생님께 연락처로 "123456으로 로그인 후 비밀번호를 꼭 바꾸세요"라고 안내해주세요.`
    )) return

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    let ok = 0
    const fails = []
    for (const r of targets) {
      const target = teachers.find(t => t.username === r.username)
      if (!target) { fails.push(`${r.realname}(@${r.username}) — 계정 없음`); continue }
      const result = await resetPasswordApi(target.id, token)
      if (result.ok) {
        ok++
        await supabase.from('password_reset_requests')
          .update({ status: 'done', handled_at: new Date().toISOString() })
          .eq('id', r.id)
      } else {
        fails.push(`${r.realname}(@${r.username}) — ${result.error}`)
      }
    }
    setSelectedReqIds(new Set())
    await loadAll()
    alert(
      `✅ 일괄 초기화 완료\n\n성공 ${ok}건 / 실패 ${fails.length}건` +
      (fails.length ? `\n\n[실패 목록]\n- ${fails.join('\n- ')}` : '') +
      `\n\n📋 비밀번호 123456을 각 요청자에게 전달해주세요.`
    )
  }

  // 🆕 step162: 요청 삭제 (비번 안 건드리고 행만 제거) — DELETE RLS 정책 필요
  const deleteRequest = async (req) => {
    if (!confirm('이 요청을 삭제할까요?\n\n(비밀번호는 건드리지 않고 목록에서 행만 제거해요. 되돌릴 수 없어요.)')) return
    const { error } = await supabase.from('password_reset_requests').delete().eq('id', req.id)
    if (error) {
      return alert('삭제 실패: ' + error.message + '\n\n(step162 DELETE RLS 정책이 적용됐는지 확인해주세요)')
    }
    setSelectedReqIds(prev => { const n = new Set(prev); n.delete(req.id); return n })
    await loadAll()
  }

  // 🆕 step162: 선택 일괄 삭제
  const bulkDeleteRequests = async (ids) => {
    if (!ids || ids.length === 0) return alert('선택된 요청이 없어요.')
    if (!confirm(`선택한 ${ids.length}건을 삭제할까요?\n\n(비밀번호는 건드리지 않고 행만 제거해요. 되돌릴 수 없어요.)`)) return
    const { error } = await supabase.from('password_reset_requests').delete().in('id', ids)
    if (error) {
      return alert('삭제 실패: ' + error.message + '\n\n(step162 DELETE RLS 정책이 적용됐는지 확인해주세요)')
    }
    setSelectedReqIds(new Set())
    await loadAll()
  }

  // 🗑️ 선생님 휴지통으로 (B4)
  const trashTeacher = async (teacher) => {
    if (teacher.id === user?.id) {
      return alert('⚠️ 본인 계정은 휴지통에 넣을 수 없어요.')
    }
    if (teacher.role === 'admin') {
      const activeAdmins = teachers.filter(t => t.role === 'admin' && !t.deleted_at)
      if (activeAdmins.length <= 1) {
        return alert('⚠️ 마지막 관리자는 삭제할 수 없어요. 다른 선생님께 관리자 권한을 먼저 부여하세요.')
      }
    }

    // 영향 범위 안내
    const myClasses = classes.filter(c => c.teacher_id === teacher.id)
    let warning = `🗑️ ${teacher.realname} 선생님을 휴지통으로 보낼까요?\n\n`
    warning += `· 30일 후 영구 삭제됩니다 (그 전엔 복원 가능)\n`
    warning += `· 선생님 본인은 로그인 차단됩니다\n`
    if (myClasses.length > 0) {
      warning += `· 담임 학급 ${myClasses.length}개는 그대로 유지됩니다 (학생 데이터 보호)\n`
    }
    warning += `\n계속하려면 선생님 이름을 입력하세요: ${teacher.realname}`
    const answer = prompt(warning)
    if (answer !== teacher.realname) {
      if (answer !== null) alert('이름이 일치하지 않아 취소되었어요.')
      return
    }

    const reason = prompt('삭제 사유 (선택 — 그냥 OK 눌러도 됨):') || null

    const { error } = await supabase.from('profiles').update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      delete_reason: reason
    }).eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert('휴지통으로 보냈어요.')
    await loadAll()
  }

  const restoreTeacher = async (teacher) => {
    if (!confirm(`${teacher.realname} 선생님을 복원할까요?\n\n복원하면 다시 로그인 가능해져요.`)) return
    const { error } = await supabase.from('profiles').update({
      deleted_at: null,
      deleted_by: null,
      delete_reason: null
    }).eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert('복원 완료!')
    await loadAll()
  }

  const purgeTeacher = async (teacher) => {
    let warning = `⚠️ ${teacher.realname} 선생님을 영구 삭제할까요?\n\n`
    warning += `이 작업은 되돌릴 수 없어요.\n\n`
    warning += `계속하려면 다음 문구를 그대로 입력하세요:\n"영구삭제 ${teacher.realname}"`
    const expected = `영구삭제 ${teacher.realname}`
    const answer = prompt(warning)
    if (answer !== expected) {
      if (answer !== null) alert('문구가 일치하지 않아 취소되었어요.')
      return
    }
    // 🆕 step387: profiles + auth.users를 서버 API로 완전 삭제.
    //   기존엔 profiles만 지워 auth 계정이 고아로 남았고, 같은 이메일 재가입이 signUp에서 충돌했음.
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/admin-purge-teacher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId: teacher.id, accessToken: session?.access_token })
      })
      const d = await resp.json()
      if (!resp.ok) return alert('실패: ' + (d.error || '알 수 없는 오류'))
    } catch (e) {
      return alert('실패: ' + (e.message || '네트워크 오류'))
    }
    alert('영구 삭제 완료')
    await loadAll()
  }

  // 🗑️ 학급 휴지통으로 (B4)
  const trashClass = async (cls) => {
    let warning = `🗑️ "${cls.name}" 학급을 휴지통으로 보낼까요?\n\n`
    warning += `· 30일 후 영구 삭제됩니다 (그 전엔 복원 가능)\n`
    warning += `· 학생들이 이 학급으로 가입할 수 없게 됩니다\n`
    warning += `· 영구 삭제 시 학급의 모든 주제·제출물도 함께 삭제됩니다\n\n`
    warning += `계속하려면 학급명을 입력하세요: ${cls.name}`
    const answer = prompt(warning)
    if (answer !== cls.name) {
      if (answer !== null) alert('학급명이 일치하지 않아 취소되었어요.')
      return
    }

    const reason = prompt('삭제 사유 (선택):') || null

    const { error } = await supabase.from('classes').update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
      delete_reason: reason
    }).eq('id', cls.id)
    if (error) return alert('실패: ' + error.message)
    alert('휴지통으로 보냈어요.')
    await loadAll()
  }

  const restoreClass = async (cls) => {
    if (!confirm(`"${cls.name}" 학급을 복원할까요?`)) return
    const { error } = await supabase.from('classes').update({
      deleted_at: null,
      deleted_by: null,
      delete_reason: null
    }).eq('id', cls.id)
    if (error) return alert('실패: ' + error.message)
    alert('복원 완료!')
    await loadAll()
  }

  const purgeClass = async (cls) => {
    let warning = `⚠️ "${cls.name}" 학급을 영구 삭제할까요?\n\n`
    warning += `· 학급의 모든 주제·제출물이 함께 삭제됩니다\n`
    warning += `· 이 작업은 되돌릴 수 없어요\n\n`
    warning += `계속하려면 다음 문구를 그대로 입력하세요:\n"영구삭제 ${cls.name}"`
    const expected = `영구삭제 ${cls.name}`
    const answer = prompt(warning)
    if (answer !== expected) {
      if (answer !== null) alert('문구가 일치하지 않아 취소되었어요.')
      return
    }
    // 종속 데이터 cascade
    // 1. 학급의 주제 ID 모음
    const { data: classTopics } = await supabase.from('topics').select('id').eq('teacher_id', cls.teacher_id)
    const topicIds = (classTopics || []).map(t => t.id)
    // 2. 그 주제의 제출물 삭제
    if (topicIds.length > 0) {
      await supabase.from('submissions').delete().in('topic_id', topicIds)
    }
    // 3. 학급 학생 profile.class_id null
    await supabase.from('profiles').update({ class_id: null }).eq('class_id', cls.id)
    // 4. 학급 삭제
    const { error } = await supabase.from('classes').delete().eq('id', cls.id)
    if (error) return alert('실패: ' + error.message)
    alert('영구 삭제 완료')
    await loadAll()
  }

  const toggleClassActive = async (cls) => {
    const action = cls.is_active === false ? '활성화' : '비활성화'
    if (!confirm(`"${cls.name}" 학급을 ${action}하시겠어요?\n\n${action === '비활성화' ? '비활성화하면 학생 가입/글쓰기 모두 중지됩니다' : '활성화하면 다시 정상 운영됩니다'}`)) return
    
    const { error } = await supabase.from('classes').update({ is_active: cls.is_active === false }).eq('id', cls.id)
    if (error) return alert('실패: ' + error.message)
    alert(`${action} 완료!`)
    await loadAll()
  }

  // 🔐 관리자 권한 부여/회수
  const toggleAdmin = async (teacher) => {
    const isCurrentlyAdmin = teacher.role === 'admin'

    // 자기 자신 권한 회수 시: 다른 관리자가 있는지 확인
    if (isCurrentlyAdmin && teacher.id === user?.id) {
      const adminCount = teachers.filter(t => t.role === 'admin').length
      if (adminCount <= 1) {
        return alert('⚠️ 마지막 관리자는 자기 권한을 회수할 수 없어요.\n다른 선생님께 먼저 관리자 권한을 부여한 뒤 회수해주세요.')
      }
      if (!confirm('🚨 본인의 관리자 권한을 회수하시겠어요?\n\n회수 후엔 관리자 페이지에 접근할 수 없어요.\n다른 관리자만 권한을 되돌릴 수 있어요.')) return
    } else {
      const action = isCurrentlyAdmin ? '회수' : '부여'
      const warning = isCurrentlyAdmin
        ? `\n\n회수 후 ${teacher.realname} 선생님은 일반 교사 권한으로 돌아가요.`
        : `\n\n부여 후 ${teacher.realname} 선생님도 관리자 기능을 사용할 수 있어요.`
      if (!confirm(`🔐 ${teacher.realname} 선생님의 관리자 권한을 ${action}하시겠어요?${warning}`)) return
    }

    const newRole = isCurrentlyAdmin ? 'teacher' : 'admin'
    const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
    alert(`${isCurrentlyAdmin ? '회수' : '부여'} 완료!`)

    // 본인이 권한 회수했으면 페이지 이탈
    if (isCurrentlyAdmin && teacher.id === user?.id) {
      router.push('/teacher')
      return
    }
    await loadAll()
  }

  // 💬 의견 숨김/복원
  const toggleHideFeedback = async (fb) => {
    const action = fb.is_hidden ? '복원' : '숨김'
    const { error } = await supabase.from('feedback').update({
      is_hidden: !fb.is_hidden,
      hidden_at: fb.is_hidden ? null : new Date().toISOString()
    }).eq('id', fb.id)
    if (error) return alert('실패: ' + error.message)
    await loadAll()
  }

  // 🆕 step205-B: 피드백 답변 저장 (admin write = 기존 fb_update). reply_read_at은 안 건드림(step C에서 작성자 열람 시).
  const saveReply = async (f) => {
    if (!f.user_id) return alert('비로그인 의견이라 답변을 보낼 수 없어요.')
    const text = (replyDraft[f.id] ?? '').trim()
    if (!text) return alert('답변 내용을 입력하세요.')
    setSavingReplyId(f.id)
    try {
      const now = new Date().toISOString()
      const { error } = await supabase.from('feedback').update({
        reply_text: text, replied_at: now, reply_by: user?.id || null
      }).eq('id', f.id)
      if (error) throw error
      // 🔔 step348: 알림 센터 — 의견 작성자(교사)에게 답장 알림(비차단)
      try {
        if (f.user_id) {
          await supabase.rpc('create_notification', {
            p_recipient: f.user_id,
            p_type: 'admin_reply',
            p_title: '관리자 답장이 도착했어요',
            p_body: '내 의견에 답장이 왔어요',
            p_link: '/teacher'
          })
        }
      } catch (e) { console.warn('알림 생성 실패:', e?.message) }
      // 로컬 상태 갱신(목록 즉시 반영)
      setFeedbacks(prev => prev.map(x => x.id === f.id
        ? { ...x, reply_text: text, replied_at: now, reply_by: user?.id || null }
        : x))
      setEditingReply(null)
    } catch (e) {
      alert('답변 저장 실패: ' + e.message)
    }
    setSavingReplyId(null)
  }

  // 💬 의견 일괄 숨김 (보이는 것 모두)
  const hideAllVisible = async () => {
    const visible = feedbacks.filter(f => !f.is_hidden)
    if (visible.length === 0) return alert('숨길 의견이 없어요')
    if (!confirm(`보이는 ${visible.length}개 의견을 모두 숨길까요?\n나중에 "숨김 포함 보기"에서 복원할 수 있어요.`)) return

    const now = new Date().toISOString()
    const { error } = await supabase.from('feedback').update({
      is_hidden: true, hidden_at: now
    }).in('id', visible.map(f => f.id))
    if (error) return alert('실패: ' + error.message)
    alert(`✅ ${visible.length}개 숨김 완료`)
    await loadAll()
  }

  // 💬 의견 일괄 복원 (숨김 모두)
  const restoreAllHidden = async () => {
    const hidden = feedbacks.filter(f => f.is_hidden)
    if (hidden.length === 0) return alert('복원할 의견이 없어요')
    if (!confirm(`숨김 처리된 ${hidden.length}개 의견을 모두 복원할까요?`)) return

    const { error } = await supabase.from('feedback').update({
      is_hidden: false, hidden_at: null
    }).in('id', hidden.map(f => f.id))
    if (error) return alert('실패: ' + error.message)
    alert(`✅ ${hidden.length}개 복원 완료`)
    await loadAll()
  }

  // ☑️ 선택된 의견 일괄 숨김
  const hideSelected = async () => {
    const targetIds = [...selectedFeedbackIds]
    if (targetIds.length === 0) return
    if (!confirm(`선택한 ${targetIds.length}개 의견을 숨길까요?`)) return

    const now = new Date().toISOString()
    const { error } = await supabase.from('feedback').update({
      is_hidden: true, hidden_at: now
    }).in('id', targetIds)
    if (error) return alert('실패: ' + error.message)
    setSelectedFeedbackIds(new Set())
    await loadAll()
  }

  // ☑️ 선택된 의견 일괄 복원
  const restoreSelected = async () => {
    const targetIds = [...selectedFeedbackIds]
    if (targetIds.length === 0) return
    if (!confirm(`선택한 ${targetIds.length}개 의견을 복원할까요?`)) return

    const { error } = await supabase.from('feedback').update({
      is_hidden: false, hidden_at: null
    }).in('id', targetIds)
    if (error) return alert('실패: ' + error.message)
    setSelectedFeedbackIds(new Set())
    await loadAll()
  }

  // ☑️ 체크박스 토글
  const toggleSelect = (id) => {
    setSelectedFeedbackIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 📋 복사/요약 대상 선택: 체크된 것 우선, 없으면 보이는 것 전체
  const getTargetFeedbacks = () => {
    if (selectedFeedbackIds.size > 0) {
      return feedbacks.filter(f => selectedFeedbackIds.has(f.id))
    }
    return feedbacks.filter(f => !f.is_hidden)
  }

  // 📋 의견을 마크다운 형식으로 정리 (Claude에게 바로 전달용)
  const formatFeedbacksAsMarkdown = (fbs) => {
    if (!fbs || fbs.length === 0) return ''
    const today = new Date().toISOString().slice(0, 10)
    let md = `# 다온클래스 - 사용자 의견 모음 (${today})\n\n`
    md += `총 ${fbs.length}건\n\n---\n\n`
    fbs.forEach((f, i) => {
      const date = toKST(f.created_at) || ''
      // 🆕 작성자 정보 포함
      let authorInfo = '익명/구버전'
      if (f.author) {
        const roleLabel = f.author.role === 'admin' ? '관리자'
                       : f.author.role === 'teacher' ? '선생님'
                       : '학생'
        const name = f.author.realname || f.author.username || '이름없음'
        const extra = f.author.role === 'student' && f.author.class_name
          ? ` (${f.author.class_name})`
          : (f.author.school ? ` (${f.author.school})` : '')
        authorInfo = `${roleLabel} ${name}${extra}`
      }
      md += `## ${i + 1}. ${date} — ${authorInfo}\n\n${f.content}\n\n---\n\n`
    })
    md += `\n위 의견들을 카테고리별로 정리하고, 각 의견에 대한 우선순위와 대응 방안을 제안해주세요.`
    return md
  }

  // 📋 의견 복사 (선택된 것 우선, 없으면 보이는 것 전체)
  const copyFeedbacks = async () => {
    const target = getTargetFeedbacks()
    if (target.length === 0) return alert('복사할 의견이 없어요')
    const md = formatFeedbacksAsMarkdown(target)
    try {
      await navigator.clipboard.writeText(md)
      const label = selectedFeedbackIds.size > 0 ? `선택한 ${target.length}개` : `보이는 ${target.length}개`
      alert(`✅ ${label} 의견을 마크다운으로 복사했어요!\n\nClaude나 다른 AI에게 바로 붙여넣을 수 있어요.`)
    } catch(e) {
      alert('복사 실패: ' + e.message)
    }
  }

  // 🤖 AI 요약 (Gemini로 의견 분석 요약)
  const [aiSummarizing, setAiSummarizing] = useState(false)
  const [aiSummary, setAiSummary] = useState(null)

  const summarizeWithAi = async () => {
    const target = getTargetFeedbacks()
    if (target.length === 0) return alert('요약할 의견이 없어요')
    if (target.length < 2) return alert('의견이 너무 적어요 (최소 2개 필요)')

    // 키 서버격리(step153~): 키 등록된 학급의 키로 호출 (admin은 classId 지정 가능)
    const keyedClass = classes.find(c => c.has_api_key)
    if (!keyedClass) return alert('API 키가 등록된 학급이 없어요. 선생님이 먼저 키를 등록해야 해요.')

    setAiSummarizing(true)
    setAiSummary(null)
    try {
      // 🔒 프롬프트는 서버(/api/ai)에서 구성
      const result = await callAI('feedbackSummary',
        { feedbacks: target.map(f => f.content) },
        { classId: keyedClass.id }
      )
      setAiSummary(result)
    } catch(e) {
      alert('AI 요약 실패: ' + (e.message || e))
    }
    setAiSummarizing(false)
  }

  // AI 요약을 마크다운으로 변환
  const formatAiSummaryAsMarkdown = (summary) => {
    if (!summary) return ''
    const today = new Date().toISOString().slice(0, 10)
    let md = `# 다온클래스 - 사용자 의견 AI 요약 (${today})\n\n`
    md += `## 📊 카테고리별 정리\n\n`
    summary.categories?.forEach(cat => {
      md += `### ${cat.name}\n`
      cat.items?.forEach(item => { md += `- ${item}\n` })
      md += `\n`
    })
    md += `## 🚨 우선순위 (시급한 것부터)\n\n`
    summary.priorityList?.forEach((item, i) => { md += `${i + 1}. ${item}\n` })
    md += `\n## 💡 종합 인사이트\n\n${summary.summary || ''}\n`
    md += `\n---\n위 분석을 바탕으로 작업을 진행해주세요.`
    return md
  }

  // AI 요약 복사
  const copyAiSummary = async () => {
    if (!aiSummary) return
    const md = formatAiSummaryAsMarkdown(aiSummary)
    try {
      await navigator.clipboard.writeText(md)
      alert('✅ AI 요약을 복사했어요!\n\nClaude에게 바로 붙여넣을 수 있어요.')
    } catch(e) {
      alert('복사 실패: ' + e.message)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>관리자 페이지 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">🛡️ 관리자 페이지</h1>
              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-semibold">SUPER ADMIN</span>
            </div>
            <Link href="/teacher" className="text-sm text-gray-600 hover:text-primary">
              ← 선생님 모드로
            </Link>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: '선생님', val: stats.teachers, icon: '👨‍🏫', color: 'bg-blue-50 text-blue-900' },
              { label: '학급', val: stats.classes, icon: '🏫', color: 'bg-green-50 text-green-900' },
              { label: '학생', val: stats.students, icon: '🎒', color: 'bg-purple-50 text-purple-900' },
              { label: '누적 글쓰기', val: stats.submissions, icon: '📝', color: 'bg-orange-50 text-orange-900' },
              { label: '오늘', val: stats.today, icon: '✨', color: 'bg-pink-50 text-pink-900' },
              { label: '사전 신청', val: stats.preorders, icon: '🎟️', color: 'bg-teal-50 text-teal-900' },  // 🆕 step380
              (() => {
                const cnt24h = errorLogs.filter(e => Date.now() - new Date(e.created_at).getTime() < 24 * 60 * 60 * 1000).length
                return { label: '24h 에러', val: cnt24h, icon: '🚨', color: cnt24h > 0 ? 'bg-red-100 text-red-800' : 'bg-green-50 text-green-900' }
              })()
            ].map(s => (
              <div key={s.label} className={`${s.color} rounded-xl p-4`}>
                <div className="text-2xl mb-1">{s.icon}</div>
                <div className="text-xs opacity-75">{s.label}</div>
                <div className="text-2xl font-bold">{s.val}</div>
              </div>
            ))}
          </div>

          <div className="flex gap-1 bg-white rounded-xl p-1 border border-gray-200 overflow-x-auto">
            {[
              { id: 'overview', label: '👥 선생님' },
              { id: 'classes', label: '🏫 학급' },
              { id: 'submissions', label: '📝 학생 글' },
              { id: 'feedbacks', label: `💬 의견 (${feedbacks.filter(f => !f.is_hidden).length})` },
              { id: 'shared-suggestions', label: `📚 추천 공유${sharedSuggestionLogs.length > 0 ? ` (${sharedSuggestionLogs.length})` : ''}` },
              { id: 'topic-copies', label: `🔗 주제 공유 추적${topicCopies.length > 0 ? ` (${topicCopies.length})` : ''}` },
              { id: 'trash', label: `🗑️ 휴지통${(trashedTeachers.length + trashedClasses.length) > 0 ? ` (${trashedTeachers.length + trashedClasses.length})` : ''}` },
              { id: 'corrections', label: `🔍 의심 교정${suspectCount > 0 ? ` (${suspectCount})` : ''}` },
              { id: 'messages', label: '✉️ 쪽지' },
              { id: 'preorders', label: '🎟️ 사전 신청' },
              { id: 'errors', label: `🚨 에러${errorLogs.length > 0 ? ` (${errorLogs.length})` : ''}` }
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 min-w-fit py-2 px-3 rounded-lg text-sm font-medium whitespace-nowrap ${tab === t.id ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (() => {
            // 🆕 차단된 선생님 필터링 + step249 검색(이름·아이디·학교, 부분일치·대소문자무시)
            const tq = teacherSearch.trim().toLowerCase()
            const matchTeacher = (t) => !tq
              || (t.realname || '').toLowerCase().includes(tq)
              || (t.username || '').toLowerCase().includes(tq)
              || (t.school || '').toLowerCase().includes(tq)
            const visibleTeachers = (showBannedTeachers
              ? teachers
              : teachers.filter(t => !t.is_banned)
            ).filter(matchTeacher)
            const bannedCount = teachers.filter(t => t.is_banned).length

            // 🆕 교사별 파생값을 map 앞으로 끌어올림 — 카드 집계·단계 필터·정렬에 공용 (계산식은 기존 그대로)
            const enriched = visibleTeachers.map(t => {
              const myClasses = classes.filter(c => c.teacher_id === t.id)
              const totalStudents = myClasses.reduce((sum, c) => sum + (c.student_count || 0), 0)
              const totalSubs = myClasses.reduce((sum, c) => sum + (c.submission_count || 0), 0)
              const totalFirst = myClasses.reduce((sum, c) => sum + (c.first_submission_count || 0), 0)
              const lastActivity = myClasses.reduce((max, c) => {
                if (!c.last_activity_at) return max
                return !max || c.last_activity_at > max ? c.last_activity_at : max
              }, null)
              const stage = classifyTeacher({ totalStudents, totalSubs, lastActivity })
              const lastLogin = teacherLastLogin[t.id]
              const loginDays = lastLogin ? Math.floor((Date.now() - new Date(lastLogin).getTime()) / 86400000) : null
              const diag = diagnoseTeacher(stage, { classCount: myClasses.length, totalStudents, loginDays, lastLoginLoaded })
              return { t, myClasses, totalStudents, totalSubs, totalFirst, lastActivity, stage, diag }
            })
            const stageCounts = { active: 0, cooling: 0, at_risk: 0, dormant: 0 }
            enriched.forEach(x => { stageCounts[x.stage]++ })
            // 정렬 — 'recent'는 로드 순서(created_at desc) 그대로(기존 기본 정렬 회귀 없음)
            const sorted = teacherSort === 'recent' ? enriched : [...enriched].sort((a, b) => {
              if (teacherSort === 'students') return b.totalStudents - a.totalStudents
              if (teacherSort === 'subs') return b.totalSubs - a.totalSubs
              // oldest_activity: 활동 전무(null)=가장 오래된 것으로 맨 앞
              const av = a.lastActivity ? new Date(a.lastActivity).getTime() : 0
              const bv = b.lastActivity ? new Date(b.lastActivity).getTime() : 0
              return av - bv
            })
            const listed = teacherStageFilter ? sorted.filter(x => x.stage === teacherStageFilter) : sorted
            // 카드 클릭 토글: 선택 시 '오래된 순' 자동 전환, 해제 시 기본 정렬 복귀
            const toggleStageFilter = (key) => {
              if (teacherStageFilter === key) { setTeacherStageFilter(null); setTeacherSort('recent') }
              else { setTeacherStageFilter(key); setTeacherSort('oldest_activity') }
            }

            return (
            <div className="space-y-4">
            {/* 🆕 비밀번호 초기화 요청 알림 */}
            {resetRequests.length > 0 && (
              <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-4">
                <h3 className="font-bold text-blue-900 text-sm mb-2">
                  🔔 아이디/비밀번호 찾기 요청 ({resetRequests.length}건)
                </h3>

                {/* 🆕 step162: 일괄 처리 도구 모음 */}
                <div className="flex items-center gap-1.5 flex-wrap mb-2 text-xs">
                  <span className="text-blue-800 mr-1">선택 {selectedReqIds.size}건</span>
                  <button onClick={() => bulkResetPasswords(resetRequests)}
                    className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">
                    🔑 대기 전부 초기화
                  </button>
                  <button onClick={() => bulkResetPasswords(resetRequests.filter(r => selectedReqIds.has(r.id)))}
                    disabled={selectedReqIds.size === 0}
                    className="px-2.5 py-1.5 bg-blue-100 text-blue-800 rounded-lg font-semibold hover:bg-blue-200 disabled:opacity-40">
                    🔑 선택 일괄 초기화
                  </button>
                  <button onClick={() => bulkDeleteRequests(Array.from(selectedReqIds))}
                    disabled={selectedReqIds.size === 0}
                    className="px-2.5 py-1.5 bg-white border border-red-300 text-red-600 rounded-lg font-semibold hover:bg-red-50 disabled:opacity-40">
                    🗑️ 선택 일괄 삭제
                  </button>
                </div>

                <div className="space-y-2">
                  {resetRequests.map(req => {
                    const isFindId = req.request_type === 'find_id'
                    const lookup = idLookups[req.id]
                    const checked = selectedReqIds.has(req.id)
                    return (
                    <div key={req.id} className="bg-white border border-blue-200 rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex items-start gap-2 text-sm">
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleReqSelect(req.id)}
                            className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div>
                          <div className="font-medium flex items-center gap-1.5 flex-wrap">
                            {isFindId
                              ? <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">🔍 아이디 찾기</span>
                              : <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">🔑 비번 초기화</span>}
                            {req.realname}
                            {!isFindId && <span className="text-gray-500 font-mono text-xs">@{req.username}</span>}
                            {req.school && <span className="text-gray-500 text-xs ml-1">· {req.school}</span>}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {req.contact ? `📞 ${req.contact}` : '연락처 없음 (지인 통해 전달)'}
                            <span className="ml-2">{new Date(req.created_at).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                          </div>
                          </div>
                        </div>
                        <div className="flex gap-1.5 flex-wrap">
                          {isFindId ? (
                            <>
                              <button onClick={() => findIdCandidates(req)}
                                className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700">
                                🔍 교사 찾기
                              </button>
                              <button onClick={() => markRequestDone(req)}
                                className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg font-semibold hover:bg-gray-200">
                                ✅ 완료
                              </button>
                            </>
                          ) : (
                            <button onClick={() => handleResetRequest(req)}
                              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">
                              🔑 초기화 처리
                            </button>
                          )}
                          <button onClick={() => deleteRequest(req)}
                            className="text-xs px-3 py-1.5 bg-white border border-red-300 text-red-600 rounded-lg font-semibold hover:bg-red-50">
                            🗑️ 삭제
                          </button>
                        </div>
                      </div>

                      {/* 아이디 찾기 후보 결과 */}
                      {isFindId && lookup && (
                        <div className="mt-2 border-t border-gray-100 pt-2 text-xs">
                          {lookup.loading ? (
                            <span className="text-gray-400">찾는 중...</span>
                          ) : lookup.list.length === 0 ? (
                            <span className="text-red-600">"{req.realname}" 이름의 교사를 찾지 못했어요. 학교명·이름을 요청자에게 다시 확인해주세요.</span>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-gray-500">매칭 교사 {lookup.list.length}명 (학교로 본인 대조 후 아이디 전달):</p>
                              {lookup.list.map((c, i) => (
                                <div key={i} className="flex items-center gap-2 bg-purple-50 rounded px-2 py-1">
                                  <span className="font-mono font-semibold text-purple-800">{c.username}</span>
                                  <span className="text-gray-500">· {c.school || '학교 미입력'}</span>
                                  {c.role === 'admin' && <span className="text-[10px] text-purple-600">[관리자]</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="font-bold">
                  👨‍🏫 가입한 선생님 ({visibleTeachers.length}명
                  {!showBannedTeachers && bannedCount > 0 && (
                    <span className="text-xs text-gray-500"> + 차단 {bannedCount}명 숨김</span>
                  )})
                  {/* 🆕 step435: 지금 접속 중(전체 교사 기준, 검색·필터 무관) */}
                  <span className="ml-2 text-xs font-normal text-blue-600">
                    🟦 지금 접속 중 {teachers.filter(x => isOnline(x.last_seen_at)).length}명
                  </span>
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 🆕 step249: 선생님 검색 (이름·아이디·학교) */}
                  <input type="text" value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)}
                    placeholder="🔍 이름·아이디·학교"
                    className="text-sm border border-gray-200 rounded p-2 w-[180px]" />
                  {/* 🆕 정렬 셀렉트 */}
                  <select value={teacherSort} onChange={e => setTeacherSort(e.target.value)}
                    className="text-sm border border-gray-200 rounded p-2">
                    <option value="recent">가입 최신순</option>
                    <option value="oldest_activity">마지막 활동 오래된 순</option>
                    <option value="students">학생 많은 순</option>
                    <option value="subs">글 많은 순</option>
                  </select>
                  {bannedCount > 0 && (
                    <button onClick={() => setShowBannedTeachers(!showBannedTeachers)}
                      className="text-xs px-3 py-1 border border-gray-200 rounded hover:bg-gray-50">
                      {showBannedTeachers ? '👁️ 정상 계정만 보기' : `🔍 차단 포함 보기 (${bannedCount})`}
                    </button>
                  )}
                </div>
              </div>

              {/* 🆕 활동 단계 요약 카드 4장 — 클릭=해당 단계만 필터(재클릭 해제) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                {['active', 'cooling', 'at_risk', 'dormant'].map(key => {
                  const m = STAGE_META[key]
                  const on = teacherStageFilter === key
                  return (
                    <button key={key} onClick={() => toggleStageFilter(key)}
                      className={`text-left rounded-xl p-3 border transition ${m.badge} ${on ? `ring-2 ring-offset-1 ${m.ring} border-transparent` : 'border-transparent hover:opacity-80'}`}>
                      <div className="text-xs font-semibold">{m.emoji} {m.label}</div>
                      <div className="text-xl font-bold mt-0.5">{stageCounts[key]}명</div>
                      <div className="text-[11px] opacity-70 mt-0.5">{m.desc}</div>
                    </button>
                  )
                })}
              </div>
              {/* 🆕 활성 필터 칩 */}
              {teacherStageFilter && (
                <div className="mb-2">
                  <span className="inline-flex items-center gap-1.5 text-xs bg-gray-800 text-white rounded-full pl-3 pr-1.5 py-1">
                    지금 보는 중: {STAGE_META[teacherStageFilter].emoji} {STAGE_META[teacherStageFilter].label} {listed.length}명
                    <button onClick={() => toggleStageFilter(teacherStageFilter)}
                      className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-gray-600" aria-label="필터 해제">✕</button>
                  </span>
                </div>
              )}

              {visibleTeachers.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  {tq ? '검색 결과가 없어요' : teachers.length === 0 ? '가입한 선생님이 없어요' : '정상 계정이 없어요. "차단 포함 보기"를 눌러주세요.'}
                </p>
              ) : listed.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">이 단계의 선생님이 없어요</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left w-6"></th>
                        <th className="p-2 text-left">이름</th>
                        <th className="p-2 text-left">학교</th>
                        <th className="p-2 text-left">아이디</th>
                        <th className="p-2 text-left">운영 학급</th>
                        <th className="p-2 text-left">권한</th>
                        <th className="p-2 text-left">가입일</th>
                        <th className="p-2 text-left">상태</th>
                        <th className="p-2 text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listed.map(({ t, myClasses, totalStudents, totalSubs, totalFirst, lastActivity, stage, diag }) => {
                        // 🆕 파생값(myClasses·합계·lastActivity·stage·diag)은 위 enriched에서 계산됨
                        const isExpanded = expandedTeacherId === t.id

                        // 🆕 단계 통합 배지 — 기존 '마지막 활동 N일 전' 배지를 대체(단계+일수 통합, 정보 유실 없음)
                        const sm = STAGE_META[stage]
                        let stageLabel = `${sm.emoji} ${sm.label}`
                        if (lastActivity) {
                          const diffDays = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000)
                          stageLabel += diffDays === 0 ? ' · 오늘' : diffDays === 1 ? ' · 어제' : ` · ${diffDays}일 전`
                        }

                        // 🆕 step254: 마지막 로그인(글 활동과 별개 신호 — auth.users.last_sign_in_at)
                        const lastLogin = teacherLastLogin[t.id]
                        let loginLabel = lastLoginLoaded ? '로그인 기록 없음' : '·'  // 🆕 step334: 비차단 로딩 전엔 placeholder
                        if (lastLogin) {
                          const ld = Math.floor((Date.now() - new Date(lastLogin).getTime()) / 86400000)
                          loginLabel = ld === 0 ? '오늘 로그인' : `${ld}일 전 로그인`
                        }

                        return (
                          <React.Fragment key={t.id}>
                            <tr
                              className={`border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${t.is_banned ? 'bg-red-50' : ''} ${isExpanded ? 'bg-blue-50/30' : ''}`}
                              onClick={() => setExpandedTeacherId(isExpanded ? null : t.id)}>
                              <td className="p-2 text-gray-400 select-none align-middle">{isExpanded ? '▼' : '▶'}</td>
                              <td className="p-2 font-medium whitespace-nowrap align-middle">
                                {t.realname}
                                {/* 🆕 step435: 5분 이내 하트비트면 접속 중 */}
                                {isOnline(t.last_seen_at) && (
                                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">🟦 접속 중</span>
                                )}
                              </td>
                              <td className="p-2 text-gray-600 whitespace-nowrap align-middle">{t.school || '-'}</td>
                              <td className="p-2 text-gray-600 font-mono text-xs whitespace-nowrap align-middle">{t.username}</td>
                              <td className="p-2 text-gray-600 align-middle">
                                {/* 2단 배치: 1줄 학급 정보 / 2줄 단계 배지+진단 — 셀 폭 과점유 방지(행 밀도 복구) */}
                                <div className="text-xs">
                                  {myClasses.length === 0 ? (
                                    <span className="text-gray-400 whitespace-nowrap">운영 학급 없음</span>
                                  ) : (
                                    <span className="whitespace-nowrap">
                                      🏫 <strong>{myClasses.length}개</strong> · 👥 {totalStudents}명 · 📝 {totalSubs}건<span className="text-gray-400"> (첫글 {totalFirst}개)</span>
                                    </span>
                                  )}
                                  <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap ${sm.badge}`}>{stageLabel}</span>
                                    {diag && <span className="text-[11px] text-gray-400 whitespace-nowrap">{diag}</span>}
                                  </div>
                                </div>
                              </td>
                              <td className="p-2 align-middle">
                                <span className={`text-xs px-2 py-1 rounded-full font-medium ${t.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {t.role === 'admin' ? '관리자' : '교사'}
                                </span>
                              </td>
                              <td className="p-2 text-xs text-gray-500 whitespace-nowrap align-middle">
                                <div className="flex flex-col gap-0.5">
                                  <span>{toKSTDate(t.created_at).slice(2).replace(/-/g, '.')}</span>
                                  <span className="w-fit rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-[11px]">🔑 {loginLabel}</span>
                                </div>
                              </td>
                              <td className="p-2 align-middle">
                                {t.is_banned ? (
                                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">차단됨</span>
                                ) : (
                                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">정상</span>
                                )}
                              </td>
                              <td className="p-2 text-center align-middle" onClick={e => e.stopPropagation()}>
                                {/* 작업 버튼 가로 1줄 고정(flex-nowrap) — 세로 쌓임 방지, 좁으면 테이블 가로 스크롤 */}
                                <div className="flex flex-nowrap gap-1 justify-center">
                                  {/* 🆕 비밀번호 초기화 (비번 잊은 선생님 구제) */}
                                  {!t.is_banned && (
                                    <button onClick={() => resetTeacherPassword(t)}
                                      className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                                      title="비밀번호를 잊은 선생님에게 새 비밀번호를 만들어주세요">
                                      🔑
                                    </button>
                                  )}
                                  {t.role !== 'admin' && !t.is_banned && (
                                    <button onClick={() => toggleTeacherBan(t)}
                                      className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200">
                                      차단
                                    </button>
                                  )}
                                  {t.role !== 'admin' && t.is_banned && (
                                    <button onClick={() => toggleTeacherBan(t)}
                                      className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200">
                                      차단 해제
                                    </button>
                                  )}
                                  {!t.is_banned && (
                                    <button onClick={() => toggleAdmin(t)}
                                      className={`text-xs px-2 py-1 rounded ${
                                        t.role === 'admin'
                                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                          : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                  }`}>
                                  {t.role === 'admin' ? '관리자 해제' : '관리자 부여'}
                                </button>
                              )}
                              {/* 🆕 휴지통 (B4) */}
                              {t.id !== user?.id && (
                                <button onClick={() => trashTeacher(t)}
                                  className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                  title="휴지통으로 보내기 (30일 후 영구삭제)">
                                  🗑️
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {/* 🆕 펼침 행 — 운영 학급 상세 */}
                        {isExpanded && (
                          <tr className="bg-blue-50/30 border-b border-gray-200">
                            <td></td>
                            <td colSpan={8} className="p-3">
                              {myClasses.length === 0 ? (
                                <div className="text-sm text-gray-500 py-2">
                                  운영 중인 학급이 없어요.
                                  {t.role === 'admin' && ' (관리자 계정은 학급 없이도 작동해요)'}
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="text-xs text-gray-600 font-semibold mb-1">
                                    운영 학급 {myClasses.length}개 · 총 학생 {totalStudents}명 · 총 제출 {totalSubs}건
                                  </div>
                                  {myClasses.map(c => {
                                    const lastAct = c.last_activity_at
                                    let lastLabel = '활동 없음'
                                    let lastColor = 'text-gray-400'
                                    if (lastAct) {
                                      const d = Math.floor((Date.now() - new Date(lastAct).getTime()) / 86400000)
                                      if (d === 0) { lastLabel = '오늘'; lastColor = 'text-green-700' }
                                      else if (d <= 7) { lastLabel = `${d}일 전`; lastColor = 'text-blue-700' }
                                      else { lastLabel = `${d}일 전`; lastColor = 'text-gray-600' }
                                    }
                                    return (
                                      <div key={c.id} className={`bg-white border ${c.is_active === false ? 'border-orange-200 bg-orange-50/30' : 'border-gray-200'} rounded-lg p-3 flex items-center gap-3 flex-wrap`}>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold text-gray-900">{c.name}</span>
                                            <span className="text-xs text-gray-500 font-mono">{c.code}</span>
                                            {c.is_active === false && (
                                              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">비활성</span>
                                            )}
                                          </div>
                                          <div className="text-xs text-gray-600 mt-1 flex gap-3 flex-wrap">
                                            <span>👥 학생 <strong>{c.student_count || 0}</strong>명</span>
                                            <span>📝 제출 <strong>{c.submission_count || 0}</strong>건</span>
                                            <span className={lastColor}>⏱️ {lastLabel}</span>
                                          </div>
                                        </div>
                                        <div className="flex gap-1 flex-wrap">
                                          <a href={`/teacher?as=${t.id}`}
                                            target="_blank" rel="noopener noreferrer"
                                            className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                                            title="새 탭에서 담임 화면 그대로 보기">
                                            🔍 엿보기
                                          </a>
                                          <button onClick={() => toggleClassActive(c)}
                                            className={`text-xs px-2 py-1 rounded ${c.is_active === false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                                            {c.is_active === false ? '활성화' : '비활성화'}
                                          </button>
                                          <button onClick={() => trashClass(c)}
                                            className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                            title="학급 휴지통으로">
                                            🗑️
                                          </button>
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            </div>
            )
          })()}

          {tab === 'classes' && (() => {
            // 🆕 비활성 학급 필터링 (와이프 피드백 9번)
            // 🆕 활동 상태(보유값): 활동 = 학생>0 OR 누적 글>0 (model_stats가 '-'로 비어도 학생 있으면 활동)
            const isActiveClass = (c) => (c.student_count || 0) > 0 || ((c.model_stats?.total) || 0) > 0
            const byActivity = (c) => classActivityFilter === 'all'
              ? true
              : classActivityFilter === 'active' ? isActiveClass(c) : !isActiveClass(c)
            // 🆕 step250 검색(학급명·담임·학교·코드, 부분일치·대소문자무시) — 활동 필터와 AND
            const cq = classSearch.trim().toLowerCase()
            const matchClass = (c) => !cq
              || (c.name || '').toLowerCase().includes(cq)
              || (c.teacher_profile?.realname || '').toLowerCase().includes(cq)
              || (c.teacher_profile?.school || '').toLowerCase().includes(cq)
              || (c.code || '').toLowerCase().includes(cq)
            const visibleClasses = (showInactiveClasses
              ? classes
              : classes.filter(c => c.is_active !== false)
            ).filter(byActivity).filter(matchClass)
            const inactiveCount = classes.filter(c => c.is_active === false).length

            return (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="font-bold">
                  🏫 학급 목록 ({visibleClasses.length}개
                  {!showInactiveClasses && inactiveCount > 0 && (
                    <span className="text-xs text-gray-500"> + 비활성 {inactiveCount}개 숨김</span>
                  )})
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 🆕 step250: 학급 검색 (학급명·담임·학교·코드) */}
                  <input type="text" value={classSearch} onChange={e => setClassSearch(e.target.value)}
                    placeholder="🔍 학급명·담임·학교·코드"
                    className="text-sm border border-gray-200 rounded p-2 w-[200px]" />
                  {/* 🆕 활동 상태 필터 (보유값 기준: 학생>0 && 채점글>0) */}
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <span className="text-xs text-gray-600 px-1.5">활동:</span>
                    {[{ v: 'all', l: '전체' }, { v: 'active', l: '활동' }, { v: 'inactive', l: '비활동' }].map(opt => (
                      <button key={opt.v}
                        onClick={() => setClassActivityFilter(opt.v)}
                        className={`text-xs px-2 py-1 rounded ${
                          classActivityFilter === opt.v
                            ? 'bg-white shadow-sm font-semibold text-primary'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}>
                        {opt.l}
                      </button>
                    ))}
                  </div>
                  {inactiveCount > 0 && (
                    <button onClick={() => setShowInactiveClasses(!showInactiveClasses)}
                      className="text-xs px-3 py-1 border border-gray-200 rounded hover:bg-gray-50">
                      {showInactiveClasses ? '👁️ 활성만 보기' : `🔍 비활성 포함 보기 (${inactiveCount})`}
                    </button>
                  )}
                </div>
              </div>
              {visibleClasses.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  {cq ? '검색 결과가 없어요' : classes.length === 0 ? '학급이 없어요' : '활성 학급이 없어요. "비활성 포함 보기"를 눌러주세요.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 text-left">학급명</th>
                        <th className="p-2 text-left">담임</th>
                        <th className="p-2 text-left">학교</th>
                        <th className="p-2 text-center">학생수</th>
                        <th className="p-2 text-left">코드</th>
                        <th className="p-2 text-left">API 키</th>
                        <th className="p-2 text-left">채점 모델</th>
                        <th className="p-2 text-left">상태</th>
                        <th className="p-2 text-center">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleClasses.map(c => {
                        // 채점 모델 분포 텍스트 만들기 (와이프 피드백 1번)
                        const ms = c.model_stats || { models: {}, total: 0, fallback: 0 }
                        const modelEntries = Object.entries(ms.models).sort((a, b) => b[1] - a[1])
                        // 모델 짧은 이름 ('gemini-3.1-flash-lite' → '3.1F-lite')
                        const shortName = (m) => {
                          if (!m || m === '(미기록)') return '미기록'
                          return m
                            .replace('gemini-', '')
                            .replace('-flash-lite', 'F-lite')
                            .replace('-flash-preview', 'F-prev')
                            .replace('-flash', 'F')
                        }
                        return (
                        <tr key={c.id} className={`border-b border-gray-100 ${c.is_active === false ? 'bg-gray-100 opacity-60' : ''}`}>
                          <td className="p-2 font-medium">
                            <div>{c.name}</div>
                            {/* 🆕 step253: 마지막 활동 + 누적 글수(표시만) */}
                            <div className="text-[11px] text-gray-400 font-normal">
                              {(() => {
                                if (!c.last_activity_at) return '활동 기록 없음'
                                const d = Math.floor((Date.now() - new Date(c.last_activity_at).getTime()) / 86400000)
                                return d === 0 ? '오늘 활동' : `마지막 활동 ${d}일 전`
                              })()} · 글 {c.submission_count || 0}개
                            </div>
                          </td>
                          <td className="p-2 text-gray-600">{c.teacher_profile?.realname || '-'}</td>
                          <td className="p-2 text-gray-600">{c.teacher_profile?.school || '-'}</td>
                          <td className="p-2 text-center text-gray-600">{c.student_count || 0}</td>
                          <td className="p-2 font-mono text-sm">{c.code}</td>
                          <td className="p-2">
                            {c.has_api_key ? (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">✅</span>
                            ) : (
                              <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full">미등록</span>
                            )}
                          </td>
                          <td className="p-2">
                            {ms.total === 0 ? (
                              <span className="text-xs text-gray-400">{(c.student_count || 0) === 0 ? '- (학생 없음)' : '- (글 없음)'}</span>
                            ) : (
                              <div className="space-y-0.5">
                                <div className="text-xs text-gray-700">
                                  총 <strong>{ms.total}</strong>건
                                  {ms.fallback > 0 && (
                                    <span className="ml-1 text-orange-700">
                                      (폴백 {ms.fallback})
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {modelEntries.slice(0, 3).map(([m, count]) => (
                                    <span key={m} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded" title={m}>
                                      {shortName(m)} {count}
                                    </span>
                                  ))}
                                  {modelEntries.length > 3 && (
                                    <span className="text-[10px] text-gray-500">+{modelEntries.length - 3}</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="p-2">
                            {c.is_active === false ? (
                              <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full">비활성</span>
                            ) : (
                              <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">활성</span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            <div className="flex items-center gap-1 justify-center flex-wrap">
                              {c.teacher_id && (
                                <a href={`/teacher?as=${c.teacher_id}`}
                                  target="_blank" rel="noopener noreferrer"
                                  className="text-xs px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                                  title="새 탭에서 담임 선생님 화면 그대로 보기 (담임에게 알리지 않음)">
                                  🔍 엿보기
                                </a>
                              )}
                              {/* 🆕 step431: 학생 글 탭으로 — 이 학급 필터 자동 적용(tab+class 딥링크, 의심 교정 sub 딥링크 패턴) */}
                              <button onClick={() => {
                                  router.replace({ pathname: router.pathname, query: { ...router.query, tab: 'submissions', class: c.id } }, undefined, { shallow: true })
                                  setTabState('submissions')
                                }}
                                className="text-xs px-3 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                                title="이 학급의 학생 글만 모아 보기">
                                📝 글 보기
                              </button>
                              <button onClick={() => toggleClassActive(c)}
                                className={`text-xs px-3 py-1 rounded ${c.is_active === false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
                                {c.is_active === false ? '활성화' : '비활성화'}
                              </button>
                              {/* 🆕 휴지통 (B4) */}
                              <button onClick={() => trashClass(c)}
                                className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                                title="휴지통으로 보내기 (30일 후 영구삭제)">
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            )
          })()}

          {tab === 'submissions' && <AdminSubmissions />}

          {tab === 'feedbacks' && (() => {
            const visibleFeedbacks = feedbacks.filter(f => !f.is_hidden)
            const hiddenFeedbacks = feedbacks.filter(f => f.is_hidden)
            const displayed = showHiddenFeedback ? feedbacks : visibleFeedbacks
            const selectedCount = selectedFeedbackIds.size
            const allDisplayedSelected = displayed.length > 0 && displayed.every(f => selectedFeedbackIds.has(f.id))
            const selectAll = () => setSelectedFeedbackIds(new Set(displayed.map(f => f.id)))
            const clearSelection = () => setSelectedFeedbackIds(new Set())
            // 선택된 항목 분석 (숨김/보임 카운트)
            const selectedHidden = [...selectedFeedbackIds].filter(id =>
              feedbacks.find(f => f.id === id)?.is_hidden
            ).length
            const selectedVisible = selectedCount - selectedHidden
            return (
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 className="font-bold">
                    💬 받은 의견 ({visibleFeedbacks.length}건
                    {hiddenFeedbacks.length > 0 && <span className="text-xs text-gray-500"> + 숨김 {hiddenFeedbacks.length}건</span>})
                  </h3>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setShowHiddenFeedback(!showHiddenFeedback)}
                      className="text-xs px-3 py-1 border border-gray-200 rounded hover:bg-gray-50">
                      {showHiddenFeedback ? '👁️ 보이는 것만' : `🔍 숨김 포함 보기 (${hiddenFeedbacks.length})`}
                    </button>
                    {visibleFeedbacks.length > 0 && (
                      <button onClick={hideAllVisible}
                        className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded">
                        📦 보이는 의견 모두 숨김
                      </button>
                    )}
                    {showHiddenFeedback && hiddenFeedbacks.length > 0 && (
                      <button onClick={restoreAllHidden}
                        className="text-xs px-3 py-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 rounded">
                        ↩️ 숨김 의견 모두 복원
                      </button>
                    )}
                  </div>
                </div>

                {/* ☑️ 선택 도구바 (선택된 항목이 있을 때 표시) */}
                {selectedCount > 0 && (
                  <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 mb-3 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-blue-900">
                      ☑️ {selectedCount}개 선택됨
                    </span>
                    <div className="flex gap-1.5 flex-wrap ml-auto">
                      {selectedVisible > 0 && (
                        <button onClick={hideSelected}
                          className="text-xs bg-white border border-gray-300 text-gray-700 px-2 py-1 rounded hover:bg-gray-50">
                          🗑️ 숨김 ({selectedVisible})
                        </button>
                      )}
                      {selectedHidden > 0 && (
                        <button onClick={restoreSelected}
                          className="text-xs bg-white border border-emerald-300 text-emerald-700 px-2 py-1 rounded hover:bg-emerald-50">
                          ↩️ 복원 ({selectedHidden})
                        </button>
                      )}
                      <button onClick={clearSelection}
                        className="text-xs text-gray-600 hover:text-gray-800 px-2">
                        ✕ 선택 해제
                      </button>
                    </div>
                  </div>
                )}

                {/* AI 요약 + 복사 도구 */}
                {displayed.length > 0 && (
                  <div className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-3 mb-3">
                    <p className="text-sm font-semibold text-purple-900 mb-2">
                      🤖 Claude에게 보내기 도구
                      {selectedCount > 0 && (
                        <span className="ml-2 text-xs font-normal bg-purple-200 text-purple-900 px-2 py-0.5 rounded-full">
                          선택한 {selectedCount}개만
                        </span>
                      )}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      <button onClick={copyFeedbacks}
                        className="text-xs bg-white border border-purple-300 text-purple-700 px-3 py-2 rounded hover:bg-purple-50 font-medium">
                        📋 {selectedCount > 0 ? `선택 ${selectedCount}개 복사` : '보이는 의견 전체 복사'} (마크다운)
                      </button>
                      <button onClick={summarizeWithAi} disabled={aiSummarizing}
                        className="text-xs bg-purple-600 text-white px-3 py-2 rounded hover:bg-purple-700 disabled:opacity-50 font-medium">
                        {aiSummarizing ? '🤖 분석 중...' : `✨ AI로 ${selectedCount > 0 ? '선택' : '전체'} 카테고리별 요약`}
                      </button>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                      💡 의견을 선택하면 선택한 항목만 처리해요. 선택하지 않으면 화면에 보이는 의견 전체가 대상이 돼요.
                    </p>

                    {aiSummary && (
                      <div className="mt-3 bg-white rounded-lg p-3 border border-purple-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-semibold text-sm text-purple-900">🤖 AI 분석 결과</h4>
                          <div className="flex gap-1">
                            <button onClick={copyAiSummary}
                              className="text-xs bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700">
                              📋 복사
                            </button>
                            <button onClick={() => setAiSummary(null)}
                              className="text-xs text-gray-500 hover:text-gray-800 px-2">✕</button>
                          </div>
                        </div>

                        {aiSummary.categories?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-700 mb-1">📊 카테고리별</p>
                            {aiSummary.categories.map((cat, i) => (
                              <div key={i} className="bg-gray-50 rounded p-2 mb-1.5">
                                <div className="text-xs font-semibold">{cat.name}</div>
                                <ul className="text-xs text-gray-700 list-disc pl-4 mt-1">
                                  {cat.items?.map((item, j) => <li key={j}>{item}</li>)}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}

                        {aiSummary.priorityList?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-700 mb-1">🚨 우선순위</p>
                            <ol className="text-xs text-gray-700 list-decimal pl-4 space-y-0.5">
                              {aiSummary.priorityList.map((item, i) => <li key={i}>{item}</li>)}
                            </ol>
                          </div>
                        )}

                        {aiSummary.summary && (
                          <div>
                            <p className="text-xs font-semibold text-gray-700 mb-1">💡 종합 인사이트</p>
                            <p className="text-xs text-gray-700 bg-blue-50 p-2 rounded">{aiSummary.summary}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {displayed.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8 text-center">
                    {feedbacks.length === 0 ? '받은 의견이 없어요' : '보이는 의견이 없어요. 숨김 포함 보기를 사용하세요.'}
                  </p>
                ) : (
                  <>
                    {/* 전체 선택 헤더 */}
                    <div className="flex items-center gap-2 mb-2 px-1 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={allDisplayedSelected}
                        onChange={() => allDisplayedSelected ? clearSelection() : selectAll()}
                        className="w-4 h-4 cursor-pointer"
                      />
                      <button onClick={() => allDisplayedSelected ? clearSelection() : selectAll()}
                        className="hover:text-gray-900">
                        {allDisplayedSelected ? '전체 해제' : `전체 선택 (${displayed.length})`}
                      </button>
                    </div>

                    <div className="space-y-2">
                      {displayed.map(f => {
                        const isSelected = selectedFeedbackIds.has(f.id)
                        return (
                          <div key={f.id}
                            className={`rounded-lg p-3 flex items-start gap-3 ${
                              isSelected
                                ? 'bg-blue-50 border-2 border-blue-300'
                                : f.is_hidden
                                  ? 'bg-gray-100 opacity-60'
                                  : 'bg-gray-50 border-2 border-transparent'
                            }`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(f.id)}
                              className="w-4 h-4 mt-1 flex-shrink-0 cursor-pointer"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                                  {/* 🆕 작성자 정보 (와이프 피드백 2번) */}
                                  {f.author ? (
                                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                                      f.author.role === 'admin' ? 'bg-purple-100 text-purple-800' :
                                      f.author.role === 'teacher' ? 'bg-blue-100 text-blue-800' :
                                      'bg-green-100 text-green-800'
                                    }`}>
                                      {f.author.role === 'admin' ? '🛡️ ' :
                                       f.author.role === 'teacher' ? '👨‍🏫 ' : '👤 '}
                                      {f.author.realname || f.author.username || '이름 없음'}
                                      {f.author.role === 'student' && f.author.class_name && (
                                        <span className="ml-1 opacity-80">· {f.author.class_name}</span>
                                      )}
                                      {f.author.role === 'student' && (() => {
                                        const teacher = classes.find(c => c.id === f.author.class_id)?.teacher_profile?.realname
                                        return teacher ? <span className="ml-1 opacity-80">· 담임 {teacher}</span> : null
                                      })()}
                                      {(f.author.role === 'teacher' || f.author.role === 'admin') && f.author.school && (
                                        <span className="ml-1 opacity-80">· {f.author.school}</span>
                                      )}
                                    </span>
                                  ) : (
                                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                      🕵️ 익명/구버전
                                    </span>
                                  )}
                                  <span>{toKST(f.created_at)}</span>
                                  {f.is_hidden && <span className="bg-gray-200 px-1.5 py-0.5 rounded">숨김</span>}
                                </div>
                                <button onClick={() => toggleHideFeedback(f)}
                                  className="text-xs text-gray-500 hover:text-gray-800 underline whitespace-nowrap">
                                  {f.is_hidden ? '↩️ 복원' : '🗑️ 숨김'}
                                </button>
                              </div>
                              <div className="text-sm whitespace-pre-wrap">{f.content}</div>

                              {/* 🆕 step205-B: 답변 */}
                              <div className="mt-2 pt-2 border-t border-gray-200">
                                {!f.user_id ? (
                                  <p className="text-xs text-gray-400">🕵️ 비로그인 의견이라 답변을 보낼 수 없어요.</p>
                                ) : (f.reply_text && editingReply !== f.id) ? (
                                  <div>
                                    <div className="text-xs text-blue-700 font-medium mb-0.5">
                                      💬 내 답변
                                      {f.replied_at && <span className="text-gray-400 font-normal ml-1">· {toKST(f.replied_at)}</span>}
                                    </div>
                                    <div className="text-sm bg-blue-50 border border-blue-100 rounded p-2 whitespace-pre-wrap">{f.reply_text}</div>
                                    <button onClick={() => { setEditingReply(f.id); setReplyDraft(d => ({ ...d, [f.id]: f.reply_text })) }}
                                      className="text-xs text-gray-500 underline mt-1">수정</button>
                                  </div>
                                ) : (
                                  <div>
                                    <textarea value={replyDraft[f.id] ?? ''}
                                      onChange={e => setReplyDraft(d => ({ ...d, [f.id]: e.target.value }))}
                                      rows={2} placeholder="이 의견에 답변을 입력하세요..."
                                      className="w-full p-2 border border-gray-200 rounded text-sm" />
                                    <div className="flex gap-2 mt-1">
                                      <button onClick={() => saveReply(f)} disabled={savingReplyId === f.id}
                                        className="text-xs px-3 py-1.5 bg-primary text-white rounded disabled:opacity-50">
                                        {savingReplyId === f.id ? '저장 중...' : (f.reply_text ? '답변 수정' : '답변 저장')}
                                      </button>
                                      {f.reply_text && (
                                        <button onClick={() => setEditingReply(null)}
                                          className="text-xs px-3 py-1.5 border border-gray-200 rounded">취소</button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })()}

          {/* 🆕 공유 추천 탭 (관리자 추적용 — 누가 뭘 공유했는지) */}
          {tab === 'shared-suggestions' && (
            <div className="space-y-4">
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm text-purple-900">
                <p className="font-semibold mb-1">📚 공유 추천 현황</p>
                <p className="text-xs">
                  · 학급에 실제로 등록된 추천(자동 공유) + 명시적으로 공유 토글한 추천 모두 표시
                  · 일반 선생님 화면에선 공유자 정보 익명("👤 다른 선생님")
                  · 여기선 누가 공유했는지 확인 가능
                </p>
              </div>

              <div className="bg-white rounded-2xl p-4 shadow-sm">
                {sharedSuggestionLogs.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-8">아직 공유된 추천이 없어요</p>
                ) : (
                  <div className="space-y-2">
                    {sharedSuggestionLogs.map(log => {
                      const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
                      const picked = log.selected_index !== null && log.selected_index !== undefined
                        ? sugs[log.selected_index]
                        : null
                      const isRegistered = !!log.resulting_topic_id
                      const sharedIdxs = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
                      const isExplicit = !!log.is_shared || sharedIdxs.length > 0
                      const dateStr = log.created_at
                        ? new Date(log.created_at).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
                        : ''

                      return (
                        <div key={log.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
                          <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                            <div className="flex items-center gap-2 flex-wrap text-xs">
                              <span className="text-gray-500">{dateStr}</span>
                              {isRegistered && (
                                <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                  🌐 학급 등록
                                </span>
                              )}
                              {isExplicit && (
                                <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                                  🔗 개별 공유 {sharedIdxs.length > 0 ? `${sharedIdxs.length}개` : ''}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-700 font-medium">
                              👤 {log.author?.realname || '(삭제된 계정)'}
                              {log.author?.role === 'admin' && (
                                <span className="ml-1 text-purple-600 text-[10px]">[관리자]</span>
                              )}
                              {log.author?.school && (
                                <span className="ml-1 text-gray-500">· {log.author.school}</span>
                              )}
                            </div>
                          </div>

                          {/* 선택된 주제 (등록된 경우 그게 메인) */}
                          {picked && (
                            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded p-2 mb-2">
                              <div className="text-sm font-semibold text-gray-900">
                                {isRegistered ? '✅ 등록한 주제: ' : '👆 선택만 한 주제: '}{picked.title}
                              </div>
                              {picked.description && (
                                <div className="text-xs text-gray-600 mt-0.5">{picked.description}</div>
                              )}
                              {picked.category && (
                                <span className="text-[10px] text-purple-600 mt-1 inline-block">#{picked.category}</span>
                              )}
                              {log.resulting_topic?.date && (
                                <span className="text-[10px] text-gray-500 ml-2">사용일: {log.resulting_topic.date}</span>
                              )}
                            </div>
                          )}

                          {/* 나머지 추천 카드 (명시 공유로 모두 공개되는 경우) */}
                          {isExplicit && sugs.length > 0 && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                                ▼ 이 추천 묶음의 다른 주제 {sugs.length - (picked ? 1 : 0)}개 보기
                              </summary>
                              <div className="mt-2 space-y-1.5">
                                {sugs.map((s, idx) => {
                                  if (picked && idx === log.selected_index) return null
                                  const isSharedCard = sharedIdxs.includes(idx)
                                  return (
                                    <div key={idx} className={`rounded p-2 border ${
                                      isSharedCard
                                        ? 'bg-purple-50 border-purple-300'
                                        : 'bg-gray-50 border-gray-200'
                                    }`}>
                                      <div className="font-medium text-gray-800">
                                        {idx + 1}. {s.title}
                                        {isSharedCard && (
                                          <span className="ml-1 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">🔗 공유됨</span>
                                        )}
                                      </div>
                                      {s.description && (
                                        <div className="text-gray-600 mt-0.5">{s.description}</div>
                                      )}
                                      {s.category && (
                                        <span className="text-[10px] text-purple-600">#{s.category}</span>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </details>
                          )}
                        </div>
                      )
                    })}
                    <p className="text-xs text-gray-400 text-center pt-2">
                      최근 200건까지 표시
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 🆕 주제 공유 추적 탭 (admin 전용 조회) */}
          {tab === 'topic-copies' && (() => {
            const rows = topicCopies
            const teacherLabel = (p) => {
              if (!p) return '(알 수 없음)'
              const nm = (p.realname && p.realname.trim()) ? p.realname.trim() : '(이름 없음)'
              return (p.school && p.school.trim()) ? `${nm} (${p.school.trim()})` : nm
            }
            // 원본 교사별 가져간 횟수 집계
            const byAuthor = {}
            rows.forEach(r => {
              const a = r.source_log?.author
              if (!a) return
              const key = a.id || a.realname || 'unknown'
              if (!byAuthor[key]) byAuthor[key] = { label: teacherLabel(a), count: 0 }
              byAuthor[key].count++
            })
            const ranked = Object.values(byAuthor).sort((x, y) => y.count - x.count)
            return (
              <div className="space-y-4">
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm text-purple-900 leading-relaxed">
                  🔗 누가 어느 선생님의 주제를 가져갔는지 볼 수 있어요. 공유 주제를 가져오기 버튼으로 담은 기록이에요.
                </div>

                {ranked.length > 0 && (
                  <div className="bg-white rounded-2xl p-4 shadow-sm">
                    <h3 className="text-sm font-bold text-gray-800 mb-2">원본 교사별 가져간 횟수</h3>
                    <div className="flex flex-wrap gap-2">
                      {ranked.map((a, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
                          {a.label} · {a.count}번
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-2xl p-4 shadow-sm">
                  {rows.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-6">아직 가져간 기록이 없어요.</p>
                  ) : (
                    <div className="space-y-2">
                      {rows.map(r => {
                        const title = r.source_log?.suggestions?.[r.source_index]?.title || '(주제 정보 없음)'
                        return (
                          <div key={r.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
                            <div className="text-sm text-gray-800">
                              <span className="font-semibold text-blue-700">{teacherLabel(r.copied_by)}</span>
                              <span className="text-gray-400 mx-1">←</span>
                              <span className="font-semibold text-gray-700">{teacherLabel(r.source_log?.author)}</span>
                              <span className="text-gray-500">님의 </span>
                              <span className="text-gray-900">{`'${title}'`}</span>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">{toKSTDate(r.copied_at)}</div>
                          </div>
                        )
                      })}
                      <p className="text-xs text-gray-400 text-center pt-2">최근 200건까지 표시</p>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* 🆕 휴지통 탭 (B4) */}
          {tab === 'trash' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
                <p className="font-semibold mb-1">🗑️ 휴지통</p>
                <p className="text-xs">
                  · 휴지통에 보낸 선생님·학급은 <strong>30일 후 자동으로 영구 삭제</strong>됩니다.
                  · 그 전까지는 언제든 복원 가능합니다.
                  · 영구 삭제 시 학급의 모든 주제·제출물도 함께 삭제되며 되돌릴 수 없습니다.
                </p>
              </div>

              {/* 삭제된 선생님 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h3 className="font-bold mb-3 text-sm">
                  👥 삭제된 선생님 ({trashedTeachers.length})
                </h3>
                {trashedTeachers.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">휴지통이 비어있어요</p>
                ) : (
                  <div className="space-y-2">
                    {trashedTeachers.map(t => {
                      const deletedAt = new Date(t.deleted_at)
                      const daysLeft = Math.ceil((deletedAt.getTime() + 30 * 86400000 - Date.now()) / 86400000)
                      const dDay = daysLeft <= 0 ? '곧 영구삭제' : `D-${daysLeft}`
                      const dDayColor = daysLeft <= 3 ? 'text-red-700 bg-red-50' : daysLeft <= 7 ? 'text-orange-700 bg-orange-50' : 'text-gray-600 bg-gray-50'
                      return (
                        <div key={t.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{t.realname}</span>
                              <span className="text-xs text-gray-500">{t.username}</span>
                              {t.role === 'admin' && (
                                <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">관리자</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {t.school || '학교 미입력'}
                              {t.delete_reason && <span className="ml-2">· 사유: {t.delete_reason}</span>}
                            </div>
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              삭제일: {deletedAt.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <span className={`text-xs font-bold px-2 py-1 rounded ${dDayColor}`}>{dDay}</span>
                          <div className="flex gap-2">
                            <button onClick={() => restoreTeacher(t)}
                              className="text-xs px-3 py-1.5 rounded bg-green-100 text-green-700 hover:bg-green-200">
                              ↩️ 복원
                            </button>
                            <button onClick={() => purgeTeacher(t)}
                              className="text-xs px-3 py-1.5 rounded bg-red-100 text-red-700 hover:bg-red-200">
                              영구삭제
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 삭제된 학급 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <h3 className="font-bold mb-3 text-sm">
                  🏫 삭제된 학급 ({trashedClasses.length})
                </h3>
                {trashedClasses.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">휴지통이 비어있어요</p>
                ) : (
                  <div className="space-y-2">
                    {trashedClasses.map(c => {
                      const deletedAt = new Date(c.deleted_at)
                      const daysLeft = Math.ceil((deletedAt.getTime() + 30 * 86400000 - Date.now()) / 86400000)
                      const dDay = daysLeft <= 0 ? '곧 영구삭제' : `D-${daysLeft}`
                      const dDayColor = daysLeft <= 3 ? 'text-red-700 bg-red-50' : daysLeft <= 7 ? 'text-orange-700 bg-orange-50' : 'text-gray-600 bg-gray-50'
                      return (
                        <div key={c.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900">{c.name}</span>
                              <span className="text-xs text-gray-500 font-mono">{c.code}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {c.school || '학교 미입력'}
                              {c.delete_reason && <span className="ml-2">· 사유: {c.delete_reason}</span>}
                            </div>
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              삭제일: {deletedAt.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <span className={`text-xs font-bold px-2 py-1 rounded ${dDayColor}`}>{dDay}</span>
                          <div className="flex gap-2">
                            <button onClick={() => restoreClass(c)}
                              className="text-xs px-3 py-1.5 rounded bg-green-100 text-green-700 hover:bg-green-200">
                              ↩️ 복원
                            </button>
                            <button onClick={() => purgeClass(c)}
                              className="text-xs px-3 py-1.5 rounded bg-red-100 text-red-700 hover:bg-red-200">
                              영구삭제
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 🆕 step155: 에러 로그 탭 */}
          {tab === 'errors' && (() => {
            const classInfoById = {}
            classes.forEach(c => { classInfoById[c.id] = { name: c.name, teacher: c.teacher_profile?.realname || '', school: c.teacher_profile?.school || '' } })
            // 같은 message 연속 발생을 묶어서 (N회) 표기
            const grouped = []
            for (const e of errorLogs) {
              const last = grouped[grouped.length - 1]
              if (last && last.message === e.message && last.error_type === e.error_type && last.page === e.page) {
                last.count++
              } else {
                grouped.push({ ...e, count: 1 })
              }
            }
            const roleBadge = (r) => {
              const map = {
                admin: 'bg-purple-100 text-purple-700',
                teacher: 'bg-blue-100 text-blue-700',
                student: 'bg-green-100 text-green-700',
                unknown: 'bg-gray-100 text-gray-600',
              }
              return map[r] || map.unknown
            }
            const typeBadge = (t) => {
              const map = {
                ai_call: 'bg-orange-100 text-orange-700',
                api_error: 'bg-red-100 text-red-700',
                js_error: 'bg-amber-100 text-amber-700',
              }
              return map[t] || 'bg-gray-100 text-gray-600'
            }
            // 🆕 표시 시점 원인 분류 (저장구조 불변). 순서 중요: prepayment를 429보다 먼저.
            const classifyError = (msg) => {
              const m = msg || ''
              if (/prepayment|credits are depleted|billing#prepay/i.test(m))
                return { color: 'bg-rose-100 text-rose-700', label: '🔴 유료키 소진', summary: '유료키 잔액 소진 · 무료키로 교체 필요' }
              if (/503|high demand|overloaded|UNAVAILABLE/i.test(m))
                return { color: 'bg-yellow-100 text-yellow-700', label: '🟡 구글 혼잡', summary: '구글 AI 서버 혼잡 · 곧 풀림(조치 불필요)' }
              if (/429|per day|PerDay|quota|exceeded/i.test(m))
                return { color: 'bg-orange-100 text-orange-700', label: '🟠 한도 소진', summary: '무료 한도 소진 · 오후 리셋' }
              if (/401|인증 정보가 유효|UNAUTHENTICATED/i.test(m))
                return { color: 'bg-gray-100 text-gray-600', label: '⚪ 세션 만료', summary: '학생 세션 만료 · 다시 로그인하면 됨(정상)' }
              if (/Failed to fetch|NetworkError/i.test(m))
                return { color: 'bg-gray-100 text-gray-600', label: '⚪ 네트워크', summary: '네트워크 일시 끊김 · 보통 일시적' }
              if (/504|파싱 실패|JSON|TIMEOUT/i.test(m))
                return { color: 'bg-yellow-100 text-yellow-700', label: '🟡 응답지연', summary: '응답 지연/파싱 실패 · 보통 일시적' }
              if (/MetaMask|Invariant|extension|ethereum/i.test(m))
                return { color: 'bg-gray-200 text-gray-500', label: '⚫ 확장노이즈', summary: '브라우저 확장 노이즈 · 무시 가능' }
              return { color: 'bg-gray-100 text-gray-600', label: '⚪ 기타', summary: '기타' }
            }
            // 🆕 분류 라벨 → 심각도 (무시 가능 라벨만 명시, 그 외 = 조치 필요). 라벨 문자열 기준 상수.
            const IGNORE_LABELS = new Set(['🟡 구글 혼잡', '⚪ 세션 만료', '⚪ 네트워크', '🟡 응답지연', '⚫ 확장노이즈'])
            const severityOf = (msg) => IGNORE_LABELS.has(classifyError(msg).label) ? 'ignore' : 'action'
            // 🆕 필터 적용(이미 받아온 grouped에 클라 필터) — 심각도 + 종류
            const matchErr = (e) =>
              (errSeverity === 'all' || severityOf(e.message) === errSeverity) &&
              (errType === 'all' || e.error_type === errType)
            const filteredGrouped = grouped.filter(matchErr)
            // 🆕 종류 토글 후보(받아온 로그에 존재하는 error_type만)
            const typeOptions = [...new Set(errorLogs.map(e => e.error_type).filter(Boolean))]
            // 🆕 학급별 빈도(필터 반영, e.count 합산) — 내림차순
            const classFreq = {}
            filteredGrouped.forEach(e => {
              const k = e.class_id || '(없음)'
              if (!classFreq[k]) classFreq[k] = { count: 0 }
              classFreq[k].count += (e.count || 1)
            })
            const classFreqArr = Object.entries(classFreq)
              .map(([cid, v]) => ({ cid, count: v.count, info: classInfoById[cid] }))
              .sort((a, b) => b.count - a.count)
            const toggleBtn = (active) => `text-xs px-2 py-1 rounded ${active ? 'bg-white shadow-sm font-semibold text-primary' : 'text-gray-600 hover:text-gray-900'}`
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 className="font-bold text-gray-900">🚨 에러 로그 (최근 {errorLogs.length}건{filteredGrouped.length !== grouped.length ? ` · 필터 ${filteredGrouped.length}` : ''})</h3>
                  <span className="text-xs text-gray-500">30일 지나면 자동 삭제돼요</span>
                </div>
                {/* 🆕 필터 바: 심각도 / 종류 / 보기 */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <span className="text-xs text-gray-600 px-1.5">심각도:</span>
                    {[{ v: 'all', l: '전체' }, { v: 'action', l: '🔴 조치 필요' }, { v: 'ignore', l: '⚪ 무시 가능' }].map(o => (
                      <button key={o.v} onClick={() => setErrSeverity(o.v)} className={toggleBtn(errSeverity === o.v)}>{o.l}</button>
                    ))}
                  </div>
                  {typeOptions.length > 0 && (
                    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 flex-wrap">
                      <span className="text-xs text-gray-600 px-1.5">종류:</span>
                      <button onClick={() => setErrType('all')} className={toggleBtn(errType === 'all')}>전체</button>
                      {typeOptions.map(t => (
                        <button key={t} onClick={() => setErrType(t)} className={toggleBtn(errType === t)}>{t}</button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                    <span className="text-xs text-gray-600 px-1.5">보기:</span>
                    {[{ v: 'list', l: '목록' }, { v: 'byClass', l: '학급별 빈도' }].map(o => (
                      <button key={o.v} onClick={() => setErrView(o.v)} className={toggleBtn(errView === o.v)}>{o.l}</button>
                    ))}
                  </div>
                </div>
                {/* 🆕 학급별 빈도 뷰 */}
                {errView === 'byClass' ? (
                  classFreqArr.length === 0 ? (
                    <div className="text-sm text-gray-400 py-8 text-center">표시할 에러가 없어요 🎉</div>
                  ) : (
                    <div className="space-y-1.5">
                      {classFreqArr.map(({ cid, count, info }) => (
                        <div key={cid} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2 text-sm">
                          <span className="text-gray-800">
                            {info ? <>{info.name}{info.school ? ` · ${info.school}` : ''}{info.teacher ? ` (담임 ${info.teacher})` : ''}</> : <span className="text-gray-400">학급 정보 없음 / 비학급 에러</span>}
                          </span>
                          <span className="text-sm font-bold text-rose-600 flex-shrink-0 ml-3">{count}회</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : filteredGrouped.length === 0 ? (
                  <div className="text-sm text-gray-400 py-8 text-center">표시할 에러가 없어요 🎉</div>
                ) : (
                  <div className="space-y-2">
                    {filteredGrouped.map((e, i) => {
                      const c = classifyError(e.message)
                      return (
                      <div key={e.id || i} className="border border-gray-100 rounded-lg p-3 text-sm">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs text-gray-500">{toKST(e.created_at)}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${roleBadge(e.role)}`}>{e.role || 'unknown'}</span>
                          {e.class_id && classInfoById[e.class_id] && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                              {classInfoById[e.class_id].name}{classInfoById[e.class_id].school ? ` · ${classInfoById[e.class_id].school}` : ''}{classInfoById[e.class_id].teacher ? ` (담임 ${classInfoById[e.class_id].teacher})` : ''}
                            </span>
                          )}
                          {e.role === 'student' && e.user_id && logStudentNumbers[e.user_id] && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{logStudentNumbers[e.user_id]}번</span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeBadge(e.error_type)}`}>{e.error_type}</span>
                          {e.page && <span className="text-[10px] text-gray-400">{e.page}</span>}
                          {e.count > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">({e.count}회)</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${c.color}`}>{c.label}</span>
                        </div>
                        <div className="text-sm text-gray-800">{c.summary}</div>
                        <div className="text-[10px] text-gray-400 break-all mt-0.5">{e.message}</div>
                        {e.context && (
                          <div className="text-[11px] text-gray-400 mt-1 break-all">{JSON.stringify(e.context)}</div>
                        )}
                      </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}

          {/* 🔍 step359: 의심 교정 탭 — pg_cron이 매일 적재하는 correction_alerts(미해결) 확인·해결 */}
          {tab === 'corrections' && (() => {
            const suspectBadge = (t) => {
              const map = {
                '안않오교정': 'bg-purple-100 text-purple-700',
                '불가능형태': 'bg-red-100 text-red-700',
                '문체개입': 'bg-orange-100 text-orange-700',
                '과도한변형': 'bg-yellow-100 text-yellow-700',
              }
              // '(차단됨)' 접미 변형도 같은 색 — prefix 매칭
              const key = Object.keys(map).find(k => (t || '').startsWith(k))
              return key ? map[key] : 'bg-gray-100 text-gray-600'
            }
            // 🆕 중복 묶기: 유형+원문+교정이 같은 행을 한 카드로(대표=최신 행, 목록이 최신순이라 첫 행)
            const groups = []
            const gmap = {}
            suspectAlerts.forEach(a => {
              const key = `${a.suspect_type || ''}|${a.original || ''}|${a.correction || ''}`
              if (gmap[key]) gmap[key].ids.push(a.id)
              else { gmap[key] = { rep: a, ids: [a.id] }; groups.push(gmap[key]) }
            })
            // 🆕 유형 필터 칩 — prefix 매칭('(차단됨)' 무관), 클라이언트 필터만
            const FILTER_CHIPS = ['전체', '안않오교정', '불가능형태', '문체개입', '과도한변형']
            const filtered = suspectFilter === '전체'
              ? groups
              : groups.filter(g => (g.rep.suspect_type || '').startsWith(suspectFilter))
            // 해당 학생 글로 이동 — 학생 글 탭의 sub 딥링크 재사용 (한 번의 replace로 tab+sub 동시 반영)
            const goToSubmission = (submissionId) => {
              router.replace({ pathname: router.pathname, query: { ...router.query, tab: 'submissions', sub: submissionId } }, undefined, { shallow: true })
              setTabState('submissions')
            }
            return (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                  <h2 className="text-lg font-bold">🔍 의심 교정 {suspectCount > 0 && <span className="text-red-500">({suspectCount}건 미해결)</span>}</h2>
                  {suspectCount > 0 && (
                    <button onClick={resolveAllAlerts}
                      className="text-xs bg-gray-700 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition">
                      ✅ 모두 해결
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mb-4">AI 맞춤법 교정 중 의심스러운 건을 매일 자동으로 모아요. 내용을 확인한 뒤 해결 처리하면 목록에서 사라져요.</p>

                {!suspectLoaded ? (
                  <div className="py-8 text-center text-sm text-gray-400">불러오는 중...</div>
                ) : suspectError ? (
                  /* 🆕 step369: 로드 실패를 숨기지 않고 표시 */
                  <div className="py-6 text-center">
                    <div className="inline-block bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                      목록을 불러오지 못했어요.
                      <div className="text-xs text-red-500 mt-1 break-all">{suspectError}</div>
                    </div>
                    <div className="mt-3">
                      <button onClick={() => { setSuspectError(null); setSuspectLoaded(false) }}
                        className="text-xs bg-gray-700 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition">
                        🔄 다시 시도
                      </button>
                    </div>
                  </div>
                ) : suspectAlerts.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-400">의심 교정이 없어요 🎉</div>
                ) : (
                  <>
                    {/* 🆕 유형 필터 칩 — 클라이언트 표시 필터만 */}
                    <div className="flex gap-1.5 flex-wrap mb-3">
                      {FILTER_CHIPS.map(f => (
                        <button key={f} onClick={() => setSuspectFilter(f)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition ${suspectFilter === f
                            ? 'bg-gray-800 text-white border-gray-800'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                          {f}
                        </button>
                      ))}
                    </div>
                    {filtered.length === 0 ? (
                      <div className="py-8 text-center text-sm text-gray-400">이 유형의 의심 교정이 없어요</div>
                    ) : (
                      <div className="space-y-3">
                        {filtered.map(g => { const a = g.rep; return (
                          <div key={a.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50">
                            {/* 1행: 배지·중복수·시각 + 해결 버튼(우측) */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${suspectBadge(a.suspect_type)}`}>{a.suspect_type || '미분류'}</span>
                              {g.ids.length > 1 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-gray-200 text-gray-600">×{g.ids.length}</span>
                              )}
                              <span className="text-xs text-gray-400">감지 {toKST(a.created_at)}</span>
                              {a.submission_created_at && <span className="text-xs text-gray-400">글 작성 {toKST(a.submission_created_at)}</span>}
                              <span className="ml-auto">
                                <button onClick={() => g.ids.length > 1 ? resolveGroup(g.ids) : resolveAlert(g.ids[0])}
                                  className="text-xs bg-green-50 text-green-700 px-2.5 py-1 rounded-lg hover:bg-green-100 transition">
                                  ✅ 해결{g.ids.length > 1 ? ` ${g.ids.length}건` : ''}
                                </button>
                              </span>
                            </div>
                            {/* 2행(주인공): 교정 내용 크게 */}
                            <div className="text-base sm:text-lg text-gray-900 mt-2">
                              <span className="line-through text-red-600">{a.original}</span>
                              <span className="mx-2 text-gray-400">→</span>
                              <span className="font-bold text-green-700">{a.correction}</span>
                            </div>
                            {/* 3행: 원문 속 맥락 문장 (step371 로직 그대로, 위치만 아래로) */}
                            {(() => {
                              const c = suspectMeta[a.id]?.ctx
                              if (!c || c.kind === 'skip') return null
                              if (c.kind === 'gone') return <div className="mt-2 text-xs text-gray-400 italic">(글 없음)</div>
                              if (c.kind === 'notfound') return <div className="mt-2 text-xs text-gray-400 italic">(원문에서 위치를 찾지 못했어요)</div>
                              // 🆕 step398 후속: 차단 기록 발췌(original 위치 못 찾음) — 하이라이트 없이 원문 그대로
                              if (c.kind === 'excerpt') return (
                                <div className="mt-2 pl-2 border-l-2 border-gray-200 text-xs text-gray-500 whitespace-pre-wrap">{c.text}</div>
                              )
                              return (
                                <div className="mt-2 pl-2 border-l-2 border-gray-200 text-xs text-gray-500 whitespace-pre-wrap">
                                  {c.before}<mark className="bg-yellow-200 text-gray-900 rounded px-0.5">{c.match}</mark>{c.after}
                                </div>
                              )
                            })()}
                            {/* 4행: 판단 이유 */}
                            {a.reason && <div className="text-xs text-gray-500 mt-1.5">💬 {a.reason}</div>}
                            {/* 5행: 작성 학생 정보(step371) + 글 보기(submission_id 있을 때만, 기존 조건 그대로) */}
                            {(suspectMeta[a.id]?.student || a.submission_id) && (
                              <div className="flex items-center gap-2 flex-wrap mt-2">
                                {(() => {
                                  const s = suspectMeta[a.id]?.student
                                  if (!s) return null
                                  if (s.kind === 'none') return <span className="text-xs text-gray-400">🏫 (정보 없음)</span>
                                  const parts = [s.school, s.className, s.teacher && `담임 ${s.teacher}`, s.numName].filter(Boolean)
                                  return <span className="text-xs text-gray-500">🏫 {parts.join(' · ')}</span>
                                })()}
                                {a.submission_id && (
                                  <button onClick={() => goToSubmission(a.submission_id)}
                                    className="text-xs bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg hover:bg-blue-100 transition">
                                    📝 글 보기
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )})}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })()}

          {/* 🆕 step382: 사전 신청 명단 탭 — 응답 요약 + 신청자 목록 (SELECT만) */}
          {tab === 'preorders' && (() => {
            const interested = preorderList.rows.filter(r => r.response !== 'not_sure')
            const notSure = preorderList.rows.filter(r => r.response === 'not_sure')
            return (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-lg font-bold mb-1">🎟️ 사전 신청</h2>
                {!preorderList.loaded ? (
                  <div className="py-8 text-center text-sm text-gray-400">불러오는 중...</div>
                ) : preorderList.error ? (
                  <div className="py-6 text-center">
                    <div className="inline-block bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                      명단을 불러오지 못했어요.
                      <div className="text-xs text-red-500 mt-1 break-all">{preorderList.error}</div>
                    </div>
                    <div className="mt-3">
                      <button onClick={() => setPreorderList({ loaded: false, rows: [], error: null })}
                        className="text-xs bg-gray-700 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition">
                        🔄 다시 시도
                      </button>
                    </div>
                  </div>
                ) : preorderList.rows.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-400">아직 신청이 없어요</div>
                ) : (
                  <>
                    <p className="text-sm text-gray-600 mb-4">관심 {interested.length} · 아직 모르겠어요 {notSure.length}</p>
                    <div className="space-y-2">
                      {preorderList.rows.map((r, i) => (
                        <div key={r.teacher_id || i} className="p-3 rounded-xl border border-gray-100 bg-gray-50 flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-800">{r.realname}</span>
                          {r.school && <span className="text-xs text-gray-500">{r.school}</span>}
                          {r.className && <span className="text-xs text-gray-500">{r.className}</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                            r.response === 'not_sure' ? 'bg-gray-100 text-gray-600' : 'bg-teal-50 text-teal-700'
                          }`}>
                            {r.response === 'not_sure' ? '아직 모르겠어요' : '관심 있어요'}
                          </span>
                          <span className="ml-auto text-xs text-gray-400">{toKST(r.created_at)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* 🆕 다음 걸음 카드(교사 온보딩 설문) 응답 — 사전 신청과 함께 로드된 섹션 */}
                <div className="mt-8 pt-5 border-t border-gray-100">
                  <h2 className="text-lg font-bold mb-1">🧭 다음 걸음 응답</h2>
                  {onboardingRows === null ? (
                    <div className="py-6 text-center text-sm text-gray-400">불러오는 중...</div>
                  ) : onboardingRows.length === 0 ? (
                    <div className="py-6 text-center text-sm text-gray-400">아직 응답이 없어요</div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-600 mb-4">
                        {['review', 'no_students', 'no_topics', 'no_class_run']
                          .map(k => `${OB_CARD_LABELS[k]} ${onboardingRows.filter(o => o.card_type === k).length}`)
                          .join(' · ')}
                      </p>
                      <div className="space-y-2">
                        {onboardingRows.map((o, i) => (
                          <div key={`${o.teacher_id}-${o.card_type}` || i} className="p-3 rounded-xl border border-gray-100 bg-gray-50">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-gray-800">{o.realname}</span>
                              {o.role === 'admin' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-purple-100 text-purple-700">관리자</span>
                              )}
                              {o.school && <span className="text-xs text-gray-500">{o.school}</span>}
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-indigo-50 text-indigo-700">
                                {OB_CARD_LABELS[o.card_type] || o.card_type}
                              </span>
                              <span className="text-xs text-gray-700">{OB_RESP_LABELS[o.response] || o.response}</span>
                              <span className="ml-auto text-xs text-gray-400">{toKST(o.created_at)}</span>
                            </div>
                            {o.comment && <div className="text-xs text-gray-600 mt-1.5 pl-2 border-l-2 border-indigo-100">{o.comment}</div>}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* 🆕 step423: 홍보용 리뷰 캡쳐 목록 — review+good+소감 있는 응답만, 마스킹 표기(렌더만) */}
                <div className="mt-8 pt-5 border-t border-gray-100">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                    <h2 className="text-lg font-bold">📸 홍보용 리뷰</h2>
                    <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={reviewShowReal} onChange={e => setReviewShowReal(e.target.checked)} />
                      실명 병기(내부 확인용)
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 mb-4">😀 좋아요 + 한 줄 소감이 있는 응답만 모아요. 마스킹된 카드 그대로 캡쳐해 쓰세요.</p>
                  {(() => {
                    const reviews = (onboardingRows || []).filter(o => o.card_type === 'review' && o.response === 'good' && (o.comment || '').trim())
                    if (onboardingRows === null) return <div className="py-6 text-center text-sm text-gray-400">불러오는 중...</div>
                    if (reviews.length === 0) return <div className="py-6 text-center text-sm text-gray-400">아직 캡쳐할 리뷰가 없어요</div>
                    return (
                      <div className="grid sm:grid-cols-2 gap-3">
                        {reviews.map((o, i) => {
                          const d = o.created_at ? new Date(o.created_at) : null
                          const ym = d ? `${d.getFullYear()}.${d.getMonth() + 1}` : ''
                          return (
                            <div key={`${o.teacher_id}-rv` || i} className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
                              <div className="text-base text-gray-900 leading-relaxed break-keep">“{o.comment.trim()}”</div>
                              <div className="text-xs text-gray-500 mt-3">
                                {maskTeacherLabel(o.realname, o.school)}{ym && ` · ${ym}`}
                                {reviewShowReal && (
                                  <span className="ml-2 text-[11px] text-gray-400">({o.realname}{o.school ? ' · ' + o.school : ''})</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )
          })()}

          {/* 🆕 step422: 쪽지 탭 — 교사↔관리자 스레드(좌 목록/우 대화), 처리됨·마스킹·일괄 쪽지 */}
          {tab === 'messages' && (() => {
            // 스레드 구성: teacher_id 그룹, 마지막 쪽지 시각 내림차순
            const byTid = {}
            msgData.msgs.forEach(m => { (byTid[m.teacher_id] = byTid[m.teacher_id] || []).push(m) })
            const threads = Object.entries(byTid).map(([tid, list]) => ({
              tid,
              list,
              last: list[list.length - 1],
              unread: list.filter(m => m.sender_id === tid && !m.read_at).length,  // 교사발 안읽음
              resolved: !!msgData.status[tid],
              // 🆕 step434: '대화 중' 판정 — 교사발 메시지가 1개라도 있으면(마지막이 누구든).
              //   is_bulk는 관리자발이라 이 판정과 무관.
              hasTeacherMsg: list.some(m => m.sender_id === m.teacher_id),
            })).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at))
            const shown = threads.filter(t =>
              // 🆕 step434: '답장 옴'(마지막=교사발) → '대화 중'(교사발 존재)으로 재정의.
              //   관리자 본인 스레드(teacher_id의 role=admin)는 제외.
              msgFilter === 'replied' ? (t.hasTeacherMsg && msgData.profs[t.tid]?.role !== 'admin') :
              msgFilter === 'unresolved' ? !t.resolved :
              msgFilter === 'unread' ? t.unread > 0 : true)
            const sel = msgSelected ? threads.find(t => t.tid === msgSelected) : null
            // 표기: 마스킹 모드면 "경기 ○○초 신○○ 선생님" (렌더만)
            const labelOf = (tid) => {
              const p = msgData.profs[tid] || {}
              return msgMasked ? maskTeacherLabel(p.realname, p.school)
                : `${p.realname || '(정보 없음)'}${p.school ? ' · ' + p.school : ''}`
            }
            const bulkPreviewTarget = bulkTargets()[0]
            return (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                  <h2 className="text-lg font-bold">✉️ 쪽지</h2>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={msgMasked} onChange={e => setMsgMasked(e.target.checked)} />
                      마스킹 모드(캡쳐용)
                    </label>
                    <button onClick={() => setBulkOpen(true)}
                      className="text-xs bg-gray-700 text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition">
                      📢 일괄 쪽지
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-3">교사가 보낸 문의를 확인하고 답장하세요. 처리 끝난 스레드는 체크로 표시해요.</p>

                {/* 필터 칩 — step434: '대화 중'(교사발 존재, 관리자 본인 제외)·기본 선택 */}
                <div className="flex gap-1.5 flex-wrap mb-3">
                  {[['replied', '대화 중'], ['all', '전체'], ['unresolved', '미처리'], ['unread', '안읽음']].map(([v, label]) => (
                    <button key={v} onClick={() => setMsgFilter(v)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${msgFilter === v
                        ? 'bg-gray-800 text-white border-gray-800'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {!msgData.loaded ? (
                  <div className="py-8 text-center text-sm text-gray-400">불러오는 중...</div>
                ) : threads.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-400">아직 쪽지가 없어요</div>
                ) : (
                  <div className="grid md:grid-cols-[minmax(220px,1fr)_2fr] gap-4">
                    {/* 좌: 스레드 목록 */}
                    <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                      {shown.length === 0 ? (
                        <div className="py-6 text-center text-xs text-gray-400">이 조건의 스레드가 없어요</div>
                      ) : shown.map(t => (
                        <div key={t.tid}
                          className={`p-2.5 rounded-xl border cursor-pointer transition ${t.resolved ? 'bg-gray-50 border-gray-100 opacity-60' : 'bg-white border-gray-200'} ${msgSelected === t.tid ? 'ring-2 ring-indigo-300' : 'hover:bg-gray-50'}`}
                          onClick={() => openThread(t.tid)}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-gray-800 truncate">{labelOf(t.tid)}</span>
                            {t.unread > 0 && (
                              <span className="shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full">{t.unread}</span>
                            )}
                            <label className="ml-auto shrink-0 text-[10px] text-gray-500 flex items-center gap-0.5 cursor-pointer"
                              onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={t.resolved} onChange={() => toggleResolved(t.tid)} />
                              처리됨
                            </label>
                          </div>
                          <div className={`text-xs truncate mt-0.5 ${t.last.deleted_at ? 'text-gray-400 italic' : 'text-gray-500'}`}>
                            {t.last.deleted_at ? '삭제된 쪽지예요' : (t.last.is_bulk ? `📢 (일괄 안내) ${t.last.body}` : t.last.body)}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{toKST(t.last.created_at)}</div>
                        </div>
                      ))}
                    </div>

                    {/* 우: 선택 스레드 대화 + 답장 */}
                    <div>
                      {!sel ? (
                        <div className="py-16 text-center text-sm text-gray-400">왼쪽에서 스레드를 선택하세요</div>
                      ) : (
                        <>
                          <div className="text-sm font-semibold text-gray-800 mb-2">{labelOf(sel.tid)}</div>
                          <div className="border border-gray-100 rounded-xl p-3 max-h-[45vh] overflow-y-auto space-y-2 bg-gray-50/50">
                            {sel.list.map(m => {
                              const fromTeacher = m.sender_id === m.teacher_id
                              // 🆕 step432: 삭제된 쪽지 — 본문 대신 안내(버튼 없음)
                              if (m.deleted_at) {
                                return (
                                  <div key={m.id} className={`flex ${fromTeacher ? 'justify-start' : 'justify-end'}`}>
                                    <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm italic text-gray-400 bg-gray-100 ${fromTeacher ? 'rounded-bl-sm' : 'rounded-br-sm'}`}>
                                      삭제된 쪽지예요
                                      <div className="text-[10px] mt-0.5 not-italic text-gray-300">{toKST(m.created_at)}</div>
                                    </div>
                                  </div>
                                )
                              }
                              return (
                                <div key={m.id} className={`group flex ${fromTeacher ? 'justify-start' : 'justify-end'} items-end gap-1`}>
                                  {/* 🆕 step432: 내(관리자)가 보낸 쪽지에만 ✏️🗑 — 데스크탑 hover, 모바일 항상 */}
                                  {!fromTeacher && msgEditingId !== m.id && (
                                    <span className="flex gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition order-first">
                                      <button onClick={() => { setMsgEditingId(m.id); setMsgEditDraft(m.body) }} aria-label="쪽지 수정"
                                        className="text-xs p-1 rounded hover:bg-gray-200">✏️</button>
                                      <button onClick={() => deleteMsg(m)} aria-label="쪽지 삭제"
                                        className="text-xs p-1 rounded hover:bg-gray-200">🗑</button>
                                    </span>
                                  )}
                                  <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words ${fromTeacher
                                    ? 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                                    : m.is_bulk
                                      ? 'bg-gray-200 text-gray-600 rounded-br-sm'  // 🆕 step434: 일괄 쪽지 톤 다운
                                      : 'bg-indigo-600 text-white rounded-br-sm'}`}>
                                    {!fromTeacher && m.is_bulk && (
                                      <div className="text-[10px] font-semibold text-gray-500 mb-0.5">📢 일괄 안내</div>
                                    )}
                                    {msgEditingId === m.id ? (
                                      <div className="w-56 max-w-full">
                                        <textarea value={msgEditDraft} onChange={e => setMsgEditDraft(e.target.value)} rows={3} maxLength={2000}
                                          className="w-full text-sm text-gray-800 border border-gray-200 rounded-lg px-2 py-1.5 resize-none" />
                                        <div className="flex gap-1.5 mt-1 justify-end">
                                          <button onClick={() => setMsgEditingId(null)} className="text-[11px] px-2 py-1 rounded bg-white/20 hover:bg-white/30">취소</button>
                                          <button onClick={() => saveMsgEdit(m)} className="text-[11px] px-2 py-1 rounded bg-white text-indigo-700 font-semibold hover:bg-indigo-50">저장</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        {m.body}
                                        {m.edited_at && <span className={`text-[10px] ml-1 ${fromTeacher || m.is_bulk ? 'text-gray-400' : 'text-indigo-200'}`}>(수정됨)</span>}
                                      </>
                                    )}
                                    <div className={`text-[10px] mt-0.5 ${fromTeacher || m.is_bulk ? 'text-gray-400' : 'text-indigo-200'}`}>
                                      {toKST(m.created_at)}
                                      {/* 🆕 step434: 비대칭 읽음 표시 — 관리자발만, 관리자 화면에서만 보임 */}
                                      {!fromTeacher && m.read_at && <span className="ml-1">· 읽음</span>}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          <div className="flex gap-2 mt-2">
                            <textarea value={msgReply} onChange={e => setMsgReply(e.target.value)}
                              placeholder="답장을 적어주세요" rows={2} maxLength={2000}
                              className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none" />
                            <button onClick={sendReply} disabled={msgSending || !msgReply.trim()}
                              className="shrink-0 self-end text-sm bg-indigo-600 text-white font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition disabled:opacity-40">
                              {msgSending ? '보내는 중...' : '답장'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* 일괄 쪽지 모달 — 발송 전 반드시 N명 confirm. ⚠️ 테스트는 관리자 본인 1명으로만 */}
                {bulkOpen && (
                  <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setBulkOpen(false)}>
                    <div className="relative bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setBulkOpen(false)} aria-label="닫기"
                        className="absolute top-3 right-3 text-gray-300 hover:text-gray-500 transition text-lg leading-none">✕</button>
                      <h3 className="font-bold text-gray-900 pr-6">📢 일괄 쪽지</h3>
                      <p className="text-xs text-gray-500 mt-1">대상 단계를 고르고 내용을 적어주세요. {'{이름}'}을 쓰면 각 선생님 성함으로 바뀌어요.</p>
                      <div className="flex gap-2 flex-wrap mt-3">
                        {['active', 'cooling', 'at_risk', 'dormant'].map(k => (
                          <label key={k} className={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer transition ${bulkStages[k] ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200'}`}>
                            <input type="checkbox" className="hidden" checked={bulkStages[k]}
                              onChange={e => setBulkStages(prev => ({ ...prev, [k]: e.target.checked }))} />
                            {STAGE_META[k].emoji} {STAGE_META[k].label}
                          </label>
                        ))}
                      </div>
                      <div className="text-xs text-gray-600 mt-2">현재 대상: <strong>{bulkTargets().length}명</strong> (차단 제외)</div>
                      <textarea value={bulkBody} onChange={e => setBulkBody(e.target.value)}
                        placeholder={'{이름} 선생님, 안녕하세요. ...'} rows={5} maxLength={2000}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 mt-2 resize-none" />
                      {/* 발송 전 미리보기 — 첫 번째 대상 기준 치환 결과 */}
                      {bulkBody.trim() && bulkPreviewTarget && (
                        <div className="mt-2 text-xs bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                          <div className="text-gray-400 mb-1">미리보기 ({bulkPreviewTarget.realname || '(이름 없음)'} 기준):</div>
                          <div className="text-gray-700 whitespace-pre-wrap">{fillName(bulkBody.trim(), bulkPreviewTarget.realname)}</div>
                        </div>
                      )}
                      <button onClick={sendBulk} disabled={bulkSending || !bulkBody.trim() || bulkTargets().length === 0}
                        className="mt-3 w-full text-sm bg-indigo-600 text-white font-semibold px-4 py-2.5 rounded-xl hover:bg-indigo-700 transition disabled:opacity-40">
                        {bulkSending ? '발송 중...' : `발송하기 (${bulkTargets().length}명)`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

        </main>
      </div>
    </>
  )
}

function AdminSubmissions() {
  return (
    <>
      <style>{`
        .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: pointer; }
        .grammar-tooltip {
          position: fixed;
          background: #1f2937;
          color: white;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.4;
          max-width: 280px;
          z-index: 1000;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          pointer-events: auto;
        }
      `}</style>
      <AdminSubmissionsInner />
    </>
  )
}

function AdminSubmissionsInner() {
  const router = useRouter()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSubmission, setSelectedSubmissionState] = useState(null)
  // 🆕 그룹화 모드: 'flat' | 'school' | 'class' | 'topic' | 'student'
  const [groupBy, setGroupBy] = useState('flat')
  const [selectedClass, setSelectedClass] = useState('all')
  const [classList, setClassList] = useState([])
  const [expandedGroups, setExpandedGroups] = useState(new Set())  // 펼쳐진 그룹 ID
  // 🆕 날짜 필터: 'all' | 'today' | 'week' | 'custom'
  const [dateFilter, setDateFilter] = useState('all')
  const [customDate, setCustomDate] = useState('')  // YYYY-MM-DD (custom일 때)
  const [search, setSearch] = useState('')  // 🆕 통합 검색(담임·학교·학생 표시이름) — 클라 필터
  const [attemptFilter, setAttemptFilter] = useState('all')  // 🆕 글 종류: 'all' | 'first' | 'rewrite' (클라 필터)
  // 🆕 step286: 활성/휴지통/전체 (서버 필터). 기본 'active' — soft delete 글이 목록에 섞이지 않게.
  const [subStatusFilter, setSubStatusFilter] = useState('active')  // 'active' | 'trashed' | 'all'

  // 🆕 보조 데이터: 학생 → 학급 → 학교 매핑
  const [studentMap, setStudentMap] = useState({})  // { userId: { realname, username, class_id } }
  const [classMap, setClassMap] = useState({})      // { classId: { name, teacher_school } }

  // 선택한 글을 URL(sub=id)에 반영 — 새로고침해도 유지
  const setSelectedSubmission = (s) => {
    setSelectedSubmissionState(s)
    const q = { ...router.query }
    if (s?.id) q.sub = s.id
    else delete q.sub
    router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true })
  }

  useEffect(() => { load() }, [selectedClass, dateFilter, customDate, subStatusFilter])

  // 🆕 step431: URL ?class= 복원 — 학급 탭 "글 보기" 딥링크(tab=submissions&class=id).
  //   deps에 selectedClass 없음 → 드롭다운 수동 변경을 되돌리지 않음.
  useEffect(() => {
    if (!router.isReady) return
    const c = router.query.class
    if (c && String(c) !== selectedClass) setSelectedClass(String(c))
  }, [router.isReady, router.query.class])

  // 새로고침 시: 글 목록 로드된 뒤 URL의 sub ID로 상세 복원
  // 🆕 step370: 목록(최근 200건·active 필터)에 없으면 단건 직접 조회 폴백 —
  //   의심 교정 "글 보기"가 오래된 글·휴지통 글에서 무반응이던 문제 해결. 실패는 안내로 표시(조용한 실패 금지).
  const subFetchingRef = useRef(false)
  useEffect(() => {
    if (!router.isReady || loading) return
    const subId = router.query.sub
    if (!subId || selectedSubmission) return
    const found = submissions.find(s => String(s.id) === String(subId))
    if (found) { setSelectedSubmissionState(found); return }

    if (subFetchingRef.current) return
    subFetchingRef.current = true
    ;(async () => {
      const { data, error } = await supabase.from('submissions')
        .select('*, profiles!submissions_user_id_fkey(realname, nickname, username, number, class_id), topics(title, date)')
        .eq('id', subId)
        .maybeSingle()
      subFetchingRef.current = false
      if (error) {
        alert('글을 불러오지 못했어요: ' + error.message)
      } else if (!data || data.deleted_at) {
        alert('글이 삭제되었어요. 의심 교정이 가리키는 글을 열 수 없어요.')
      } else {
        setSelectedSubmissionState(data)
        return
      }
      // 실패 시 URL에서 sub 제거 (재시도 루프 방지)
      const q = { ...router.query }
      delete q.sub
      router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true })
    })()
  }, [router.isReady, submissions, loading])

  const load = async () => {
    setLoading(true)
    // 학급 목록 + 담임 학교 정보 (학교별 그룹화에 필요)
    const { data: classData } = await supabase.from('classes').select('id, name, teacher_id')
    // 담임 학교 매핑
    const teacherIds = [...new Set((classData || []).map(c => c.teacher_id).filter(Boolean))]
    let teacherSchoolMap = {}
    let teacherNameMap = {}
    if (teacherIds.length > 0) {
      const { data: tProfiles } = await supabase.from('profiles')
        .select('id, school, realname').in('id', teacherIds)
      ;(tProfiles || []).forEach(t => {
        teacherSchoolMap[t.id] = t.school || '학교 미설정'
        teacherNameMap[t.id] = t.realname || ''
      })
    }
    const cMap = {}
    ;(classData || []).forEach(c => {
      cMap[c.id] = { name: c.name, teacher_school: teacherSchoolMap[c.teacher_id] || '학교 미설정', teacher_name: teacherNameMap[c.teacher_id] || '' }
      // 🆕 드롭다운 구분용: 학교·담임 정보를 classList 항목에 직접 부착
      c.school = teacherSchoolMap[c.teacher_id] || '학교 미설정'
      c.teacher_name = teacherNameMap[c.teacher_id] || ''
    })
    setClassMap(cMap)
    setClassList(classData || [])

    // 학생글 (최근 200건 — 그룹화 위해 좀 더 가져옴)
    // 🆕 특정 학급 선택 시: 그 학급 학생들의 글만 서버에서 직접 조회
    // (기존엔 전체 최근 200건에서 클라이언트 필터 → 다른 반 글이 많으면
    //  이 학급 글이 200건 밖으로 밀려나 "0건"으로 보이는 버그)
    let query = supabase.from('submissions')
      .select('*, profiles!submissions_user_id_fkey(realname, nickname, username, number, class_id), topics(title, date)')
      .order('created_at', { ascending: false })
      .limit(selectedClass === 'all' ? 200 : 2000)  // 🆕 step431: 학급 지정 시 그 학급 전체 커버(상한 완화)

    if (selectedClass !== 'all') {
      const { data: classStudents } = await supabase.from('profiles')
        .select('id').eq('class_id', selectedClass).eq('role', 'student')
      const studentIds = (classStudents || []).map(x => x.id)
      if (studentIds.length === 0) {
        setStudentMap({})
        setSubmissions([])
        setLoading(false)
        return
      }
      query = query.in('user_id', studentIds)
    }

    // 🆕 날짜 필터 (KST 기준 created_at 범위). 그룹화·학급 필터와 공존.
    const kstTodayStr = () => {
      const k = new Date(Date.now() + 9 * 3600 * 1000)
      return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`
    }
    const kstDayStartUTC = (ymd) => {
      const [y, m, d] = ymd.split('-').map(Number)
      return new Date(Date.UTC(y, m - 1, d) - 9 * 3600 * 1000).toISOString()
    }
    if (dateFilter === 'today') {
      query = query.gte('created_at', kstDayStartUTC(kstTodayStr()))
    } else if (dateFilter === 'week') {
      const start = new Date(new Date(kstDayStartUTC(kstTodayStr())).getTime() - 6 * 86400000).toISOString()
      query = query.gte('created_at', start)
    } else if (dateFilter === 'custom' && customDate) {
      const start = kstDayStartUTC(customDate)
      const end = new Date(new Date(start).getTime() + 86400000).toISOString()
      query = query.gte('created_at', start).lt('created_at', end)
    }

    // 🆕 step286: 활성/휴지통/전체 (보기 목록 전용 — 일괄작업 쿼리엔 적용 안 함)
    if (subStatusFilter === 'active') query = query.is('deleted_at', null)
    else if (subStatusFilter === 'trashed') query = query.not('deleted_at', 'is', null)
    // 'all' → 필터 없음

    const { data } = await query
    const filtered = data || []

    // 학생 매핑 만들기
    const sMap = {}
    filtered.forEach(s => {
      if (s.user_id && s.profiles) {
        sMap[s.user_id] = {
          realname: s.profiles.realname,
          username: s.profiles.username,
          class_id: s.profiles.class_id
        }
      }
    })
    setStudentMap(sMap)
    setSubmissions(filtered)
    setLoading(false)
  }

  const toggleGroup = (gid) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(gid)) next.delete(gid)
      else next.add(gid)
      return next
    })
  }

  if (selectedSubmission) {
    return <SubmissionDetail sub={selectedSubmission} onBack={() => setSelectedSubmission(null)} />
  }

  // 🆕 그룹화 로직
  const buildGroups = () => {
    if (groupBy === 'flat') return null  // flat은 그룹 안 만듦

    const groups = {}  // { groupKey: { label, subLabel, items: [] } }

    visibleSubmissions.forEach(s => {
      let key, label, subLabel = ''
      if (groupBy === 'school') {
        const cls = classMap[s.profiles?.class_id]
        key = cls?.teacher_school || '(학교 정보 없음)'
        label = `🏫 ${key}`
      } else if (groupBy === 'class') {
        const cls = classMap[s.profiles?.class_id]
        key = s.profiles?.class_id || 'no-class'
        label = `📚 ${cls?.name || '(학급 정보 없음)'}`
        subLabel = [cls?.teacher_school, cls?.teacher_name && '담임 ' + cls.teacher_name].filter(Boolean).join(' · ')
      } else if (groupBy === 'topic') {
        key = s.topic_id || s.topic_title || 'no-topic'
        label = `📝 ${s.topic_title || s.topics?.title || '(주제 없음)'}`
        if (s.topics?.date) subLabel = s.topics.date
      } else if (groupBy === 'student') {
        key = s.user_id || 'no-user'
        const stu = studentMap[s.user_id]
        label = `👤 ${stu?.realname || s.profiles?.realname || '(이름 없음)'}`
        const cls = classMap[stu?.class_id]
        subLabel = cls?.name || ''
      }
      if (!groups[key]) groups[key] = { key, label, subLabel, items: [] }
      groups[key].items.push(s)
    })
    // 그룹을 글 수 많은 순으로 정렬
    return Object.values(groups).sort((a, b) => b.items.length - a.items.length)
  }

  // 🆕 통합 검색: 담임명·학교명·학생 표시이름(displayStudentName)·번호 부분일치 — 이미 로드된 목록 내 클라이언트 필터(서버 재조회 없음)
  // ⚠️ 잠긴 학생은 displayStudentName이 닉네임을 반환 → 닉네임으로만 검색됨. 실명 복호화/암호문 조회 절대 안 함.
  const sq = search.trim().toLowerCase()
  const matchSearch = (s) => {
    if (!sq) return true
    const cls = classMap?.[s.profiles?.class_id]
    return [cls?.teacher_name, cls?.teacher_school, displayStudentName(s.profiles), String(s.profiles?.number || '')]
      .some(f => f && String(f).toLowerCase().includes(sq))
  }
  // 🆕 글 종류 필터 (첫 글 = attempt 1, 수정본 = 그 외) — SubmissionRow의 판정과 동일 기준
  const matchAttempt = (s) => attemptFilter === 'all'
    ? true
    : attemptFilter === 'first' ? (s.attempt || 1) === 1 : (s.attempt || 1) !== 1
  const visibleSubmissions = submissions.filter(s => matchSearch(s) && matchAttempt(s))
  const groups = buildGroups()

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-bold">
          📝 학생 글 (최근 {submissions.length}건{sq ? ` · 검색 ${visibleSubmissions.length}건` : ''})
          {selectedClass === 'all' && (
            <span className="text-[10px] text-gray-400 font-normal ml-1.5">
              전체 모드는 최근 200건만 — 특정 학급 글을 모두 보려면 학급을 선택하세요
            </span>
          )}
        </h3>
      </div>
      {/* 🆕 step266: 컨트롤을 제목과 분리해 전체 폭에서 한 흐름으로 (검색 단독 줄빠짐 방지) */}
      <div className="flex flex-wrap items-center gap-2">
          {/* 🆕 그룹화 모드 셀렉터 */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <span className="text-xs text-gray-600 px-2">묶음:</span>
            {[
              { v: 'flat', l: '전체' },
              { v: 'school', l: '학교별' },
              { v: 'class', l: '학급별' },
              { v: 'topic', l: '주제별' },
              { v: 'student', l: '학생별' }
            ].map(opt => (
              <button key={opt.v}
                onClick={() => { setGroupBy(opt.v); setExpandedGroups(new Set()) }}
                className={`text-xs px-2.5 py-1 rounded ${
                  groupBy === opt.v
                    ? 'bg-white shadow-sm font-semibold text-primary'
                    : 'text-gray-600 hover:text-gray-900'
                }`}>
                {opt.l}
              </button>
            ))}
          </div>
          {/* 🆕 글 종류 필터 (첫 글 / 수정본) — 이미 받아온 목록에 클라 필터 */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <span className="text-xs text-gray-600 px-1.5">글 종류:</span>
            {[{ v: 'all', l: '전체' }, { v: 'first', l: '첫 글만' }, { v: 'rewrite', l: '수정본만' }].map(opt => (
              <button key={opt.v}
                onClick={() => setAttemptFilter(opt.v)}
                className={`text-xs px-2 py-1 rounded ${
                  attemptFilter === opt.v
                    ? 'bg-white shadow-sm font-semibold text-primary'
                    : 'text-gray-600 hover:text-gray-900'
                }`}>
                {opt.l}
              </button>
            ))}
          </div>
          {/* 🆕 날짜 필터 (전체/오늘/최근7일/직접날짜) — 그룹화·학급 필터와 공존 */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <span className="text-xs text-gray-600 px-1.5">기간:</span>
            {[{ v: 'all', l: '전체' }, { v: 'today', l: '오늘' }, { v: 'week', l: '최근7일' }].map(opt => (
              <button key={opt.v}
                onClick={() => { setDateFilter(opt.v); setCustomDate('') }}
                className={`text-xs px-2 py-1 rounded ${
                  dateFilter === opt.v
                    ? 'bg-white shadow-sm font-semibold text-primary'
                    : 'text-gray-600 hover:text-gray-900'
                }`}>
                {opt.l}
              </button>
            ))}
            <input type="date" value={customDate}
              onChange={e => { setCustomDate(e.target.value); setDateFilter(e.target.value ? 'custom' : 'all') }}
              className="text-xs border border-gray-200 rounded p-1" />
          </div>
          {/* 🆕 step286: 상태 필터 (활성/휴지통/전체) — soft delete 가시성 */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <span className="text-xs text-gray-600 px-1.5">상태:</span>
            {[{ v: 'active', l: '활성' }, { v: 'trashed', l: '휴지통' }, { v: 'all', l: '전체' }].map(opt => (
              <button key={opt.v}
                onClick={() => setSubStatusFilter(opt.v)}
                className={`text-xs px-2 py-1 rounded ${
                  subStatusFilter === opt.v
                    ? 'bg-white shadow-sm font-semibold text-primary'
                    : 'text-gray-600 hover:text-gray-900'
                }`}>
                {opt.l}
              </button>
            ))}
          </div>
          {/* 학급 필터 — 항상 렌더(자리·폭 고정). 기간·검색과 한 그룹(맨 오른쪽). 학급별 묶음일 땐 비활성으로 레이아웃 점프 제거 */}
            <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}
              disabled={groupBy === 'class'}
              className={`text-sm border border-gray-200 rounded p-2 w-[220px] ${groupBy === 'class' ? 'opacity-40 cursor-not-allowed' : ''}`}>
              <option value="all">모든 학급</option>
              {/* 🆕 학교별 그룹 + 담임명으로 같은 반 이름 구분 */}
              {/* 🆕 step431: 검색어로 드롭다운 목록도 축소(학급명·담임·학교) — 선택된 학급은 항상 포함(value 유지) */}
              {Object.entries(
                classList.filter(c => {
                  const q = search.trim().toLowerCase()
                  if (!q || String(c.id) === String(selectedClass)) return true
                  return (c.name || '').toLowerCase().includes(q)
                    || (c.teacher_name || '').toLowerCase().includes(q)
                    || (c.school || '').toLowerCase().includes(q)
                }).reduce((acc, c) => {
                  const school = c.school || '학교 미설정'
                  if (!acc[school]) acc[school] = []
                  acc[school].push(c)
                  return acc
                }, {})
              ).sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([school, list]) => (
                <optgroup key={school} label={`🏫 ${school}`}>
                  {[...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko')).map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.teacher_name ? ` (${c.teacher_name})` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          {/* 🆕 통합 검색 (담임·학교·학생 표시이름) — 로드된 목록 내 클라 필터 */}
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 담임·학교·학생 검색"
            className="text-sm border border-gray-200 rounded p-2 w-[170px]" />
        </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">로딩 중...</p>
      ) : visibleSubmissions.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">{sq ? '검색 결과가 없어요' : '학생 글이 없어요'}</p>
      ) : groupBy === 'flat' ? (
        // ─── flat: 기존 동작 (시간순 평면 리스트) ───
        <div className="space-y-2">
          {visibleSubmissions.map(s => (
            <SubmissionRow key={s.id} s={s} classMap={classMap} onClick={() => setSelectedSubmission(s)} />
          ))}
        </div>
      ) : (
        // ─── 그룹화 뷰 ───
        <div className="space-y-2">
          {groups.map(g => {
            const isExpanded = expandedGroups.has(g.key)
            // 그룹 통계
            const total = g.items.length
            const avgScore = total > 0
              ? Math.round(g.items.reduce((sum, s) => sum + (s.total_score || 0), 0) / total * 10) / 10
              : 0
            const fallbackCount = g.items.filter(s => s.is_fallback_graded).length
            const pasteCount = g.items.filter(s => s.paste_detected).length

            return (
              <div key={g.key} className="border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => toggleGroup(g.key)}
                  className="w-full bg-gray-50 hover:bg-gray-100 px-3 py-2.5 flex items-center justify-between text-left">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">
                      {g.label}
                      <span className="ml-2 text-xs font-normal text-gray-500">({total}건)</span>
                    </div>
                    {g.subLabel && (
                      <div className="text-xs text-gray-500 mt-0.5">{g.subLabel}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span>평균 <strong>{avgScore}</strong>점</span>
                    {fallbackCount > 0 && (
                      <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">폴백 {fallbackCount}</span>
                    )}
                    {pasteCount > 0 && (
                      <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded">복붙 {pasteCount}</span>
                    )}
                    <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="bg-white p-2 space-y-1.5 border-t border-gray-200">
                    {g.items.map(s => (
                      <SubmissionRow key={s.id} s={s} classMap={classMap}
                        onClick={() => setSelectedSubmission(s)}
                        hideField={groupBy === 'topic' ? 'topic' : groupBy === 'student' ? 'student' : null} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 학생글 한 줄 (재사용 컴포넌트)
function SubmissionRow({ s, onClick, hideField, classMap }) {
  // 읽기 전용 소속 표시 — 이미 로드된 classMap만 사용 (추가 쿼리 없음)
  const cls = classMap?.[s.profiles?.class_id]
  // 학급명은 칩으로 강조, 학교·담임은 보조 회색
  const sub = [cls?.teacher_school, cls?.teacher_name && '담임 ' + cls.teacher_name].filter(Boolean).join(' · ')
  const pct = s.max_score ? s.total_score / s.max_score : 0
  const scoreColor = pct >= 0.8 ? 'text-green-600' : pct >= 0.6 ? 'text-amber-600' : 'text-rose-600'
  // 🆕 step286: 휴지통(soft delete) 행 — 반투명 + 사유 뱃지. step284 중복정리는 통일 표기.
  const trashed = !!s.deleted_at
  const reasonLabel = s.delete_reason
    ? (s.delete_reason.startsWith('dup-cleanup step284') ? '중복정리' : s.delete_reason)
    : null
  return (
    <button onClick={onClick}
      className={`w-full text-left bg-gray-50 hover:bg-gray-100 rounded-lg p-3 flex justify-between items-center gap-3 ${trashed ? 'opacity-50' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900">
          {hideField !== 'student' && (
            <>
              {displayStudentNameWithNumber(s.profiles)}
              <span className="text-xs font-normal text-gray-500 ml-2">({s.attempt === 1 ? '첫 글' : `수정본 ${s.attempt - 1}차`})</span>
            </>
          )}
          {hideField === 'student' && (
            <span className="font-medium">{s.attempt === 1 ? '✏️ 첫 글' : `🔄 수정본 ${s.attempt - 1}차`}</span>
          )}
          {s.paste_detected && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠️ 복붙</span>}
          {s.is_fallback_graded && <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">폴백</span>}
          {trashed && <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">🗑️ {reasonLabel || '삭제됨'}</span>}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {cls?.name && (
            <span className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded text-[10px] mr-1.5">{cls.name}</span>
          )}
          <span className="text-gray-400">
            {sub && <>{sub} · </>}
            {hideField !== 'topic' && <>{s.topic_title || s.topics?.title || '-'} · </>}
            {toKST(s.created_at)}
            {s.graded_with_model && <> · 🤖 {s.graded_with_model.replace('gemini-', '')}</>}
          </span>
        </div>
      </div>
      <div className={`text-sm font-bold ml-3 flex-shrink-0 ${scoreColor}`}>{s.total_score}/{s.max_score}</div>
    </button>
  )
}

function SubmissionDetail({ sub, onBack }) {
  const [allSubs, setAllSubs] = useState([sub])
  const [topic, setTopic] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadFullData()
  }, [sub.id])

  const loadFullData = async () => {
    setLoading(true)
    try {
      // 1. 같은 학생 + 같은 주제의 모든 attempt 가져오기 (첫 글 + 수정본들)
      const { data: subs } = await supabase.from('submissions')
        .select('*')
        .eq('user_id', sub.user_id)
        .eq('topic_id', sub.topic_id)
        .order('attempt', { ascending: true })

      if (subs && subs.length > 0) setAllSubs(subs)

      // 2. 주제 정보 (rubrics 포함)
      if (sub.topic_id) {
        const { data: t } = await supabase.from('topics').select('*').eq('id', sub.topic_id).maybeSingle()
        if (t) setTopic(t)
      }
    } catch(e) {
      console.error('상세 정보 로드 실패:', e)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-3 mx-auto" style={allSubs.length >= 2 ? { width: 'min(1500px, calc(100vw - 2rem))' } : undefined}>
      <button onClick={onBack} className="text-sm text-gray-600 hover:text-gray-900">← 목록으로</button>

      {/* 상단: 학생/주제 정보 */}
      <div className="bg-primary-light rounded-2xl p-4">
        <div className="font-bold text-lg">
          {displayStudentName(sub.profiles)}
          {sub.profiles?.number && <span className="ml-2 text-sm font-normal text-gray-500">({sub.profiles.number}번)</span>}
        </div>
        <div className="text-sm text-gray-700 mt-1">
          📚 {sub.topic_title || topic?.title || '-'}
          {topic?.date && <span className="ml-2 text-xs">({topic.date})</span>}
        </div>
        {topic?.description && (
          <p className="text-xs text-gray-600 mt-2">{topic.description}</p>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-8 text-center">상세 정보 로딩 중...</p>
      ) : allSubs.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">제출된 글이 없어요</p>
      ) : (() => {
        // allSubs는 attempt 오름차순. 최신 2개를 병렬, 그 이전 글은 아래로
        const topTwo = allSubs.slice(-2)
        const older = allSubs.slice(0, -2)
        const labelFor = (s) => s.attempt === 1 ? '✏️ 첫 글' : `🔄 수정본 ${s.attempt - 1}차`
        return (
          <>
            {topTwo.length >= 2 && (
              <div className="text-xs text-gray-500 mb-1">
                ← 직전 글과 가장 최근 글을 나란히 비교하세요. 더 이전 글은 아래에 있어요.
              </div>
            )}
            <div className={`grid grid-cols-1 gap-4 items-stretch ${topTwo.length >= 2 ? 'lg:grid-cols-2' : ''}`}>
              {topTwo.map(s => (
                <StudentFeedbackCard key={s.id} sub={s} topic={topic} headerLabel={labelFor(s)} />
              ))}
            </div>

            {older.length > 0 && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-semibold text-gray-600 hover:text-gray-900 py-2 px-2 bg-gray-50 rounded-lg select-none">
                  📂 이전 글 더 보기 ({older.length}개)
                </summary>
                <div className="space-y-4 mt-3">
                  {[...older].reverse().map(s => (
                    <StudentFeedbackCard key={s.id} sub={s} topic={topic} headerLabel={labelFor(s)} />
                  ))}
                </div>
              </details>
            )}
          </>
        )
      })()}
    </div>
  )
}
