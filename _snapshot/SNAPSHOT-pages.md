# SNAPSHOT — pages/  (46 files)

> 다온클래스 소스 스냅샷. 생성 기준 디렉터리: `pages/`

## pages/_app.js

```js
import { useEffect } from 'react'
import { useRouter } from 'next/router'
import '../styles/globals.css'
import Footer from '../components/Footer'
import VersionChecker from '../components/VersionChecker'
import { purgeLegacyApiKey } from '../lib/gemini'
import { logError } from '../lib/errorLog'
import { Analytics } from '@vercel/analytics/react'

export default function App({ Component, pageProps }) {
  const router = useRouter()

  // 키 서버격리(step153~): 과거 버전이 localStorage에 남긴 API 키 1회성 제거
  useEffect(() => {
    purgeLegacyApiKey()
  }, [])

  // 전역 에러 수집(step155): 잡히지 않은 JS 에러 / Promise 거부를 error_logs에 기록
  useEffect(() => {
    if (typeof window === 'undefined') return

    // 🆕 확장프로그램(메타마스크 등) 노이즈 필터 — js_error 경로에만 적용.
    // 보수적 원칙: 우리 앱 진짜 에러(504/ai_call/api_error 등)는 절대 거르지 않음. (미탐 > 오탐)
    const APP_MARKERS = ['status 5', '파싱 실패', 'TIMEOUT', 'ai_call', 'Gemini', '응답']
    const EXTENSION_ORIGINS = [
      'chrome-extension://', 'moz-extension://', 'safari-web-extension://',
      'safari-extension://', 'ms-browser-extension://',
    ]
    const NOISE_PHRASES = [
      'Failed to connect to MetaMask',
      'Cannot redefine property: ethereum',
      'Cannot set property ethereum',
    ]
    const isExtensionNoise = (msg, source) => {
      const m = msg || ''
      // 1) 우리 앱 표지가 있으면 출처 불문 무조건 보존 (오탐 방지)
      if (APP_MARKERS.some(w => m.includes(w))) return false
      // 2) 출처(filename/stack)가 확장프로그램 origin이면 노이즈로 판단
      const s = source || ''
      if (EXTENSION_ORIGINS.some(o => s.includes(o))) return true
      // 3) 알려진 전체 문구면 노이즈 (단어 단독 매칭 금지 — 전체 문구만)
      if (NOISE_PHRASES.some(p => m.includes(p))) return true
      return false
    }

    const onError = (event) => {
      const msg = event?.error?.message || event?.message || '알 수 없는 오류'
      const source = event?.filename || event?.error?.stack || ''
      if (isExtensionNoise(msg, source)) return
      logError({
        page: router.pathname,
        errorType: 'js_error',
        message: msg,
        context: event?.filename ? { filename: String(event.filename).slice(0, 200), lineno: event.lineno } : null,
      })
    }
    const onRejection = (event) => {
      const reason = event?.reason
      const msg = (reason && (reason.message || String(reason))) || 'unhandledrejection'
      const source = (reason && reason.stack) || ''
      if (isExtensionNoise(msg, source)) return
      logError({ page: router.pathname, errorType: 'js_error', message: msg })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [router.pathname])

  return (
    <>
      <Component {...pageProps} />
      <Footer />
      {/* 🆕 새 버전 자동 감지 — 배포 나가면 사용자에게 새로고침 안내 */}
      <VersionChecker />
      <Analytics />
    </>
  )
}

```

## pages/admin/index.js

```js
import Head from 'next/head'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import StudentFeedbackCard from '../../components/StudentFeedbackCard'
import { toKST, toKSTDate } from '../../lib/timeFormat'
import { callAI } from '../../lib/aiClient'
import { displayStudentName, displayStudentNameWithNumber } from '../../lib/displayName'

export default function AdminHome() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState({ teachers: 0, classes: 0, students: 0, submissions: 0, today: 0 })
  const [teachers, setTeachers] = useState([])
  const [teacherLastLogin, setTeacherLastLogin] = useState({})  // 🆕 step254: { userId: last_sign_in_at } (auth.users 읽기)
  const [classes, setClasses] = useState([])
  const [trashedTeachers, setTrashedTeachers] = useState([])  // 🆕 휴지통 (B4)
  const [trashedClasses, setTrashedClasses] = useState([])
  const [sharedSuggestionLogs, setSharedSuggestionLogs] = useState([])  // 🆕 공유 추천 추적
  const [resetRequests, setResetRequests] = useState([])  // 🆕 비밀번호 초기화 요청
  const [idLookups, setIdLookups] = useState({})  // 🆕 step161: 아이디 찾기 후보 { [reqId]: {loading, list} }
  const [selectedReqIds, setSelectedReqIds] = useState(new Set())  // 🆕 step162: 요청함 일괄 선택
  const [errorLogs, setErrorLogs] = useState([])  // 🆕 step155: 에러 로그 (최근 50건)
  const [errSeverity, setErrSeverity] = useState('all')  // 🆕 심각도: 'all' | 'action' | 'ignore'
  const [errType, setErrType] = useState('all')          // 🆕 종류: 'all' | error_type 값
  const [errView, setErrView] = useState('list')         // 🆕 보기: 'list' | 'byClass'
  const [logStudentNumbers, setLogStudentNumbers] = useState({})  // 🆕 에러로그 학생 번호 표시용 {user_id: number} (실명 미조회)
  const [expandedTeacherId, setExpandedTeacherId] = useState(null)  // 🆕 선생님 펼침
  const [feedbacks, setFeedbacks] = useState([])
  const [showHiddenFeedback, setShowHiddenFeedback] = useState(false)
  const [showInactiveClasses, setShowInactiveClasses] = useState(false)  // 🆕 비활성 학급 표시 토글 (기본 OFF)
  const [classActivityFilter, setClassActivityFilter] = useState('all')  // 🆕 활동 상태: 'all' | 'active' | 'inactive' (보유값 기준)
  const [showBannedTeachers, setShowBannedTeachers] = useState(false)  // 🆕 차단 선생님 표시 토글 (기본 OFF)
  const [teacherSearch, setTeacherSearch] = useState('')  // 🆕 step249: 선생님 검색(이름·아이디·학교) — 클라 필터
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

    const [teachersRes, classesRes, studentsRes, submissionsRes, todayRes, feedbackRes] = await Promise.all([
      supabase.from('profiles').select('*, classes:class_id(name, code)').in('role', ['teacher', 'admin']).order('created_at', { ascending: false }),
      supabase.from('classes').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').is('deleted_at', null),
      supabase.from('submissions').select('id', { count: 'exact', head: true }),
      supabase.from('submissions').select('id', { count: 'exact', head: true }).gte('created_at', todayStartUTC),
      supabase.from('feedback').select('*').order('created_at', { ascending: false }).limit(200)
    ])

    if (classesRes.error) {
      console.error('학급 조회 실패:', classesRes.error)
    }

    // 학급별 담임 정보를 별도로 조회해서 매핑 (외래키 명시 안 함 - 더 안정적)
    const classes = classesRes.data || []
    // 🆕 step251/252: PostgREST 기본 1000행 제한을 range 페이지 루프로 우회해 "전량" 수집(읽기 전용 헬퍼).
    //   build(from,to)가 매번 새 쿼리를 만들어 range로 페이지를 받아 합친다. 두 집계 블록이 공유.
    const PAGE_SIZE = 1000
    const fetchAllPaged = async (build) => {
      let from = 0, all = [], guard = 0
      while (guard++ < 100) {  // 최대 10만행 가드 (무한 루프 방지)
        const { data, error } = await build(from, from + PAGE_SIZE - 1)
        if (error) { console.error('fetchAllPaged 실패(부분 결과 반환):', error); break }  // 🆕 step256: 에러 가시화
        if (!data || data.length === 0) break
        all = all.concat(data)
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
      return all
    }
    const chunkArr = (arr, n) => {
      const out = []
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
      return out
    }
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
      // 학급별 학생 수 + 채점 모델 통계 (헬퍼 fetchAllPaged/chunkArr는 상위 스코프에서 정의)
      const classIds = classes.map(c => c.id)

      // 학생 전량(id, class_id) — student_count와 model_stats가 이 한 배열을 함께 재사용
      const studentsWithClass = await fetchAllPaged((from, to) =>
        supabase.from('profiles').select('id, class_id')
          .in('class_id', classIds).eq('role', 'student').range(from, to))

      const countMap = {}
      const studentIdByClass = {}  // { classId: [studentId, ...] }
      ;(studentsWithClass || []).forEach(s => {
        countMap[s.class_id] = (countMap[s.class_id] || 0) + 1
        if (!studentIdByClass[s.class_id]) studentIdByClass[s.class_id] = []
        studentIdByClass[s.class_id].push(s.id)
      })
      classes.forEach(c => { c.student_count = countMap[c.id] || 0 })

      // 🆕 학급별 채점 모델 통계 (와이프 피드백 1번: 다른 학급도 어떤 모델로 채점했는지)
      // 학급 → 학생 → 제출 → graded_with_model 집계. studentsWithClass 재사용(별도 학생 쿼리 없음).
      const allStudentIds = (studentsWithClass || []).map(s => s.id)
      if (allStudentIds.length > 0) {
        // 제출물도 전량 수집. user_id IN 목록이 너무 길어지지 않도록 1000개씩 끊어서(URL 길이 안전)
        // 각 묶음마다 range 페이지 루프로 받는다.
        let subs = []
        for (const idChunk of chunkArr(allStudentIds, 150)) {  // 🆕 step256: IN 리스트 축소(URL 한도 회피)
          const part = await fetchAllPaged((from, to) =>
            supabase.from('submissions')
              .select('user_id, graded_with_model, is_fallback_graded')
              .in('user_id', idChunk).range(from, to))
          subs = subs.concat(part)
        }
        // user_id → class_id 역매핑
        const classByStudent = {}
        ;(studentsWithClass || []).forEach(s => { classByStudent[s.id] = s.class_id })
        // 학급별 모델 카운트
        const modelStatsByClass = {}  // { classId: { 'gemini-3.1-flash-lite': 12, 'gemini-2.5-flash': 2, ... }, fallbackCount }
        ;(subs || []).forEach(sub => {
          const cid = classByStudent[sub.user_id]
          if (!cid) return
          if (!modelStatsByClass[cid]) modelStatsByClass[cid] = { models: {}, total: 0, fallback: 0 }
          const m = sub.graded_with_model || '(미기록)'
          modelStatsByClass[cid].models[m] = (modelStatsByClass[cid].models[m] || 0) + 1
          modelStatsByClass[cid].total++
          if (sub.is_fallback_graded) modelStatsByClass[cid].fallback++
        })
        classes.forEach(c => {
          c.model_stats = modelStatsByClass[c.id] || { models: {}, total: 0, fallback: 0 }
        })
      } else {
        classes.forEach(c => { c.model_stats = { models: {}, total: 0, fallback: 0 } })
      }
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

    // 🆕 학급별 제출 통계 + 마지막 활동 시각
    // 🆕 step252: 학생/제출을 range 페이지 루프로 전량 수집(1000행 제한 우회). 상위 fetchAllPaged/chunkArr 재사용.
    const activeClassIds = activeClasses.map(c => c.id)
    if (activeClassIds.length > 0) {
      // 학급에 속한 모든 학생 id (전량)
      const studentsForActivity = await fetchAllPaged((from, to) =>
        supabase.from('profiles').select('id, class_id')
          .in('class_id', activeClassIds).eq('role', 'student').range(from, to))
      const studentToClass = {}
      ;(studentsForActivity || []).forEach(s => { studentToClass[s.id] = s.class_id })
      const allActiveStudentIds = (studentsForActivity || []).map(s => s.id)

      if (allActiveStudentIds.length > 0) {
        // 제출물 전량 수집 (user_id IN 목록이 길어지지 않도록 1000개씩 끊어 range 루프). attempt 포함.
        let subStats = []
        for (const idChunk of chunkArr(allActiveStudentIds, 150)) {  // 🆕 step256: IN 리스트 축소(URL 한도 회피)
          const part = await fetchAllPaged((from, to) =>
            supabase.from('submissions')
              .select('user_id, created_at, attempt')
              .in('user_id', idChunk).range(from, to))
          subStats = subStats.concat(part)
        }

        const classSubCount = {}     // { classId: 전체 제출 수(수정본 포함) }
        const classFirstCount = {}   // { classId: 첫 글 수(attempt=1) }
        const classLastActivity = {} // { classId: 최근 제출 시각 }
        ;(subStats || []).forEach(sub => {
          const cid = studentToClass[sub.user_id]
          if (!cid) return
          classSubCount[cid] = (classSubCount[cid] || 0) + 1
          if ((sub.attempt || 1) === 1) classFirstCount[cid] = (classFirstCount[cid] || 0) + 1
          if (!classLastActivity[cid] || sub.created_at > classLastActivity[cid]) {
            classLastActivity[cid] = sub.created_at
          }
        })
        activeClasses.forEach(c => {
          c.submission_count = classSubCount[c.id] || 0
          c.first_submission_count = classFirstCount[c.id] || 0
          c.last_activity_at = classLastActivity[c.id] || null
        })
      }
    }

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

    // 🆕 step254: 교사 마지막 로그인 시각(auth.users.last_sign_in_at)을 서버(service-role)에서 읽어옴.
    //   실패해도 화면 나머지는 정상 동작(로그인 표시만 비워둠).
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
    } catch (e) { /* 무시: 로그인 표시는 보조 정보 */ }

    setStats({
      teachers: activeTeachers.filter(t => t.role !== 'admin').length,
      classes: activeClasses.length,
      students: studentsRes.count || 0,
      submissions: submissionsRes.count || 0,
      today: todayRes.count || 0
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
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

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
    // profile만 삭제 (auth.users는 별도, SET NULL인 FK는 자동 처리)
    const { error } = await supabase.from('profiles').delete().eq('id', teacher.id)
    if (error) return alert('실패: ' + error.message)
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

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {[
              { label: '선생님', val: stats.teachers, icon: '👨‍🏫', color: 'bg-blue-50 text-blue-900' },
              { label: '학급', val: stats.classes, icon: '🏫', color: 'bg-green-50 text-green-900' },
              { label: '학생', val: stats.students, icon: '🎒', color: 'bg-purple-50 text-purple-900' },
              { label: '누적 글쓰기', val: stats.submissions, icon: '📝', color: 'bg-orange-50 text-orange-900' },
              { label: '오늘', val: stats.today, icon: '✨', color: 'bg-pink-50 text-pink-900' },
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
              { id: 'trash', label: `🗑️ 휴지통${(trashedTeachers.length + trashedClasses.length) > 0 ? ` (${trashedTeachers.length + trashedClasses.length})` : ''}` },
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
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* 🆕 step249: 선생님 검색 (이름·아이디·학교) */}
                  <input type="text" value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)}
                    placeholder="🔍 이름·아이디·학교"
                    className="text-sm border border-gray-200 rounded p-2 w-[180px]" />
                  {bannedCount > 0 && (
                    <button onClick={() => setShowBannedTeachers(!showBannedTeachers)}
                      className="text-xs px-3 py-1 border border-gray-200 rounded hover:bg-gray-50">
                      {showBannedTeachers ? '👁️ 정상 계정만 보기' : `🔍 차단 포함 보기 (${bannedCount})`}
                    </button>
                  )}
                </div>
              </div>
              {visibleTeachers.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  {tq ? '검색 결과가 없어요' : teachers.length === 0 ? '가입한 선생님이 없어요' : '정상 계정이 없어요. "차단 포함 보기"를 눌러주세요.'}
                </p>
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
                      {visibleTeachers.map(t => {
                        // 🆕 이 선생님이 담임으로 운영하는 학급들
                        const myClasses = classes.filter(c => c.teacher_id === t.id)
                        const totalStudents = myClasses.reduce((sum, c) => sum + (c.student_count || 0), 0)
                        const totalSubs = myClasses.reduce((sum, c) => sum + (c.submission_count || 0), 0)
                        const totalFirst = myClasses.reduce((sum, c) => sum + (c.first_submission_count || 0), 0)
                        const lastActivity = myClasses.reduce((max, c) => {
                          if (!c.last_activity_at) return max
                          return !max || c.last_activity_at > max ? c.last_activity_at : max
                        }, null)
                        const isExpanded = expandedTeacherId === t.id

                        // 활동 라벨(마지막 글 활동 기준) — step253: 문구 명확화 / step263: 뱃지 색상
                        let activityLabel = '활동 기록 없음'
                        let activityBadge = 'bg-gray-100 text-gray-400'
                        if (lastActivity) {
                          const diffDays = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000)
                          if (diffDays === 0) { activityLabel = '오늘 활동'; activityBadge = 'bg-green-100 text-green-700' }
                          else if (diffDays === 1) { activityLabel = '어제 활동'; activityBadge = 'bg-green-100 text-green-700' }
                          else if (diffDays <= 7) { activityLabel = `마지막 활동 ${diffDays}일 전`; activityBadge = 'bg-blue-100 text-blue-700' }
                          else if (diffDays <= 30) { activityLabel = `마지막 활동 ${diffDays}일 전`; activityBadge = 'bg-gray-100 text-gray-600' }
                          else { activityLabel = `마지막 활동 ${diffDays}일 전`; activityBadge = 'bg-amber-100 text-amber-700' }
                        }

                        // 🆕 step254: 마지막 로그인(글 활동과 별개 신호 — auth.users.last_sign_in_at)
                        const lastLogin = teacherLastLogin[t.id]
                        let loginLabel = '로그인 기록 없음'
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
                              <td className="p-2 font-medium whitespace-nowrap align-middle">{t.realname}</td>
                              <td className="p-2 text-gray-600 whitespace-nowrap align-middle">{t.school || '-'}</td>
                              <td className="p-2 text-gray-600 font-mono text-xs whitespace-nowrap align-middle">{t.username}</td>
                              <td className="p-2 text-gray-600 whitespace-nowrap align-middle">
                                {myClasses.length === 0 ? (
                                  <span className="text-xs text-gray-400">운영 학급 없음</span>
                                ) : (
                                  <span className="text-xs whitespace-nowrap inline-flex items-center gap-1.5">
                                    🏫 <strong>{myClasses.length}개</strong> · 👥 {totalStudents}명 · 📝 {totalSubs}건<span className="text-gray-400"> (첫글 {totalFirst}개)</span>
                                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${activityBadge}`}>{activityLabel}</span>
                                  </span>
                                )}
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
                                <div className="flex flex-wrap gap-1 justify-center">
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

  useEffect(() => { load() }, [selectedClass, dateFilter, customDate])

  // 새로고침 시: 글 목록 로드된 뒤 URL의 sub ID로 상세 복원
  useEffect(() => {
    if (!router.isReady) return
    const subId = router.query.sub
    if (subId && !selectedSubmission && submissions.length > 0) {
      const found = submissions.find(s => String(s.id) === String(subId))
      if (found) setSelectedSubmissionState(found)
    }
  }, [router.isReady, submissions])

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
      .limit(200)

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
          {/* 학급 필터 — 항상 렌더(자리·폭 고정). 기간·검색과 한 그룹(맨 오른쪽). 학급별 묶음일 땐 비활성으로 레이아웃 점프 제거 */}
            <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}
              disabled={groupBy === 'class'}
              className={`text-sm border border-gray-200 rounded p-2 w-[220px] ${groupBy === 'class' ? 'opacity-40 cursor-not-allowed' : ''}`}>
              <option value="all">모든 학급</option>
              {/* 🆕 학교별 그룹 + 담임명으로 같은 반 이름 구분 */}
              {Object.entries(
                classList.reduce((acc, c) => {
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
  return (
    <button onClick={onClick}
      className="w-full text-left bg-gray-50 hover:bg-gray-100 rounded-lg p-3 flex justify-between items-center gap-3">
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

```

## pages/api-key-guide.js

```js
import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import ApiKeyManager from '../components/ApiKeyManager'

// 각 단계마다 캡처 이미지가 들어갈 자리 컴포넌트
// 나중에 /public/api-key/step1.png ~ step5.png 이미지 넣으면 자동 표시
function StepImage({ step, alt }) {
  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
      {/* 이미지가 있으면 표시, 없으면 placeholder */}
      <img
        src={`/api-key/step${step}.png`}
        alt={alt}
        className="w-full h-auto"
        onError={(e) => {
          e.target.style.display = 'none'
          if (e.target.nextSibling) e.target.nextSibling.style.display = 'block'
        }}
      />
      <div className="hidden p-6 text-center text-xs text-gray-400 border-2 border-dashed border-gray-300 rounded-lg">
        📷 (이 자리에 화면 캡처 이미지가 들어갈 예정)
      </div>
    </div>
  )
}

export default function ApiKeyGuide() {
  // step157: 로그인한 교사면 가이드 안에서 바로 등록할 수 있게 상태 로드
  const [authState, setAuthState] = useState({ loading: true, classId: null, isTeacher: false })
  const [registered, setRegistered] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setAuthState({ loading: false, classId: null, isTeacher: false }); return }
        const { data: profile } = await supabase.from('profiles')
          .select('role, class_id').eq('id', user.id).maybeSingle()
        const isTeacher = !!profile && (profile.role === 'teacher' || profile.role === 'admin')
        setAuthState({ loading: false, classId: profile?.class_id || null, isTeacher })
      } catch (e) {
        setAuthState({ loading: false, classId: null, isTeacher: false })
      }
    })()
  }, [])

  return (
    <>
      <Head><title>Gemini API 키 발급 안내 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <Link href="/" className="text-gray-600 hover:text-gray-900">←</Link>
            <h1 className="text-base font-bold">Gemini API 키 발급 안내</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">

          {/* 무료 안내 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
            <h2 className="font-bold text-blue-900 mb-2">🎁 완전 무료입니다!</h2>
            <p className="text-sm text-blue-800">
              Google의 Gemini API는 일정량까지 <strong>완전 무료</strong>로 사용할 수 있어요.
              25명 학급에서 매일 글쓰기를 해도 무료 한도 내에서 충분히 운영됩니다.
            </p>
          </div>

          {/* 💡 API 키가 뭔지 — 생소한 선생님용 쉬운 설명 */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="font-bold text-gray-900 mb-2">💡 API 키가 뭐예요?</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              AI(구글 Gemini)를 쓰기 위해 구글에서 <strong>무료로 받는 '출입증'</strong>이에요.
            </p>
            <p className="text-sm text-gray-700 mt-2 leading-relaxed">
              한 번 발급받아 붙여넣으면 끝! <strong>5분</strong>이면 됩니다.
            </p>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              <strong>왜 선생님이 직접 받나요?</strong> → 선생님 키로 쓰면 AI 비용이 구글 무료 한도로 해결되거든요.
            </p>
          </div>

          {/* 💡 한 가지만 확인 - 안내 톤 */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <h3 className="font-bold text-amber-900 mb-2 text-base">💡 한 가지만 확인해주세요</h3>
            <div className="text-sm text-amber-900 space-y-2">
              <p>
                <strong>개인 Gmail 계정</strong>으로 발급해주세요. 학교·교육청 계정은 구글이 외부 앱 연결을 막아둬서 작동하지 않거든요.
                개인 Gmail이 없으시면 <strong>1분</strong>이면 새로 만들 수 있어요.
              </p>
              <p className="text-xs">✅ 예: <strong>본인이름@gmail.com</strong> 같은 개인 계정</p>
              <p className="text-xs bg-white border border-amber-100 p-2 rounded text-amber-900">
                🔒 이 키는 AI 글쓰기 채점에만 사용되며, 선생님의 Gmail·메일·개인정보에는 접근하지 않아요. (구글 AI를 부르는 용도로만 쓰이는 키예요.)
              </p>
              <p className="text-xs mt-1 bg-white p-2 rounded">
                💡 만약 현재 브라우저에 학교 계정으로 로그인되어 있다면, <strong>시크릿 모드</strong>(Ctrl+Shift+N)를 열어서 진행하시면 편해요.
              </p>
            </div>
          </div>

          {/* 발급 단계 - 각 단계마다 캡처 자리 */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-1">📋 발급 방법 (3분 소요)</h2>
            <p className="text-xs text-gray-500 mb-5">각 단계마다 화면 예시를 함께 보여드려요</p>

            <ol className="space-y-6 text-sm">
              {/* 1단계 */}
              <li className="border-l-4 border-primary pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">1</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">Google AI Studio 접속 + 개인 Gmail 로그인 → "<strong className="text-red-600">+ API 키 만들기</strong>" 클릭</p>
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
                       className="inline-block bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition mt-1">
                      🔗 aistudio.google.com/apikey 바로가기
                    </a>
                    <p className="text-xs text-gray-500 mt-2">⚠️ 학교/회사 계정 X, 반드시 <strong>@gmail.com 개인 계정</strong>으로 로그인</p>
                    <p className="text-xs text-gray-500 mt-1">아래 사진의 빨간 ① 표시된 "API 키 만들기" 버튼을 클릭하세요</p>
                  </div>
                </div>
                <StepImage step={1} alt="API 키 만들기 버튼 위치" />
              </li>

              {/* 2단계: 키 만들기 모달 */}
              <li className="border-l-4 border-primary pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">2</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">새 키 만들기 창에서 "<strong className="text-red-600">키 만들기</strong>" 버튼 클릭</p>
                    <p className="text-gray-600 text-xs">키 이름은 기본값(Gemini API Key) 그대로 두셔도 OK</p>
                    <p className="text-gray-600 text-xs mt-1">프로젝트도 기본값(Default Gemini Project) 그대로 두세요</p>
                    <p className="text-xs text-gray-500 mt-1">아래 사진의 빨간 ② 표시된 버튼을 클릭하세요</p>
                  </div>
                </div>
                <StepImage step={3} alt="키 만들기 버튼 위치" />
              </li>

              {/* 3단계: 키 복사 */}
              <li className="border-l-4 border-primary pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-primary text-white rounded-full flex items-center justify-center font-bold text-sm">3</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">생성된 API 키 복사</p>
                    <p className="text-gray-600 text-xs">키는 보통 <code className="bg-gray-100 px-1 rounded">AIza</code> 또는 <code className="bg-gray-100 px-1 rounded">AQ.</code> 등으로 시작하는 긴 문자열이에요 (형식은 발급 시기마다 달라요)</p>
                    <p className="text-gray-600 text-xs mt-1">아래 사진의 빨간 ③ 표시된 <strong>복사 아이콘</strong> 또는 아래쪽 <strong>"키 복사"</strong> 버튼 클릭</p>
                  </div>
                </div>
                <StepImage step={4} alt="키 복사 버튼 위치" />
              </li>

              {/* 4단계: 사이트에 붙여넣기 */}
              <li className="border-l-4 border-green-500 pl-4">
                <div className="flex items-start gap-3 mb-2">
                  <span className="flex-shrink-0 w-7 h-7 bg-green-500 text-white rounded-full flex items-center justify-center font-bold text-sm">4</span>
                  <div className="flex-1">
                    <p className="font-medium mb-1">다온클래스 사이트에 붙여넣고 저장</p>
                    <p className="text-gray-600 text-xs">아래에서 <strong>바로 등록</strong>하거나, 선생님 메인 화면의 <strong>"🔑 학급 Gemini API 키"</strong> 카드에서 등록할 수 있어요</p>
                    <p className="text-gray-500 text-xs mt-1">한 번 저장하면 학급의 모든 학생이 자동으로 이 키를 사용합니다</p>
                  </div>
                </div>

                {/* 🆕 step157: 가이드 안에서 바로 등록 */}
                {authState.loading ? null : (authState.isTeacher && authState.classId) ? (
                  <div className="mt-3">
                    <ApiKeyManager classId={authState.classId} onChange={(k) => { if (k) setRegistered(true) }} />
                    {registered && (
                      <Link href="/teacher"
                        className="mt-3 inline-block bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700 transition">
                        ✅ 등록 완료! 대시보드로 돌아가기 →
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm">
                    <p className="text-blue-900 font-medium mb-2">🔑 로그인하면 이 자리에서 바로 등록할 수 있어요</p>
                    <Link href="/teacher/login"
                      className="inline-block bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-dark transition">
                      선생님 로그인 →
                    </Link>
                  </div>
                )}
              </li>
            </ol>
          </div>

          {/* 영상 안내 */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-5">
            <h3 className="font-bold text-purple-900 mb-2">🎬 영상으로 보고 싶다면?</h3>
            <p className="text-sm text-purple-900 mb-3">
              유튜브에서 <strong>"Gemini API key 발급"</strong>으로 검색하시면 친절한 한국어 영상이 많이 있어요.
            </p>
            <a
              href="https://www.youtube.com/results?search_query=Gemini+API+key+%EB%B0%9C%EA%B8%89"
              target="_blank" rel="noopener noreferrer"
              className="inline-block bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700"
            >
              🔗 유튜브에서 영상 찾아보기
            </a>
          </div>

          {/* 자주 묻는 질문 */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-3">❓ 자주 묻는 질문</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium">Q. 학교 계정으로 발급했는데 차단된 것 같아요</p>
                <p className="text-gray-600 mt-0.5">
                  → 시크릿 모드(Ctrl+Shift+N)에서 개인 Gmail로 다시 발급받으세요. 기존 학교 계정 키는 삭제해도 OK.
                </p>
              </div>
              <div>
                <p className="font-medium">Q. 개인 Gmail이 없어요</p>
                <p className="text-gray-600 mt-0.5">
                  → <a href="https://accounts.google.com/signup" target="_blank" rel="noopener" className="text-primary underline">accounts.google.com/signup</a>에서 새로 만들 수 있어요 (5분 소요).
                </p>
              </div>
              <div>
                <p className="font-medium">Q. 키가 정상인데 "403 PERMISSION_DENIED" 오류가 나요</p>
                <p className="text-gray-600 mt-0.5">
                  → 학교 계정 키일 가능성이 높아요. 개인 Gmail로 새 키 발급 후 교체하세요.
                </p>
              </div>
              <div>
                <p className="font-medium">Q. 키를 잃어버렸어요</p>
                <p className="text-gray-600 mt-0.5">
                  → aistudio.google.com/apikey에서 다시 확인 가능. 또는 새로 발급받으세요 (무료, 개수 제한 없음).
                </p>
              </div>
            </div>
          </div>

          {/* 보안 주의 */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
            <h3 className="font-bold text-yellow-900 mb-2">⚠️ 보안 주의사항</h3>
            <ul className="text-sm text-yellow-900 space-y-1">
              <li>• 입력한 키는 서버에 안전하게 보관되며, 학생이나 외부에 공개되지 않아요</li>
              <li>• 키를 바꾸거나 지우려면 언제든 "키 삭제" 버튼으로 가능해요 (서버에서 제거됩니다)</li>
              <li>• 타인에게 API 키를 공유하지 마세요</li>
              <li>• 키가 유출된 것 같으면 Google AI Studio에서 즉시 삭제 후 재발급</li>
            </ul>
          </div>

          {/* 무료 한도 - 간단하게 */}
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold mb-3">💰 AI 쓰는 데 돈이 드나요?</h2>
            <div className="text-sm space-y-2">
              <p>AI 채점에 드는 비용은 구글의 <strong>무료 한도</strong>로 충분해서, 따로 돈이 나가지 않아요. (선생님이 등록한 키로 무료 한도 안에서 작동해요.)</p>
              <p className="text-gray-600">
                Google이 정한 일일 한도가 있긴 하지만, 학급 단위로 쓰기엔 넉넉해서 끊김 없이 사용할 수 있어요.
              </p>
              <p className="text-gray-600 text-xs">
                💡 학급 25명이 매일 글쓰기 + 수정해도 한도 안에서 안정적으로 운영 가능해요.
              </p>
            </div>
          </div>

          <div className="text-center">
            <Link href="/teacher/login" className="inline-block bg-primary text-white px-6 py-3 rounded-xl font-semibold hover:bg-primary-dark transition">
              선생님 로그인으로 가기 →
            </Link>
          </div>
        </main>
      </div>
    </>
  )
}

```

## pages/api/admin-last-logins.js

```js
// 교사 마지막 로그인 시각 조회 API (관리자 전용, 읽기 전용)
// Supabase auth.users.last_sign_in_at(내장 자동 기록)을 service-role로 읽어온다.
// ★읽기 전용: listUsers만 사용. auth 데이터 update/delete 절대 안 함. PII(이메일 등) 미반환.
//
// 환경변수 필요:
// - NEXT_PUBLIC_SUPABASE_URL
// - NEXT_PUBLIC_SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 (다른 admin API가 이미 쓰는 그 키 재사용)

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { accessToken } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY가 없어요.' })
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 요청자 인증
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }

  // 요청자가 admin인지
  const { data: requesterProfile } = await supabaseAdmin.from('profiles')
    .select('role').eq('id', userData.user.id).maybeSingle()
  if (!requesterProfile || requesterProfile.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 조회할 수 있어요' })
  }

  // auth.users 전량 순회 (listUsers는 perPage 최대 1000 — 페이지네이션 필수)
  const lastLogins = {}  // { userId: last_sign_in_at }
  let page = 1
  const perPage = 1000
  let guard = 0
  try {
    while (guard++ < 100) {  // 최대 10만명 가드 (무한 루프 방지)
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
      if (error) {
        return res.status(500).json({ error: '사용자 목록 조회 실패' })
      }
      const users = data?.users || []
      users.forEach(u => {
        // id ↔ 마지막 로그인 시각만. 이메일 등 PII는 담지 않음.
        lastLogins[u.id] = u.last_sign_in_at || null
      })
      if (users.length < perPage) break
      page += 1
    }
  } catch (e) {
    return res.status(500).json({ error: '사용자 목록 조회 중 오류' })
  }

  return res.status(200).json({ lastLogins })
}

```

## pages/api/ai.js

```js
// ============================================
// AI 서버 프록시 — 프롬프트를 서버에서만 구성/실행
// ============================================
// 브라우저는 "어떤 작업인지(type) + 필요한 데이터 + 로그인 토큰"만 보냄.
// 프롬프트 본문은 lib/prompts.server.js 에만 있어 F12로 노출되지 않음.
//
// 키 서버격리 모델(step153~): 클라이언트는 API 키를 보내지 않는다.
//   accessToken으로 호출자를 인증 → 학급 판별 → service_role로 class_secrets에서
//   학급 키를 조회해 호출에만 사용한다 (키는 클라이언트로 절대 내려가지 않음).
//   class_secrets에 없으면 classes.api_key 폴백 (step154에서 제거 예정).
// ============================================
import { createClient } from '@supabase/supabase-js'
import { callGeminiStructured, callGemini, SCHEMAS } from '../../lib/gemini'
import { gradingPrompt, rewriteGradingPrompt, regradePrompt, rubricHintPrompt,
  topicBatchPrompt, topicSinglePrompt, rubricGenPrompt, topicDescPrompt,
  exampleEssayPrompt, tutorChatPrompt, schoolRecordPrompt, commentSuggestPrompt,
  grammarOnlyPrompt, feedbackSummaryPrompt } from '../../lib/prompts.server'

export const config = {
  maxDuration: 300, // 채점은 시간이 걸릴 수 있음 (Fluid Compute로 최대 300초)
}

// 서버 측 에러 기록(step155): service_role로 error_logs에 직접 INSERT. 절대 throw하지 않음.
async function logServerError({ accessToken, type, message }) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceKey) return
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    let role = 'unknown', userId = null, classId = null
    if (accessToken) {
      try {
        const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
          auth: { autoRefreshToken: false, persistSession: false }
        })
        const { data: u } = await anon.auth.getUser(accessToken)
        if (u?.user?.id) {
          userId = u.user.id
          const { data: p } = await admin.from('profiles').select('role, class_id').eq('id', userId).maybeSingle()
          role = p?.role || 'unknown'
          classId = p?.class_id || null
        }
      } catch (_) {}
    }
    await admin.from('error_logs').insert({
      role, user_id: userId, class_id: classId,
      page: 'api/ai', error_type: 'api_error',
      message: (message == null ? '' : String(message)).slice(0, 500),
      context: type ? { aiType: type } : null,
    })
  } catch (_) { /* 로깅 실패는 무시 */ }
}

// 호출자 학급의 Gemini 키를 서버에서 조회 (class_secrets 우선 → classes.api_key 폴백)
async function resolveApiKey({ accessToken, classId: classIdParam }) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return { error: { status: 500, message: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' } }
  }

  // 토큰 검증 (anon 클라이언트)
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return { error: { status: 401, message: '인증 정보가 유효하지 않아요. 다시 로그인해주세요.' } }
  }

  // 호출자 프로필 → 학급 판별
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: profile } = await supabaseAdmin.from('profiles')
    .select('role, class_id').eq('id', userData.user.id).maybeSingle()
  if (!profile) {
    return { error: { status: 403, message: '사용자 정보를 찾을 수 없어요.' } }
  }

  // admin은 classId 파라미터 허용, 그 외엔 본인 학급
  const classId = (profile.role === 'admin' && classIdParam) ? classIdParam : profile.class_id
  if (!classId) {
    return { error: { status: 400, message: '학급 정보가 없어요.' } }
  }

  // class_secrets 우선 → classes.api_key 폴백
  const { data: secret } = await supabaseAdmin.from('class_secrets')
    .select('api_key').eq('class_id', classId).maybeSingle()
  let apiKey = secret?.api_key || null
  if (!apiKey) {
    const { data: cls } = await supabaseAdmin.from('classes')
      .select('api_key').eq('id', classId).maybeSingle()
    apiKey = cls?.api_key || null
  }
  if (!apiKey) {
    return { error: { status: 400, message: '선생님이 API 키를 등록해야 AI 기능을 쓸 수 있어요.' } }
  }
  return { apiKey }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { type, accessToken, classId, payload } = req.body || {}

  if (!type) return res.status(400).json({ error: '작업 종류가 필요해요' })
  // 구버전 클라이언트(키만 보내고 토큰 없음)는 거부 — 배포 전 열려 있던 탭 대비
  if (!accessToken) {
    return res.status(401).json({ error: '앱이 업데이트되었어요. 페이지를 새로고침 해주세요.' })
  }

  // 키 서버 조회 (class_secrets → classes 폴백)
  const keyResult = await resolveApiKey({ accessToken, classId })
  if (keyResult.error) {
    return res.status(keyResult.error.status).json({ error: keyResult.error.message })
  }
  const apiKey = keyResult.apiKey

  try {
    let prompt, schema, opts

    // 챗봇은 텍스트 응답 (structured 아님) — 별도 처리
    if (type === 'tutorChat') {
      const p = tutorChatPrompt(payload || {})
      const answer = await callGemini(apiKey, p, { chainName: 'simple', temperature: 0.7, maxTokens: 500 })
      return res.status(200).json({ answer })
    }

    if (type === 'grading') {
      const { topic, essay, rubrics } = payload || {}
      if (!topic || !essay || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '채점에 필요한 정보가 부족해요' })
      }
      prompt = gradingPrompt({ topic, essay, rubrics })
      schema = SCHEMAS.essayFeedback
      opts = { maxTokens: 12000, taskType: 'grading', temperature: 0 }

    } else if (type === 'rewriteGrading') {
      const { topic, rewriteEssay, rubrics } = payload || {}
      if (!topic || !rewriteEssay || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '채점에 필요한 정보가 부족해요' })
      }
      prompt = rewriteGradingPrompt({ topic, rewriteEssay, rubrics })
      schema = SCHEMAS.essayFeedback
      opts = { maxTokens: 12000, taskType: 'grading', temperature: 0 }

    } else if (type === 'regrade') {
      const { topic, essay, rubrics } = payload || {}
      if (!topic || !essay || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '재평가에 필요한 정보가 부족해요' })
      }
      prompt = regradePrompt({ topic, essay, rubrics })
      schema = SCHEMAS.essayFeedback
      opts = { maxTokens: 12000, taskType: 'grading', temperature: 0 }

    } else if (type === 'rubricHint') {
      const { topic, rubrics } = payload || {}
      if (!topic || !Array.isArray(rubrics)) {
        return res.status(400).json({ error: '평가기준 정보가 부족해요' })
      }
      prompt = rubricHintPrompt({ topic, rubrics })
      schema = SCHEMAS.rubricSet
      opts = { maxTokens: 6000, taskType: 'creative', temperature: 0.3 }

    } else if (type === 'topicBatch') {
      prompt = topicBatchPrompt(payload || {})
      schema = SCHEMAS.topicBatch
      opts = { taskType: 'creative', maxTokens: payload?.maxTokens || 6000 }

    } else if (type === 'topicSingle') {
      prompt = topicSinglePrompt(payload || {})
      schema = SCHEMAS.topicSuggestion
      opts = { taskType: 'creative', maxTokens: payload?.maxTokens || 2000 }

    } else if (type === 'rubricGen') {
      if (!payload?.title) return res.status(400).json({ error: '주제 제목이 필요해요' })
      prompt = rubricGenPrompt(payload)
      schema = SCHEMAS.rubricSet
      opts = { taskType: 'creative', maxTokens: 6000, temperature: 0.5 }

    } else if (type === 'topicDesc') {
      if (!payload?.title) return res.status(400).json({ error: '주제 제목이 필요해요' })
      prompt = topicDescPrompt(payload)
      schema = SCHEMAS.topicSuggestion
      opts = { taskType: 'creative', maxTokens: 2000 }

    } else if (type === 'exampleEssay') {
      const { topicTitle, studentEssay } = payload || {}
      if (!studentEssay) return res.status(400).json({ error: '글 내용이 필요해요' })
      prompt = exampleEssayPrompt({ topicTitle, studentEssay })
      schema = SCHEMAS.exampleEssay
      opts = { maxTokens: 8000, taskType: 'quality' }

    } else if (type === 'schoolRecord') {
      const { summaries } = payload || {}
      if (!Array.isArray(summaries) || summaries.length === 0) {
        return res.status(400).json({ error: '학생의 글 기록이 필요해요' })
      }
      prompt = schoolRecordPrompt(payload)
      schema = SCHEMAS.schoolRecord
      opts = { taskType: 'quality', maxTokens: 6000, temperature: 0.4 }

    } else if (type === 'commentSuggest') {
      const { essay } = payload || {}
      if (!essay) return res.status(400).json({ error: '학생 글이 필요해요' })
      prompt = commentSuggestPrompt(payload)
      schema = SCHEMAS.commentSuggest
      opts = { taskType: 'quality', maxTokens: 2000, temperature: 0.6 }

    } else if (type === 'grammarOnly') {
      const { essay } = payload || {}
      if (!essay) return res.status(400).json({ error: '글 내용이 필요해요' })
      prompt = grammarOnlyPrompt({ essay })
      schema = SCHEMAS.grammarOnly
      opts = { taskType: 'grammar', maxTokens: 2000 }

    } else if (type === 'feedbackSummary') {
      const { feedbacks } = payload || {}
      if (!Array.isArray(feedbacks) || feedbacks.length < 2) {
        return res.status(400).json({ error: '요약할 의견이 부족해요' })
      }
      prompt = feedbackSummaryPrompt({ feedbacks })
      schema = SCHEMAS.feedbackSummary
      opts = { taskType: 'quality', maxTokens: 4000 }

    } else {
      return res.status(400).json({ error: '알 수 없는 작업 종류예요' })
    }

    const result = await callGeminiStructured(apiKey, prompt, schema, opts)
    return res.status(200).json({ result })

  } catch (e) {
    console.error('AI proxy error:', e?.message || e)
    // 서버 측 에러 기록 (개인정보 없는 원본 메시지만)
    await logServerError({ accessToken, type, message: e?.message || e })
    // 친절한 에러 메시지는 클라이언트에서 처리하도록 원문 전달
    return res.status(500).json({ error: e?.message || 'AI 처리 중 오류가 발생했어요' })
  }
}

```

## pages/api/class-lookup.js

```js
// ============================================
// 학급 코드 조회 API (step149 RLS 동반)
// ============================================
// classes의 익명 SELECT가 RLS로 막히면서, 비로그인 경로 2가지를 대체:
//   1. { code }      → 학생 가입·QR 힌트용 학급 정보 (안전 컬럼만!)
//   2. { checkCode } → 학급 코드 중복확인 (존재 여부만)
//
// ⚠️ teacher_id, api_key 등 민감 컬럼은 절대 반환하지 말 것.
//    4자리 코드는 원래 공개 전제(학생에게 배포)라 이 라우트가 노출하는
//    정보는 기존 익명 SELECT보다 항상 적다.

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { code, checkCode } = req.body || {}

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 모드 2: 코드 중복확인 (존재 여부만 — 교사 학급코드 발급/재발급용)
  if (checkCode) {
    const normalized = String(checkCode).trim().toUpperCase()
    const { data } = await supabaseAdmin.from('classes')
      .select('id').eq('code', normalized).limit(1).maybeSingle()
    return res.status(200).json({ exists: !!data })
  }

  // 모드 1: 학급 정보 조회 (학생 가입 + QR/로그인 힌트)
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: '학급 코드가 필요해요' })
  }
  const normalized = code.trim().toUpperCase()
  const { data, error } = await supabaseAdmin.from('classes')
    .select('id, name, school, is_active, deleted_at, login_hint_enabled, login_username_prefix, login_default_password, self_signup_enabled')
    .eq('code', normalized)
    .maybeSingle()

  if (error) {
    console.error('class-lookup error:', error.message)
    return res.status(500).json({ error: '학급 조회 중 오류가 발생했어요' })
  }
  if (!data) return res.status(200).json({ found: false, class: null })

  return res.status(200).json({ found: true, class: data })
}

```

## pages/api/consent-grayzone-list.js

```js
// 회색지대 학생 목록 조회 API — 인증된 담임이 자기 학급의 "증빙 공백" 학생을 본다.
//
// 회색지대 = consent_received=true 인데 consents 행이 없고, realname 평문이 있고, pending_names 가 없는 학생.
//   (✓는 켜졌는데 동의서 기록이 없어 실명이 노출된 상태 — 종이 동의 확인 또는 재잠금 필요)
// 인증: 교사 accessToken → 본인 학급(classes.teacher_id) 만. admin 은 classId 자유(우회).
// ★실명은 students.js 가 교사에게 보여주는 것과 동일 수위(담임 본인 학급만) — 인증 맥락이라 [{id, number, realname}] 반환.
//   다른 반·is_hidden 학생은 제외. 쓰기 전혀 없음(읽기 전용).
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { classId, accessToken } = req.body || {}
  if (!classId) return res.status(400).json({ error: '학급 정보가 필요해요' })
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // 교사 인증
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: ud, error: ue } = await anon.auth.getUser(accessToken)
  if (ue || !ud?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  const uid = ud.user.id
  const { data: requester } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle()
  if (!requester || (requester.role !== 'teacher' && requester.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }
  // 담임 검증 (admin 우회)
  if (requester.role !== 'admin') {
    const { data: cls } = await admin.from('classes').select('teacher_id').eq('id', classId).maybeSingle()
    if (!cls || cls.teacher_id !== uid) return res.status(403).json({ error: '본인 학급만 볼 수 있어요' })
  }

  try {
    // 1) 후보: consent_received=true + realname 평문 있음 + 숨김 아님
    const { data: studs } = await admin.from('profiles')
      .select('id, number, realname, consent_received, is_hidden, role')
      .eq('class_id', classId).eq('role', 'student')
    const candidates = (studs || []).filter(s =>
      !s.is_hidden && s.consent_received === true && s.realname && String(s.realname).trim()
    )
    const ids = candidates.map(s => s.id)
    if (ids.length === 0) return res.status(200).json({ ok: true, students: [] })

    // 2) pending_names 있는 학생(잠긴 적 있음 → 제외)
    const { data: pns } = await admin.from('pending_names').select('student_id').in('student_id', ids)
    const lockedSet = new Set((pns || []).map(p => p.student_id))

    // 3) consents 있는 학생(증빙 있음 → 제외)
    const { data: cons } = await admin.from('consents').select('student_id').in('student_id', ids)
    const tracedSet = new Set((cons || []).map(c => c.student_id))

    // 4) 회색지대 = 후보 중 pending_names 없고 consents 없음
    const gray = candidates
      .filter(s => !lockedSet.has(s.id) && !tracedSet.has(s.id))
      .map(s => ({ id: s.id, number: s.number, realname: s.realname }))
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999))

    return res.status(200).json({ ok: true, students: gray })
  } catch (e) {
    console.error('consent-grayzone-list error:', e?.message || e)
    return res.status(500).json({ error: '조회 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}

```

## pages/api/consent-paper.js

```js
// 종이 동의 처리 API (묶음 F-0) — 교사가 종이 동의서를 받아 "동의서 ✓"로 켤 때 호출.
//
// 온라인(/api/parent-consent)과 달리 부모 세션이 없고 교사가 대신 처리하므로,
// 교사 accessToken으로 인증 + 담임 검증 후 service_role로 RLS를 우회해 처리한다.
// 해제 로직은 parent-consent.js 142~174줄과 동일(잠금 해제 단일 규칙 재사용):
//   pending_names.enc_name → decryptName → profiles.realname 채움 → pending_names 삭제.
//
// 학생별 처리(8단계):
//   1) env  2) 교사 인증  3) 담임 검증(class_id)  4) 멱등 가드(이미 동의+잠금없음 → 스킵)
//   5) 실명 해제(pending_names 있을 때만 복호화)  6) consent_received=true 보장
//   7) consents 이력 insert(source='paper')  8) 결과 집계 응답
// ★ 지목된 studentIds만 처리. 다른 반·온라인 경로·기존 데이터 불변. 응답에 실명 등 PII 미포함.
//
// 사전 조건(SQL): step187(pending_names), step193(consents), step209(consents.source).
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//           SUPABASE_SERVICE_ROLE_KEY, NAME_ENCRYPTION_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import { decryptName, encryptName } from '../../lib/encryptName'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { studentIds, accessToken, action } = req.body || {}
  // 기본 unlock(동의 처리) — 기존 동작 보존. lock=재잠금, teacher_confirm=회색지대 증빙 마커.
  const mode = action === 'lock' ? 'lock'
    : action === 'teacher_confirm' ? 'teacher_confirm'
    : 'unlock'
  const ids = Array.isArray(studentIds) ? studentIds.filter(Boolean) : []
  if (ids.length === 0) return res.status(400).json({ error: '대상 학생이 없어요' })
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  // 1) env
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 2) 교사 인증 (anon 클라이언트로 토큰 검증 → uid·role)
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }
  const uid = userData.user.id
  const { data: requester } = await supabaseAdmin.from('profiles')
    .select('role').eq('id', uid).maybeSingle()
  if (!requester || (requester.role !== 'teacher' && requester.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }
  const isAdmin = requester.role === 'admin'

  const now = new Date().toISOString()
  // 결과 집계: 상태별 studentId 모음
  const results = { unlocked: [], consentOnly: [], alreadyDone: [], unlockFailed: [], relocked: [], confirmed: [], skipped: [] }

  for (const studentId of ids) {
    try {
      // 3) 대상 학생 조회 + 담임 검증
      const { data: stu } = await supabaseAdmin.from('profiles')
        .select('id, class_id, role, consent_received, realname')
        .eq('id', studentId)
        .maybeSingle()
      if (!stu || stu.role !== 'student') { results.skipped.push(studentId); continue }

      if (!isAdmin) {
        const { data: cls } = await supabaseAdmin.from('classes')
          .select('teacher_id').eq('id', stu.class_id).maybeSingle()
        if (!cls || cls.teacher_id !== uid) { results.skipped.push(studentId); continue }
      }

      // ===== 재잠금(동의 철회) 분기 — action:'lock' =====
      // ★복구 보장: ①빈값 스킵 ②암호화 성공 ③pending_names 저장 성공 — 셋 다 통과한 뒤에만 realname 비움.
      //   하나라도 실패하면 realname을 그대로 두고 skipped 기록(절대 파괴 안 함).
      if (mode === 'lock') {
        // ① 빈값 스킵 — 이미 닉네임 상태(잠김) 또는 자가가입(realname 없음): 재잠금할 실명 없음.
        //    단, 동의 플래그가 켜져 있으면(자가가입 consentOnly 등) 철회는 반영해 내려준다(realname 불변).
        if (!stu.realname || !String(stu.realname).trim()) {
          if (stu.consent_received === true) {
            await supabaseAdmin.from('profiles').update({ consent_received: false, consent_received_at: null }).eq('id', studentId)
          }
          results.skipped.push(studentId); continue
        }
        // ② 선(先)암호화 — 실패(키 없음 등)면 realname 유지 + 스킵
        let enc = null
        try { enc = encryptName(String(stu.realname)) } catch (e) { console.error('encryptName 실패:', studentId, e?.message); enc = null }
        if (!enc) { results.skipped.push(studentId); continue }
        // ③ pending_names upsert(저장) 성공 후에만 realname 비움 (PK=student_id)
        const { error: pnErr } = await supabaseAdmin.from('pending_names')
          .upsert({ student_id: studentId, class_id: stu.class_id, enc_name: enc }, { onConflict: 'student_id' })
        if (pnErr) { console.error('pending_names upsert 실패:', studentId, pnErr.message); results.skipped.push(studentId); continue }
        // ④ 저장 확인 후 realname 비우고 동의 해제
        const { error: upErr } = await supabaseAdmin.from('profiles').update({
          realname: '', consent_received: false, consent_received_at: null,
        }).eq('id', studentId)
        if (upErr) { console.error('consent-paper lock update 실패:', studentId, upErr.message); results.skipped.push(studentId); continue }
        // ⑤ 철회 이력 (서명·동의항목 없음)
        const { error: cErr } = await supabaseAdmin.from('consents').insert({
          student_id: studentId, class_id: stu.class_id,
          parent_name: '(동의 철회)', signature: null,
          consent_items: [], source: 'paper', consented_at: now,
        })
        if (cErr) console.error('consent-paper 철회 이력 insert 실패:', studentId, cErr.message)
        results.relocked.push(studentId)
        continue
      }

      // ===== 회색지대 "확인 처리" 분기 — action:'teacher_confirm' =====
      //   consent_received=true인데 consents 기록이 없는(증빙 공백) 학생에게 교사 확인 마커를 남긴다.
      //   ★lock/unlock 경로는 건드리지 않음. 마커 insert만(realname·consent_received·pending_names 무변경).
      if (mode === 'teacher_confirm') {
        // 가드: 이미 consents 행이 하나라도 있으면 skip(회색지대 아님 + teacher_confirm 중복 방지 = 멱등)
        const { count: cCount } = await supabaseAdmin.from('consents')
          .select('id', { count: 'exact', head: true }).eq('student_id', studentId)
        if ((cCount || 0) > 0) { results.skipped.push(studentId); continue }
        // 마커 행 insert (동의 증빙 = 교사 확인) — unlock의 source='paper' 패턴 차용
        const { error: cErr } = await supabaseAdmin.from('consents').insert({
          student_id: studentId, class_id: stu.class_id,
          parent_name: '(교사 확인)', signature: null,
          consent_items: ['privacy', 'ai_processing'],
          source: 'teacher_confirm', consented_at: now,
        })
        if (cErr) { console.error('consent-paper teacher_confirm insert 실패:', studentId, cErr.message); results.skipped.push(studentId); continue }
        results.confirmed.push(studentId)
        continue
      }

      // 4) 멱등 가드 — pending_names 조회
      const { data: pn } = await supabaseAdmin.from('pending_names')
        .select('enc_name').eq('student_id', studentId).maybeSingle()

      // 이미 동의됨 + 잠금 없음 → 완전 스킵(realname·consents 무변경)
      if (!pn && stu.consent_received === true) {
        results.alreadyDone.push(studentId)
        continue
      }

      let status = null

      if (pn) {
        // 5) 실명 해제 — enc_name 복호화 (있을 때만)
        let realname = null
        try {
          realname = pn.enc_name ? decryptName(pn.enc_name) : null
        } catch (e) {
          console.error('decryptName 실패:', studentId, e?.message)
          realname = null
        }

        if (realname) {
          const { error: upErr } = await supabaseAdmin.from('profiles').update({
            realname,
            consent_received: true,
            consent_received_at: now,
          }).eq('id', studentId)
          if (upErr) { results.skipped.push(studentId); continue }
          // 잠금 행 삭제(마지막 — 중간 실패 시 재시도 여지)
          await supabaseAdmin.from('pending_names').delete().eq('student_id', studentId)
          status = 'unlocked'
        } else {
          // 복호화 실패/키 없음 — realname은 못 채우지만 consent_received는 켜고 교사에게 안내
          const { error: upErr } = await supabaseAdmin.from('profiles').update({
            consent_received: true, consent_received_at: now,
          }).eq('id', studentId)
          if (upErr) { results.skipped.push(studentId); continue }
          status = 'unlockFailed'
        }
      } else {
        // pending_names 없음(자가가입 등) — realname 건드리지 않고 consent_received만 보장
        const { error: upErr } = await supabaseAdmin.from('profiles').update({
          consent_received: true, consent_received_at: now,
        }).eq('id', studentId)
        if (upErr) { results.skipped.push(studentId); continue }
        status = 'consentOnly'
      }

      // 7) consents 이력 insert (종이 제출 — 서명 없음)
      const { error: cErr } = await supabaseAdmin.from('consents').insert({
        student_id: studentId,
        class_id: stu.class_id,
        parent_name: '(종이 제출)',
        signature: null,
        consent_items: ['privacy', 'ai_processing'],
        source: 'paper',
        consented_at: now,
      })
      if (cErr) {
        // 실명·동의는 이미 처리됨 — 이력 실패는 로깅만(상태는 유지)
        console.error('consent-paper consents insert 실패:', studentId, cErr.message)
      }

      if (status === 'unlocked') results.unlocked.push(studentId)
      else if (status === 'unlockFailed') results.unlockFailed.push(studentId)
      else results.consentOnly.push(studentId)
    } catch (e) {
      console.error('consent-paper student 처리 실패:', studentId, e?.message || e)
      results.skipped.push(studentId)
    }
  }

  // 8) 집계 응답 (PII 없음 — studentId만)
  return res.status(200).json({ ok: true, action: mode, results })
}

```

## pages/api/consent-verify-child.js

```js
// 부모 동의 1단계 — 자녀 본인 확인 (읽기 전용, 비로그인)
//
// 마법사형 부모 동의 1페이지에서 호출. (학급코드 + 자녀번호 + 동의비밀번호)로 자녀를
// 특정해 "곽○윤 학생 맞나요?" 확인용 마스킹 이름만 돌려준다.
// ⚠️ DB 에 아무것도 쓰지 않는다(rate-limit 시도 기록만 예외). 평문 실명·studentId·enc_name
//    은 절대 응답에 넣지 않는다. 실제 잠금 해제(실명 기록)는 2페이지 최종 제출
//    /api/parent-consent 에서만 일어난다.
//
// 동의비번 폴백은 parent-consent.js 와 같은 헬퍼(effectiveConsentPassword)를 쓴다.
// rate-limit 은 최종 제출(parent_consent)과 별도 버킷(parent_consent_verify)으로 분리해
// 확인 호출이 제출 한도를 잠식하지 않게 한다.
//
// 사전 조건(SQL 적용): step187(pending_names), step193(consents + classes.consent_password),
//                      step165(api_rate_limit). NAME_ENCRYPTION_KEY 환경변수.
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NAME_ENCRYPTION_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { decryptName } from '../../lib/encryptName'
import { maskKoreanName } from '../../lib/maskName'
import { effectiveConsentPassword } from '../../lib/consentPassword'
import { hasConsentTrace } from '../../lib/consentTrace'

// ── 호출 제한 (parent-consent 패턴 동일, 버킷만 분리) ──
const RL_BUCKET = 'parent_consent_verify'
const RL_IP_PREFIX = 'literacy-class:consent-verify:'   // 라우트별 고유 prefix
const RL_SHORT_LIMIT = 20                                 // 10분 내 허용(확인은 제출보다 자주)
const RL_SHORT_WINDOW_MS = 10 * 60 * 1000
const RL_DAY_LIMIT = 80                                   // 24시간 내 허용
const RL_DAY_WINDOW_MS = 24 * 60 * 60 * 1000

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}
function hashIp(ip) {
  return crypto.createHash('sha256').update(RL_IP_PREFIX + ip).digest('hex')
}
// true면 한도 초과(차단). 내부 오류는 fail-open(false).
async function isRateLimited(supabase, ipHash) {
  try {
    const countSince = async (windowMs) => {
      const cutoff = new Date(Date.now() - windowMs).toISOString()
      const { count } = await supabase.from('api_rate_limit')
        .select('id', { count: 'exact', head: true })
        .eq('bucket', RL_BUCKET).eq('ip_hash', ipHash).gt('created_at', cutoff)
      return count || 0
    }
    if (await countSince(RL_SHORT_WINDOW_MS) >= RL_SHORT_LIMIT) return true
    if (await countSince(RL_DAY_WINDOW_MS) >= RL_DAY_LIMIT) return true
    await supabase.from('api_rate_limit').insert({ bucket: RL_BUCKET, ip_hash: ipHash })
    return false
  } catch (e) {
    console.error('consent-verify rate limit check failed (fail-open):', e?.message || e)
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { classCode, studentNumber, consentPassword } = req.body || {}

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 1) rate-limit (제출과 별도 버킷)
  const ipHash = hashIp(getClientIp(req))
  if (await isRateLimited(supabaseAdmin, ipHash)) {
    return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' })
  }

  // 2) 입력 검증
  if (!classCode || !String(classCode).trim()) return res.status(400).json({ error: '학급 코드가 필요해요' })
  if (!studentNumber || !String(studentNumber).trim()) return res.status(400).json({ error: '자녀의 번호를 입력해주세요' })
  if (!consentPassword || !String(consentPassword).trim()) return res.status(400).json({ error: '동의 비밀번호를 입력해주세요' })

  try {
    // 3) 학급 검증 + 동의비번 폴백(parent-consent 와 동일 헬퍼)
    const normalizedCode = String(classCode).trim().toUpperCase()
    const { data: cls } = await supabaseAdmin.from('classes')
      .select('id, code, name, grade, consent_password, deleted_at')
      .eq('code', normalizedCode)
      .maybeSingle()
    if (!cls || cls.deleted_at) {
      return res.status(404).json({ error: '학급을 찾을 수 없어요. 코드를 다시 확인해주세요.' })
    }
    const effectivePw = effectiveConsentPassword(cls, normalizedCode)
    if (!effectivePw || String(consentPassword).trim() !== effectivePw) {
      return res.status(403).json({ error: '동의 비밀번호가 일치하지 않아요. 담임 선생님께 확인해주세요.' })
    }

    // 4) 자녀 특정 (class_id + number + role='student', 숨김 제외) — parent-consent 와 동일 규칙
    const { data: kids } = await supabaseAdmin.from('profiles')
      .select('id')
      .eq('class_id', cls.id)
      .eq('number', String(studentNumber).trim())
      .eq('role', 'student')
      .or('is_hidden.is.null,is_hidden.eq.false')
    if (!kids || kids.length === 0) {
      return res.status(404).json({ error: '해당 번호의 학생을 찾을 수 없어요. 번호를 확인해주세요.' })
    }
    if (kids.length > 1) {
      return res.status(409).json({ error: '같은 번호의 학생이 둘 이상이에요. 담임 선생님께 문의해주세요.' })
    }
    const studentId = kids[0].id

    // 5) pending_names 조회 — 잠긴 적 없으면(행 없음) 동의 흔적이 있을 때만 '이미 동의'로 본다.
    const { data: pn } = await supabaseAdmin.from('pending_names')
      .select('enc_name')
      .eq('student_id', studentId)
      .maybeSingle()
    if (!pn) {
      // 동의 흔적(consents OR consent_received) 판정 — pending_names 단독 판정의 오판 방지.
      const traced = await hasConsentTrace(supabaseAdmin, studentId)
      // 평문 실명 확인(마스킹만 반환 — 평문은 서버 밖으로 나가지 않음)
      const { data: prof } = await supabaseAdmin.from('profiles')
        .select('realname').eq('id', studentId).maybeSingle()
      const hasName = !!(prof?.realname && String(prof.realname).trim())
      // 진짜 이미 동의(흔적 있음) 또는 풀 이름 자체가 없음(닉네임 전용) → 더 할 일 없음
      if (traced || !hasName) {
        return res.status(200).json({ ok: true, alreadyConsented: true })
      }
      // 레거시 미동의(평문 실명 노출 + 흔적 없음) → 정상 확인 화면으로 진입(마스킹 이름 제공)
      return res.status(200).json({
        ok: true,
        masked: maskKoreanName(prof.realname),
        grade: (cls.grade ?? null),
        className: cls.name || null,
        number: String(studentNumber).trim(),
      })
    }

    // 6) 복호화 → 마스킹만 추출 (평문은 서버 밖으로 나가지 않음)
    const realname = pn.enc_name ? decryptName(pn.enc_name) : null
    if (!realname) {
      console.error('consent-verify decrypt 실패:', studentId)
      return res.status(500).json({ error: '학생 정보를 확인하지 못했어요. 담임 선생님께 문의해주세요.' })
    }
    const masked = maskKoreanName(realname)

    // 7) 응답 — 마스킹 이름·학년·반·번호만. studentId/enc_name/평문 실명 절대 미포함.
    return res.status(200).json({
      ok: true,
      masked,
      grade: (cls.grade ?? null),
      className: cls.name || null,
      number: String(studentNumber).trim(),
    })
  } catch (e) {
    console.error('consent-verify error:', e?.message || e)
    return res.status(500).json({ error: '처리 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}

```

## pages/api/cron-admin-trash-cleanup.js

```js
// 🗑️ 관리자 휴지통 자동 영구 삭제 cron (B4)
// Vercel Cron으로 매일 호출 (vercel.json에 설정)
// 30일 지난 선생님·학급을 영구삭제

import { createClient } from '@supabase/supabase-js'

const RETENTION_DAYS = 30

export default async function handler(req, res) {
  // Vercel Cron만 호출 가능 (인증) — CRON_SECRET 미설정 시 무조건 거부
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(500).json({ error: '서버 설정 누락 (CRON_SECRET 없음)' })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()

  const result = {
    cutoff,
    teachersDeleted: 0,
    classesDeleted: 0,
    submissionsDeleted: 0,
    topicsDeleted: 0,
    errors: []
  }

  try {
    // ============================================
    // 1. 30일 지난 학급 영구삭제 (먼저 — cascade 필요)
    // ============================================
    const { data: oldClasses, error: classErr } = await supabase
      .from('classes')
      .select('id, name, teacher_id')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff)
    if (classErr) throw classErr

    for (const cls of oldClasses || []) {
      try {
        // 1.1) 학급에 속한 주제들 찾기 (teacher_id 기준)
        const { data: classTopics } = await supabase
          .from('topics').select('id').eq('teacher_id', cls.teacher_id)
        const topicIds = (classTopics || []).map(t => t.id)

        // 1.2) 주제들의 제출물 삭제
        if (topicIds.length > 0) {
          const { count: subCount } = await supabase
            .from('submissions').delete({ count: 'exact' }).in('topic_id', topicIds)
          result.submissionsDeleted += subCount || 0
          // 1.3) 주제 삭제
          const { count: topicCount } = await supabase
            .from('topics').delete({ count: 'exact' }).in('id', topicIds)
          result.topicsDeleted += topicCount || 0
        }

        // 1.4) 학급의 학생 profile.class_id = null
        await supabase.from('profiles').update({ class_id: null }).eq('class_id', cls.id)

        // 1.5) 학급 삭제
        const { error: delErr } = await supabase.from('classes').delete().eq('id', cls.id)
        if (delErr) throw delErr
        result.classesDeleted++
      } catch (e) {
        result.errors.push(`class ${cls.id} (${cls.name}): ${e.message}`)
      }
    }

    // ============================================
    // 2. 30일 지난 선생님 영구삭제
    // ============================================
    const { data: oldTeachers, error: teacherErr } = await supabase
      .from('profiles')
      .select('id, realname, role')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff)
      .in('role', ['teacher', 'admin'])
    if (teacherErr) throw teacherErr

    for (const t of oldTeachers || []) {
      try {
        // FK 설정대로:
        // - topic_suggestion_logs.teacher_id ON DELETE CASCADE → 자동
        // - feedback.user_id ON DELETE SET NULL → 자동
        // 학급은 그대로 둠 (학생 데이터 보호 — 이미 학급은 별도 휴지통)
        const { error: delErr } = await supabase.from('profiles').delete().eq('id', t.id)
        if (delErr) throw delErr
        result.teachersDeleted++
      } catch (e) {
        result.errors.push(`teacher ${t.id} (${t.realname}): ${e.message}`)
      }
    }

    return res.status(200).json({
      ok: true,
      ...result
    })
  } catch (e) {
    console.error('cron-admin-trash-cleanup 오류:', e)
    return res.status(500).json({ error: e.message, ...result })
  }
}

```

## pages/api/cron-trash-cleanup.js

```js
// 🗑️ 쓰레기통 자동 영구 삭제 cron
// Vercel Cron으로 매일 새벽 호출 (vercel.json에 설정)
// 각 학급의 trash_retention_days 기간 지난 글 영구 삭제

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // Vercel Cron만 호출 가능 (인증) — CRON_SECRET 미설정 시 무조건 거부
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(500).json({ error: '서버 설정 누락 (CRON_SECRET 없음)' })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    // 🆕 step155: 30일 지난 에러 로그 자동 삭제 (테이블 무한 증가 방지)
    try {
      const elogCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('error_logs').delete().lt('created_at', elogCutoff)
    } catch (e) {
      console.warn('error_logs 정리 실패(무시):', e?.message || e)
    }

    // 각 학급의 보관 기간 가져오기
    const { data: classes, error: classErr } = await supabase
      .from('classes')
      .select('id, trash_retention_days')
    if (classErr) throw classErr

    let totalDeleted = 0
    const perClass = []

    for (const cls of classes || []) {
      const days = cls.trash_retention_days || 30
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

      // 해당 학급 학생들 ID
      const { data: students } = await supabase
        .from('profiles')
        .select('id')
        .eq('class_id', cls.id)
        .eq('role', 'student')
      const studentIds = (students || []).map(s => s.id)
      if (studentIds.length === 0) continue

      // 만료된 글 영구 삭제
      const { data: expiredSubs } = await supabase
        .from('submissions')
        .select('id')
        .in('user_id', studentIds)
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoff)

      if (expiredSubs && expiredSubs.length > 0) {
        const ids = expiredSubs.map(s => s.id)
        const { error: delErr } = await supabase
          .from('submissions')
          .delete()
          .in('id', ids)
        if (delErr) {
          console.error(`학급 ${cls.id} 삭제 실패:`, delErr)
          continue
        }
        totalDeleted += ids.length
        perClass.push({ classId: cls.id, deleted: ids.length, retentionDays: days })
      }
    }

    res.status(200).json({
      success: true,
      totalDeleted,
      perClass,
      runAt: new Date().toISOString()
    })
  } catch (e) {
    console.error('cron 실패:', e)
    res.status(500).json({ error: e.message })
  }
}

```

## pages/api/feedback-mark-read.js

```js
// 피드백 답변 읽음 처리 (step205-C)
// feedback UPDATE 정책은 admin-only(fb_update)라 작성자가 직접 못 씀.
// → 이 서비스롤 라우트가 "본인(user_id=auth.uid())의 답변 달린 미열람 의견"만 reply_read_at 갱신한다.
//   ★ user_id 가드로 다른 사람 행은 절대 못 건드림. reply_text/reply_by 등 답변 내용은 변경하지 않음.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  // 토큰 검증 → 본인 user_id 확보
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }
  const uid = userData.user.id

  // service_role로 본인 행만 읽음 처리 (★ user_id 가드 — 다른 행 불가)
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { error } = await supabaseAdmin.from('feedback')
    .update({ reply_read_at: new Date().toISOString() })
    .eq('user_id', uid)
    .not('reply_text', 'is', null)
    .is('reply_read_at', null)
  if (error) {
    console.error('feedback-mark-read error:', error.message)
    return res.status(500).json({ error: '읽음 처리 중 오류가 생겼어요.' })
  }
  return res.status(200).json({ ok: true })
}

```

## pages/api/find-teacher-id.js

```js
// 교사 아이디 찾기 (자동, 마스킹 표시) — step162 / step164
//
// 이름 + 학교가 정확히 일치하는 교사를 service_role로 조회해 "마스킹된" 아이디를 반환한다.
//   - 0건  → status: 'none'            (일치 계정 없음)
//   - 1건  → status: 'found'           (maskedUsername 반환)
//   - 2건+ → status: 'need_class_code' (동명이인 — 학급 가입코드 2차 확인 요청)
//            └ 클라이언트가 class_code를 추가로 보내 재호출하면:
//               · 후보 중 그 코드의 담임 1명 확정 → 'found'
//               · 코드 불일치/여전히 복수      → 'multiple' (관리자 요청 폴백)
//
// step164: 아이디 찾기는 "교사"를 돕는 기능이므로 후보를 role='teacher'로 한정한다
//   (admin 본인은 자기 아이디를 아므로 후보에서 제외 → 불필요한 동명이인 줄임).
//
// 전체 아이디는 절대 반환하지 않는다(마스킹만). 아이디는 비밀번호 없이는 로그인에 쓸 수
// 없으므로 마스킹 표시의 위험은 낮다. 학급코드 2차 확인은 "아이디 찾기"에만 쓰며
// 비밀번호 재설정에는 절대 쓰지 않는다. 학급코드 검증은 서버에서만 한다.
//
// profiles RLS(prof_select)는 to authenticated라 비로그인은 0행 → 반드시 service_role 경유.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// step165: IP 기반 호출 제한 (무차별 대입 방지, 특히 동명이인 학급코드 2차 확인)
//   password-reset-request.js의 ip_hash(sha256 + 고정 prefix) 패턴을 재사용한다.
//   전용 테이블 api_rate_limit에 호출 1건당 1행 기록, 윈도우 내 건수로 차단.
//   조회 실패 시에는 fail-open(차단하지 않음)해 정상 사용자의 가용성을 우선한다.
const RL_BUCKET = 'find_teacher_id'
const RL_IP_PREFIX = 'literacy-class:findid:'   // password-reset와 다른 prefix
const RL_SHORT_LIMIT = 20                         // 10분 내 허용 횟수
const RL_SHORT_WINDOW_MS = 10 * 60 * 1000
const RL_DAY_LIMIT = 50                            // 24시간 내 허용 횟수
const RL_DAY_WINDOW_MS = 24 * 60 * 60 * 1000

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(RL_IP_PREFIX + ip).digest('hex')
}

// true면 한도 초과(차단). 내부 오류는 fail-open(false).
async function isRateLimited(supabase, ipHash) {
  try {
    const countSince = async (windowMs) => {
      const cutoff = new Date(Date.now() - windowMs).toISOString()
      const { count } = await supabase.from('api_rate_limit')
        .select('id', { count: 'exact', head: true })
        .eq('bucket', RL_BUCKET).eq('ip_hash', ipHash).gt('created_at', cutoff)
      return count || 0
    }
    if (await countSince(RL_SHORT_WINDOW_MS) >= RL_SHORT_LIMIT) return true
    if (await countSince(RL_DAY_WINDOW_MS) >= RL_DAY_LIMIT) return true
    // 한도 내 → 이번 호출 기록 후 통과
    await supabase.from('api_rate_limit').insert({ bucket: RL_BUCKET, ip_hash: ipHash })
    return false
  } catch (e) {
    console.error('find-teacher-id rate limit check failed (fail-open):', e?.message || e)
    return false
  }
}

function maskUsername(u) {
  const s = String(u || '')
  if (s.length <= 1) return '***'
  if (s.length <= 4) return s[0] + '***' + s.slice(-1)
  return s.slice(0, 3) + '***' + s.slice(-2)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { realname, school, school_code, class_code } = req.body || {}
  if (!realname || !realname.trim() || !school || !school.trim()) {
    return res.status(400).json({ error: '이름과 학교를 모두 입력해주세요' })
  }
  const code = school_code ? String(school_code).trim() : ''
  const classCode = class_code ? String(class_code).trim() : ''

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // step165: 호출 제한 (이름+학교 1차 조회와 학급코드 2차 확인 모두 동일 한도 적용)
  const ipHash = hashIp(getClientIp(req))
  if (await isRateLimited(supabase, ipHash)) {
    return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' })
  }

  try {
    // 이름 + 학교 정확 일치 (클라이언트가 trim해서 보냄). 휴지통 계정은 제외.
    // step163: 표준학교코드(school_code)가 오면 코드 기준으로 먼저 매칭해 표기 흔들림
    // ('하랑초' vs '하랑초등학교')으로 인한 'none'을 없앤다.
    //   ⚠️ 단, 기존 교사는 profile.school_code가 아직 NULL일 수 있다. 이때 코드 매칭이
    //      0건이면 학교명 텍스트로 한 번 더 fallback 조회해 오인식('none')을 막는다.
    //      자동완성으로 고른 학교명은 공식명이라 텍스트 fallback도 정확도가 높다.
    // step164: 후보는 교사만 (admin 제외)
    const findBy = async (col, val) => {
      const { data, error } = await supabase.from('profiles')
        .select('id, username, deleted_at, role')
        .eq('realname', realname.trim())
        .eq(col, val)
        .eq('role', 'teacher')
      if (error) throw error
      return (data || []).filter(p => !p.deleted_at && p.username)
    }

    let active = []
    if (code) {
      active = await findBy('school_code', code)
      if (active.length === 0) active = await findBy('school', school.trim()) // 기존 교사 보완
    } else {
      active = await findBy('school', school.trim())
    }

    if (active.length === 0) return res.status(200).json({ status: 'none' })
    if (active.length === 1) return res.status(200).json({ status: 'found', maskedUsername: maskUsername(active[0].username) })

    // 동명이인(2명+) — step164: 학급 가입코드로 2차 확인
    if (!classCode) return res.status(200).json({ status: 'need_class_code' })

    // 후보 중 입력한 가입코드의 담임(휴지통 학급 제외)을 찾아 1명으로 좁힌다.
    const candidateIds = active.map(p => p.id)
    const { data: cls, error: cErr } = await supabase.from('classes')
      .select('teacher_id')
      .eq('code', classCode)
      .in('teacher_id', candidateIds)
      .is('deleted_at', null)
    if (cErr) throw cErr

    const matchedIds = [...new Set((cls || []).map(c => c.teacher_id))]
    if (matchedIds.length === 1) {
      const t = active.find(p => p.id === matchedIds[0])
      return res.status(200).json({ status: 'found', maskedUsername: maskUsername(t.username) })
    }
    // 코드 불일치 또는 여전히 복수 → 관리자 요청 폴백
    return res.status(200).json({ status: 'multiple', count: active.length })
  } catch (e) {
    console.error('find-teacher-id error:', e?.message || e)
    return res.status(500).json({ error: '조회 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}

```

## pages/api/parent-consent.js

```js
// 부모 동의 제출 API (비로그인 — C방식: 학급코드 + 자녀번호 + 학급 동의비밀번호 + 부모 서명)
//
// 비로그인 부모는 세션이 없으므로 토큰 대신 (학급코드 + 자녀번호 + 동의비밀번호)로 인가하고,
// service_role 로 RLS 를 우회해 처리한다. 흐름:
//   1) rate-limit(IP) → 2) 입력 검증 → 3) classes(code)로 consent_password 검증
//   4) profiles(class_id+number+role)로 자녀 1명 특정
//   5) pending_names.enc_name → decryptName → profiles.realname/consent 기록 (잠금 해제)
//   6) consents insert → 7) pending_names 삭제
// ⚠️ 응답에 실명 등 PII 를 절대 넣지 않는다. 복호화 키(NAME_ENCRYPTION_KEY)는 서버 전용.
//
// 사전 조건(SQL 적용): step187(pending_names), step193(consents + classes.consent_password),
//                      step165(api_rate_limit). NAME_ENCRYPTION_KEY 환경변수.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NAME_ENCRYPTION_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { decryptName } from '../../lib/encryptName'
import { effectiveConsentPassword } from '../../lib/consentPassword'
import { hasConsentTrace } from '../../lib/consentTrace'

// ── step165 호출 제한 (find-teacher-id 패턴 인라인) — 무차별 시도 방지 ──
const RL_BUCKET = 'parent_consent'
const RL_IP_PREFIX = 'literacy-class:consent:'   // 라우트별 고유 prefix
const RL_SHORT_LIMIT = 10                          // 10분 내 허용 횟수(빡세게)
const RL_SHORT_WINDOW_MS = 10 * 60 * 1000
const RL_DAY_LIMIT = 40                            // 24시간 내 허용 횟수
const RL_DAY_WINDOW_MS = 24 * 60 * 60 * 1000

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}
function hashIp(ip) {
  return crypto.createHash('sha256').update(RL_IP_PREFIX + ip).digest('hex')
}
// true면 한도 초과(차단). 내부 오류는 fail-open(false).
async function isRateLimited(supabase, ipHash) {
  try {
    const countSince = async (windowMs) => {
      const cutoff = new Date(Date.now() - windowMs).toISOString()
      const { count } = await supabase.from('api_rate_limit')
        .select('id', { count: 'exact', head: true })
        .eq('bucket', RL_BUCKET).eq('ip_hash', ipHash).gt('created_at', cutoff)
      return count || 0
    }
    if (await countSince(RL_SHORT_WINDOW_MS) >= RL_SHORT_LIMIT) return true
    if (await countSince(RL_DAY_WINDOW_MS) >= RL_DAY_LIMIT) return true
    await supabase.from('api_rate_limit').insert({ bucket: RL_BUCKET, ip_hash: ipHash })
    return false
  } catch (e) {
    console.error('parent-consent rate limit check failed (fail-open):', e?.message || e)
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { classCode, studentNumber, consentPassword, parentName, signature, consentItems, agree } = req.body || {}

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 1) rate-limit
  const ipHash = hashIp(getClientIp(req))
  if (await isRateLimited(supabaseAdmin, ipHash)) {
    return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' })
  }

  // 2) 입력 검증
  if (!classCode || !String(classCode).trim()) return res.status(400).json({ error: '학급 코드가 필요해요' })
  if (!studentNumber || !String(studentNumber).trim()) return res.status(400).json({ error: '자녀의 번호를 입력해주세요' })
  if (!consentPassword || !String(consentPassword).trim()) return res.status(400).json({ error: '동의 비밀번호를 입력해주세요' })
  if (!parentName || !String(parentName).trim()) return res.status(400).json({ error: '보호자 성함을 입력해주세요' })
  if (!signature || !String(signature).trim()) return res.status(400).json({ error: '서명을 작성해주세요' })

  try {
    // 3) 학급 검증
    const normalizedCode = String(classCode).trim().toUpperCase()
    const { data: cls } = await supabaseAdmin.from('classes')
      .select('id, code, consent_password, deleted_at')
      .eq('code', normalizedCode)
      .maybeSingle()
    if (!cls || cls.deleted_at) {
      return res.status(404).json({ error: '학급을 찾을 수 없어요. 코드를 다시 확인해주세요.' })
    }
    // 동의번호 폴백: 교사가 비번을 설정했으면 그 값, 비웠으면(빈값/null) 학급코드가 정답.
    //  ※ ClassSettings(표시·안내문)와 반드시 같은 규칙 — 안 그러면 "안내문엔 적혀있는데 거부" 사고.
    const effectivePw = effectiveConsentPassword(cls, normalizedCode)
    if (!effectivePw || String(consentPassword).trim() !== effectivePw) {
      return res.status(403).json({ error: '동의 비밀번호가 일치하지 않아요. 담임 선생님께 확인해주세요.' })
    }

    // 3-b) 동의 의사 검증 — 서버가 동의 여부를 보증한다.
    //  agree !== true 이면 실명 잠금 해제(7단계 profiles.update) 전에 차단.
    //  (클라이언트 체크박스 가드만으로는 직접 POST 우회가 가능하므로 서버에서 재검증)
    if (agree !== true) {
      return res.status(400).json({ error: '동의 항목에 체크하지 않으면 처리할 수 없어요.' })
    }

    // 4) 자녀 특정 (class_id + number + role='student', 숨김 제외)
    const { data: kids } = await supabaseAdmin.from('profiles')
      .select('id')
      .eq('class_id', cls.id)
      .eq('number', String(studentNumber).trim())
      .eq('role', 'student')
      .or('is_hidden.is.null,is_hidden.eq.false')
    if (!kids || kids.length === 0) {
      return res.status(404).json({ error: '해당 번호의 학생을 찾을 수 없어요. 번호를 확인해주세요.' })
    }
    if (kids.length > 1) {
      return res.status(409).json({ error: '같은 번호의 학생이 둘 이상이에요. 담임 선생님께 문의해주세요.' })
    }
    const studentId = kids[0].id

    // 5) 멱등 가드: pending_names 행 존재 여부로 "이미 동의됨" 판단
    const { data: pn } = await supabaseAdmin.from('pending_names')
      .select('enc_name')
      .eq('student_id', studentId)
      .maybeSingle()

    const consentRow = {
      student_id: studentId,
      class_id: cls.id,
      parent_name: String(parentName).trim().slice(0, 100),
      signature: String(signature),
      consent_items: Array.isArray(consentItems) ? consentItems : (consentItems || null),
      consented_at: new Date().toISOString(),
    }

    if (!pn) {
      // 잠긴 적 없음(pending_names 없음) → 동의 흔적(consents OR consent_received) 판정.
      //  ★ 판정만 — realname·consent_received 등 어떤 쓰기도 추가하지 않는다.
      //    기존처럼 동의 기록(consents)만 남기되, alreadyConsented 여부는 '흔적' 기준으로 돌려준다.
      //    흔적 없음 = 닉네임-잠금 도입 이전의 레거시 미동의 학생 → 정상 신규 동의로 안내.
      const traced = await hasConsentTrace(supabaseAdmin, studentId)
      const { error: cErr } = await supabaseAdmin.from('consents').insert(consentRow)
      if (cErr) {
        console.error('parent-consent consents insert(흔적판정) 실패:', cErr.message)
        return res.status(500).json({ error: '동의 기록 저장에 실패했어요. 잠시 후 다시 시도해주세요.' })
      }
      return res.status(200).json({ ok: true, alreadyConsented: traced })
    }

    // 6) 잠금 해제 — enc_name 복호화
    const realname = pn.enc_name ? decryptName(pn.enc_name) : null
    if (!realname) {
      // 키 미설정/복호화 실패 — 실명을 못 채우므로 동의 기록도 남기지 않고 중단(담임 안내)
      console.error('parent-consent decrypt 실패:', studentId)
      return res.status(500).json({ error: '잠금 해제에 실패했어요. 담임 선생님께 문의해주세요.' })
    }

    // 7) profiles에 실명·동의 기록 (잠금 해제)
    const { error: upErr } = await supabaseAdmin.from('profiles').update({
      realname,
      consent_received: true,
      consent_received_at: new Date().toISOString(),
    }).eq('id', studentId)
    if (upErr) {
      console.error('parent-consent profiles update 실패:', upErr.message)
      return res.status(500).json({ error: '처리 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
    }

    // 8) 동의 기록 insert
    const { error: cErr } = await supabaseAdmin.from('consents').insert(consentRow)
    if (cErr) {
      // 실명은 이미 채워졌으나 동의기록 실패 — 사용자에겐 재시도 안내(다음 시도는 멱등 가드로 처리됨)
      console.error('parent-consent consents insert 실패:', cErr.message)
      return res.status(500).json({ error: '동의 기록 저장에 실패했어요. 잠시 후 다시 시도해주세요.' })
    }

    // 9) 잠금 테이블 행 삭제 (마지막 — 중간 실패 시 재시도 여지)
    const { error: delErr } = await supabaseAdmin.from('pending_names').delete().eq('student_id', studentId)
    if (delErr) {
      // 삭제 실패는 치명적 아님(다음 호출 멱등 가드에서 또 시도). 로깅만.
      console.warn('parent-consent pending_names delete 실패(무시):', delErr.message)
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('parent-consent error:', e?.message || e)
    return res.status(500).json({ error: '처리 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}

```

## pages/api/password-reset-request.js

```js
// 비밀번호 초기화 요청 API (step156)
// 익명 직접 INSERT를 막고 이 서버 라우트가 service_role로만 INSERT한다.
// 스팸 방어: ip_hash 기준 24시간 내 3건 초과 거부 + 전체 24시간 50건 초과 시 일시 차단.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const IP_HASH_PREFIX = 'literacy-class:pwreset:' // 고정 prefix (별도 salt 환경변수 불필요)
const PER_IP_LIMIT = 3       // 같은 ip_hash 24시간 허용 건수 (초과 시 거부)
const GLOBAL_LIMIT = 50      // 전체 24시간 신규 건수 상한 (초과 시 일시 차단)
const WINDOW_MS = 24 * 60 * 60 * 1000

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(IP_HASH_PREFIX + ip).digest('hex')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { username, realname, school, contact } = req.body || {}
  const requestType = req.body?.request_type === 'find_id' ? 'find_id' : 'reset_password'

  // 요청 종류별 필수값 검증
  if (requestType === 'find_id') {
    // 아이디를 모르는 상황 → 이름+학교로 본인 확인
    if (!realname || !realname.trim() || !school || !school.trim()) {
      return res.status(400).json({ error: '이름과 학교는 꼭 입력해주세요' })
    }
  } else {
    if (!username || !username.trim() || !realname || !realname.trim()) {
      return res.status(400).json({ error: '아이디와 이름은 꼭 입력해주세요' })
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const ipHash = hashIp(getClientIp(req))
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString()
  const tooMany = '요청이 너무 많아요. 내일 다시 시도하거나 선생님께 직접 말씀드려주세요.'

  try {
    // 1) 같은 ip_hash 24시간 내 건수
    const { count: ipCount } = await supabase.from('password_reset_requests')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gt('created_at', cutoff)
    if ((ipCount || 0) >= PER_IP_LIMIT) {
      return res.status(429).json({ error: tooMany })
    }

    // 2) 전체 24시간 신규 건수 (글로벌 캡)
    const { count: globalCount } = await supabase.from('password_reset_requests')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', cutoff)
    if ((globalCount || 0) >= GLOBAL_LIMIT) {
      return res.status(429).json({ error: tooMany })
    }

    // 3) INSERT (service_role — RLS 우회)
    //    find_id는 아이디를 모르는 요청이므로 username은 빈 문자열로 저장 (컬럼 NOT NULL 대비)
    const { error } = await supabase.from('password_reset_requests').insert({
      username: requestType === 'find_id' ? '' : String(username).trim().toLowerCase(),
      realname: String(realname).trim(),
      school: school ? String(school).trim() : null,
      contact: contact ? String(contact).trim() : null,
      request_type: requestType,
      ip_hash: ipHash,
    })
    if (error) throw error

    return res.status(200).json({ success: true })
  } catch (e) {
    console.error('password-reset-request error:', e?.message || e)
    return res.status(500).json({ error: '요청 처리 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}

```

## pages/api/reset-student-password.js

```js
// 학생 비밀번호 초기화 API
// 호출 권한: 같은 학급 담임 교사 또는 admin만
//
// 환경변수 필요:
// - NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 (절대 클라이언트 노출 금지)

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { studentId, newPassword, accessToken } = req.body || {}

  // 입력 검증
  if (!studentId) return res.status(400).json({ error: '학생 ID가 필요해요' })
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 해요' })
  }
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing env vars:', { hasUrl: !!supabaseUrl, hasKey: !!serviceKey })
    return res.status(500).json({
      error: '서버 설정 오류: 관리자 권한 키가 없어요.\nVercel 환경변수에 SUPABASE_SERVICE_ROLE_KEY를 추가해주세요.'
    })
  }

  // Admin 클라이언트 (Service Role)
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 요청자 인증 (anon 클라이언트로 토큰 검증)
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }

  const requesterId = userData.user.id

  // 요청자의 권한 확인 (teacher 또는 admin)
  const { data: requesterProfile } = await supabaseAdmin.from('profiles')
    .select('role, class_id')
    .eq('id', requesterId)
    .maybeSingle()

  if (!requesterProfile || (requesterProfile.role !== 'teacher' && requesterProfile.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }

  // 대상 학생 정보 확인
  const { data: targetProfile } = await supabaseAdmin.from('profiles')
    .select('role, class_id, username, realname')
    .eq('id', studentId)
    .maybeSingle()

  if (!targetProfile) {
    return res.status(404).json({ error: '학생을 찾을 수 없어요' })
  }

  // 권한 체크: 같은 학급 담임이거나 admin만 가능
  if (requesterProfile.role !== 'admin') {
    if (targetProfile.class_id !== requesterProfile.class_id) {
      return res.status(403).json({ error: '같은 학급 학생만 초기화할 수 있어요' })
    }
  }

  // 학생만 가능 (다른 교사 비번 못 바꾸게)
  if (targetProfile.role !== 'student') {
    return res.status(403).json({ error: '학생 계정만 초기화할 수 있어요' })
  }

  // 비밀번호 변경
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(studentId, {
    password: newPassword
  })

  if (updErr) {
    console.error('Password update error:', updErr)
    return res.status(500).json({ error: '비밀번호 변경 실패: ' + updErr.message })
  }

  return res.status(200).json({
    success: true,
    student: { username: targetProfile.username, realname: targetProfile.realname }
  })
}

```

## pages/api/reset-teacher-password.js

```js
// 선생님 비밀번호 초기화 API
// 호출 권한: admin만 (선생님이 비번을 잊었을 때 관리자가 초기화)
//
// 가짜 이메일 도메인(@writing.class)이라 이메일 재설정이 불가능하므로
// 관리자가 직접 새 비밀번호를 설정해서 전달하는 흐름.
//
// 환경변수 필요:
// - NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 (절대 클라이언트 노출 금지)

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { teacherId, newPassword, accessToken } = req.body || {}

  if (!teacherId) return res.status(400).json({ error: '선생님 ID가 필요해요' })
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요' })
  }
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY가 없어요.'
    })
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 요청자 인증
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }

  // 요청자가 admin인지
  const { data: requesterProfile } = await supabaseAdmin.from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (!requesterProfile || requesterProfile.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 선생님 비밀번호를 초기화할 수 있어요' })
  }

  // 대상이 선생님(또는 admin)인지
  const { data: targetProfile } = await supabaseAdmin.from('profiles')
    .select('role, username, realname, deleted_at')
    .eq('id', teacherId)
    .maybeSingle()

  if (!targetProfile) {
    return res.status(404).json({ error: '대상을 찾을 수 없어요' })
  }
  if (targetProfile.role === 'student') {
    return res.status(403).json({ error: '학생은 학생 관리에서 초기화해주세요' })
  }
  if (targetProfile.deleted_at) {
    return res.status(403).json({ error: '휴지통에 있는 계정이에요. 먼저 복원해주세요.' })
  }

  // 비밀번호 변경
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(teacherId, {
    password: newPassword
  })

  if (updErr) {
    console.error('Teacher password update error:', updErr)
    return res.status(500).json({ error: '비밀번호 변경 실패: ' + updErr.message })
  }

  // step161: 초기화된 계정은 로그인 후 비번 변경을 강제 유도 (방치 방지)
  try {
    await supabaseAdmin.from('profiles')
      .update({ must_change_password: true })
      .eq('id', teacherId)
  } catch (e) {
    console.warn('must_change_password 설정 실패(무시):', e?.message || e)
  }

  return res.status(200).json({
    success: true,
    teacher: { username: targetProfile.username, realname: targetProfile.realname }
  })
}

```

## pages/api/school-search.js

```js
// 학교 자동완성 — step163 → step167
//
// 브라우저 → /api/school-search?q=검색어
//   - step167: 우선 우리 DB(schools 테이블)에서 조회 → 수십 ms로 즉시 응답.
//   - schools가 아직 비었거나(적재 전) DB 오류면 NEIS 직접호출로 fallback
//     (배포 순서 제약 제거 + 안전망). 적재 완료 후엔 NEIS를 호출하지 않는다.
//   - 응답 정규화: { ok, schools: [{ code, name, region, address }] }
//   - NEIS 인증키(NEIS_API_KEY)는 서버 환경변수로만 참조.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEIS_API_KEY

import { createClient } from '@supabase/supabase-js'

const NEIS_ENDPOINT = 'https://open.neis.go.kr/hub/schoolInfo'
const NEIS_PAGE_SIZE = 100   // fallback(NEIS 직접호출) 시 후보 확보용
const MAX_RESULTS = 20       // 클라이언트에 돌려줄 최대 후보 수
const CACHE_MAX = 200        // 메모리 캐시 항목 상한

// schools 테이블에 데이터가 적재됐는지 (null=모름). 적재 후엔 NEIS fallback 불필요.
let tableHasData = null

// 모듈 스코프 LRU 캐시
const cache = new Map() // key: 정규화된 q → value: { ok, schools }
function cacheGet(key) {
  if (!cache.has(key)) return null
  const v = cache.get(key)
  cache.delete(key); cache.set(key, v)
  return v
}
function cacheSet(key, value) {
  cache.set(key, value)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
}

let _supabase = null
function getSupabase() {
  if (_supabase) return _supabase
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  _supabase = createClient(url, anon, { auth: { persistSession: false } })
  return _supabase
}

// q로 시작하는 학교를 앞에 오게 정렬 후 상위 MAX_RESULTS개
function rankAndTrim(schools, q) {
  const k = q.toLowerCase()
  return schools
    .slice()
    .sort((a, b) => {
      const as = a.name.toLowerCase().startsWith(k) ? 0 : 1
      const bs = b.name.toLowerCase().startsWith(k) ? 0 : 1
      if (as !== bs) return as - bs
      return a.name.localeCompare(b.name, 'ko')
    })
    .slice(0, MAX_RESULTS)
}

// DB 조회. 반환: { hit:boolean, schools } | { error:true }
//   hit=true  → DB에 데이터가 있고 정상 처리됨(결과 0개여도 hit)
//   error     → 쿼리 실패(테이블 없음 등) → 호출부가 NEIS fallback
async function searchDb(q) {
  const supabase = getSupabase()
  if (!supabase) return { error: true }
  try {
    const { data, error } = await supabase
      .from('schools')
      .select('code, name, region, address')
      .ilike('name', `%${q}%`)
      .limit(50)
    if (error) return { error: true }

    if (data && data.length > 0) {
      tableHasData = true
      return { hit: true, schools: rankAndTrim(data, q) }
    }
    // 결과 0개 — 테이블이 비었는지(적재 전), 진짜 매칭이 없는지 구분
    if (tableHasData === true) return { hit: true, schools: [] }
    const { count } = await supabase.from('schools')
      .select('code', { count: 'exact', head: true })
    if ((count || 0) > 0) { tableHasData = true; return { hit: true, schools: [] } }
    tableHasData = false
    return { error: true } // 테이블 비어있음 → NEIS fallback
  } catch {
    return { error: true }
  }
}

// NEIS 직접호출 fallback (적재 전 또는 DB 오류 시)
async function searchNeis(q) {
  const apiKey = process.env.NEIS_API_KEY
  if (!apiKey) return { ok: false, schools: [], reason: 'no_key' }
  const url = `${NEIS_ENDPOINT}?KEY=${encodeURIComponent(apiKey)}`
    + `&Type=json&pIndex=1&pSize=${NEIS_PAGE_SIZE}`
    + `&SCHUL_NM=${encodeURIComponent(q)}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const r = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!r.ok) return { ok: false, schools: [], reason: 'neis_http_' + r.status }
    const json = await r.json()
    const rows = json?.schoolInfo?.[1]?.row
    if (!Array.isArray(rows)) return { ok: true, schools: [] }
    const schools = rows
      .filter(row => row?.SCHUL_KND_SC_NM === '초등학교')
      .map(row => ({
        code: row.SD_SCHUL_CODE || '',
        name: row.SCHUL_NM || '',
        region: row.ATPT_OFCDC_SC_NM || '',
        address: row.ORG_RDNMA || '',
      }))
      .filter(s => s.code && s.name)
      .slice(0, MAX_RESULTS)
    return { ok: true, schools }
  } catch (e) {
    console.error('school-search NEIS fallback error:', e?.name || '', e?.message || e)
    return { ok: false, schools: [], reason: 'neis_error' }
  }
}

export default async function handler(req, res) {
  const q = String(req.query.q || '').trim()
  if (q.length < 2) return res.status(200).json({ ok: true, schools: [] })

  const cacheKey = q.toLowerCase()
  const cached = cacheGet(cacheKey)
  if (cached) return res.status(200).json(cached)

  // 1) DB 우선
  const db = await searchDb(q)
  if (!db.error) {
    const payload = { ok: true, schools: db.schools }
    cacheSet(cacheKey, payload)
    return res.status(200).json(payload)
  }

  // 2) fallback: NEIS 직접호출 (적재 전 또는 DB 오류). 빈 결과는 캐시 안 함.
  const neis = await searchNeis(q)
  if (neis.ok) cacheSet(cacheKey, neis)
  return res.status(200).json(neis)
}

```

## pages/api/students-bulk.js

```js
// 학생 일괄 등록 API (엑셀 업로드)
// 호출 권한: 해당 학급 담임 교사 또는 admin만
//
// 환경변수 필요:
// - NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 (절대 클라이언트 노출 금지)
// - NAME_ENCRYPTION_KEY        ← 서버 전용, 신규 학생 실명 잠금용(없으면 실명 평문 폴백)

import { createClient } from '@supabase/supabase-js'
import { generateUniqueNickname } from '../../lib/nickname'
import { encryptName } from '../../lib/encryptName'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { students, classId, accessToken } = req.body || {}
  if (!Array.isArray(students) || !classId) return res.status(400).json({ error: '잘못된 요청' })
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing env vars:', { hasUrl: !!supabaseUrl, hasKey: !!serviceKey })
    return res.status(500).json({
      error: '서버 설정 오류: 관리자 권한 키가 없어요.\nVercel 환경변수에 SUPABASE_SERVICE_ROLE_KEY를 추가해주세요.'
    })
  }

  // Admin 클라이언트 (Service Role)
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 요청자 인증 (anon 클라이언트로 토큰 검증)
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }

  // 요청자 권한 확인: 해당 학급 담임 교사 또는 admin
  const { data: requesterProfile } = await supabaseAdmin.from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (!requesterProfile || (requesterProfile.role !== 'teacher' && requesterProfile.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }

  if (requesterProfile.role !== 'admin') {
    const { data: targetClass } = await supabaseAdmin.from('classes')
      .select('teacher_id')
      .eq('id', classId)
      .maybeSingle()
    if (!targetClass || targetClass.teacher_id !== userData.user.id) {
      return res.status(403).json({ error: '본인 학급에만 학생을 등록할 수 있어요' })
    }
  }

  // 학급 내 기존 닉네임 한 번에 조회 (중복 방지)
  let usedNicknames = []
  try {
    const { data: existing } = await supabaseAdmin.from('profiles')
      .select('nickname').eq('class_id', classId).eq('role', 'student')
    usedNicknames = (existing || []).map(p => p.nickname).filter(Boolean)
  } catch(e) { /* nickname 컬럼 없으면 무시 */ }

  const results = { success: [], failed: [] }

  for (const s of students) {
    try {
      if (!s.username || !s.realname) {
        results.failed.push({ ...s, error: '아이디/이름 누락' })
        continue
      }

      // step160: 서버 측 아이디 형식 검증 (소문자화 + 허용문자 + 길이)
      // 학생 로그인은 username@writing.class 합성 이메일 → 이메일 안전 문자만 허용
      const uname = String(s.username).trim().toLowerCase()
      if (!/^[a-z0-9_-]{4,20}$/.test(uname)) {
        results.failed.push({ ...s, error: '아이디 형식 오류 (영문 소문자·숫자 4~20자)' })
        continue
      }

      const email = `${uname}@writing.class`
      const password = '123456' // 초기 비밀번호 (Supabase 정책: 최소 6자)

      // 계정 생성 (service_role — RLS·이메일 확인 영향 없음)
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })
      if (error) {
        if (error.message.includes('already')) {
          results.failed.push({ ...s, error: '이미 가입된 아이디' })
        } else {
          results.failed.push({ ...s, error: error.message })
        }
        continue
      }

      // 새 닉네임 생성 (이번 배치에서 중복 안 되게)
      let nickname = null
      try {
        nickname = generateUniqueNickname(usedNicknames)
        usedNicknames.push(nickname) // 다음 학생 위해 추가
      } catch(e) {}

      // 🔒 신규 학생 실명 잠금(개인정보 최소화):
      //    실명을 암호화해 pending_names에 보관하고 profiles.realname은 비운다.
      //    화면은 displayStudentName이 빈 realname 대신 nickname을 보여줌.
      //    암호화가 가능할 때만 realname을 비우고(이름 분실 방지), 실패 시 실명 평문 폴백.
      let encName = null
      let lockWarning = null
      try {
        encName = encryptName(s.realname)   // 키 없음/형식오류면 throw → 폴백
      } catch (encErr) {
        lockWarning = '이름 암호화 실패(실명 보존): ' + encErr.message
        console.error('[students-bulk] encrypt 실패:', uname, encErr.message)
      }

      // profile 추가 — 잠금 성공 시 realname 비움, 실패 시 실명 보존
      const profileData = {
        id: data.user.id,
        username: uname,
        realname: encName ? '' : s.realname,
        role: 'student',
        class_id: classId
      }
      if (s.number !== undefined && s.number !== null && s.number !== '') {
        profileData.number = String(s.number).trim()
      }
      if (nickname) profileData.nickname = nickname

      const { error: profErr } = await supabaseAdmin.from('profiles').insert(profileData)

      if (profErr) {
        results.failed.push({ ...s, error: 'profile: ' + profErr.message })
      } else {
        // 잠금 테이블 저장 (profiles가 먼저 있어야 FK 충족 → insert 이후 수행)
        if (encName) {
          const { error: pnErr } = await supabaseAdmin.from('pending_names')
            .insert({ student_id: data.user.id, class_id: classId, enc_name: encName })
          if (pnErr) {
            // 잠금 실패 → 이름 분실 방지: realname을 실명으로 되돌리고 경고 기록
            lockWarning = 'pending_names 저장 실패(실명 복원): ' + pnErr.message
            console.error('[students-bulk] pending_names 실패:', uname, pnErr.message)
            await supabaseAdmin.from('profiles').update({ realname: s.realname }).eq('id', data.user.id)
          }
        }
        results.success.push({ ...s, nickname, ...(lockWarning ? { warning: lockWarning } : {}) })
      }
    } catch(e) {
      results.failed.push({ ...s, error: e.message })
    }
  }

  // step206: 명렬표(일괄등록) 학급은 학생 자가가입을 자동 차단한다.
  //   "명단을 올린 학급"은 교사가 아이디를 관리하므로, 학생이 로그인 오타 후
  //   가입 탭으로 새 계정(유령)을 만드는 길을 막는다. 이미 false면 그대로(멱등).
  //   ★순수 자가가입 학급은 명렬표를 안 올리니 이 라우트를 안 거쳐 true 유지 → 영향 0.
  //   1명이라도 등록 성공했을 때만 끈다(파일 오류로 전부 실패 시 설정 안 건드림).
  if (results.success.length > 0) {
    try {
      await supabaseAdmin.from('classes').update({ self_signup_enabled: false }).eq('id', classId)
    } catch (e) {
      // 토글 실패는 등록 결과를 막지 않음(컬럼 미적용 등). 등록 결과는 그대로 반환.
      console.error('[students-bulk] self_signup_enabled off 실패:', e?.message)
    }
  }

  return res.status(200).json(results)
}

```

## pages/api/update-student-username.js

```js
// 학생 아이디(username) 변경 API
// - profiles.username + auth.email 둘 다 변경 (가짜 이메일 username@writing.class)
// 호출 권한: 같은 학급 담임 교사 또는 admin만

import { createClient } from '@supabase/supabase-js'

const EMAIL_DOMAIN = '@writing.class' // student/login.js와 동일하게 유지

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { studentId, newUsername, accessToken } = req.body || {}

  if (!studentId) return res.status(400).json({ error: '학생 ID가 필요해요' })
  if (!newUsername || !/^[a-z0-9_]{3,20}$/.test(newUsername)) {
    return res.status(400).json({ error: '아이디는 영문 소문자/숫자/_만, 3~20자' })
  }
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락'
    })
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 요청자 인증
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }

  const requesterId = userData.user.id

  const { data: requesterProfile } = await supabaseAdmin.from('profiles')
    .select('role, class_id')
    .eq('id', requesterId)
    .maybeSingle()

  if (!requesterProfile || (requesterProfile.role !== 'teacher' && requesterProfile.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }

  const { data: targetProfile } = await supabaseAdmin.from('profiles')
    .select('role, class_id, username, realname')
    .eq('id', studentId)
    .maybeSingle()

  if (!targetProfile) {
    return res.status(404).json({ error: '학생을 찾을 수 없어요' })
  }

  if (requesterProfile.role !== 'admin') {
    if (targetProfile.class_id !== requesterProfile.class_id) {
      return res.status(403).json({ error: '같은 학급 학생만 변경할 수 있어요' })
    }
  }

  if (targetProfile.role !== 'student') {
    return res.status(403).json({ error: '학생 계정만 변경할 수 있어요' })
  }

  // 중복 검사
  const { data: existing } = await supabaseAdmin.from('profiles')
    .select('id').eq('username', newUsername).maybeSingle()
  if (existing && existing.id !== studentId) {
    return res.status(409).json({ error: '이미 사용 중인 아이디예요' })
  }

  const newEmail = `${newUsername}${EMAIL_DOMAIN}`

  // 1) auth.email 변경
  const { error: emailErr } = await supabaseAdmin.auth.admin.updateUserById(studentId, {
    email: newEmail,
    email_confirm: true  // 이메일 확인 메일 안 보내고 즉시 확인 처리
  })
  if (emailErr) {
    return res.status(500).json({ error: '이메일 변경 실패: ' + emailErr.message })
  }

  // 2) profiles.username 변경
  const { error: profileErr } = await supabaseAdmin.from('profiles')
    .update({ username: newUsername })
    .eq('id', studentId)

  if (profileErr) {
    // 롤백 (가능하면)
    await supabaseAdmin.auth.admin.updateUserById(studentId, {
      email: `${targetProfile.username}${EMAIL_DOMAIN}`,
      email_confirm: true
    })
    return res.status(500).json({ error: 'profile 변경 실패: ' + profileErr.message })
  }

  return res.status(200).json({
    success: true,
    student: { oldUsername: targetProfile.username, newUsername, realname: targetProfile.realname }
  })
}

```

## pages/api/verify-code.js

```js
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { code, role } = req.body

  const ADMIN_CODE = process.env.ADMIN_SECRET_CODE
  const TEACHER_CODE = process.env.TEACHER_SECRET_CODE

  if (role === 'admin') {
    if (code !== ADMIN_CODE) return res.status(403).json({ error: '관리자 코드가 틀렸어요' })

    // admin 중복가입 확인 (step148 RLS로 클라이언트에서 확인 불가능해져 서버로 이동)
    // service_role로 RLS 우회 조회 — 키 없으면 확인 생략(구버전 동작과 동일한 수준)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (supabaseUrl && serviceKey) {
      const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
      const { data: existingAdmin } = await supabaseAdmin.from('profiles')
        .select('id').eq('role', 'admin').limit(1).maybeSingle()
      if (existingAdmin) {
        return res.status(409).json({ error: '관리자는 이미 가입되어 있어요' })
      }
    }
  } else if (role === 'teacher') {
    if (code !== TEACHER_CODE) return res.status(403).json({ error: '교사 가입 코드가 틀렸어요' })
  } else {
    return res.status(400).json({ error: '잘못된 요청이에요' })
  }

  return res.status(200).json({ ok: true })
}

```

## pages/api/verify-gemini-key.js

```js
// Gemini API 키 실호출 검증 (step157)
// 교사/admin이 키를 등록하기 "전"에 실제 작동하는지 초소형 호출 1회로 확인한다.
//
// ⚠️ 이 라우트는 클라이언트가 apiKey를 body로 보내는 유일한 예외다.
//    (아직 class_secrets에 저장 전이라 서버가 조회할 수 없음.)
//    → 키를 절대 로그에 남기지 말 것. 검증 후 서버에 보관하지 않음.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'
import { callGemini, getFriendlyErrorMessage } from '../../lib/gemini'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'Method not allowed' })

  const { accessToken, apiKey } = req.body || {}
  if (!accessToken) return res.status(401).json({ ok: false, reason: '로그인이 필요해요' })
  if (!apiKey || !String(apiKey).trim()) return res.status(400).json({ ok: false, reason: 'API 키가 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, reason: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  // 요청자 인증 (교사/admin만 — 아무나 키 검증 오라클로 못 쓰게)
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ ok: false, reason: '인증 정보가 유효하지 않아요. 다시 로그인해주세요.' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: profile } = await supabaseAdmin.from('profiles')
    .select('role').eq('id', userData.user.id).maybeSingle()
  if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
    return res.status(403).json({ ok: false, reason: '선생님 권한이 필요해요' })
  }

  // 초소형 테스트 호출 1회 (가장 가벼운 flash-lite, 토큰 최소)
  try {
    await callGemini(String(apiKey).trim(), '안녕', {
      model: 'gemini-3.1-flash-lite', // flash-lite(경량) + 가장 큰 일일 한도 → 한도성 오판 최소화
      maxTokens: 5,
      temperature: 0,
      maxRetries: 2,
    })
    return res.status(200).json({ ok: true })
  } catch (e) {
    // 원인별 친화 메시지로 변환 (키 자체는 절대 로그에 남기지 않음)
    console.error('verify-gemini-key 실패:', e?.message || e)
    return res.status(200).json({ ok: false, reason: getFriendlyErrorMessage(e) })
  }
}

```

## pages/api/version.js

```js
// 🆕 현재 배포된 빌드 ID 반환 — 클라이언트 자동 최신화 감지용
// 클라이언트의 NEXT_PUBLIC_BUILD_ID(번들에 박힌 값)와 비교해서
// 다르면 새 버전이 배포된 것

export default function handler(req, res) {
  // 캐시 절대 금지 — 항상 서버의 현재 빌드 ID
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.status(200).json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID || 'unknown' })
}

```

## pages/consent/[classCode].js

```js
// 부모 동의 페이지 (비로그인 공개) — 2단계 마법사
//   1p: 자녀 번호 + 동의 비밀번호 → /api/consent-verify-child → "곽○윤 맞나요?" 확인
//   2p: ConsentDocument 양식(학년·반·번호·마스킹명 자동 채움) + 보호자명 + 체크 + 서명 → 제출
// URL: /consent/<학급코드>
// ⚠️ 평문 실명은 끝까지 클라이언트로 내려오지 않는다. 1p verify는 마스킹명만 받고,
//    실명 잠금 해제(기록)는 2p 최종 제출 시 /api/parent-consent 서버에서만 일어난다.
// terms.js 레이아웃 패턴. Footer는 _app.js 전역 렌더.
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import SignaturePad from '../../components/SignaturePad'
import ConsentDocument from '../../components/ConsentDocument'

export default function ParentConsent() {
  const router = useRouter()
  const [classCode, setClassCode] = useState('')
  const [classInfo, setClassInfo] = useState(null)   // null=로딩전, 'loading', 'notfound', {name, school}

  // 마법사 단계
  const [step, setStep] = useState(1)                       // 1 | 2
  const [confirmStage, setConfirmStage] = useState('input') // step1 내부: 'input' | 'confirm'
  const [verified, setVerified] = useState(null)            // {masked, grade, className, number}

  // 입력값 (번호·비번은 제출 때 parent-consent 가 다시 매칭하므로 계속 보관)
  const [studentNumber, setStudentNumber] = useState('')
  const [consentPassword, setConsentPassword] = useState('')
  const [parentName, setParentName] = useState('')
  const [agree, setAgree] = useState(false)
  const [signature, setSignature] = useState('')

  // 상태 플래그
  const [verifying, setVerifying] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)          // null | 'success' | 'already'

  // 학급 정보 조회
  useEffect(() => {
    if (!router.isReady) return
    const code = router.query.classCode
    if (!code || typeof code !== 'string') { setClassInfo('notfound'); return }
    const upper = code.trim().toUpperCase()
    setClassCode(upper)
    setClassInfo('loading')
    ;(async () => {
      try {
        const res = await fetch('/api/class-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: upper }),
        })
        const data = await res.json().catch(() => ({}))
        if (!data.found || !data.class || data.class.deleted_at) { setClassInfo('notfound'); return }
        setClassInfo({ name: data.class.name, school: data.class.school })
      } catch (e) {
        setClassInfo('notfound')
      }
    })()
  }, [router.isReady, router.query])

  // ── 1p: 자녀 확인 (읽기 전용 — 마스킹명만 받음) ──
  const verify = async () => {
    setError('')
    if (!studentNumber.trim()) return setError('자녀의 번호를 입력해주세요')
    if (!consentPassword.trim()) return setError('동의 비밀번호를 입력해주세요 (담임 선생님께 받으세요)')

    setVerifying(true)
    try {
      const res = await fetch('/api/consent-verify-child', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classCode,
          studentNumber: studentNumber.trim(),
          consentPassword: consentPassword.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      // 이미 동의된 학생 → 마스킹명 없이 완료 화면으로 종료
      if (res.ok && data.ok && data.alreadyConsented) {
        setResult('already')
        return
      }
      if (res.ok && data.ok && data.masked) {
        setVerified({
          masked: data.masked,
          grade: data.grade ?? null,
          className: data.className || null,
          number: data.number || studentNumber.trim(),
        })
        setConfirmStage('confirm')
        return
      }
      // 403(비번)/404(번호없음)/409(중복)/429/400 → API 친절 메시지 그대로
      setError(data.error || '확인에 실패했어요. 잠시 후 다시 시도해주세요.')
    } catch (e) {
      setError('네트워크 오류예요. 인터넷 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setVerifying(false)
    }
  }

  // confirm: 맞아요 → 2p
  const goToConsent = () => { setError(''); setStep(2) }
  // confirm: 아니에요 → 번호만 비우고 다시 입력 (동의 비번은 유지)
  const rejectMatch = () => {
    setVerified(null)
    setStudentNumber('')
    setConfirmStage('input')
    setError('')
  }
  // 2p: 뒤로 → 확인 카드로 (입력값·서명 유지)
  const backToConfirm = () => { setError(''); setStep(1); setConfirmStage('confirm') }

  // ── 2p: 제출 (기존 parent-consent 재사용 — 서버가 번호로 재매칭 + agree·비번 재검증 후 잠금 해제) ──
  const submit = async () => {
    setError('')
    if (!studentNumber.trim()) return setError('자녀의 번호를 입력해주세요')
    if (!consentPassword.trim()) return setError('동의 비밀번호를 입력해주세요 (담임 선생님께 받으세요)')
    if (!parentName.trim()) return setError('보호자 성함을 입력해주세요')
    if (!agree) return setError('동의 항목에 체크해주세요')
    if (!signature) return setError('보호자 서명을 작성해주세요')

    setSubmitting(true)
    try {
      const res = await fetch('/api/parent-consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classCode,
          studentNumber: studentNumber.trim(),
          consentPassword: consentPassword.trim(),
          parentName: parentName.trim(),
          signature,
          agree: true,
          consentItems: agree ? ['privacy', 'ai_processing'] : [],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setResult(data.alreadyConsented ? 'already' : 'success')
        return
      }
      // 403(비번)/404(번호없음)/409(중복)/429/400 → API의 친절 메시지 그대로
      setError(data.error || '제출에 실패했어요. 잠시 후 다시 시도해주세요.')
    } catch (e) {
      setError('네트워크 오류예요. 인터넷 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── 성공 화면 ──
  if (result === 'success' || result === 'already') {
    return (
      <>
        <Head><title>동의 완료 - 다온클래스</title></Head>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-8 shadow-sm max-w-md w-full text-center">
            <div className="text-5xl mb-3">{result === 'already' ? '✅' : '🎉'}</div>
            <h1 className="text-xl font-bold mb-2">
              {result === 'already' ? '이미 동의가 완료된 학생이에요' : '동의가 완료되었어요!'}
            </h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              {result === 'already'
                ? '이 학생은 이미 동의 처리가 되어 있어요. 추가로 하실 일은 없습니다.'
                : '이제 자녀의 이름이 담임 선생님 화면에 표시됩니다. 소중한 동의 감사합니다.'}
            </p>
            <p className="text-xs text-gray-400 mt-6">이 창은 닫으셔도 돼요.</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Head><title>학부모 동의 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <h1 className="text-base font-bold">학부모 동의</h1>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          {/* 학급 안내 */}
          {classInfo === 'loading' || classInfo === null ? (
            <div className="bg-white rounded-2xl p-6 shadow-sm text-sm text-gray-500 text-center">학급 정보를 확인하는 중...</div>
          ) : classInfo === 'notfound' ? (
            <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
              <div className="text-4xl mb-2">🔍</div>
              <p className="font-semibold text-gray-900">학급을 찾을 수 없어요</p>
              <p className="text-sm text-gray-600 mt-1">링크가 올바른지, 담임 선생님께 받은 주소가 맞는지 확인해주세요.</p>
            </div>
          ) : (
            <>
              {/* 학급 헤더 + 진행 표시 */}
              <div className="bg-primary-light rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-primary-dark">학부모 동의</p>
                  <span className="text-[11px] font-semibold text-primary-dark bg-white/60 rounded-full px-2 py-0.5">{step}/2 단계</span>
                </div>
                <h2 className="text-lg font-bold text-gray-900 mt-0.5">
                  {classInfo.school ? `${classInfo.school} · ` : ''}{classInfo.name}
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  {step === 1
                    ? '먼저 자녀를 확인할게요. 번호와 동의 비밀번호를 입력해주세요.'
                    : '안내 내용을 확인하시고 보호자 동의와 서명을 해주세요.'}
                </p>
              </div>

              {/* ── STEP 1 · 입력 ── */}
              {step === 1 && confirmStage === 'input' && (
                <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
                  {/* 부모 안심 안내 (압축 — 사실 기반) */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 leading-relaxed">
                    🔒 받는 정보는 <strong>보호자 성함·서명</strong>뿐이에요(연락처·주소는 받지 않아요). 동의는 <strong>선택</strong>이며, 거두고 싶으시면 담임 선생님께 말씀하시면 돼요.
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">자녀의 번호</label>
                    <input type="text" inputMode="numeric" value={studentNumber}
                      onChange={e => setStudentNumber(e.target.value)}
                      placeholder="예: 5"
                      className="w-full p-3 border border-gray-200 rounded-lg" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">동의 비밀번호</label>
                    <input type="text" value={consentPassword}
                      onChange={e => setConsentPassword(e.target.value)}
                      placeholder="담임 선생님께 받은 비밀번호"
                      className="w-full p-3 border border-gray-200 rounded-lg" />
                  </div>

                  {error && (
                    <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 whitespace-pre-line">{error}</div>
                  )}

                  <button onClick={verify} disabled={verifying}
                    className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                    {verifying ? '확인 중...' : '자녀 확인하기'}
                  </button>
                </div>
              )}

              {/* ── STEP 1 · 확인 ("곽○윤 맞나요?") ── */}
              {step === 1 && confirmStage === 'confirm' && verified && (
                <div className="bg-white rounded-2xl p-6 shadow-sm text-center space-y-4">
                  <div className="text-4xl">🧒</div>
                  <div>
                    <p className="text-sm text-gray-500">우리 반 {verified.number}번 학생이에요</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{verified.masked}</p>
                    {(verified.grade || verified.className) && (
                      <p className="text-sm text-gray-600 mt-1">
                        {[verified.grade ? `${verified.grade}학년` : '', verified.className].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  <p className="text-sm text-gray-700">이 학생이 자녀가 맞나요?</p>
                  {error && (
                    <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{error}</div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={rejectMatch}
                      className="flex-1 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-semibold">아니에요</button>
                    <button onClick={goToConsent}
                      className="flex-1 py-3 bg-primary text-white rounded-xl font-semibold">맞아요</button>
                  </div>
                </div>
              )}

              {/* ── STEP 2 · 양식 + 동의 + 서명 ── */}
              {step === 2 && verified && (
                <>
                  {/* 양식 본문 (고정 — 실시간 미리보기 없음. 마스킹명·학년·반·번호만 채움) */}
                  <ConsentDocument
                    school={classInfo.school}
                    className={verified.className || classInfo.name}
                    grade={verified.grade}
                    student={{ realname: verified.masked, number: verified.number }}
                  />

                  {/* 입력 영역 — ① 체크 → ② 서명 순서 안내 */}
                  <div className="bg-white rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
                    {/* ① 동의 확인 */}
                    <div>
                      <p className="text-xs font-semibold text-primary-dark mb-2">① 동의 확인</p>
                      <label className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer">
                        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="w-4 h-4 mt-0.5" />
                        <span className="text-sm text-blue-900">
                          위 내용을 모두 확인했으며, <strong>보호자(법정대리인)</strong>로서 자녀의 「다온클래스」 이용 및 위 개인정보 처리에 <strong>동의합니다.</strong>
                        </span>
                      </label>
                      <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                        자세한 내용은 <Link href="/privacy" target="_blank" className="text-primary underline">개인정보처리방침</Link>·<Link href="/terms" target="_blank" className="text-primary underline">이용약관</Link>을 참고하세요. ※ 만 14세 미만 학생의 정보는 법정대리인(보호자)의 동의 하에 수집됩니다.
                      </p>
                    </div>

                    {/* ② 보호자 성함 + 서명 */}
                    <div>
                      <p className="text-xs font-semibold text-primary-dark mb-2">② 보호자 성함과 서명</p>
                      <label className="block text-sm font-medium mb-1">보호자 성함</label>
                      <input type="text" value={parentName}
                        onChange={e => setParentName(e.target.value)}
                        placeholder="예: 홍길동"
                        className="w-full p-3 border border-gray-200 rounded-lg" />
                      <div className="mt-3">
                        <label className="block text-sm font-medium mb-1">보호자 서명 <span className="text-rose-500">*</span></label>
                        <SignaturePad onChange={setSignature} initialValue={signature} />
                      </div>
                    </div>

                    {error && (
                      <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 whitespace-pre-line">{error}</div>
                    )}

                    <div className="flex gap-2">
                      <button onClick={backToConfirm} disabled={submitting}
                        className="px-5 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-semibold disabled:opacity-50">← 뒤로</button>
                      <button onClick={submit} disabled={submitting}
                        className="flex-1 py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                        {submitting ? '제출 중...' : '동의하고 제출하기'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </>
  )
}

```

## pages/index.js

```js
import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import FeedbackModal from '../components/FeedbackModal'

export default function Home() {
  const router = useRouter()
  const [showFeedback, setShowFeedback] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    checkExistingSession()
  }, [])

  const checkExistingSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        // 이미 로그인된 상태 → 역할에 맞는 화면으로 이동
        const { data: profile } = await supabase.from('profiles')
          .select('role').eq('id', session.user.id).maybeSingle()
        
        if (profile?.role === 'teacher' || profile?.role === 'admin') {
          router.replace('/teacher')
          return
        } else if (profile?.role === 'student') {
          router.replace('/student')
          return
        }
      }
    } catch(e) {
      console.error('세션 확인 오류:', e)
    }
    setCheckingAuth(false)
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500 text-sm">로딩 중...</div>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>다온클래스</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="초등학생을 위한 AI 글쓰기 피드백 시스템" />
      </Head>

      <div className="min-h-screen flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📝</span>
              <h1 className="text-lg font-bold text-primary-dark">다온클래스</h1>
            </div>
            <button
              onClick={() => setShowFeedback(true)}
              className="text-sm text-gray-600 hover:text-primary px-3 py-1 rounded-full border border-gray-200 hover:border-primary transition"
            >
              💬 의견 보내기
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="max-w-md w-full text-center">
            <div className="text-6xl mb-4">✏️</div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">다온클래스</h2>
            <p className="text-gray-600 mb-6">
              선생님과 함께하는<br />
              스마트한 글쓰기 학습
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-8 text-xs text-amber-900 text-left">
              <p className="font-bold mb-1">🌱 베타 운영 중입니다</p>
              <p className="leading-relaxed">
                현재 시범 운영 단계로 일부 기능이 추가·변경될 수 있어요.
                의견은 언제든 우상단 <strong>"💬 의견 보내기"</strong>로 보내주세요.
              </p>
            </div>

            <div className="space-y-3">
              <Link
                href="/student/login"
                className="block w-full py-4 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition shadow-sm"
              >
                🎒 학생이에요
              </Link>
              <Link
                href="/teacher/login"
                className="block w-full py-4 bg-white text-primary border-2 border-primary rounded-xl font-semibold hover:bg-primary-light transition"
              >
                👩‍🏫 선생님이에요
              </Link>
            </div>

            <div className="mt-12 text-xs text-gray-400">
              <Link href="/terms" target="_blank" className="hover:text-gray-600">이용약관</Link>
              <span className="mx-2">·</span>
              <Link href="/privacy" target="_blank" className="hover:text-gray-600">개인정보처리방침</Link>
              <span className="mx-2">·</span>
              <Link href="/api-key-guide" target="_blank" className="hover:text-gray-600">API 키 안내</Link>
            </div>
          </div>
        </main>

        {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      </div>
    </>
  )
}

```

## pages/privacy.js

```js
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'

export default function Privacy() {
  const router = useRouter()

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length <= 1) {
      window.close()
      setTimeout(() => router.push('/'), 100)
    } else {
      router.back()
    }
  }

  return (
    <>
      <Head><title>개인정보처리방침 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <button onClick={goBack} className="text-gray-600 hover:text-gray-900" title="뒤로 / 닫기">←</button>
            <h1 className="text-base font-bold">개인정보처리방침</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 text-sm leading-relaxed">
            <section>
              <p className="text-gray-700">다온클래스(이하 "서비스")는 「개인정보 보호법」 등 관련 법령을 준수하며, 다음과 같이 개인정보처리방침을 수립·공개합니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">1. 수집하는 개인정보 항목</h2>
              <p className="font-semibold mt-2">[학생]</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>필수: 이름, 학년/반/번호, 아이디, 비밀번호</li>
                <li>자동 수집: 작성한 글, AI 피드백 결과, 접속 기록</li>
                <li>방문/페이지뷰 통계 (쿠키 없는 익명 집계, 개인 식별 안 함)</li>
              </ul>
              <p className="font-semibold mt-2">[교사]</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>필수: 이름, 아이디, 비밀번호, 소속 학급 정보</li>
                <li>선택: AI API 키 (학급 단위로 서버에 보관, 담당 교사·관리자만 접근, 학생·외부 비공개)</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">2. 수집 및 이용 목적</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>회원 식별 및 서비스 제공</li>
                <li>AI 기반 글쓰기 피드백 제공</li>
                <li>학습 기록 관리 및 성장 추적</li>
                <li>서비스 개선 및 통계 분석</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">3. 보유 및 이용 기간</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>회원 정보: 회원 탈퇴 시까지</li>
                <li>학생 글 및 피드백: 학기 종료 후 1년까지 보관 후 자동 삭제</li>
                <li>접속 로그: 3개월</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">4. 제3자 제공 및 처리 위탁</h2>
              <p>서비스는 원칙적으로 회원의 개인정보를 외부에 제공하지 않습니다. 단, AI 피드백 생성을 위해 다음과 같이 학생 글을 처리합니다.</p>
              <ul className="list-disc pl-5 space-y-1 mt-2">
                <li>처리 위탁자: Google (Gemini API)</li>
                <li>처리 항목: 학생이 작성한 글 (이름 등 식별 정보 제외)</li>
                <li>처리 목적: AI 피드백 생성</li>
                <li>※ 학생 이름, 학교명 등 개인 식별 정보는 AI에 전달되지 않습니다</li>
              </ul>
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-3 text-xs">
                <p className="font-bold text-amber-900">⚠️ 무료 API 키 사용 시 안내</p>
                <p className="text-amber-800 mt-1 leading-relaxed">
                  Google Gemini API의 무료 등급(Free Tier)을 사용하는 경우, Google의 정책에 따라
                  학생이 작성한 글이 <strong>Google의 AI 모델 학습 및 서비스 개선에 활용될 수 있습니다</strong>.
                  이 과정에서 Google 측 검토자의 검토가 진행될 수 있습니다.
                </p>
                <p className="text-amber-800 mt-2 leading-relaxed">
                  따라서 학생의 글에 <strong>본명, 주소, 전화번호, 이메일, 가족의 개인정보, 비밀번호 등 민감한 개인정보를 포함하지 않도록</strong> 지도해주세요.
                  교사가 유료 등급(Cloud Billing) API 키를 사용하는 경우 이러한 학습 활용은 발생하지 않습니다.
                </p>
              </div>
              <p className="font-semibold mt-3">[처리 위탁 및 국외 이전]</p>
              <p className="text-gray-700 mt-1">서비스는 안정적 운영을 위해 다음 사업자에 데이터 저장·처리를 위탁하며, 이 과정에서 개인정보가 국외 서버에 저장될 수 있습니다.</p>
              <ul className="list-disc pl-5 space-y-1 mt-1">
                <li>Supabase Inc. (데이터베이스 호스팅) — 회원·학습 데이터 저장, 국외(미국 등)</li>
                <li>Vercel Inc. (애플리케이션 호스팅·방문 통계) — 서비스 구동 및 익명 방문 통계 집계(쿠키 미사용, 개인 식별 안 함), 국외(미국 등)</li>
                <li>Google LLC (Gemini API) — AI 피드백 생성, 국외(미국 등)</li>
              </ul>
              <p className="text-gray-600 text-xs mt-1">이전 항목: 위 "수집하는 개인정보 항목" 및 학생이 작성한 글. 이전·보유 기간은 본 방침의 보유기간과 동일합니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">5. 학부모 및 학생의 권리</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>본인 정보 열람, 수정, 삭제 요청 가능</li>
                <li>만 14세 미만 학생의 정보는 법정대리인의 동의 하에 수집됩니다</li>
                <li>요청은 담당 교사 또는 운영자를 통해 처리됩니다</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">6. 안전성 확보 조치</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>HTTPS 암호화 통신</li>
                <li>비밀번호는 단방향 암호화 저장</li>
                <li>AI API 키는 학급 단위로 서버에 보관하며, 담당 교사·관리자만 접근할 수 있고 학생·외부에는 공개되지 않습니다 (AI 호출 시에만 서버가 사용, 브라우저로 전달 안 함)</li>
                <li>접근 권한 분리 (학생/교사/관리자)</li>
              </ul>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">7. 개인정보 보호책임자</h2>
              <p>개인정보 처리에 관한 업무를 총괄하는 책임자는 다음과 같습니다.</p>
              <ul className="list-disc pl-5 space-y-1 mt-1">
                <li>개인정보 보호책임자: 서비스 운영자</li>
                <li>문의 접수: 사이트 내 "의견 보내기" 기능</li>
              </ul>
              <p className="text-gray-600 text-xs mt-1">정보주체는 개인정보 열람·정정·삭제·처리정지를 요청할 수 있으며, 서비스는 지체 없이 조치합니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">8. 처리방침의 변경</h2>
              <p className="text-gray-700">본 개인정보처리방침은 법령·서비스 변경에 따라 개정될 수 있으며, 변경 시 시행일과 변경 내용을 서비스 내 공지합니다.</p>
            </section>
            <p className="text-gray-500 text-xs pt-4 border-t">시행일: 2026년 5월 7일 · 최종 개정: 2026년 6월 16일</p>
          </div>
        </main>
      </div>
    </>
  )
}

```

## pages/student/history.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import useGrammarTooltip from '../../lib/useGrammarTooltip'
import { splitFeedbackItems } from '../../lib/feedbackFormat'
import { findOriginalRange } from '../../lib/koreanRules'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js'
import { Line } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

function FeedbackList({ text, color = 'gray' }) {
  if (!text) return null
  const items = splitFeedbackItems(text)
  
  const colorClasses = { green: 'text-green-900', amber: 'text-amber-900', blue: 'text-blue-900', gray: 'text-gray-700' }
  const dotClasses = { green: 'bg-green-600', amber: 'bg-amber-600', blue: 'bg-blue-600', gray: 'bg-gray-400' }
  
  if (items.length <= 1) {
    return <p className={`text-sm ${colorClasses[color]} break-keep leading-relaxed`}>{items[0] || text}</p>
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${dotClasses[color]} mt-2`}></span>
          <span className={`text-sm ${colorClasses[color]} break-keep leading-relaxed flex-1`}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function escapeHtml(text) {
  if (!text) return ''
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function applyGrammar(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections?.length) return escapeHtml(essayText).replace(/\n/g,'<br>')
  const matches = []
  corrections.forEach(c => {
    const orig = c.original || c.error || c.wrong || ''
    const corr = c.correction || c.fixed || ''
    const reason = c.reason || c.type || ''
    if (!orig) return
    let from = 0
    let placed = false
    while (true) {
      const idx = essayText.indexOf(orig, from)
      if (idx === -1) break
      const overlap = matches.some(m => idx < m.end && idx + orig.length > m.start)
      if (!overlap) { matches.push({ start: idx, end: idx + orig.length, orig, corr, reason }); placed = true; break }
      from = idx + 1
    }
    // 🆕 정확 일치 실패 시 공백 허용 매칭 (위치 불확실하면 긋지 않음)
    if (!placed) {
      const range = findOriginalRange(essayText, orig)
      if (range && !range.exact) {
        const overlap = matches.some(m => range.start < m.end && range.end > m.start)
        if (!overlap) { matches.push({ start: range.start, end: range.end, orig: essayText.slice(range.start, range.end), corr, reason }) }
      }
    }
  })
  matches.sort((a,b) => a.start - b.start)
  let result = '', last = 0
  matches.forEach(m => {
    if (m.start > last) result += escapeHtml(essayText.slice(last, m.start))
    const tip = m.corr ? `${m.corr}${m.reason ? ' (' + m.reason + ')' : ''}` : '오류'
    result += `<span class="grammar-error" data-correction="${escapeHtml(tip)}">${escapeHtml(m.orig)}</span>`
    last = m.end
  })
  if (last < essayText.length) result += escapeHtml(essayText.slice(last))
  return result.replace(/\n/g, '<br>')
}

export default function StudentHistory() {
  const router = useRouter()
  useGrammarTooltip()
  const [user, setUser] = useState(null)
  const [grouped, setGrouped] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIdx, setSelectedIdx] = useState(null)

  useEffect(() => { checkAuth() }, [])

  // 🆕 디테일 화면 진입 시 — 그 주제의 미확인 담임 코멘트 읽음 처리
  useEffect(() => {
    if (selectedIdx === null || !grouped[selectedIdx]) return
    const g = grouped[selectedIdx]
    const unreadIds = (g.items || [])
      .filter(s => s.teacher_comment && !s.teacher_comment_read_at)
      .map(s => s.id)
    if (unreadIds.length === 0) return
    supabase.from('submissions')
      .update({ teacher_comment_read_at: new Date().toISOString() })
      .in('id', unreadIds)
      .then(() => {})
      .catch(() => {})  // 실패해도 무시 (다음에 또 시도됨)
  }, [selectedIdx])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/student/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', au.id).maybeSingle()
    if (!profile || profile.role !== 'student') {
      await supabase.auth.signOut(); router.push('/student/login'); return
    }
    setUser(profile)
    
    const { data } = await supabase.from('submissions').select('*, topics(title, date)').eq('user_id', profile.id).is('deleted_at', null).order('created_at', { ascending: false })
    
    // 주제별로 그룹화
    const groups = {}
    ;(data || []).forEach(s => {
      const title = s.topic_title || (s.topics?.title) || '주제 없음'
      const date = (s.topics?.date) || (s.created_at ? s.created_at.slice(0, 10) : '')
      const key = (s.topic_id || 'no') + '_' + title
      if (!groups[key]) groups[key] = { title, date, topic_id: s.topic_id, items: [] }
      groups[key].items.push(s)
    })
    setGrouped(Object.values(groups).sort((a,b) => new Date(b.date) - new Date(a.date)))
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  // 디테일 화면
  if (selectedIdx !== null && grouped[selectedIdx]) {
    const g = grouped[selectedIdx]
    const items = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
    const lastSub = items[items.length - 1]
    const maxAttempt = Math.max(...items.map(s => s.attempt || 1))
    const canRewrite = maxAttempt === 1 || (maxAttempt >= 2 && lastSub?.extra_rewrite_allowed)
    
    return (
      <>
        <Head><title>{g.title} - 다온클래스</title></Head>
        <style>{`
          .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: pointer; }
        `}</style>
        <div className="min-h-screen bg-gray-50">
          <Header user={user} onLogout={logout} />
          <main className={`mx-auto px-4 py-6 space-y-4 ${items.length >= 2 ? 'max-w-3xl xl:max-w-[1500px] xl:px-8' : 'max-w-3xl'}`}>
            <button onClick={() => setSelectedIdx(null)} className="text-sm text-gray-600">← 목록으로</button>
            
            <div className="bg-primary-light rounded-2xl p-4">
              <div className="text-xs text-primary-dark">📅 {g.date}</div>
              <h2 className="text-lg font-bold text-primary-dark">{g.title}</h2>
            </div>

            {/* 🆕 첫 글·수정본 좌우 병렬 (데스크탑), 모바일은 위아래 */}
            <div className={`grid gap-4 items-stretch ${items.length >= 2 ? 'lg:grid-cols-2' : ''}`}>
            {items.map((s, i) => (
              <div key={s.id} className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-sm">
                    {(s.attempt||1) === 1 ? '📝 첫 번째 글' : (s.attempt||1) === 2 ? '✨ 수정본' : `✨ 수정본 ${s.attempt}`}
                  </h3>
                </div>

                {s.corrections?.length > 0 && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full inline-block">
                    맞춤법/띄어쓰기 {s.corrections.length}개
                  </span>
                )}
                <div className={`bg-gray-50 rounded-lg p-3 text-sm leading-relaxed ${
                  items.length >= 2 ? 'lg:h-[420px] lg:overflow-y-auto' : ''
                }`}
                  dangerouslySetInnerHTML={{__html: applyGrammar(s.essay_text, s.corrections)}} />
                {s.corrections?.length > 0 && (
                  <p className="text-xs text-gray-500">💡 빨간 밑줄을 탭하면 올바른 표기를 볼 수 있어요</p>
                )}

                {/* 🆕 담임 선생님 코멘트 — 글 바로 아래 (가까이) */}
                {s.teacher_comment && (
                  <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4">
                    <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
                      <h4 className="font-bold text-yellow-900 flex items-center gap-1.5">
                        <span>💛</span> 선생님이 직접 남긴 코멘트
                      </h4>
                      {s.teacher_comment_at && (
                        <span className="text-[11px] text-yellow-700">
                          {new Date(s.teacher_comment_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <p className="text-yellow-900 whitespace-pre-wrap leading-relaxed break-keep text-sm">
                      {s.teacher_comment}
                    </p>
                  </div>
                )}

                {/* 🆕 AI 점수·피드백 — 기본 접힘 (글·코멘트 먼저 보기) */}
                <details className="group">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-700 hover:text-gray-900 flex items-center gap-1 py-2 px-2 bg-gray-50 rounded-lg select-none list-none">
                    <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                    🤖 AI 점수·피드백 보기
                    <span className="ml-auto font-bold text-gray-900">{s.total_score}/{s.max_score}점</span>
                  </summary>
                  <div className="space-y-3 mt-2">{/* details open */}

                {/* 항목별 점수 + 점수 근거 */}
                {Array.isArray(s.scores) && Array.isArray(g.rubrics) && g.rubrics.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-bold text-gray-800">📊 항목별 점수와 이유</h4>
                    {s.scores.map((sc, idx) => {
                      const r = g.rubrics[idx] || { name: `기준 ${idx+1}`, score: 25 }
                      const pct = Math.round((sc / r.score) * 100)
                      const isFull = sc >= r.score
                      const reason = Array.isArray(s.rubric_reasons) ? s.rubric_reasons[idx] : null
                      const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
                      return (
                        <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-100 lg:min-h-[150px]">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-800 font-semibold">
                              {r.name}
                              {isFull && <span className="ml-1 text-green-600">✓</span>}
                            </span>
                            <span className={`font-bold ${isFull ? 'text-green-700' : 'text-gray-700'}`}>
                              {sc}/{r.score}점
                            </span>
                          </div>
                          <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                            <div className={`${barColor} h-full transition-all`} style={{width: pct + '%'}} />
                          </div>
                          {reason ? (
                            <p className="text-xs text-gray-700 leading-relaxed break-keep bg-white rounded p-2 border border-gray-200 mt-2">
                              <span className="font-semibold text-gray-800">💡 이유: </span>
                              {reason}
                            </p>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="space-y-3 text-sm">
                  <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                    <h4 className="font-bold mb-1 text-blue-900 flex items-center gap-1.5">
                      <span>💬</span> 종합 의견
                    </h4>
                    <p className="text-blue-900 break-keep leading-relaxed">{s.feedback_overall}</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-3 border border-green-100">
                    <h4 className="font-bold mb-1 text-green-900 flex items-center gap-1.5">
                      <span>⭐</span> 잘한 점
                    </h4>
                    <FeedbackList text={s.feedback_good} color="green" />
                  </div>
                  <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                    <h4 className="font-bold mb-1 text-amber-900 flex items-center gap-1.5">
                      <span>🌱</span> 발전시킬 점
                    </h4>
                    <FeedbackList text={s.feedback_improve} color="amber" />
                  </div>

                  {/* 🆕 발전점 구체 예시 */}
                  {Array.isArray(s.improve_examples) && s.improve_examples.length > 0 && (
                    <div className="bg-purple-50 rounded-xl p-3 border-2 border-purple-200">
                      <h4 className="font-bold mb-2 text-purple-900 flex items-center gap-1.5">
                        <span>✏️</span> 이렇게 바꿔보면 어떨까요?
                      </h4>
                      <p className="text-xs text-purple-700 mb-2">예시예요. 참고만 하세요!</p>
                      <div className="space-y-2">
                        {s.improve_examples.map((ex, exIdx) => (
                          <div key={exIdx} className="bg-white rounded-lg border border-purple-200 overflow-hidden">
                            <div className="px-3 py-2 bg-red-50 border-b border-red-100">
                              <div className="text-[11px] text-red-700 font-semibold mb-0.5">현재</div>
                              <p className="text-sm text-gray-800 break-keep">{ex.original}</p>
                            </div>
                            <div className="px-3 py-2 bg-green-50 border-b border-green-100">
                              <div className="text-[11px] text-green-700 font-semibold mb-0.5">예시</div>
                              <p className="text-sm text-gray-900 break-keep leading-relaxed">{ex.suggested}</p>
                            </div>
                            {ex.reason && (
                              <div className="px-3 py-1.5 bg-purple-50 border-t border-purple-100">
                                <p className="text-[11px] text-purple-700 break-keep">💡 {ex.reason}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                  </div>
                </details>

                {s.example_text && (i === items.length - 1) && (
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div className="font-bold text-purple-900 text-sm mb-1">📖 AI 예시 작품</div>
                    <p className="text-sm text-purple-900 whitespace-pre-wrap">{s.example_text}</p>
                  </div>
                )}
              </div>
            ))}
            </div>

            {canRewrite ? (
              <Link
                href={g.topic_id ? `/student?topic=${g.topic_id}` : '/student'}
                className="block w-full py-3 bg-primary text-white rounded-xl font-semibold text-center"
              >
                ✏️ {maxAttempt === 1 ? '다시 쓰기 (첫 수정)' : '추가 수정하기 (선생님이 허가함)'}
              </Link>
            ) : maxAttempt >= 2 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                ✅ 이미 수정본을 제출했어요. 추가 수정을 원하면 선생님께 요청해주세요.
              </div>
            )}
          </main>
        </div>
      </>
    )
  }

  // 목록 화면
  // 그래프 데이터 준비 (시간순으로 최종본 점수)
  const chartData = (() => {
    if (grouped.length === 0) return null
    const sorted = [...grouped].sort((a,b) => new Date(a.date) - new Date(b.date))
    const labels = sorted.map(g => g.date?.slice(5) || '')
    const finals = sorted.map(g => {
      const sortedItems = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
      const last = sortedItems[sortedItems.length - 1]
      return Math.round((last.total_score / last.max_score) * 100)
    })
    return {
      labels,
      datasets: [{
        label: '점수 (100점 환산)',
        data: finals,
        borderColor: '#2d6a4f',
        backgroundColor: 'rgba(45, 106, 79, 0.1)',
        tension: 0.3,
        fill: true,
      }]
    }
  })()

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title: { display: true, text: '나의 글쓰기 점수 변화' }
    },
    scales: {
      y: { min: 0, max: 100, ticks: { stepSize: 20 } }
    }
  }

  return (
    <>
      <Head><title>내 글 기록 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">📚 내 글 기록</h2>
            <Link href="/student" className="text-sm text-primary hover:underline">오늘 글쓰기 →</Link>
          </div>

          {chartData && grouped.length >= 2 && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <Line data={chartData} options={chartOptions} />
            </div>
          )}

          {grouped.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-500">
              <div className="text-4xl mb-2">📝</div>
              <p className="text-sm">아직 쓴 글이 없어요</p>
            </div>
          ) : (
            <div className="space-y-2">
              {grouped.map((g, idx) => {
                const sorted = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
                const first = sorted[0]
                const last = sorted[sorted.length - 1]
                const isImproved = first.id !== last.id
                
                return (
                  <button key={idx} onClick={() => setSelectedIdx(idx)}
                    className="w-full bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition text-left">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm mb-1 truncate">{g.title}</div>
                        <div className="text-xs text-gray-500">{g.date}</div>
                      </div>
                      <div className="text-right text-xs ml-3">
                        {isImproved ? (
                          <>
                            <div className="text-gray-500">첫 글 {first.total_score}점</div>
                            <div className="font-bold">최종 {last.total_score}/{last.max_score}점
                              {last.total_score > first.total_score && <span className="text-green-600 ml-1">↑{last.total_score - first.total_score}</span>}
                            </div>
                          </>
                        ) : (
                          <div className="font-bold">{first.total_score}/{first.max_score}점</div>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </main>
      </div>
    </>
  )
}

```

## pages/student/index.js

```js
import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getFriendlyErrorMessage } from '../../lib/gemini'
import { callAI } from '../../lib/aiClient'
import TutorChat from '../../components/TutorChat'
import Header from '../../components/Header'
import PasswordChangeModal from '../../components/PasswordChangeModal'
import NicknameChangeModal from '../../components/NicknameChangeModal'
import StudentTutorial from '../../components/StudentTutorial'
import StudentFeedbackCard from '../../components/StudentFeedbackCard'
import useGrammarTooltip from '../../lib/useGrammarTooltip'
import { splitFeedbackItems } from '../../lib/feedbackFormat'
import { findOriginalRange } from '../../lib/koreanRules'
import { GRAMMAR_NOTICE_STUDENT } from '../../lib/notices'

// 한국 시간 기준 오늘 날짜
function todayStr() {
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}

// 현재 시간이 락 시간대 안에 있는지 검사
// 반환: { allowed: boolean, reason: string }
function checkTimeLock(topic) {
  // 1. 제출 기한 검사 (시간 락보다 먼저)
  if (topic?.deadline_date) {
    const deadlineStr = `${topic.deadline_date}T${topic.deadline_time || '23:59'}:00`
    // KST를 명시
    const deadline = new Date(deadlineStr + '+09:00')
    const now = new Date()
    if (now > deadline) {
      const mm = String(deadline.getMonth() + 1).padStart(2, '0')
      const dd = String(deadline.getDate()).padStart(2, '0')
      return {
        allowed: false,
        reason: `이 주제의 제출 기한이 지났어요. (~${mm}/${dd} ${topic.deadline_time || '23:59'})`
      }
    }
  }

  // 2. 수업 시간 락 검사
  if (!topic?.lock_enabled || !topic.lock_start_time || !topic.lock_end_time) {
    return { allowed: true, reason: '' }
  }
  // 오늘 주제가 아니면 시간 락 무시 (지난 주제는 언제든 쓸 수 있게)
  if (topic.date !== todayStr()) {
    return { allowed: true, reason: '' }
  }
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  const hh = String(kst.getUTCHours()).padStart(2, '0')
  const mm = String(kst.getUTCMinutes()).padStart(2, '0')
  const nowHM = `${hh}:${mm}`
  const start = topic.lock_start_time
  const end = topic.lock_end_time
  if (nowHM < start) {
    return { allowed: false, reason: `아직 수업 시간이 아니에요. ${start}부터 글쓰기가 시작돼요.` }
  }
  if (nowHM > end) {
    return { allowed: false, reason: `수업 시간이 끝났어요. (${start}~${end})` }
  }
  return { allowed: true, reason: '' }
}

// HTML 이스케이프
// 피드백 텍스트를 리스트로 시각화 (lib/feedbackFormat의 분리 헬퍼 사용)
function FeedbackList({ text, color = 'gray' }) {
  if (!text) return null
  const items = splitFeedbackItems(text)
  
  const colorClasses = {
    green: 'text-green-900',
    amber: 'text-amber-900',
    blue: 'text-blue-900',
    gray: 'text-gray-700'
  }
  const dotClasses = {
    green: 'bg-green-600',
    amber: 'bg-amber-600',
    blue: 'bg-blue-600',
    gray: 'bg-gray-400'
  }
  
  if (items.length <= 1) {
    return <p className={`text-sm ${colorClasses[color]} break-keep leading-relaxed`}>{items[0] || text}</p>
  }
  
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${dotClasses[color]} mt-2`}></span>
          <span className={`text-sm ${colorClasses[color]} break-keep leading-relaxed flex-1`}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 맞춤법 빨간 밑줄 적용
function applyGrammarHighlights(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections || corrections.length === 0) return escapeHtml(essayText).replace(/\n/g, '<br>')

  const matches = []
  corrections.forEach(c => {
    const original = c.original || c.error || c.wrong || ''
    const correction = c.correction || c.fixed || c.suggestion || ''
    const reason = c.reason || c.type || c.category || ''
    if (!original) return

    let from = 0
    let placed = false
    while (true) {
      const idx = essayText.indexOf(original, from)
      if (idx === -1) break
      const overlaps = matches.some(m => idx < m.end && idx + original.length > m.start)
      if (!overlaps) {
        matches.push({ start: idx, end: idx + original.length, original, correction, reason })
        placed = true
        break
      }
      from = idx + 1
    }
    // 🆕 정확 일치로 못 그었으면 공백 허용 매칭으로 한 번 더 (위치 불확실하면 긋지 않음)
    if (!placed) {
      const range = findOriginalRange(essayText, original)
      if (range && !range.exact) {
        const overlaps = matches.some(m => range.start < m.end && range.end > m.start)
        if (!overlaps) {
          const actual = essayText.slice(range.start, range.end)
          matches.push({ start: range.start, end: range.end, original: actual, correction, reason })
        }
      }
    }
  })

  matches.sort((a, b) => a.start - b.start)
  
  let result = ''
  let lastIdx = 0
  matches.forEach(m => {
    if (m.start > lastIdx) result += escapeHtml(essayText.slice(lastIdx, m.start))
    const tooltip = m.correction ? `${m.correction}${m.reason ? ' (' + m.reason + ')' : ''}` : (m.reason || '오류')
    result += `<span class="grammar-error" data-correction="${escapeHtml(tooltip)}">${escapeHtml(m.original)}</span>`
    lastIdx = m.end
  })
  if (lastIdx < essayText.length) result += escapeHtml(essayText.slice(lastIdx))
  return result.replace(/\n/g, '<br>')
}

export default function StudentHome() {
  const router = useRouter()
  useGrammarTooltip()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [todayTopic, setTodayTopic] = useState(null)
  const [todayTopicList, setTodayTopicList] = useState([]) // 오늘 주제가 여러 개일 때
  const [pendingTopics, setPendingTopics] = useState([]) // 지난 미제출 주제들
  const [unreadComments, setUnreadComments] = useState([]) // 🆕 미확인 담임 코멘트
  const [showPendingPicker, setShowPendingPicker] = useState(false)
  const [loading, setLoading] = useState(true)
  
  const [step, setStep] = useState('write') // write / feedback / done
  const [essay, setEssay] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [currentSub, setCurrentSub] = useState(null)
  const [feedbackResult, setFeedbackResult] = useState(null)
  const [exampleText, setExampleText] = useState('')
  const [exampleLoading, setExampleLoading] = useState(false)
  
  const [rewriteEssay, setRewriteEssay] = useState('')
  const [rewriting, setRewriting] = useState(false)
  
  const [pasteWarning, setPasteWarning] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [showNicknameModal, setShowNicknameModal] = useState(false)
  // AI 호출 에러 모달
  const [errorModal, setErrorModal] = useState(null) // null 또는 { title, message }
  // 백업 복원 알림 (null 또는 { type, length })
  const [restoredBackup, setRestoredBackup] = useState(null)
  // AI 재시도 진행 표시 (null 또는 메시지)
  const [retryMessage, setRetryMessage] = useState(null)
  const pasteCountRef = useRef(0)
  const pasteDetectedRef = useRef(false)
  const backupTimerRef = useRef(null)
  // 🆕 step283: 제출 동기 재진입 가드 — state(submitting/rewriting)는 re-render 후에야 반영돼
  //   같은 프레임 연타·await 창 재진입을 못 막음(중복 insert 원인). ref는 즉시 잠겨 확실히 차단.
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!router.isReady) return
    checkAuth()
  }, [router.isReady])
  
  // 자동 백업 (5초마다)
  useEffect(() => {
    if (!todayTopic || !user) return
    const key = `essay_backup_${user.id}_${todayTopic.id}_${step}`
    if (backupTimerRef.current) clearTimeout(backupTimerRef.current)
    backupTimerRef.current = setTimeout(() => {
      const text = step === 'write' ? essay : rewriteEssay
      if (text && text.length > 0) {
        try { localStorage.setItem(key, text) } catch(e) {}
      }
    }, 5000)
    return () => { if (backupTimerRef.current) clearTimeout(backupTimerRef.current) }
  }, [essay, rewriteEssay, step, todayTopic, user])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/student/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name, code, school, grade, tutor_chat_enabled)').eq('id', authUser.id).maybeSingle()
    if (!profile || profile.role !== 'student') {
      await supabase.auth.signOut(); router.push('/student/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    // 키 서버격리(step153~): 학생은 API 키를 다루지 않는다. AI 호출 시 서버가 학급 키를 조회한다.

    // URL 쿼리에 topic_id 있으면 그 주제로 진입 (history에서 "추가 수정" 등)
    const queryTopicId = router.query?.topic
    await loadTodayTopic(profile, queryTopicId || null)
    setLoading(false)
  }

  // 지난 주제 중 학생이 아직 제출하지 않은 것들 로드
  const loadPendingTopics = async (profile, teacherId) => {
    const today = todayStr()
    // 최근 30일 이내 주제 중 오늘보다 이전 것
    const { data: pastTopics } = await supabase.from('topics')
      .select('id, date, title, description')
      .eq('teacher_id', teacherId)
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(30)

    if (!pastTopics || pastTopics.length === 0) {
      setPendingTopics([])
      return
    }

    // 이 학생의 제출 기록 확인
    const topicIds = pastTopics.map(t => t.id)
    const { data: mySubs } = await supabase.from('submissions')
      .select('topic_id')
      .eq('user_id', profile.id)
      .in('topic_id', topicIds)
      .is('deleted_at', null)

    const submittedSet = new Set((mySubs || []).map(s => s.topic_id))
    const pending = pastTopics.filter(t => !submittedSet.has(t.id))
    setPendingTopics(pending)
  }

  // 🆕 미확인 담임 코멘트 (학생 알림 — AI 추천 기록처럼 로그 형태)
  const loadUnreadComments = async (profile) => {
    try {
      const { data } = await supabase.from('submissions')
        .select('id, topic_id, teacher_comment, teacher_comment_at, attempt, topics(title, date)')
        .eq('user_id', profile.id)
        .not('teacher_comment', 'is', null)
        .is('teacher_comment_read_at', null)
        .is('deleted_at', null)
        .order('teacher_comment_at', { ascending: false })
        .limit(10)
      setUnreadComments(data || [])
    } catch(e) {
      setUnreadComments([])
    }
  }

  const loadTodayTopic = async (profile, targetTopicId = null) => {
    if (!profile.class_id) return

    // 학급 담임 찾기
    const { data: classData } = await supabase.from('classes').select('teacher_id').eq('id', profile.class_id).maybeSingle()
    if (!classData) return

    let topic = null
    if (targetTopicId) {
      // 특정 주제 로드 (지난 주제 선택 시 또는 URL ?topic=)
      const { data } = await supabase.from('topics')
        .select('*').eq('id', targetTopicId).maybeSingle()
      // 우리 학급 담임 주제인지 검증 (다른 학급 침입 방지)
      if (data && data.teacher_id === classData.teacher_id) {
        topic = data
      }
    }

    // 특정 주제가 없거나 검증 실패 → 오늘 주제로 폴백
    if (!topic) {
      const today = todayStr()
      // 오늘 주제가 여러 개일 수 있음 → 미제출인 것 우선 선택
      const { data: todayTopics } = await supabase.from('topics')
        .select('*').eq('teacher_id', classData.teacher_id).eq('date', today)
        .order('created_at', { ascending: true })

      if (todayTopics && todayTopics.length > 0) {
        // 학생이 아직 제출 안 한 주제 ID 찾기
        const topicIds = todayTopics.map(t => t.id)
        const { data: mySubs } = await supabase.from('submissions')
          .select('topic_id, attempt').eq('user_id', profile.id).in('topic_id', topicIds)
          .is('deleted_at', null)

        // 각 주제별로 최대 attempt 계산
        const maxAttemptByTopic = {}
        ;(mySubs || []).forEach(s => {
          const cur = maxAttemptByTopic[s.topic_id] || 0
          if ((s.attempt || 1) > cur) maxAttemptByTopic[s.topic_id] = s.attempt || 1
        })

        // 미제출 주제 우선
        const unsubmitted = todayTopics.filter(t => !maxAttemptByTopic[t.id])
        if (unsubmitted.length > 0) {
          topic = unsubmitted[0]
        } else {
          // 모두 제출했으면 첫 글만 쓰고 수정 안 한 것 우선
          const noRewrite = todayTopics.filter(t => maxAttemptByTopic[t.id] === 1)
          topic = noRewrite[0] || todayTopics[0]
        }

        // 오늘 주제 여러 개라면 state에 저장 (화면 상단 선택 UI용)
        if (todayTopics.length > 1) {
          setTodayTopicList(todayTopics.map(t => ({
            ...t,
            myMaxAttempt: maxAttemptByTopic[t.id] || 0
          })))
        } else {
          setTodayTopicList([])
        }
      }

      // 지난 미제출 주제 목록도 같이 조회
      await loadPendingTopics(profile, classData.teacher_id)
      // 🆕 미확인 담임 코멘트 알림도
      await loadUnreadComments(profile)
    }

    if (!topic) return
    setTodayTopic(topic)
    setShowPendingPicker(false)
    // 화면 리셋
    setEssay('')
    setFeedbackResult(null)
    setExampleText('')
    setCurrentSub(null)
    setStep('write')

    // 이미 제출했나 확인
    const { data: existing } = await supabase.from('submissions')
      .select('*').eq('user_id', profile.id).eq('topic_id', topic.id).order('attempt', { ascending: true })
      .is('deleted_at', null)
    
    if (existing && existing.length > 0) {
      const sorted = [...existing].sort((a,b) => (b.attempt||1) - (a.attempt||1))
      const last = sorted[0]
      const maxAttempt = last.attempt || 1
      
      if (maxAttempt === 1) {
        // 첫 글만 있음 → 피드백 화면 + 다시쓰기 가능
        setCurrentSub(last)
        setEssay(last.essay_text)
        if (last.example_text) setExampleText(last.example_text)
        setFeedbackResult({
          scores: last.scores,
          total: last.total_score,
          overall: last.feedback_overall,
          good: last.feedback_good,
          improve: last.feedback_improve,
          corrections: last.corrections || []
        })
        setStep('feedback')
      } else if (maxAttempt >= 2) {
        // 수정본까지 있음
        if (last.extra_rewrite_allowed) {
          // 추가 수정 허용됨
          setCurrentSub(last)
          setEssay(last.essay_text)
          if (last.example_text) setExampleText(last.example_text)
          setFeedbackResult({
            scores: last.scores, total: last.total_score, overall: last.feedback_overall,
            good: last.feedback_good, improve: last.feedback_improve, corrections: last.corrections || []
          })
          setStep('feedback')
        } else {
          // 완료 상태
          setCurrentSub(last)
          setEssay(last.essay_text)
          if (last.example_text) setExampleText(last.example_text)
          setFeedbackResult({
            scores: last.scores, total: last.total_score, overall: last.feedback_overall,
            good: last.feedback_good, improve: last.feedback_improve, corrections: last.corrections || []
          })
          setStep('done')
        }
      }
    } else {
      // 새 주제 → 백업 복원 시도
      try {
        const backupKey = `essay_backup_${profile.id}_${topic.id}_write`
        const backup = localStorage.getItem(backupKey)
        if (backup && backup.trim().length > 0) {
          setEssay(backup)
          // 복원 알림 띄우기 (1초 후, 화면 그려진 다음에)
          setTimeout(() => {
            setRestoredBackup({
              type: 'write',
              length: backup.length
            })
          }, 800)
        }

        // 수정본 백업도 있으면 미리 채워둠 (수정 모드 들어가면 보임)
        const rewriteBackupKey = `essay_backup_${profile.id}_${topic.id}_rewrite`
        const rewriteBackup = localStorage.getItem(rewriteBackupKey)
        if (rewriteBackup && rewriteBackup.trim().length > 0) {
          setRewriteEssay(rewriteBackup)
        }
      } catch(e) {}
    }
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const handlePaste = (type) => {
    pasteDetectedRef.current = true
    pasteCountRef.current++
    setPasteWarning(true)
    setTimeout(() => setPasteWarning(false), 5000)
  }

  // 첫 글 제출
  const submitEssay = async () => {
    if (submitting || submittingRef.current) return
    const minLen = todayTopic?.min_length || 30
    const maxLen = todayTopic?.max_length
    if (essay.trim().length < minLen) {
      return alert(`글을 더 써 주세요! (${minLen}자 이상)\n\n현재 ${essay.trim().length}자`)
    }
    if (maxLen && essay.trim().length > maxLen) {
      return alert(`글이 너무 길어요! (${maxLen}자 이하로 써주세요)\n\n현재 ${essay.trim().length}자`)
    }

    // 시간 락 검증
    const lock = checkTimeLock(todayTopic)
    if (!lock.allowed) {
      alert('🔒 ' + lock.reason)
      return
    }

    // 🆕 제출 전 확인 (어린이 화면 — 짧고 쉽게)
    if (!confirm('이대로 제출할까요? 제출하면 AI가 채점해요.')) return

    submittingRef.current = true  // 🆕 step283: 첫 await 전 동기 잠금(연타 중복 방지)
    setSubmitting(true)
    try {
      const rubrics = todayTopic.rubrics
      const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)
      // 🔒 프롬프트는 서버(/api/ai)에서 구성 — 핵심 IP 보호
      // 키 서버격리(step153~): 키 미등록이면 서버가 명확한 에러를 반환 → catch에서 안내
      const result = await callAI('grading', {
        topic: { title: todayTopic.title, description: todayTopic.description },
        essay,
        rubrics,
      })

      // 점수 검증
      if (!Array.isArray(result.scores)) result.scores = rubrics.map(r => Math.round(r.score * 0.7))
      // 각 점수가 평가기준 만점 넘으면 만점으로 캡 + 음수 방지
      result.scores = result.scores.map((s, i) => {
        const max = rubrics[i]?.score || 25
        const n = Number(s) || 0
        return Math.max(0, Math.min(n, max))
      })
      if (typeof result.total !== 'number') result.total = result.scores.reduce((a,b)=>a+(Number(b)||0),0)
      // 총점도 만점 넘으면 캡
      result.total = Math.max(0, Math.min(result.total, totalMax))
      if (!result.overall) result.overall = '글을 잘 써주었어요!'
      if (!result.good) result.good = '열심히 글을 썼어요.'
      if (!result.improve) result.improve = '더 자세하게 써보세요.'
      if (!Array.isArray(result.corrections)) result.corrections = []

      // 🆕 rubric_reasons 검증: scores와 길이 맞추기
      if (!Array.isArray(result.rubric_reasons)) result.rubric_reasons = []
      while (result.rubric_reasons.length < result.scores.length) {
        result.rubric_reasons.push('')
      }
      result.rubric_reasons = result.rubric_reasons.slice(0, result.scores.length)

      // 🆕 improve_examples 검증 (학생 글에 실제 등장 + 유효한 객체만)
      if (!Array.isArray(result.improve_examples)) result.improve_examples = []
      result.improve_examples = result.improve_examples
        .filter(ex => ex && typeof ex === 'object' && ex.original && ex.suggested)
        .filter(ex => essay.includes(ex.original))  // 학생 글에 정확히 있는 것만
        .slice(0, 3)  // 최대 3개

      // 규칙 기반 보강: AI가 놓치는 패턴들 (.그래서 등 띄어쓰기) 추가로 잡기
      try {
        const { mergeCorrections } = await import('../../lib/koreanRules')
        result.corrections = mergeCorrections(result.corrections, essay)
      } catch(e) { console.warn('규칙 검사 실패:', e) }

      // 🆕 채점에 사용된 모델 정보
      const usedModel = result.__usedModel || 'unknown'
      const isFallback = usedModel !== 'gemini-3.1-flash-lite'

      // DB 저장
      const { data: sub, error } = await supabase.from('submissions').insert({
        user_id: user.id,
        topic_id: todayTopic.id,
        topic_title: todayTopic.title,
        topic_description: todayTopic.description,
        attempt: 1,
        essay_text: essay,
        scores: result.scores,
        rubric_reasons: result.rubric_reasons,
        total_score: result.total,
        max_score: totalMax,
        feedback_overall: result.overall,
        feedback_good: result.good,
        feedback_improve: result.improve,
        improve_examples: result.improve_examples,
        corrections: result.corrections,
        graded_with_model: usedModel,
        is_fallback_graded: isFallback,
        paste_detected: pasteDetectedRef.current,
        paste_count: pasteCountRef.current,
        is_final: false
      }).select().single()

      if (error) throw error

      // 백업 정리
      try { localStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_write`) } catch(e) {}
      pasteDetectedRef.current = false
      pasteCountRef.current = 0

      setCurrentSub(sub)
      setFeedbackResult(result)
      setStep('feedback')
      
      // 예시 작품 생성 (백그라운드)
      generateExample(essay, totalMax)
    } catch(e) {
      console.error('제출 오류:', e)
      const rawMsg = e?.message || ''
      // 로그인 세션 만료(401)면 새로고침 버튼 노출 — 판정은 원본 메시지 기준
      const isAuthExpired = /인증|로그인/.test(rawMsg)
      // 유료 잔액 소진은 학생이 못 고침 → 선생님께 알리도록 안내 (버튼 없음)
      const isPrepayment = rawMsg.includes('prepayment') || rawMsg.includes('credits are depleted') || rawMsg.includes('billing#prepay')
      setErrorModal({
        title: '🚨 글 제출에 문제가 생겼어요',
        message: isPrepayment
          ? '⏳ 지금 AI 사용에 문제가 생겼어요. 선생님께 알려주시면 금방 해결돼요.\n\n📝 쓴 글은 자동 저장돼 있어요!'
          : getFriendlyErrorMessage(e),
        showReload: isAuthExpired
      })
    }
    submittingRef.current = false
    setSubmitting(false); setRetryMessage(null)
  }

  // 예시 작품 생성 (subId 명시 가능 - 수정본 직후 사용)
  const generateExampleForSub = async (studentEssay, totalMax, subId) => {
    if (!subId) return

    setExampleLoading(true)
    try {
      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('exampleEssay', {
        topicTitle: todayTopic.title, studentEssay,
      })
      if (result.example) {
        setExampleText(result.example)
        await supabase.from('submissions').update({ example_text: result.example }).eq('id', subId)
      }
    } catch(e) {
      console.error('수정본 예시 생성 실패:', e)
      // 예시 생성 실패는 학생에게 굳이 알리지 않음 (채점은 이미 성공)
    }
    setExampleLoading(false)
  }

  // 예시 작품 생성 (첫 글용 - currentSub 사용)
  const generateExample = async (studentEssay, totalMax) => {
    setExampleLoading(true)
    try {
      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('exampleEssay', {
        topicTitle: todayTopic.title, studentEssay,
      })
      if (result.example) {
        setExampleText(result.example)
        // DB에도 저장
        if (currentSub?.id) {
          await supabase.from('submissions').update({ example_text: result.example }).eq('id', currentSub.id)
        }
      }
    } catch(e) {
      console.error('예시 생성 실패:', e)
      // 예시 생성 실패는 학생에게 굳이 알리지 않음 (채점은 이미 성공)
    }
    setExampleLoading(false)
  }

  // 다시 쓰기 시작
  const startRewrite = () => {
    setRewriteEssay(essay) // 처음 글로 채워둠
    setStep('rewrite')
  }

  // 피드백 신고
  const reportFeedback = async () => {
    if (!currentSub?.id) return alert('아직 제출된 글이 없어요')
    if (currentSub.reported) return alert('이미 신고했어요. 선생님께서 확인하실 거예요.')

    const reason = prompt(
      '🚨 이 피드백이 이상하다고 느껴졌나요?\n\n' +
      '어떤 점이 이상한지 알려주세요 (생략 가능):\n' +
      '예: "내 글 내용과 다른 말을 했어요", "너무 짧아요" 등'
    )
    if (reason === null) return // 취소

    try {
      const { error } = await supabase.from('submissions').update({
        reported: true,
        report_reason: (reason || '').trim() || null,
        reported_at: new Date().toISOString()
      }).eq('id', currentSub.id)
      if (error) throw error
      setCurrentSub({ ...currentSub, reported: true, report_reason: reason })
      alert('🙏 신고가 접수됐어요!\n선생님께서 확인하시고 도와주실 거예요.')
    } catch(e) {
      alert('신고 실패: ' + e.message)
    }
  }

  // 수정본 제출
  const submitRewrite = async () => {
    if (rewriting || submittingRef.current) return
    const minLen = todayTopic?.min_length || 30
    const maxLen = todayTopic?.max_length
    if (rewriteEssay.trim().length < minLen) {
      return alert(`글을 더 써 주세요! (${minLen}자 이상)\n\n현재 ${rewriteEssay.trim().length}자`)
    }
    if (maxLen && rewriteEssay.trim().length > maxLen) {
      return alert(`글이 너무 길어요! (${maxLen}자 이하로 써주세요)\n\n현재 ${rewriteEssay.trim().length}자`)
    }

    // 🆕 step201: 재제출(덮어쓰기 + AI 재채점) 실수 클릭 방지 — 1단계 확인.
    //   취소 시 아무 동작 없음(기존 글·점수 그대로). 확인해야만 아래 재제출 로직 진행.
    if (!confirm('다시 제출하면 지금 쓴 글로 바뀌고, AI가 다시 채점해요.\n제출할까요?')) return

    // 🆕 첫 글과 거의 같은지 검사 (맞춤법만 고친 경우)
    const norm = (t) => (t || '').replace(/\s/g, '')
    const a = norm(essay), b = norm(rewriteEssay)
    if (a.length > 0 && b.length > 0) {
      const shorter = a.length < b.length ? a : b
      const longer = a.length < b.length ? b : a
      let same = 0
      for (let i = 0; i < shorter.length; i++) {
        if (longer[i] === shorter[i]) same++
      }
      const sim = same / longer.length
      const lenDiff = Math.abs(a.length - b.length)
      const requireChange = todayTopic?.require_rewrite_change

      if (requireChange && sim >= 0.9 && lenDiff < longer.length * 0.07) {
        // 교사가 차단 설정 + 90% 이상 동일 → 제출 막음
        return alert(
          '✋ 아직 제출할 수 없어요!\n\n' +
          '처음 글이랑 거의 똑같아요. 맞춤법만 고친 것 같아요.\n' +
          '선생님이 알려준 \'더 발전시킬 점\'을 보고\n' +
          '내용을 더 자세히 쓰거나 새로운 생각을 더해 주세요. 💪'
        )
      }
      if (sim >= 0.85 && lenDiff < longer.length * 0.1) {
        // 그 외: 경고만 (제출은 허용)
        const ok = confirm(
          '✏️ 처음 글이랑 거의 똑같아요!\n\n' +
          '맞춤법만 살짝 고친 것 같아요. 선생님이 알려준 \'더 발전시킬 점\'을 보고\n' +
          '내용을 더 자세히 쓰거나 새로운 생각을 더하면 점수가 더 오를 거예요.\n\n' +
          '그래도 이대로 제출할까요?'
        )
        if (!ok) return
      }
    }

    // 시간 락 검증
    const lock = checkTimeLock(todayTopic)
    if (!lock.allowed) {
      alert('🔒 ' + lock.reason)
      return
    }

    // 🆕 step283: 첫 await(중복확인 쿼리) 전에 동기 잠금 — 연타/재진입으로 같은 attempt 중복 insert 방지.
    //   read-then-insert(아래 existingSubs→insert)가 비원자라, 동시 진입 시 모두 같은 attempt로 insert되던 버그.
    submittingRef.current = true

    // 추가 수정 권한 체크
    const { data: existingSubs } = await supabase.from('submissions')
      .select('attempt, extra_rewrite_allowed').eq('user_id', user.id).eq('topic_id', todayTopic.id)
      .is('deleted_at', null)

    // max_rewrites: 0이면 수정 불가, N이면 attempt=N+1까지 가능
    const maxRewrites = todayTopic?.max_rewrites !== undefined && todayTopic?.max_rewrites !== null
      ? todayTopic.max_rewrites : 1
    if (maxRewrites === 0) {
      submittingRef.current = false  // 🆕 잠금 해제 후 종료
      return alert('이 주제는 수정이 허용되지 않아요.')
    }

    let nextAttempt = 2
    if (existingSubs && existingSubs.length > 0) {
      const maxAtt = Math.max(...existingSubs.map(s => s.attempt || 1))
      nextAttempt = maxAtt + 1
      // maxAtt가 이미 (1 + maxRewrites)면 한도 도달
      if (maxAtt >= 1 + maxRewrites) {
        const latest = existingSubs.find(s => s.attempt === maxAtt)
        if (!latest || !latest.extra_rewrite_allowed) {
          submittingRef.current = false  // 🆕 잠금 해제 후 종료
          return alert(
            `수정 횟수를 모두 사용했어요 (${maxRewrites}회).\n` +
            `추가 수정을 원하면 선생님께 요청해주세요.`
          )
        }
      }
    }

    setRewriting(true)
    try {
      const rubrics = todayTopic.rubrics
      const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)
      // 🔒 프롬프트는 서버(/api/ai)에서 구성 — 핵심 IP 보호
      const result = await callAI('rewriteGrading', {
        topic: { title: todayTopic.title, description: todayTopic.description },
        rewriteEssay,
        rubrics,
      })

      if (!Array.isArray(result.scores)) result.scores = rubrics.map(r => Math.round(r.score * 0.8))
      // 각 점수 만점 캡 + 음수 방지
      result.scores = result.scores.map((s, i) => {
        const max = rubrics[i]?.score || 25
        const n = Number(s) || 0
        return Math.max(0, Math.min(n, max))
      })
      if (typeof result.total !== 'number') result.total = result.scores.reduce((a,b)=>a+(Number(b)||0),0)
      const rwTotalMax = rubrics.reduce((s,r) => s + (r.score || 0), 0)
      result.total = Math.max(0, Math.min(result.total, rwTotalMax))
      if (!result.overall) result.overall = '수정본을 잘 써주었어요!'
      if (!result.good) result.good = '글이 더 좋아졌어요.'
      if (!result.improve) result.improve = '계속 노력해보세요.'
      if (!Array.isArray(result.corrections)) result.corrections = []

      // 🆕 rubric_reasons 검증
      if (!Array.isArray(result.rubric_reasons)) result.rubric_reasons = []
      while (result.rubric_reasons.length < result.scores.length) {
        result.rubric_reasons.push('')
      }
      result.rubric_reasons = result.rubric_reasons.slice(0, result.scores.length)

      // 🆕 improve_examples 검증 (수정본에 실제 등장하는 문장만)
      if (!Array.isArray(result.improve_examples)) result.improve_examples = []
      result.improve_examples = result.improve_examples
        .filter(ex => ex && typeof ex === 'object' && ex.original && ex.suggested)
        .filter(ex => rewriteEssay.includes(ex.original))
        .slice(0, 3)

      // 규칙 기반 보강
      try {
        const { mergeCorrections } = await import('../../lib/koreanRules')
        result.corrections = mergeCorrections(result.corrections, rewriteEssay)
      } catch(e) { console.warn('규칙 검사 실패:', e) }

      // 🆕 채점에 사용된 모델 정보
      const rwUsedModel = result.__usedModel || 'unknown'
      const rwIsFallback = rwUsedModel !== 'gemini-3.1-flash-lite'

      const { data: newSub, error } = await supabase.from('submissions').insert({
        user_id: user.id,
        topic_id: todayTopic.id,
        topic_title: todayTopic.title,
        topic_description: todayTopic.description,
        attempt: nextAttempt,
        essay_text: rewriteEssay,
        scores: result.scores,
        rubric_reasons: result.rubric_reasons,
        total_score: result.total,
        max_score: totalMax,
        feedback_overall: result.overall,
        feedback_good: result.good,
        feedback_improve: result.improve,
        improve_examples: result.improve_examples,
        corrections: result.corrections,
        graded_with_model: rwUsedModel,
        is_fallback_graded: rwIsFallback,
        paste_detected: pasteDetectedRef.current,
        paste_count: pasteCountRef.current,
        is_final: true,
        extra_rewrite_allowed: false
      }).select().single()
      if (error) throw error

      // 이전 글들도 final 처리
      await supabase.from('submissions').update({ is_final: true, extra_rewrite_allowed: false })
        .eq('user_id', user.id).eq('topic_id', todayTopic.id)

      try { localStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_rewrite`) } catch(e) {}
      pasteDetectedRef.current = false
      pasteCountRef.current = 0

      // 새 정보로 업데이트
      setEssay(rewriteEssay)
      setCurrentSub(newSub) // 수정본 row를 currentSub로 (예시 저장 대상)
      setFeedbackResult(result)
      setExampleText('') // 새 예시 받기 위해 비우기
      setStep('done')
      alert(`🎉 수정본 제출 완료!\n최종 점수: ${result.total}/${totalMax}점`)

      // 수정본에 대한 새 예시 작품 생성 (백그라운드)
      generateExampleForSub(rewriteEssay, totalMax, newSub?.id)
    } catch(e) {
      console.error('수정본 제출 오류:', e)
      const rawMsg = e?.message || ''
      // 로그인 세션 만료(401)면 새로고침 버튼 노출 — 판정은 원본 메시지 기준
      const isAuthExpired = /인증|로그인/.test(rawMsg)
      // 유료 잔액 소진은 학생이 못 고침 → 선생님께 알리도록 안내 (버튼 없음)
      const isPrepayment = rawMsg.includes('prepayment') || rawMsg.includes('credits are depleted') || rawMsg.includes('billing#prepay')
      setErrorModal({
        title: '🚨 수정본 제출에 문제가 생겼어요',
        message: isPrepayment
          ? '⏳ 지금 AI 사용에 문제가 생겼어요. 선생님께 알려주시면 금방 해결돼요.\n\n📝 쓴 글은 자동 저장돼 있어요!'
          : getFriendlyErrorMessage(e),
        showReload: isAuthExpired
      })
    }
    submittingRef.current = false
    setRewriting(false); setRetryMessage(null)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500">로딩 중...</div></div>

  return (
    <>
      <Head><title>글쓰기 - 다온클래스</title></Head>
      <style>{`
        .grammar-error {
          text-decoration: underline wavy #dc2626;
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
          background: #fee2e2;
          padding: 0 2px;
          border-radius: 2px;
          cursor: pointer;
        }
      `}</style>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className={`mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-3 sm:space-y-4 ${
          step === 'rewrite' ? 'max-w-3xl lg:max-w-6xl' : 'max-w-3xl'
        }`}>

          {/* 백업 복원 알림 배너 */}
          {restoredBackup && (
            <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="text-2xl flex-shrink-0">💾</div>
                <div className="flex-1">
                  <h3 className="font-bold text-green-900 text-sm">저장된 글을 불러왔어요!</h3>
                  <p className="text-xs text-green-800 mt-1">
                    이전에 쓰던 글({restoredBackup.length}자)이 자동으로 불러와졌어요.
                    이어서 쓰거나 새로 시작할 수 있어요.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setRestoredBackup(null)}
                      className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700"
                    >
                      ✓ 이어서 쓸게요
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('정말 새로 쓰시겠어요?\n이전 글은 사라져요.')) {
                          setEssay('')
                          setRewriteEssay('')
                          if (user && todayTopic) {
                            try {
                              localStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_write`)
                              localStorage.removeItem(`essay_backup_${user.id}_${todayTopic.id}_rewrite`)
                            } catch(e) {}
                          }
                          setRestoredBackup(null)
                        }
                      }}
                      className="text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                    >
                      🗑️ 새로 쓰기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-base font-bold text-gray-900">{user?.realname || ''}님 안녕하세요!</h2>
                <p className="text-xs text-gray-600 mt-0.5">
                  {(user?.school || classInfo?.school) && <span>{user?.school || classInfo?.school}</span>}
                  {classInfo?.name && <span>{(user?.school || classInfo?.school) ? ' · ' : ''}{classInfo.name}</span>}
                  {user?.number && <span> · {user.number}번</span>}
                </p>
                {user?.nickname && (
                  <p className="text-xs mt-1 text-purple-700 flex items-center gap-1.5 flex-wrap">
                    <span>🎭 친구들에겐 <strong>{user.nickname}</strong>(이)로 보여요</span>
                    <button onClick={() => setShowNicknameModal(true)}
                      className="text-purple-600 underline hover:text-purple-900">
                      변경
                    </button>
                  </p>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <Link href="/student/ranking"
                  className="text-xs text-amber-700 hover:text-amber-900 px-3 py-1 rounded-full border border-amber-200 bg-amber-50">
                  🏆 랭킹
                </Link>
                <button onClick={() => setShowPwModal(true)} className="text-xs text-gray-600 hover:text-primary px-3 py-1 rounded-full border border-gray-200">
                  🔐 비밀번호
                </button>
              </div>
            </div>
          </div>

          {/* 🆕 선생님 코멘트 도착 알림 (미확인 코멘트가 있을 때) */}
          {unreadComments.length > 0 && (
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4">
              <h3 className="font-bold text-yellow-900 text-sm mb-1">
                💛 선생님이 내 글에 코멘트를 남겼어요! ({unreadComments.length}개)
              </h3>
              <div className="space-y-2 mt-2">
                {unreadComments.map(c => (
                  <Link key={c.id} href="/student/history"
                    className="block bg-white border border-yellow-200 hover:border-yellow-400 rounded-lg p-3 transition">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs text-gray-500">
                        📅 {c.topics?.date} · {c.topics?.title}
                        {(c.attempt||1) >= 2 && <span className="ml-1 text-purple-600">(수정본)</span>}
                      </span>
                      {c.teacher_comment_at && (
                        <span className="text-[10px] text-yellow-700">
                          {new Date(c.teacher_comment_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 mt-1 line-clamp-2 break-keep">
                      {c.teacher_comment}
                    </p>
                    <span className="text-xs text-yellow-700 mt-1 inline-block">전체 보기 →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          
          {!todayTopic ? (
            <>
              <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
                <div className="text-5xl mb-3">📝</div>
                <h2 className="text-lg font-bold mb-1">오늘은 글쓰기 주제가 없어요</h2>
                <p className="text-sm text-gray-600">선생님께서 곧 등록해주실 거예요!</p>
                <Link href="/student/history" className="mt-6 inline-block text-primary text-sm hover:underline">
                  내 글 기록 보기 →
                </Link>
              </div>

              {/* 지난 주제 중 안 쓴 글 안내 */}
              {pendingTopics.length > 0 && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <h3 className="font-bold mb-1 text-base">📚 안 쓴 글이 있어요 ({pendingTopics.length}개)</h3>
                  <p className="text-xs text-gray-600 mb-3">결석했거나 못 쓴 지난 주제예요. 지금 써도 돼요!</p>
                  <div className="space-y-2">
                    {pendingTopics.map(t => (
                      <button key={t.id}
                        onClick={() => loadTodayTopic(user, t.id)}
                        className="w-full text-left p-3 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition">
                        <div className="text-xs text-amber-700 font-semibold">📅 {t.date}</div>
                        <div className="font-medium text-sm mt-0.5">{t.title}</div>
                        {t.description && <div className="text-xs text-gray-600 mt-1 line-clamp-2">{t.description}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* 지난 주제 글쓰기 안내 배너 (오늘 주제 있을 때 — 모든 단계에서 표시) */}
              {pendingTopics.length > 0 && !showPendingPicker && todayTopic.date === todayStr() && (
                <button onClick={() => setShowPendingPicker(true)}
                  className="w-full bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-2xl p-3 text-left transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm text-amber-900">📚 안 쓴 지난 글이 {pendingTopics.length}개 있어요</div>
                      <div className="text-xs text-amber-700 mt-0.5">결석했거나 못 쓴 주제도 지금 쓸 수 있어요</div>
                    </div>
                    <div className="text-amber-700">→</div>
                  </div>
                </button>
              )}

              {/* 지난 주제 선택 모드 */}
              {showPendingPicker && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-base">📚 지난 주제 선택</h3>
                    <button onClick={() => setShowPendingPicker(false)}
                      className="text-xs text-gray-500 hover:text-gray-700">✕ 닫기</button>
                  </div>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {pendingTopics.map(t => (
                      <button key={t.id}
                        onClick={() => loadTodayTopic(user, t.id)}
                        className="w-full text-left p-3 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg transition">
                        <div className="text-xs text-amber-700 font-semibold">📅 {t.date}</div>
                        <div className="font-medium text-sm mt-0.5">{t.title}</div>
                        {t.description && <div className="text-xs text-gray-600 mt-1 line-clamp-2">{t.description}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 오늘 주제가 여러 개일 때 선택 UI */}
              {todayTopicList.length > 1 && (
                <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
                  <p className="text-sm font-semibold text-amber-900 mb-2">
                    📚 오늘 주제가 {todayTopicList.length}개 있어요!
                  </p>
                  <div className="space-y-2">
                    {todayTopicList.map(t => {
                      const isCurrent = todayTopic?.id === t.id
                      const submitted = t.myMaxAttempt > 0
                      return (
                        <button
                          key={t.id}
                          onClick={() => loadTodayTopic(user, t.id)}
                          className={`w-full text-left p-3 rounded-lg transition ${
                            isCurrent
                              ? 'bg-primary text-white'
                              : 'bg-white border border-gray-200 hover:border-primary'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium ${isCurrent ? 'text-white' : 'text-gray-900'}`}>
                                {t.title}
                              </div>
                              {t.description && (
                                <div className={`text-xs mt-0.5 truncate ${isCurrent ? 'text-white/80' : 'text-gray-500'}`}>
                                  {t.description}
                                </div>
                              )}
                            </div>
                            <div className="flex-shrink-0">
                              {submitted ? (
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  isCurrent ? 'bg-white/20 text-white' : 'bg-green-100 text-green-700'
                                }`}>
                                  ✅ 제출함
                                </span>
                              ) : (
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  isCurrent ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'
                                }`}>
                                  📝 미제출
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 주제 정보 */}
              <div className="bg-primary-light border border-primary rounded-2xl p-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex-1">
                    <div className="text-xs text-primary-dark font-semibold mb-1">
                      📅 {todayTopic.date}
                      {todayTopic.date !== todayStr() && (
                        <span className="ml-2 bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">지난 주제</span>
                      )}
                    </div>
                    <h2 className="text-lg font-bold text-primary-dark mb-1">{todayTopic.title}</h2>
                    {todayTopic.description && <p className="text-sm text-primary-dark/80">{todayTopic.description}</p>}
                  </div>
                  {todayTopic.date !== todayStr() && (
                    <button onClick={() => loadTodayTopic(user)}
                      className="text-xs bg-white border border-primary text-primary px-3 py-1.5 rounded-full hover:bg-primary-light flex-shrink-0">
                      🌟 오늘 주제로
                    </button>
                  )}
                </div>
                {todayTopic.lock_enabled && todayTopic.lock_start_time && todayTopic.lock_end_time && todayTopic.date === todayStr() && (
                  (() => {
                    const lock = checkTimeLock(todayTopic)
                    return (
                      <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-medium ${
                        lock.allowed
                          ? 'bg-green-50 border border-green-200 text-green-800'
                          : 'bg-amber-50 border border-amber-200 text-amber-900'
                      }`}>
                        {lock.allowed
                          ? `🔓 글쓰기 가능 시간: ${todayTopic.lock_start_time} ~ ${todayTopic.lock_end_time}`
                          : `🔒 ${lock.reason}`}
                      </div>
                    )
                  })()
                )}
                {/* 제출 기한 배지 */}
                {todayTopic.deadline_date && (() => {
                  const dl = new Date(`${todayTopic.deadline_date}T${todayTopic.deadline_time || '23:59'}:00+09:00`)
                  const now = new Date()
                  const isPast = now > dl
                  const hoursLeft = Math.floor((dl - now) / 3600000)
                  const daysLeft = Math.floor(hoursLeft / 24)
                  let timeLabel = ''
                  if (isPast) timeLabel = '마감됨'
                  else if (hoursLeft < 24) timeLabel = `${hoursLeft}시간 남음`
                  else timeLabel = `${daysLeft}일 남음`
                  return (
                    <div className={`mt-2 px-3 py-2 rounded-lg text-xs font-medium ${
                      isPast
                        ? 'bg-red-50 border border-red-200 text-red-900'
                        : hoursLeft < 24
                          ? 'bg-amber-50 border border-amber-200 text-amber-900'
                          : 'bg-blue-50 border border-blue-200 text-blue-900'
                    }`}>
                      📅 제출 마감: {todayTopic.deadline_date} {todayTopic.deadline_time || '23:59'} ({timeLabel})
                    </div>
                  )
                })()}
              </div>

              {/* 단계별 화면 */}
              {step === 'write' && (
                <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                  {todayTopic.rubrics?.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
                      <div className="font-bold mb-2">📝 평가 기준 (총 {todayTopic.rubrics.reduce((s,r)=>s+r.score,0)}점)</div>
                      <div className="space-y-1">
                        {todayTopic.rubrics.map((r, i) => (
                          <div key={i}>
                            <strong>{r.name} ({r.score}점)</strong>
                            {r.hint && <span className="text-blue-700"> - {r.hint}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <h3 className="font-bold">✏️ 글쓰기</h3>
                  <div className="text-xs bg-blue-50 border border-blue-200 rounded-lg p-2 text-blue-800 flex items-start gap-1.5">
                    <span>💡</span>
                    <span>본명, 주소, 전화번호, 가족 이름 같은 <strong>개인정보는 쓰지 말아주세요</strong>. AI 학습에 활용될 수 있어요.</span>
                  </div>
                  <textarea
                    value={essay}
                    onChange={e => setEssay(e.target.value)}
                    onPaste={() => handlePaste('essay')}
                    placeholder={`여기에 글을 써 주세요... (${todayTopic?.min_length || 30}자 이상)`}
                    rows="12"
                    className="w-full p-3 border border-gray-200 rounded-lg text-sm leading-relaxed"
                  />
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <span className={`${
                      essay.length >= (todayTopic?.min_length || 30) &&
                      (!todayTopic?.max_length || essay.length <= todayTopic.max_length)
                        ? 'text-green-600 font-medium'
                        : essay.length > (todayTopic?.max_length || Infinity)
                          ? 'text-red-600 font-medium'
                          : ''
                    }`}>
                      {essay.length}자 / 최소 {todayTopic?.min_length || 30}자
                      {todayTopic?.max_length && ` · 최대 ${todayTopic.max_length}자`}
                    </span>
                    {pasteWarning && <span className="text-red-600">⚠️ 붙여넣기 감지됨!</span>}
                  </div>
                  <button onClick={submitEssay} disabled={submitting}
                    className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                    {submitting ? '🤖 AI가 검토 중...' : '제출하고 피드백 받기 →'}
                  </button>
                  {submitting && retryMessage && (
                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
                      <span>⏳</span>
                      <span>{retryMessage}</span>
                    </div>
                  )}
                </div>
              )}

              {(step === 'feedback' || step === 'done') && feedbackResult && (
                <>
                  {step === 'done' && (
                    <div className="bg-green-50 border border-green-300 rounded-2xl p-4 text-center">
                      <div className="text-3xl mb-1">🎉</div>
                      <div className="font-bold text-green-900">수정본 제출 완료!</div>
                      <div className="text-sm text-green-800 mt-1">최종 점수: {feedbackResult.total}/{currentSub?.max_score}점</div>
                    </div>
                  )}

                  {/* 피드백 결과 */}
                  <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm space-y-4 overflow-hidden">
                    <div className="flex justify-between items-center gap-2">
                      <h3 className="font-bold text-base">📊 피드백 결과</h3>
                      <span className="text-base sm:text-lg font-bold flex-shrink-0">{feedbackResult.total}/{currentSub?.max_score || todayTopic.rubrics.reduce((s,r)=>s+r.score,0)}점</span>
                    </div>

                    {/* 내가 쓴 글 (맞춤법 표시) */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold">📝 내가 쓴 글</h4>
                        {feedbackResult.corrections?.length > 0 && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">
                            맞춤법/띄어쓰기 {feedbackResult.corrections.length}개
                          </span>
                        )}
                      </div>
                      <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                        dangerouslySetInnerHTML={{__html: applyGrammarHighlights(essay, feedbackResult.corrections)}} />
                      {feedbackResult.corrections?.length > 0 && (
                        <p className="text-xs text-gray-500 mt-2">💡 빨간 밑줄을 탭하거나 클릭하면 올바른 표기를 볼 수 있어요</p>
                      )}
                      <p className="text-[11px] text-gray-400 mt-1 leading-snug">{GRAMMAR_NOTICE_STUDENT}</p>
                    </div>

                    {/* 점수 막대 + 점수 근거 (와이프 피드백: 왜 감점됐는지 학생이 납득해야 함) */}
                    {Array.isArray(feedbackResult.scores) && (
                      <div className="space-y-3 overflow-hidden">
                        {feedbackResult.scores.map((s, i) => {
                          const r = todayTopic.rubrics[i] || { name: `기준 ${i+1}`, score: 25 }
                          const pct = Math.round((s / r.score) * 100)
                          const isFull = s >= r.score
                          const reason = Array.isArray(feedbackResult.rubric_reasons) ? feedbackResult.rubric_reasons[i] : null
                          const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
                          return (
                            <div key={i} className="min-w-0 bg-gray-50 rounded-lg p-3 border border-gray-100">
                              <div className="flex justify-between gap-2 text-sm mb-1">
                                <span className="text-gray-800 font-semibold break-keep">
                                  {r.name}
                                  {isFull && <span className="ml-1 text-green-600">✓</span>}
                                </span>
                                <span className={`font-bold flex-shrink-0 ${isFull ? 'text-green-700' : 'text-gray-700'}`}>
                                  {s}/{r.score}점
                                </span>
                              </div>
                              {r.hint && <div className="text-xs text-gray-500 mb-1.5 break-keep">📌 {r.hint}</div>}
                              <div className="bg-gray-200 rounded-full h-2 overflow-hidden mb-2">
                                <div className={`${barColor} h-full transition-all`} style={{width: pct + '%'}} />
                              </div>
                              {/* 🆕 점수 근거 (와이프 피드백: 왜 감점됐는지) */}
                              {reason ? (
                                <p className="text-xs text-gray-700 leading-relaxed break-keep bg-white rounded p-2 border border-gray-200 mt-2">
                                  <span className="font-semibold text-gray-800">💡 이유: </span>
                                  {reason}
                                </p>
                              ) : !isFull ? (
                                <p className="text-xs text-amber-700 leading-relaxed bg-amber-50 rounded p-2 border border-amber-200 mt-2">
                                  ⚠️ 이번에는 점수 근거가 나오지 않았어요. 위의 발전점을 참고해주세요.
                                </p>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 의견들 - 시각적으로 분리 */}
                    <div className="space-y-3 pt-3 border-t border-gray-100">
                      {/* 종합 의견 */}
                      <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                        <h4 className="text-sm font-bold mb-2 text-blue-900 flex items-center gap-1.5">
                          <span>💬</span> 종합 의견
                        </h4>
                        <p className="text-sm text-blue-900 break-keep leading-relaxed">{feedbackResult.overall}</p>
                      </div>

                      {/* 잘한 점 */}
                      <div className="bg-green-50 rounded-xl p-4 border border-green-100">
                        <h4 className="text-sm font-bold mb-2 text-green-900 flex items-center gap-1.5">
                          <span>⭐</span> 잘한 점
                        </h4>
                        <FeedbackList text={feedbackResult.good} color="green" />
                      </div>

                      {/* 발전 점 */}
                      <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                        <h4 className="text-sm font-bold mb-2 text-amber-900 flex items-center gap-1.5">
                          <span>🌱</span> 더 발전시킬 점
                        </h4>
                        <FeedbackList text={feedbackResult.improve} color="amber" />
                      </div>

                      {/* 🆕 발전점 구체 예시 (와이프 피드백: 어떻게 고치면 좋을지) */}
                      {Array.isArray(feedbackResult.improve_examples) && feedbackResult.improve_examples.length > 0 && (
                        <div className="bg-purple-50 rounded-xl p-4 border-2 border-purple-200">
                          <h4 className="text-sm font-bold mb-2 text-purple-900 flex items-center gap-1.5">
                            <span>✏️</span> 이렇게 바꿔보면 어떨까요?
                          </h4>
                          <p className="text-xs text-purple-700 mb-3">아래는 예시예요. 똑같이 쓰지 말고 참고만 하세요!</p>
                          <div className="space-y-3">
                            {feedbackResult.improve_examples.map((ex, i) => (
                              <div key={i} className="bg-white rounded-lg border border-purple-200 overflow-hidden">
                                <div className="px-3 py-2 bg-red-50 border-b border-red-100">
                                  <div className="text-[11px] text-red-700 font-semibold mb-0.5">현재</div>
                                  <p className="text-sm text-gray-800 break-keep">{ex.original}</p>
                                </div>
                                <div className="px-3 py-2 bg-green-50 border-b border-green-100">
                                  <div className="text-[11px] text-green-700 font-semibold mb-0.5">예시</div>
                                  <p className="text-sm text-gray-900 break-keep leading-relaxed">{ex.suggested}</p>
                                </div>
                                {ex.reason && (
                                  <div className="px-3 py-1.5 bg-purple-50 border-t border-purple-100">
                                    <p className="text-[11px] text-purple-700 break-keep">💡 {ex.reason}</p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 피드백 신고 버튼 - 카드 하단에 작게 */}
                    <div className="pt-2 border-t border-gray-100 flex justify-end">
                      <button onClick={reportFeedback}
                        className={`text-xs px-3 py-1.5 rounded-full ${
                          currentSub?.reported
                            ? 'bg-amber-100 text-amber-800 cursor-default'
                            : 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                        }`}
                        disabled={currentSub?.reported}
                        title="피드백이 이상하다고 느껴지면 선생님께 알릴 수 있어요"
                      >
                        {currentSub?.reported ? '🙏 신고 완료' : '🚨 이 피드백 이상해요'}
                      </button>
                    </div>
                  </div>

                  {/* 예시 작품 (피드백/완료 단계 모두 표시) */}
                  {(exampleText || exampleLoading) && (step === 'feedback' || step === 'done') && (
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
                      <h3 className="font-bold text-purple-900 mb-2">
                        📖 AI 예시 작품
                        {step === 'done' && <span className="ml-2 text-xs font-normal text-purple-600">(수정본 기준)</span>}
                      </h3>
                      {exampleLoading ? (
                        <p className="text-sm text-purple-700">예시 작품을 만들고 있어요...</p>
                      ) : (
                        <p className="text-sm text-purple-900 whitespace-pre-wrap leading-relaxed">{exampleText}</p>
                      )}
                    </div>
                  )}

                  {/* 다시 쓰기 버튼 (feedback 단계에서만) */}
                  {step === 'feedback' && (
                    <button onClick={startRewrite}
                      className="w-full py-3 bg-white border-2 border-primary text-primary rounded-xl font-semibold hover:bg-primary-light">
                      ✏️ 다시 쓰기
                    </button>
                  )}
                </>
              )}

              {step === 'rewrite' && (
                <>
                  {/* 다음 단계 안내 (와이프 피드백) */}
                  <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-4">
                    <h3 className="font-bold text-amber-900 mb-1">✏️ 이제 글을 더 좋게 다듬어 봐요!</h3>
                    <p className="text-sm text-amber-800 leading-relaxed break-keep">
                      아래 피드백을 잘 읽고, 특히 <strong className="text-amber-900">🌱 다음엔 이렇게 해봐요</strong>와
                      {' '}<strong className="text-amber-900">✏️ 이렇게 바꿔보면 어떨까요</strong> 부분을 참고해서 다시 써보세요.
                      <br />
                      <span className="text-xs text-amber-700 mt-1 inline-block">💡 똑같이 베끼지 말고, 자기 표현으로 바꿔서 써야 점수가 잘 나와요!</span>
                    </p>
                  </div>

                  {/* 첫 글 피드백 카드 (전체 폭) */}
                  <StudentFeedbackCard
                    sub={currentSub || { ...feedbackResult, essay_text: essay, total_score: feedbackResult?.total, max_score: todayTopic?.rubrics?.reduce((s,r)=>s+r.score,0) || 100, rubric_reasons: feedbackResult?.rubric_reasons, improve_examples: feedbackResult?.improve_examples, feedback_overall: feedbackResult?.overall, feedback_good: feedbackResult?.good, feedback_improve: feedbackResult?.improve, corrections: feedbackResult?.corrections, scores: feedbackResult?.scores }}
                    topic={todayTopic}
                    headerLabel="📋 처음 쓴 글 피드백 (참고용)"
                  />

                  {/* 🆕 좌우 분할: 왼쪽 첫 글, 오른쪽 수정본 입력 (와이프 피드백) */}
                  {/* 데스크탑(lg)에서만 좌우, 모바일·태블릿은 위아래 */}
                  <div className="grid lg:grid-cols-2 gap-3 lg:gap-4">
                    {/* 왼쪽 (또는 위쪽): 처음 쓴 글 + 맞춤법 밑줄 */}
                    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                      <h3 className="font-bold mb-2 text-sm flex items-center gap-1">
                        📝 처음 쓴 글
                        <span className="text-xs font-normal text-gray-500">(참고용)</span>
                      </h3>
                      <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed border border-gray-200 max-h-[500px] lg:max-h-[600px] overflow-y-auto"
                        dangerouslySetInnerHTML={{__html: applyGrammarHighlights(essay, feedbackResult?.corrections)}} />
                      <p className="text-xs text-gray-500 mt-2">💡 빨간 밑줄에 마우스 올리거나 탭하면 올바른 표기를 볼 수 있어요</p>
                    </div>

                    {/* 오른쪽 (또는 아래쪽): 수정본 입력 */}
                    <div className="bg-white rounded-2xl p-4 shadow-sm border-2 border-primary/30">
                      <h3 className="font-bold mb-2 text-sm flex items-center gap-1">
                        ✏️ 다시 쓰기
                        <span className="text-xs font-normal text-primary">(여기에 새로 써요)</span>
                      </h3>
                      <textarea
                        value={rewriteEssay}
                        onChange={e => setRewriteEssay(e.target.value)}
                        onPaste={() => handlePaste('rewrite')}
                        placeholder={`처음 쓴 글의 발전점을 참고해서 새로 써 보세요... (${todayTopic?.min_length || 30}자 이상)`}
                        className="w-full p-3 border border-gray-200 rounded-lg text-sm leading-relaxed resize-none focus:border-primary focus:outline-none"
                        style={{ height: '500px' }}
                      />
                      <div className="flex justify-between items-center text-xs text-gray-500 mt-2">
                        <span className={`${
                          rewriteEssay.length >= (todayTopic?.min_length || 30) &&
                          (!todayTopic?.max_length || rewriteEssay.length <= todayTopic.max_length)
                            ? 'text-green-600 font-medium'
                            : rewriteEssay.length > (todayTopic?.max_length || Infinity)
                              ? 'text-red-600 font-medium'
                              : ''
                        }`}>
                          {rewriteEssay.length}자 / 최소 {todayTopic?.min_length || 30}자
                          {todayTopic?.max_length && ` · 최대 ${todayTopic.max_length}자`}
                        </span>
                        {pasteWarning && <span className="text-red-600">⚠️ 붙여넣기 감지됨!</span>}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => setStep('feedback')}
                          className="flex-1 py-3 border border-gray-200 rounded-xl text-sm">취소</button>
                        <button onClick={submitRewrite} disabled={rewriting}
                          className="flex-[2] py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                          {rewriting ? '🤖 AI 검토 중...' : '수정본 제출 →'}
                        </button>
                      </div>
                      {rewriting && retryMessage && (
                        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2 mt-3">
                          <span>⏳</span>
                          <span>{retryMessage}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 예시 작품 (전체 폭, 아래쪽) */}
                  {exampleText && (
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
                      <h3 className="font-bold text-purple-900 mb-2 text-sm">📖 AI 예시 작품 (참고만)</h3>
                      <p className="text-xs text-purple-700 mb-2">⚠️ 베끼지 마세요! 어떻게 쓰는지만 참고하고 자기 글로 새로 써야 해요.</p>
                      <p className="text-sm text-purple-900 whitespace-pre-wrap leading-relaxed break-keep">{exampleText}</p>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* 내 글 기록 링크 */}
          <div className="text-center pt-4">
            <Link href="/student/history" className="text-sm text-gray-600 hover:text-primary">
              📚 내 글 기록 보기 →
            </Link>
          </div>
        </main>
        {showPwModal && <PasswordChangeModal onClose={() => setShowPwModal(false)} />}
        {showNicknameModal && (
          <NicknameChangeModal
            targetUserId={user?.id}
            currentNickname={user?.nickname}
            classId={user?.class_id}
            displayName={user?.realname}
            onClose={() => setShowNicknameModal(false)}
            onSuccess={(newNick) => setUser(prev => ({ ...prev, nickname: newNick }))}
          />
        )}
        {errorModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
              <h3 className="text-lg font-bold mb-3">{errorModal.title}</h3>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-amber-900 whitespace-pre-line leading-relaxed">
                  {errorModal.message}
                </p>
              </div>
              {errorModal.showReload && (
                <button
                  onClick={() => window.location.reload()}
                  className="w-full py-3 mb-2 bg-primary text-white rounded-xl font-semibold"
                >
                  🔄 새로고침
                </button>
              )}
              <button
                onClick={() => setErrorModal(null)}
                className={`w-full py-3 rounded-xl font-semibold ${
                  errorModal.showReload
                    ? 'bg-gray-100 text-gray-700'
                    : 'bg-primary text-white'
                }`}
              >
                확인
              </button>
            </div>
          </div>
        )}
        <StudentTutorial />

        {/* 🆕 AI 글쓰기 도우미 (교사가 켰을 때 + 글쓰기 단계에서만) */}
        {classInfo?.tutor_chat_enabled && (step === 'write' || step === 'rewrite') && todayTopic && (
          <TutorChat
            topic={todayTopic}
            currentText={step === 'rewrite' ? rewriteEssay : essay}
            studentName={user?.realname}
            userId={user?.id}
            grade={classInfo?.grade}
          />
        )}
      </div>
    </>
  )
}

```

## pages/student/login.js

```js
import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { getAuthErrorMessage } from '../../lib/authErrors'
import ConsentForm from '../../components/ConsentForm'

// 로컬 스토리지 키
const SAVED_USERNAME_KEY = 'lc-saved-username'
const NO_AUTO_LOGIN_KEY = 'lc-no-auto-login'
const SESSION_ACTIVE_KEY = 'lc-session-active'

export default function StudentLogin() {
  const router = useRouter()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [classCode, setClassCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('form')
  const [checkingAuth, setCheckingAuth] = useState(true)
  // 새 옵션
  const [saveUsername, setSaveUsername] = useState(false)
  const [autoLogin, setAutoLogin] = useState(true)
  // 가입 시 동의 체크 (한 화면에 같이 표시)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  // 🆕 QR 진입 시 학급 로그인 안내 (선생님이 설정한 경우)
  const [classHint, setClassHint] = useState(null) // { className, prefix, password, school }
  // 🆕 로그인 모드에서 "아이디 잊어버렸어요?" 토글 (학급 코드로 안내 받기)
  const [showHintLookup, setShowHintLookup] = useState(false)

  useEffect(() => {
    // 저장된 아이디 / 자동 로그인 설정 복원
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SAVED_USERNAME_KEY)
      if (saved) {
        setUsername(saved)
        setSaveUsername(true)
      }
      const noAuto = localStorage.getItem(NO_AUTO_LOGIN_KEY) === 'true'
      setAutoLogin(!noAuto)
    }
    checkSession()
  }, [])

  // 🔗 URL 쿼리로 학급 코드 자동 입력 (?code=XXX)
  // - 학급 코드만 자동 채움 (로그인/가입은 학생이 선택)
  // - mode=signup 명시 시에만 가입 모드 자동 전환 (구버전 호환)
  // - 학급 로그인 안내가 설정되어 있으면 가져와서 표시
  useEffect(() => {
    if (!router.isReady) return
    const { code, mode: qMode } = router.query
    if (code && typeof code === 'string') {
      const upperCode = code.toUpperCase()
      setClassCode(upperCode)
      if (qMode === 'signup') {
        setMode('signup')
      }
      // 학급 정보 가져오기 (로그인 안내 표시용)
      loadClassHint(upperCode)
    }
  }, [router.isReady, router.query])

  const loadClassHint = async (code) => {
    try {
      // step149 RLS: 비로그인 classes 조회는 서버 라우트 경유 (api_key 비노출)
      const res = await fetch('/api/class-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const { class: data } = await res.json()
      if (data && data.login_hint_enabled && data.login_username_prefix) {
        setClassHint({
          className: data.name,
          school: data.school,
          prefix: data.login_username_prefix,
          password: data.login_default_password || '123456'
        })
      } else {
        setClassHint(null)
      }
    } catch (e) {
      console.warn('학급 안내 로드 실패:', e)
    }
  }

  // 🆕 학급 코드를 입력하는 즉시 안내 로드 (코드 없이 들어와도 동작)
  useEffect(() => {
    const trimmed = (classCode || '').trim().toUpperCase()
    if (trimmed.length >= 4) {
      loadClassHint(trimmed)
    } else if (classHint) {
      setClassHint(null)
    }
  }, [classCode])

  const checkSession = async () => {
    // 자동 로그인 OFF + 새 브라우저 세션 → 강제 로그아웃
    if (typeof window !== 'undefined') {
      const noAutoLogin = localStorage.getItem(NO_AUTO_LOGIN_KEY) === 'true'
      const sessionActive = sessionStorage.getItem(SESSION_ACTIVE_KEY) === 'true'
      if (noAutoLogin && !sessionActive) {
        await supabase.auth.signOut()
        setCheckingAuth(false)
        return
      }
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      const { data: profile } = await supabase.from('profiles')
        .select('role').eq('id', session.user.id).maybeSingle()
      if (profile?.role === 'student') {
        router.replace('/student')
        return
      }
    }
    setCheckingAuth(false)
  }

  // 옵션 저장 (로그인/가입 성공 직후 호출)
  const persistOptions = () => {
    if (typeof window === 'undefined') return
    // 아이디 저장
    if (saveUsername && username) {
      localStorage.setItem(SAVED_USERNAME_KEY, username)
    } else {
      localStorage.removeItem(SAVED_USERNAME_KEY)
    }
    // 자동 로그인
    if (autoLogin) {
      localStorage.removeItem(NO_AUTO_LOGIN_KEY)
      sessionStorage.removeItem(SESSION_ACTIVE_KEY)
    } else {
      localStorage.setItem(NO_AUTO_LOGIN_KEY, 'true')
      sessionStorage.setItem(SESSION_ACTIVE_KEY, 'true')
    }
  }

  // form onSubmit: 엔터키든 버튼이든 다 여기로
  // setTimeout 0ms: 마지막 onChange의 setState가 반영된 뒤 실행되도록 보장
  const handleFormSubmit = (e) => {
    if (e?.preventDefault) e.preventDefault()
    if (loading) return
    setTimeout(() => {
      if (mode === 'signup') {
        if (!username || !password || !classCode) {
          setError('모든 항목을 입력해주세요')
          return
        }
        if (password.length < 6) {
          setError('비밀번호는 6자 이상이어야 해요')
          return
        }
        if (!agreeTerms || !agreePrivacy) {
          setError('이용약관과 개인정보처리방침에 동의해주세요')
          return
        }
        handleSubmit()
      } else {
        handleSubmit()
      }
    }, 0)
  }

  // 추가 안전망: input에서 엔터 직접 캐치 (IME는 무시)
  const handleEnter = (e) => {
    if (e.key !== 'Enter') return
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    handleFormSubmit(e)
  }

  const handleSubmit = async () => {
    if (!username || !password) return setError('아이디와 비밀번호를 입력해주세요')
    if (mode === 'signup' && !classCode) return setError('학급 코드를 입력해주세요')

    setLoading(true)
    setError('')
    const email = `${username.toLowerCase()}@writing.class`

    try {
      if (mode === 'login') {
        const { data: loginData, error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        
        const { data: profile } = await supabase.from('profiles').select('role, realname').eq('id', loginData.user.id).maybeSingle()
        
        if (!profile) {
          await supabase.auth.signOut()
          // step206: '가입을 먼저' 유도 제거 — 명렬표 학급에서 잘못된 새 계정(유령) 생성을 부추기지 않도록.
          throw new Error('회원 정보를 찾을 수 없어요. 아이디 오타가 아닌지 확인하거나 선생님께 문의해주세요.')
        }
        
        if (profile.role === 'teacher' || profile.role === 'admin') {
          await supabase.auth.signOut()
          throw new Error(`이 계정은 선생님 계정이에요!\n\n${profile.realname || ''}님, "👩‍🏫 선생님이에요" 버튼으로 다시 들어가주세요.`)
        }
        
        if (profile.role !== 'student') {
          await supabase.auth.signOut()
          throw new Error('학생 권한이 없는 계정이에요.')
        }
        
        persistOptions()
        router.push('/student')
      } else {
        // step149 RLS: 가입은 비로그인이므로 서버 라우트로 학급 조회
        const lookupRes = await fetch('/api/class-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: classCode })
        })
        const { class: classData } = await lookupRes.json()
        if (!classData) {
          setError('학급 코드가 잘못됐어요. 선생님께 확인해주세요')
          setLoading(false)
          return
        }
        // 🆕 삭제된 학급은 가입 차단 (B4)
        if (classData.deleted_at) {
          setError('이 학급은 삭제되었어요. 선생님께 문의해주세요.')
          setLoading(false)
          return
        }
        if (classData.is_active === false) {
          setError('이 학급은 현재 운영 중지 상태예요. 선생님께 문의해주세요.')
          setLoading(false)
          return
        }
        // 🆕 step206: 명렬표 학급(자가가입 OFF)은 새 계정 생성을 막는다 — 유령계정 원천 차단.
        //   ★ false일 때만 막음(null/미적용 학급은 그대로 허용 → 순수 자가가입 학급 영향 0).
        //   ★ 로그인(기존 계정) 경로는 막지 않음 — 가입(새 계정)만 차단한다.
        if (classData.self_signup_enabled === false) {
          setError('이 학급은 선생님이 만든 아이디로 로그인만 가능해요.\n아이디 오타가 아닌지 확인해주세요.\n전학생이거나 아이디를 모르면 선생님께 문의하면 바로 만들어 주실 수 있어요.')
          setLoading(false)
          return
        }
        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) {
          setError(getAuthErrorMessage(err, 'signup'))
          setLoading(false)
          return
        }

        // 🆕 step197: 닉네임을 insert 전에 확정해 한 번에 저장 (자가가입도 잠금 모델과 동일하게
        //   realname엔 아이디 대신 빈값 → 화면은 displayStudentName이 닉네임을 표시).
        // generateUniqueNickname은 항상 비어있지 않은 문자열을 반환(중복 회피 30회 실패 시 숫자 접미사,
        //   DB접근·throw 없음) → 닉네임 누락 불가. 동급생 닉네임 조회는 best-effort(가입 전이라
        //   RLS상 대개 빈 결과 → 중복 회피는 약화되나 중복은 외관상 문제일 뿐, 교사가 '닉네임 변경'으로 조정 가능).
        let nickname
        try {
          const { generateUniqueNickname } = await import('../../lib/nickname')
          let used = []
          try {
            const { data: existing } = await supabase.from('profiles')
              .select('nickname').eq('class_id', classData.id).eq('role', 'student')
            used = (existing || []).map(p => p.nickname).filter(Boolean)
          } catch (_) { /* 조회 실패 → 빈 목록으로 생성(닉네임은 여전히 보장) */ }
          nickname = generateUniqueNickname(used)
        } catch (_) {
          // 극단 케이스(모듈 로드 실패 등) 폴백 — 닉네임이 절대 비지 않도록 직접 구성. 가입은 중단하지 않음.
          nickname = '새친구' + String(data.user.id).slice(0, 4)
        }

        const profileData = {
          id: data.user.id, username: username.toLowerCase(), realname: '', nickname,
          role: 'student', class_id: classData.id, school: classData.school || null
        }
        await supabase.from('profiles').insert(profileData)
        persistOptions()
        router.push('/student')
      }
    } catch(e) {
      const errMsg = getAuthErrorMessage(e, mode === 'signup' ? 'signup' : 'login')
      setError(errMsg)
      setLoading(false)
    }
  }

  if (checkingAuth) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500 text-sm">로딩 중...</div></div>

  return (
    <>
      <Head><title>학생 로그인 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-md mx-auto flex items-center gap-3">
            <Link href="/" className="text-gray-600 hover:text-gray-900">←</Link>
            <h1 className="text-base font-bold">학생 로그인</h1>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="text-center mb-6">
              <div className="text-5xl mb-2">🎒</div>
              <h2 className="text-xl font-bold">{mode === 'login' ? '학생 로그인' : '학생 가입'}</h2>
            </div>

            <div className="flex gap-2 mb-6 bg-gray-100 rounded-xl p-1">
              <button type="button" onClick={() => { setMode('login'); setError(''); setStep('form'); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'login' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                로그인
              </button>
              <button type="button" onClick={() => { setMode('signup'); setError(''); setStep('form'); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'signup' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                회원가입
              </button>
            </div>

            {/* 🆕 QR 진입 시 학급 로그인 안내 (선생님이 설정한 경우만 표시) */}
            {classHint && (() => {
              const formatNum = (n) => String(n).padStart(2, '0') // 무조건 2자리
              return (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                  <div className="text-sm font-bold text-blue-900 flex items-center gap-1">
                    👋 {classHint.className} 학생이라면
                  </div>
                  <div className="text-xs text-blue-800 space-y-2">
                    <div>
                      <div className="font-semibold mb-1">🆔 아이디 만들기</div>
                      <div className="pl-1">
                        <span className="bg-white px-1.5 py-0.5 rounded font-mono">{classHint.prefix}</span>
                        {' + '}
                        <span className="text-blue-700 font-bold">본인 번호 (두 자리)</span>
                      </div>
                      <div className="pl-1 mt-1.5 bg-white rounded p-2 space-y-0.5">
                        <div className="text-blue-900 font-semibold mb-1">📌 예시 (번호 두 자리로 써요!)</div>
                        <div>• 1번이면 → <span className="font-mono bg-blue-100 px-1 rounded font-bold">{classHint.prefix}{formatNum(1)}</span></div>
                        <div>• 5번이면 → <span className="font-mono bg-blue-100 px-1 rounded font-bold">{classHint.prefix}{formatNum(5)}</span></div>
                        <div>• 12번이면 → <span className="font-mono bg-blue-100 px-1 rounded font-bold">{classHint.prefix}{formatNum(12)}</span></div>
                        <div>• 25번이면 → <span className="font-mono bg-blue-100 px-1 rounded font-bold">{classHint.prefix}{formatNum(25)}</span></div>
                      </div>
                      <div className="pl-1 mt-1 text-amber-700">
                        ⚠️ 1번은 <span className="font-mono">1</span>이 아니라 <span className="font-mono font-bold">01</span>이에요!
                      </div>
                    </div>
                    <div>
                      <span className="font-semibold">🔑 비밀번호:</span>{' '}
                      <span className="bg-white px-1.5 py-0.5 rounded font-mono">{classHint.password}</span>
                      <span className="text-blue-600 ml-1">(로그인 후 꼭 바꿔주세요!)</span>
                    </div>
                  </div>
                </div>
              )
            })()}

            <div className="space-y-3">
                {mode === 'signup' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">학급 코드</label>
                    <input
                      type="text"
                      placeholder="선생님께 받은 4자리"
                      value={classCode}
                      onChange={e => setClassCode(e.target.value)}
                      onKeyDown={handleEnter}
                      className="w-full p-3 border border-gray-200 rounded-lg text-center tracking-widest font-mono"
                      maxLength="6"
                      inputMode="numeric"
                    />
                  </div>
                )}

                {/* 🆕 로그인 모드: 학급 코드 입력 옵션 (잊어버린 아이디 찾기) */}
                {mode === 'login' && !classHint && !showHintLookup && (
                  <button type="button"
                    onClick={() => setShowHintLookup(true)}
                    className="w-full text-xs text-gray-500 hover:text-blue-600 underline py-1">
                    아이디 잊어버렸어요? 학급 코드로 찾기
                  </button>
                )}
                {mode === 'login' && showHintLookup && !classHint && (
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <label className="block text-xs font-medium mb-1 text-gray-700">학급 코드 입력</label>
                    <input
                      type="text"
                      placeholder="선생님께 받은 4자리"
                      value={classCode}
                      onChange={e => setClassCode(e.target.value)}
                      className="w-full p-2 border border-gray-200 rounded text-center tracking-widest font-mono text-sm"
                      maxLength="6"
                      inputMode="numeric"
                      autoFocus
                    />
                    <p className="text-[11px] text-gray-500 mt-1">코드 입력하면 아래에 아이디 만드는 방법이 나와요</p>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">아이디</label>
                  <input
                    type="text"
                    placeholder="영문 아이디"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    autoComplete="username"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">비밀번호</label>
                  <input
                    type="password"
                    placeholder={mode === 'signup' ? '6자 이상' : '비밀번호'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  {mode === 'login' && <p className="text-xs text-gray-500 mt-1">처음이세요? 초기 비밀번호는 <strong>123456</strong></p>}
                </div>

                {/* 옵션 체크박스 (로그인 모드일 때만) */}
                {mode === 'login' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveUsername}
                        onChange={e => setSaveUsername(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span>아이디 저장</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoLogin}
                        onChange={e => setAutoLogin(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span>자동 로그인</span>
                    </label>
                  </div>
                )}

                {/* 가입 모드: 동의 체크박스 */}
                {mode === 'signup' && (
                  <div className="space-y-2 pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-600">가입 전 동의해주세요</p>
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded font-medium text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agreeTerms && agreePrivacy}
                        onChange={() => {
                          const all = !(agreeTerms && agreePrivacy)
                          setAgreeTerms(all); setAgreePrivacy(all)
                        }}
                        className="w-4 h-4"
                      />
                      <span>모두 동의합니다 (필수)</span>
                    </label>
                    <div className="space-y-1.5 px-1">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agreeTerms}
                          onChange={e => setAgreeTerms(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span>
                          (필수) <Link href="/terms" target="_blank" className="text-primary underline">이용약관</Link>에 동의합니다
                        </span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agreePrivacy}
                          onChange={e => setAgreePrivacy(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span>
                          (필수) <Link href="/privacy" target="_blank" className="text-primary underline">개인정보처리방침</Link>에 동의합니다
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded whitespace-pre-line border border-red-200">{error}</div>}
                <button
                  type="button"
                  onClick={handleFormSubmit}
                  disabled={loading}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark disabled:opacity-50"
                >
                  {loading ? '처리 중...' : (mode === 'login' ? '로그인' : '가입하기')}
                </button>
              </div>
          </div>
        </main>
      </div>
    </>
  )
}

```

## pages/student/ranking.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

// 한국 시간 기준 오늘 날짜
function todayStr() {
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}

// N일 전 날짜
function daysAgoStr(days) {
  const now = new Date()
  now.setDate(now.getDate() - days)
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}

export default function StudentRanking() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [rankings, setRankings] = useState({ avgScore: [], totalSubs: [], improvement: [] })
  const [period, setPeriod] = useState('week') // week / month / all
  const [loading, setLoading] = useState(true)
  const [myRanks, setMyRanks] = useState({ avgScore: null, totalSubs: null, improvement: null })

  useEffect(() => { checkAuth() }, [])
  useEffect(() => { if (user?.class_id) loadRankings(user, period) }, [period])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/student/login'); return }
    const { data: profile } = await supabase.from('profiles')
      .select('*, classes:class_id(id, name, ranking_enabled)').eq('id', au.id).maybeSingle()
    if (!profile || profile.role !== 'student') {
      await supabase.auth.signOut(); router.push('/student/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    if (profile.classes?.ranking_enabled === false) {
      // 랭킹 비활성화
      setLoading(false)
      return
    }

    await loadRankings(profile, period)
    setLoading(false)
  }

  const loadRankings = async (profile, periodKey) => {
    if (!profile?.class_id) return

    // 같은 학급 학생들 (숨김 제외)
    const { data: students } = await supabase.from('profiles')
      .select('id, nickname, number, is_hidden')
      .eq('class_id', profile.class_id).eq('role', 'student')
    const visible = (students || []).filter(s => !s.is_hidden)
    if (visible.length === 0) { setRankings({ avgScore: [], totalSubs: [], improvement: [] }); return }

    const studentIds = visible.map(s => s.id)

    // 기간 필터
    let dateFilter = null
    if (periodKey === 'week') dateFilter = daysAgoStr(7)
    else if (periodKey === 'month') dateFilter = daysAgoStr(30)

    let q = supabase.from('submissions')
      .select('user_id, total_score, max_score, created_at, attempt, topic_id')
      .in('user_id', studentIds)
      .is('deleted_at', null)
    if (dateFilter) q = q.gte('created_at', dateFilter)
    const { data: allSubs } = await q

    // 학생별 통계
    const stats = {}
    visible.forEach(s => {
      stats[s.id] = {
        student: s,
        bestPerTopic: {}, // topic_id -> best submission
        count: 0,
        firstAttempts: [],
        rewriteAttempts: []
      }
    })

    ;(allSubs || []).forEach(s => {
      const st = stats[s.user_id]
      if (!st) return
      const key = s.topic_id
      const cur = st.bestPerTopic[key]
      if (!cur || (s.total_score || 0) > (cur.total_score || 0)) {
        st.bestPerTopic[key] = s
      }
      st.count++
      if ((s.attempt || 1) === 1) st.firstAttempts.push(s)
      else st.rewriteAttempts.push(s)
    })

    // 평균 점수 랭킹
    const avgList = Object.values(stats)
      .map(st => {
        const tops = Object.values(st.bestPerTopic)
        if (tops.length === 0) return null
        const avg = tops.reduce((s, x) => s + (x.total_score / x.max_score) * 100, 0) / tops.length
        return { student: st.student, value: Math.round(avg * 10) / 10, topicCount: tops.length }
      })
      .filter(Boolean)
      .filter(x => x.topicCount >= 1)
      .sort((a, b) => b.value - a.value)

    // 제출 횟수 랭킹
    const subsList = Object.values(stats)
      .map(st => ({ student: st.student, value: st.count }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value)

    // 향상도 랭킹
    const improveList = Object.values(stats)
      .map(st => {
        if (st.firstAttempts.length === 0 || st.rewriteAttempts.length === 0) return null
        const firstAvg = st.firstAttempts.reduce((s, x) => s + (x.total_score / x.max_score) * 100, 0) / st.firstAttempts.length
        const rewriteAvg = st.rewriteAttempts.reduce((s, x) => s + (x.total_score / x.max_score) * 100, 0) / st.rewriteAttempts.length
        return { student: st.student, value: Math.round((rewriteAvg - firstAvg) * 10) / 10 }
      })
      .filter(Boolean)
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value)

    // 내 순위
    const myAvgRank = avgList.findIndex(x => x.student.id === profile.id) + 1 || null
    const mySubsRank = subsList.findIndex(x => x.student.id === profile.id) + 1 || null
    const myImproveRank = improveList.findIndex(x => x.student.id === profile.id) + 1 || null
    setMyRanks({ avgScore: myAvgRank, totalSubs: mySubsRank, improvement: myImproveRank })

    setRankings({
      avgScore: avgList.slice(0, 10),
      totalSubs: subsList.slice(0, 10),
      improvement: improveList.slice(0, 10)
    })
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  if (classInfo?.ranking_enabled === false) {
    return (
      <>
        <Head><title>랭킹 - 다온클래스</title></Head>
        <div className="min-h-screen bg-gray-50">
          <Header user={user} onLogout={logout} />
          <main className="max-w-3xl mx-auto px-4 py-12 text-center">
            <div className="text-5xl mb-3">🚫</div>
            <h2 className="text-lg font-bold mb-2">랭킹 기능이 꺼져있어요</h2>
            <p className="text-sm text-gray-600">선생님께서 비활성화하셨어요</p>
            <Link href="/student" className="mt-6 inline-block text-primary hover:underline">← 메인으로</Link>
          </main>
        </div>
      </>
    )
  }

  const myNickname = user?.nickname || `${user?.number || ''}번`

  // 한 랭킹 카드 렌더링
  const renderRanking = (title, list, unit, myRank) => (
    <div className="bg-white rounded-2xl p-5 shadow-sm">
      <h3 className="font-bold mb-3">{title}</h3>
      {list.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">아직 데이터가 부족해요</p>
      ) : (
        <>
          <div className="space-y-2">
            {list.map((item, idx) => {
              const isMe = item.student.id === user?.id
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`
              return (
                <div key={item.student.id}
                  className={`flex items-center justify-between p-2.5 rounded-lg ${
                    isMe ? 'bg-primary-light border-2 border-primary' : 'bg-gray-50'
                  }`}>
                  <div className="flex items-center gap-3">
                    <span className={`w-7 text-center ${idx < 3 ? 'text-xl' : 'text-sm font-bold text-gray-500'}`}>
                      {medal}
                    </span>
                    <span className={`font-medium ${isMe ? 'text-primary-dark' : ''}`}>
                      {item.student.nickname || `${item.student.number || '?'}번`}
                      {isMe && <span className="ml-1 text-xs text-primary">(나)</span>}
                    </span>
                  </div>
                  <span className="font-mono font-bold">{item.value}{unit}</span>
                </div>
              )
            })}
          </div>
          {myRank && myRank > 10 && (
            <div className="mt-3 pt-3 border-t border-gray-200 text-center text-xs text-gray-600">
              ⭐ 내 순위: <strong className="text-primary">{myRank}등</strong>
            </div>
          )}
        </>
      )}
    </div>
  )

  return (
    <>
      <Head><title>랭킹 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/student" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">🏆 우리반 글쓰기 랭킹</h1>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            <p className="font-medium mb-1">🎭 익명 랭킹이에요</p>
            <p className="text-xs leading-relaxed">
              친구들이 내 이름을 알 수 없어요. 나에게는 <strong>"{myNickname}"</strong>(이)라는 닉네임이 있어요.
              <br/>
              순위는 격려와 동기 부여를 위한 거예요. 1등이 아니어도 글을 꾸준히 쓰는 게 가장 멋져요!
            </p>
          </div>

          {/* 기간 선택 */}
          <div className="bg-white rounded-2xl p-3 shadow-sm">
            <div className="flex gap-2">
              <button onClick={() => setPeriod('week')}
                className={`flex-1 py-2 rounded-lg text-sm ${
                  period === 'week' ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-600'
                }`}>이번 주</button>
              <button onClick={() => setPeriod('month')}
                className={`flex-1 py-2 rounded-lg text-sm ${
                  period === 'month' ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-600'
                }`}>한 달</button>
              <button onClick={() => setPeriod('all')}
                className={`flex-1 py-2 rounded-lg text-sm ${
                  period === 'all' ? 'bg-primary text-white font-bold' : 'bg-gray-100 text-gray-600'
                }`}>전체</button>
            </div>
          </div>

          {renderRanking('⭐ 평균 점수', rankings.avgScore, '점', myRanks.avgScore)}
          {renderRanking('🔥 가장 많이 쓴 학생', rankings.totalSubs, '개', myRanks.totalSubs)}
          {renderRanking('📈 가장 많이 성장한 학생', rankings.improvement, '점↑', myRanks.improvement)}

          <div className="bg-white rounded-2xl p-4 shadow-sm text-xs text-gray-600 leading-relaxed">
            <p className="font-bold mb-1">📋 랭킹 계산 방법</p>
            <ul className="space-y-1 list-disc pl-4">
              <li><strong>평균 점수:</strong> 주제별 최고 점수의 평균 (백분율)</li>
              <li><strong>가장 많이 쓴:</strong> 제출한 글의 총 개수 (수정본 포함)</li>
              <li><strong>가장 많이 성장한:</strong> 수정본 평균 - 첫 글 평균 (점수 향상도)</li>
            </ul>
          </div>
        </main>
      </div>
    </>
  )
}

```

## pages/teacher/feedback-reports.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import { toKST } from '../../lib/timeFormat'
import { displayStudentName } from '../../lib/displayName'

export default function FeedbackReports() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('open') // open / all

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
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

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>피드백 신고함 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">🚨 AI 피드백 신고함</h1>
          </div>

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
                    <button onClick={() => dismissReport(r.id)}
                      className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded">
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

```

## pages/teacher/grammar-backfill.js

```js
import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getFriendlyErrorMessage } from '../../lib/gemini'
import { callAI } from '../../lib/aiClient'
import Header from '../../components/Header'
import { displayStudentName } from '../../lib/displayName'

export default function GrammarBackfill() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [hasApiKey, setHasApiKey] = useState(false)  // 키 서버격리(step153~): class_secrets 기준
  const [topics, setTopics] = useState([])
  const [selectedTopicId, setSelectedTopicId] = useState('')
  const [submissions, setSubmissions] = useState([]) // 선택 주제의 제출물
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '', errors: [] })
  const [logs, setLogs] = useState([])
  const cancelRef = useRef(false)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    // 키 서버격리(step153~): 키 등록 여부만 확인. AI 호출은 서버가 학급 키 조회.
    if (profile.classes?.id) {
      try {
        const { data: keyCheck } = await supabase.from('class_secrets')
          .select('class_id').eq('class_id', profile.classes.id).maybeSingle()
        setHasApiKey(!!keyCheck)
      } catch (e) { setHasApiKey(false) }
    }

    if (profile.classes?.id) {
      const { data: topicList } = await supabase.from('topics')
        .select('id, date, title')
        .eq('teacher_id', profile.id)
        .order('date', { ascending: false })
        .limit(60)
      setTopics(topicList || [])
    }
    setLoading(false)
  }

  // 주제 선택 시 그 주제의 모든 제출물 로드
  const handleTopicChange = async (topicId) => {
    setSelectedTopicId(topicId)
    setSelectedIds(new Set())
    if (!topicId || !classInfo?.id) { setSubmissions([]); return }

    // 우리 반 학생만 (숨김 제외)
    const { data: studs } = await supabase.from('profiles')
      .select('id, realname, nickname, username, number, is_hidden')
      .eq('class_id', classInfo.id).eq('role', 'student')
    const visible = (studs || []).filter(s => !s.is_hidden)
    const ids = visible.map(s => s.id)
    if (ids.length === 0) { setSubmissions([]); return }

    const { data: subs } = await supabase.from('submissions')
      .select('id, user_id, essay_text, corrections, total_score, max_score, attempt, created_at')
      .eq('topic_id', topicId)
      .in('user_id', ids)
      .is('deleted_at', null)
      .order('created_at')

    // 학생 정보 매핑
    const studMap = {}
    visible.forEach(s => { studMap[s.id] = s })
    const enriched = (subs || []).map(s => ({
      ...s,
      student: studMap[s.user_id],
      hasCorrections: Array.isArray(s.corrections) && s.corrections.length > 0
    }))
    setSubmissions(enriched)

    // 기본적으로 "맞춤법 정보 없는 글" 자동 선택
    const autoSelect = new Set(enriched.filter(s => !s.hasCorrections).map(s => s.id))
    setSelectedIds(autoSelect)
  }

  // 체크박스 토글
  const toggleOne = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }
  const selectAll = () => setSelectedIds(new Set(submissions.map(s => s.id)))
  const selectNone = () => setSelectedIds(new Set())
  const selectEmpty = () => setSelectedIds(new Set(submissions.filter(s => !s.hasCorrections).map(s => s.id)))

  // 맞춤법 일괄 적용
  const runBackfill = async () => {
    const targets = submissions.filter(s => selectedIds.has(s.id))
    if (targets.length === 0) return alert('선택된 글이 없어요')

    if (!hasApiKey) {
      alert('Gemini API 키가 설정되지 않았어요.\n주제 관리에서 먼저 API 키를 등록해주세요.')
      return
    }

    if (!confirm(
      `📝 맞춤법 피드백 일괄 추가\n\n` +
      `대상: ${targets.length}개 글\n` +
      `예상 소요 시간: 약 ${Math.ceil(targets.length * 5 / 60)}~${Math.ceil(targets.length * 10 / 60)}분\n` +
      `※ Gemini API 호출 ${targets.length}회 발생\n\n` +
      `점수/의견은 그대로 두고 빨간 밑줄 정보만 추가됩니다.\n` +
      `계속할까요?`
    )) return

    cancelRef.current = false
    setProcessing(true)
    setLogs([])
    setProgress({ done: 0, total: targets.length, current: '', errors: [] })

    let done = 0
    const errors = []

    for (const sub of targets) {
      if (cancelRef.current) {
        addLog('⏸ 중단되었습니다')
        break
      }
      const studentName = displayStudentName(sub.student)
      setProgress(p => ({ ...p, current: `${studentName}의 글 처리 중...`, done }))

      try {
        // 🔒 프롬프트는 서버(/api/ai)에서 구성 — 키 서버격리 + IP 보호
        const result = await callAI('grammarOnly', { essay: sub.essay_text })
        let corrections = Array.isArray(result.corrections) ? result.corrections : []

        // 규칙 기반 보강 (AI가 놓친 .그래서 등 띄어쓰기 추가)
        try {
          const { mergeCorrections } = await import('../../lib/koreanRules')
          corrections = mergeCorrections(corrections, sub.essay_text)
        } catch(e) { console.warn('규칙 검사 실패:', e) }

        // DB 업데이트 (기존 corrections 덮어쓰기)
        const { error } = await supabase.from('submissions')
          .update({ corrections })
          .eq('id', sub.id)
        if (error) throw error

        addLog(`✅ ${studentName}: 맞춤법 ${corrections.length}개 발견`)
        // 로컬 상태도 업데이트
        setSubmissions(prev => prev.map(s =>
          s.id === sub.id ? { ...s, corrections, hasCorrections: corrections.length > 0 } : s
        ))
      } catch(e) {
        const msg = getFriendlyErrorMessage(e)
        errors.push({ name: studentName, error: msg })
        addLog(`❌ ${studentName}: ${msg}`)

        // 429 오류면 잠시 대기
        if (String(e?.message || '').includes('429')) {
          addLog('⏳ API 한도 초과 - 30초 대기 후 재개')
          await sleep(30000)
        }
      }

      done++
      setProgress(p => ({ ...p, done, errors }))

      // API rate limit 보호: 글 간 1.5초 대기
      if (done < targets.length && !cancelRef.current) {
        await sleep(1500)
      }
    }

    setProgress(p => ({ ...p, current: '', done }))
    setProcessing(false)

    const successCount = done - errors.length
    alert(
      `🎉 작업 완료!\n\n` +
      `✅ 성공: ${successCount}개\n` +
      (errors.length > 0 ? `❌ 실패: ${errors.length}개\n\n실패 학생:\n${errors.map(e => `- ${e.name}`).join('\n')}` : '')
    )
  }

  const addLog = (msg) => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString('ko-KR'), msg }].slice(-50))
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms))

  const cancel = () => {
    if (!confirm('지금까지 처리된 결과는 그대로 유지됩니다.\n중단할까요?')) return
    cancelRef.current = true
    addLog('🛑 사용자가 중단 요청')
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  const emptyCount = submissions.filter(s => !s.hasCorrections).length
  const filledCount = submissions.filter(s => s.hasCorrections).length

  return (
    <>
      <Head><title>맞춤법 일괄 적용 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">📝 맞춤법 피드백 일괄 적용</h1>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
            <p className="font-medium mb-1">💡 이 기능은 무엇인가요?</p>
            <p className="text-xs leading-relaxed">
              이전에 작성된 글에 <strong>빨간 밑줄(맞춤법/띄어쓰기) 정보가 빠져있는 경우</strong> 한꺼번에 채워줍니다.
              점수, 종합 의견, 잘한 점, 발전 점 등 <strong>다른 피드백은 그대로 유지</strong>됩니다.
              Gemini API를 호출하므로 글 개수만큼 API 사용량이 발생합니다.
            </p>
          </div>

          {/* 주제 선택 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <label className="block text-xs text-gray-600 mb-1">1️⃣ 주제 선택</label>
            {topics.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">등록된 주제가 없어요</p>
            ) : (
              <select value={selectedTopicId} onChange={e => handleTopicChange(e.target.value)}
                disabled={processing}
                className="w-full p-2 border border-gray-200 rounded-lg text-sm">
                <option value="">-- 주제를 선택하세요 --</option>
                {topics.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.date} · {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedTopicId && (
            <>
              {/* 요약 + 선택 도구 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div className="text-sm">
                    <span className="font-bold">전체 {submissions.length}개</span>
                    {submissions.length > 0 && (
                      <span className="text-gray-500 ml-2">
                        · 맞춤법 있음 <span className="text-green-600">{filledCount}</span>
                        · 없음 <span className="text-amber-600">{emptyCount}</span>
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-primary">
                    선택됨: {selectedIds.size}개
                  </div>
                </div>
                {submissions.length > 0 && !processing && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button onClick={selectAll}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded">전체 선택</button>
                    <button onClick={selectNone}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded">선택 해제</button>
                    <button onClick={selectEmpty}
                      className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded">
                      맞춤법 없는 글만 ({emptyCount}개)
                    </button>
                  </div>
                )}
              </div>

              {/* 글 목록 */}
              {submissions.length === 0 ? (
                <div className="bg-white rounded-2xl p-10 text-center text-gray-500">
                  <p className="text-sm">이 주제에 제출된 글이 없어요</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <h3 className="font-bold mb-3 text-sm">2️⃣ 적용할 글 선택</h3>
                  <div className="space-y-1 max-h-96 overflow-y-auto">
                    {submissions.map(s => {
                      const checked = selectedIds.has(s.id)
                      return (
                        <label key={s.id}
                          className={`flex items-start gap-2 p-2 rounded cursor-pointer text-sm ${
                            checked ? 'bg-blue-50' : 'hover:bg-gray-50'
                          } ${processing ? 'opacity-60 cursor-not-allowed' : ''}`}>
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleOne(s.id)}
                            disabled={processing}
                            className="mt-1 w-4 h-4" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {s.student?.number && (
                                <span className="text-xs text-gray-500 font-mono">{s.student.number}번</span>
                              )}
                              <span className="font-medium">{displayStudentName(s.student)}</span>
                              <span className="text-xs text-gray-500">
                                {(s.attempt || 1) === 1 ? '첫 글' : `수정본 ${s.attempt}`}
                              </span>
                              {s.hasCorrections ? (
                                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                  맞춤법 {s.corrections.length}개
                                </span>
                              ) : (
                                <span className="text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                                  맞춤법 정보 없음
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate mt-0.5">
                              {(s.essay_text || '').slice(0, 80)}
                            </p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 실행 영역 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <h3 className="font-bold mb-3 text-sm">3️⃣ 실행</h3>
                {processing ? (
                  <>
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span>{progress.current || '준비 중...'}</span>
                        <span className="font-mono font-bold">{progress.done} / {progress.total}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-400 to-blue-600 h-full transition-all"
                          style={{width: `${(progress.done / progress.total) * 100}%`}} />
                      </div>
                      <button onClick={cancel}
                        className="w-full py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm font-medium">
                        🛑 중단
                      </button>
                    </div>
                  </>
                ) : (
                  <button onClick={runBackfill}
                    disabled={selectedIds.size === 0}
                    className="w-full py-3 bg-primary text-white rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed">
                    {selectedIds.size > 0
                      ? `🚀 ${selectedIds.size}개 글에 맞춤법 피드백 적용`
                      : '글을 선택해주세요'}
                  </button>
                )}
              </div>

              {/* 로그 */}
              {logs.length > 0 && (
                <div className="bg-gray-900 text-gray-100 rounded-2xl p-4 text-xs font-mono">
                  <div className="font-bold mb-2 text-gray-400">📋 작업 로그</div>
                  <div className="space-y-0.5 max-h-60 overflow-y-auto">
                    {logs.map((l, i) => (
                      <div key={i}>
                        <span className="text-gray-500">[{l.time}]</span> {l.msg}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </>
  )
}

```

## pages/teacher/help.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

export default function TeacherHelp() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openIdx, setOpenIdx] = useState(0)

  useEffect(() => { check() }, [])

  const check = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      router.push('/teacher/login'); return
    }
    setUser(profile)
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  const sections = [
    {
      title: '🚀 처음 시작하기 (5단계)',
      content: [
        { q: '1. 내 정보 입력', a: '메인 화면 → "✏️ 내 정보 수정" 클릭 → 학교명을 목록에서 정확히 선택하세요. 학교명 초성이 학생 아이디 자동 생성에 사용돼요 (학교명 앞 글자의 초성 알파벳이 아이디 앞부분에 들어가요).' },
        { q: '2. 학급 설정', a: '메인 화면 → "⚙️ 학급 설정" 펼치기 → 학년 선택. AI 주제 추천이 학년에 맞게 작동해요. 랭킹 ON/OFF도 여기서 조정.' },
        { q: '3. API 키 발급 + 등록', a: '"🔑 Gemini API 키" 카드 → "발급 방법" 클릭 → 안내대로. 반드시 개인 @gmail.com 계정으로! 받은 키를 학급 API 키 칸에 붙여넣고 저장하면 작동 확인까지 자동으로 돼요.' },
        { q: '4. 학생 등록', a: '"👥 학생 관리" → 나이스에서 받은 학급명렬표 엑셀 그대로 업로드. 아이디 자동 생성 + 닉네임 자동 부여. 초기 비번 모두 123456.' },
        { q: '5. 주제 등록', a: '"📚 주제 관리" → 날짜 + 주제 입력. ▼ 옵션에서 학년/난이도/카테고리 선택 후 AI 추천. 또는 주제만 입력하고 "🤖 자동 생성"으로 평가기준 받기.' },
        { q: '6. 학생들에게 안내', a: '학급 가입 코드 4자리 + 사이트 주소 공유. 학생들은 본인 아이디(자동 생성됨)와 초기 비번 123456으로 로그인.' }
      ]
    },
    {
      title: '👥 학생 관리 사용법',
      content: [
        { q: '나이스 명렬표 그대로 올리는 방법', a: '나이스에서 학급명렬표 엑셀 다운로드 → 그대로 업로드. 학년/반/번호/성명 컬럼만 있으면 됨. 아이디는 자동 생성되고 닉네임도 자동 부여돼요.' },
        { q: '학생 아이디 prefix 변경', a: '명렬표 업로드 후 미리보기 화면에서 "아이디 앞부분(prefix)" 칸 변경. 모든 학생 아이디가 즉시 갱신됩니다. 학생별 개별 수정도 가능.' },
        { q: '학생 비밀번호 잊었을 때', a: '학생 목록의 🔑 버튼 클릭. 빈 칸으로 [확인]하면 123456으로, 임의 비번 입력하면 그 값으로 초기화. 학생에게 새 비번 알려주세요.' },
        { q: '전출생 처리', a: '학생 목록의 🙈 버튼 클릭 → 사유 입력 (선택). 통계/그래프/제출현황에서 자동 제외. 데이터는 보존됨. ↻ 버튼으로 복원 가능.' },
        { q: '닉네임 부여하기', a: '학생 가입 시 자동 부여(예: "용감한 코끼리"). 기존 학생에게 부여하려면 학생 목록 상단의 "🎭 닉네임 일괄 부여" 버튼.' },
        { q: '학부모 동의서 받기', a: '"📋 학부모 동의서" 메뉴 → 인쇄해서 학생편에 보냄. 회신 받으면 학생 목록의 동의서 칸 ✓ 체크. 회신율 표시됨.' }
      ]
    },
    {
      title: '📚 주제 관리 + AI 활용',
      content: [
        { q: 'AI 주제 추천 (다양하게)', a: '주제 관리 → ▼ 옵션 펼치기 → 학년/난이도/카테고리 선택 + 자유 요청. 예: "추석 관련", "환경 보호" 등 자연어로 요청 가능.' },
        { q: '주제만 정해두고 평가기준은 AI에 맡기기', a: '주제 칸에 원하는 주제 입력 → "🤖 위 주제에 맞는 설명+평가기준 자동 생성" 버튼. AI가 주제에 맞춰서 만들어줍니다.' },
        { q: '주제별 제출 현황 보기', a: '"📋 제출 현황" 메뉴 또는 주제 관리에서 주제 클릭. 누가 냈고 누가 안 냈는지 한눈에. 미제출 명단 복사해서 단톡방에 공유 가능.' },
        { q: '주제별 글 보기', a: '"📝 학생 글 보기" 메뉴. 주제 카드 클릭 → 학생들 글 + 점수 + 피드백 + AI 예시 작품 모두 표시. 베껴쓰기 의심도 자동 감지.' },
        { q: '글쓰기 시간 제한', a: '주제 등록 시 "시간 락" 활성화 → 시작/종료 시간 지정. 그 시간에만 쓸 수 있음. 단, 지난 주제(결석 등)는 시간 무관하게 쓸 수 있음.' },
        { q: '학생이 결석해서 못 쓴 주제', a: '학생이 본인 메인 페이지에서 "📚 안 쓴 지난 글" 배너 클릭 → 미제출 주제 선택해서 글쓰기. 지난 주제는 시간 락 무시됨.' }
      ]
    },
    {
      title: '✨ 새로운 기능들',
      content: [
        { q: '📋 제출 현황 페이지', a: '메인 → "📋 제출 현황". 주제 선택 → 제출/미제출 한눈에. 미제출 명단 복사 버튼으로 단톡방 공유. 학생 이름 클릭하면 그 학생 글로 바로 이동.' },
        { q: '📝 맞춤법 일괄 적용', a: '과거 글에 빨간 밑줄 정보가 빠진 경우 사용. 메인 → "📝 맞춤법 일괄 적용" → 주제 선택 → 글 선택 → 실행. 점수/피드백은 그대로 두고 맞춤법만 추가.' },
        { q: '🏆 랭킹 (익명)', a: '학생들이 보는 익명 랭킹. 평균점수/제출량/성장도 3가지. 닉네임만 표시되고 본명 안 보임. 학급 설정에서 OFF 가능.' },
        { q: '🎭 닉네임 시스템', a: '학생 가입 시 자동 부여(예: "푸른 토끼"). 친구들에게는 본명 대신 닉네임으로 보임. 추후 게시판 기능에 활용 예정.' },
        { q: '🚨 베껴쓰기 감지', a: '수정본이 AI 예시 작품과 5글자 이상 연속 일치하면 자동 감지. 30% 이상 노란 경고, 50% 이상 빨간 경고. 학생 글 보기에서 확인 가능.' },
        { q: '📖 학생이 본 AI 예시 확인', a: '학생 글 보기 → 각 글 카드 아래 "📖 AI가 학생에게 보여준 예시 작품" 펼치기. 학생이 본 예시 그대로 확인 가능 (베껴쓰기 검토용).' }
      ]
    },
    {
      title: '❓ 자주 묻는 질문',
      content: [
        { q: 'API 키 발급 시 학교 계정 안 되나요?', a: '네! 학교/회사 Google 계정은 거의 차단돼요. 반드시 개인 @gmail.com 계정으로 발급하세요.' },
        { q: '학생이 비밀번호를 잊어버렸어요', a: '학생 관리에서 🔑 버튼으로 즉시 초기화 가능. 빈 칸으로 [확인]하면 123456으로.' },
        { q: '학생이 학급 코드를 잊어버렸어요', a: '메인 화면에서 학급 코드 다시 알려주거나, "🔄 코드 재발급"으로 새 코드 발급.' },
        { q: '복사 붙여넣기를 한 학생이 있어요', a: '시스템이 자동 감지해서 학생 글 옆에 ⚠️ 복붙 표시. 학생 글 보기에서 확인 가능.' },
        { q: '학생이 한 번 더 수정하고 싶어해요', a: '학생 글 보기 → 해당 학생 수정본 옆 "✏️ 추가 수정 허용" 버튼.' },
        { q: 'AI가 자꾸 오류 나요', a: '대부분 일시적. 1분 후 다시 시도. 계속 안 되면 API 키 확인.' },
        { q: '한도 초과(429) 오류가 나요', a: '대부분 앱이 자동으로 처리해요. 분당 한도에 닿으면 잠깐 기다렸다 자동 재시도하고("잠시만요..." 안내가 학생 화면에 뜸), 일일 한도에 닿으면 다른 모델로 자동 전환돼요. 학생이 시간을 분산할 필요 없이 그대로 두면 곧 처리됩니다. 모든 모델의 일일 한도까지 소진된 드문 경우에만 다음 날 리셋을 기다리면 돼요.' },
        { q: '같은 아이디로 가입했었는데 422 오류가 나요', a: '이미 가입된 계정이에요. "로그인" 탭으로 가서 그 비번으로 로그인하세요. 비번 모르면 학생은 🔑로 초기화, 선생님 본인은 Supabase에서 계정 삭제 후 재가입.' }
      ]
    },
    {
      title: '📝 평가 기준 / 주제 활용 팁',
      content: [
        { q: '평가 기준을 직접 만들어도 되나요?', a: '네, 가능해요. AI 추천 안 눌러도 직접 입력 가능. 합계 100점만 만족하면 됨.' },
        { q: '주제 설명을 어떻게 쓰면 좋을까요?', a: '학생 시선에서 "무엇을 떠올리고", "어떻게 쓰면 좋을지" 구체적 가이드. 질문형보다 안내형이 좋아요.' },
        { q: '한 주제로 며칠 동안 쓸 수 있나요?', a: '주제는 날짜별로 등록되며, 학생은 해당 날짜 주제만 쓸 수 있어요. 단 결석 등으로 못 쓴 지난 주제는 언제든 쓸 수 있음.' },
        { q: '평가 기준 점수 비율 추천', a: '주제 핵심 영역에 35-40점, 다음 25-30점, 다음 15-25점, 맞춤법 10-20점. AI 추천이 자동으로 비율 잡아줘요.' }
      ]
    },
    {
      title: '🔐 보안 / 개인정보',
      content: [
        { q: '학생 글이 어디에 저장되나요?', a: 'Supabase 데이터베이스에 안전하게 저장. 외부 공개되지 않으며, 담임만 볼 수 있어요.' },
        { q: 'AI에 학생 이름이 같이 전송되나요?', a: '아니요. AI에 보낼 때는 글 내용만 보내고, 학생 이름이나 학교명 등 개인정보는 전송하지 않아요.' },
        { q: '학부모 동의가 필요한가요?', a: '네, 필수. "📋 학부모 동의서" 메뉴에서 양식 인쇄해 학부모께 안내. 회신 받은 학생만 ✓ 체크.' },
        { q: '익명 닉네임은 어떻게 작동하나요?', a: '학생 가입 시 "용감한 코끼리" 같은 자동 닉네임 부여. 친구들끼리는 닉네임만 보이고 본명은 가려짐. 선생님만 본명 확인 가능.' },
        { q: '랭킹은 본명이 노출되나요?', a: '아니요. 닉네임만 표시됩니다. 본인 위치만 본인에게 표시. 비교 부담이 걱정되면 학급 설정에서 OFF 가능.' },
        { q: '학생 데이터는 언제 삭제되나요?', a: '학기 종료 후 1년까지 보관 후 자동 삭제. 학부모 요청 시 즉시 삭제 가능.' }
      ]
    },
    {
      title: '⚠️ 문제 해결',
      content: [
        { q: '"403 PERMISSION_DENIED" 오류', a: 'API 키가 차단된 상태. 학교 계정으로 발급한 키일 가능성 높아요. 개인 Gmail로 새 키 발급.' },
        { q: '"429 Too Many Requests" 오류', a: '앱이 자동으로 잠시 기다렸다 재시도하니, 보통 그대로 두면 처리돼요. 시간을 분산할 필요 없어요.' },
        { q: '"503 Service Unavailable" 오류', a: 'Gemini 서버 일시 과부하. 30초~1분 후 재시도하면 보통 풀려요.' },
        { q: '"422" 오류 (회원가입)', a: '대부분 이미 가입된 아이디. "로그인" 탭으로 변경하세요. 또는 비번 6자 미만일 때.' },
        { q: '비밀번호 초기화가 안 돼요', a: '"SUPABASE_SERVICE_ROLE_KEY가 없다"는 메시지면 Vercel 환경변수에 추가 필요. 운영자에게 문의.' },
        { q: '학생 글이 안 보여요', a: '학급 매칭 문제일 수 있음. Supabase Authentication → Users에서 그 학생의 class_id 확인.' },
        { q: '학생이 제출했는데 화면이 멈춰요', a: 'AI 처리 시간(10-30초). 글은 자동 백업되니 새로고침해도 안전.' }
      ]
    }
  ]

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>도움말 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">📖 선생님 도움말</h1>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
            처음 사용하시나요? <strong>"🚀 처음 시작하기"</strong>부터 차례대로 읽어보세요!
          </div>

          {sections.map((section, idx) => (
            <div key={idx} className="bg-white rounded-2xl shadow-sm overflow-hidden">
              <button onClick={() => setOpenIdx(openIdx === idx ? -1 : idx)}
                className="w-full p-4 flex justify-between items-center hover:bg-gray-50 transition">
                <h3 className="font-bold text-base">{section.title}</h3>
                <span className="text-gray-400 text-lg">{openIdx === idx ? '−' : '+'}</span>
              </button>
              {openIdx === idx && (
                <div className="border-t border-gray-100 px-4 py-2 space-y-3">
                  {section.content.map((item, i) => (
                    <div key={i} className="py-3 border-b border-gray-100 last:border-0">
                      <h4 className="font-medium text-sm mb-1 text-gray-900">Q. {item.q}</h4>
                      <p className="text-sm text-gray-700 leading-relaxed pl-3 border-l-2 border-primary-light">{item.a}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-900">
            💬 위 답변에서 해결되지 않는 문제는 메인 화면 우상단 <strong>"💬 의견"</strong> 버튼으로 알려주세요.
          </div>
        </main>
      </div>
    </>
  )
}

```

## pages/teacher/index.js

```js
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
import { SAMPLE_TASTE } from '../../lib/sampleFeedback'
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
                        ? `한도에 가까워졌어요. 자정(한국 시간 ${getKoreanResetTime()})에 자동으로 리셋돼요.`
                        : '사용량이 많아지고 있어요. 자정에 리셋되니 너무 걱정 마세요.'}
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

```

## pages/teacher/login.js

```js
import Head from 'next/head'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { getAuthErrorMessage } from '../../lib/authErrors'
import ConsentForm from '../../components/ConsentForm'
import SchoolAutocomplete from '../../components/SchoolAutocomplete'

// 로컬 스토리지 키
const SAVED_USERNAME_KEY = 'lc-saved-username-teacher'
const NO_AUTO_LOGIN_KEY = 'lc-no-auto-login'
const SESSION_ACTIVE_KEY = 'lc-session-active'

export default function TeacherLogin() {
  const router = useRouter()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [realname, setRealname] = useState('')
  const [password, setPassword] = useState('')
  const [secretCode, setSecretCode] = useState('')
  const [className, setClassName] = useState('')
  const [school, setSchool] = useState('')
  const [schoolCode, setSchoolCode] = useState('')      // step163: 표준학교코드
  const [schoolRegion, setSchoolRegion] = useState('')  // step163: 시도교육청명
  const [signupRole, setSignupRole] = useState('teacher')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('form')
  const [checkingAuth, setCheckingAuth] = useState(true)
  // 새 옵션
  const [saveUsername, setSaveUsername] = useState(false)
  const [autoLogin, setAutoLogin] = useState(true)

  // 🆕 비밀번호 초기화 요청 모달
  const [showResetRequest, setShowResetRequest] = useState(false)
  const [resetForm, setResetForm] = useState({ type: 'find_id', username: '', realname: '', school: '', school_code: '', class_code: '', contact: '' })
  const [resetSubmitting, setResetSubmitting] = useState(false)
  // 🆕 step162/164: 아이디 자동 찾기 결과
  //   ({ status:'found'|'none'|'need_class_code'|'multiple', maskedUsername? } | null)
  const [findResult, setFindResult] = useState(null)
  const [findLoading, setFindLoading] = useState(false)

  const closeResetModal = () => {
    setShowResetRequest(false)
    setFindResult(null)
  }

  // 🆕 step162: 아이디 자동 찾기 (이름+학교 → 마스킹된 아이디 표시)
  const submitFindId = async () => {
    if (!resetForm.realname.trim() || !resetForm.school.trim()) {
      alert('이름과 학교는 꼭 입력해주세요')
      return
    }
    setFindLoading(true)
    setFindResult(null)
    try {
      const resp = await fetch('/api/find-teacher-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          realname: resetForm.realname.trim(),
          school: resetForm.school.trim(),
          school_code: resetForm.school_code || null,
          // step164: 동명이인 2차 확인용 학급 가입코드 (있을 때만 전송)
          class_code: resetForm.class_code.trim() || null,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || '잠시 후 다시 시도해주세요')
      setFindResult(data)
    } catch(e) {
      alert('조회 실패: ' + (e.message || '잠시 후 다시 시도해주세요'))
    }
    setFindLoading(false)
  }

  const submitResetRequest = async () => {
    const isFindId = resetForm.type === 'find_id'
    // 요청 종류별 필수값
    if (isFindId) {
      if (!resetForm.realname.trim() || !resetForm.school.trim()) {
        alert('이름과 학교는 꼭 입력해주세요')
        return
      }
    } else {
      if (!resetForm.username.trim() || !resetForm.realname.trim()) {
        alert('아이디와 이름은 꼭 입력해주세요')
        return
      }
    }
    setResetSubmitting(true)
    try {
      // step156: 스팸 방어를 위해 서버 라우트 경유 (익명 직접 INSERT 차단됨)
      const resp = await fetch('/api/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_type: resetForm.type,
          username: isFindId ? '' : resetForm.username.trim().toLowerCase(),
          realname: resetForm.realname.trim(),
          school: resetForm.school.trim() || null,
          contact: resetForm.contact.trim() || null,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data?.error || '잠시 후 다시 시도해주세요')
      alert(
        isFindId
          ? '✅ 아이디 찾기 요청이 접수됐어요!\n\n' +
            '관리자가 이름·학교로 확인 후\n' +
            '남겨주신 연락 방법으로 아이디를 알려드릴게요.\n\n' +
            '⚠️ 그동안 새로 가입하지 마세요 —\n' +
            '재가입하면 기존 학급·학생·글과 연결이 끊겨요.'
          : '✅ 초기화 요청이 접수됐어요!\n\n' +
            '관리자가 확인 후 임시 비밀번호를 만들어서\n' +
            '남겨주신 연락 방법으로 전달드릴게요.\n\n' +
            '⚠️ 그동안 새로 가입하지 마세요 —\n' +
            '재가입하면 기존 학급·학생·글과 연결이 끊겨요.'
      )
      setShowResetRequest(false)
      setFindResult(null)
      setResetForm({ type: 'find_id', username: '', realname: '', school: '', school_code: '', class_code: '', contact: '' })
    } catch(e) {
      alert('요청 실패: ' + (e.message || '잠시 후 다시 시도해주세요'))
    }
    setResetSubmitting(false)
  }
  // 가입 시 동의 체크 (한 화면에 같이 표시)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(SAVED_USERNAME_KEY)
      if (saved) {
        setUsername(saved)
        setSaveUsername(true)
      }
      const noAuto = localStorage.getItem(NO_AUTO_LOGIN_KEY) === 'true'
      setAutoLogin(!noAuto)
    }
    checkSession()
  }, [])

  const checkSession = async () => {
    try {
      // 자동 로그인 OFF + 새 브라우저 세션 → 강제 로그아웃
      if (typeof window !== 'undefined') {
        const noAutoLogin = localStorage.getItem(NO_AUTO_LOGIN_KEY) === 'true'
        const sessionActive = sessionStorage.getItem(SESSION_ACTIVE_KEY) === 'true'
        if (noAutoLogin && !sessionActive) {
          await supabase.auth.signOut()
          setCheckingAuth(false)
          return
        }
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { data: profile, error: profileErr } = await supabase.from('profiles')
          .select('role, deleted_at').eq('id', session.user.id).maybeSingle()

        // 🆕 자동 복구: 세션은 있는데 profile이 없거나 조회 실패 → 깨끗하게 로그아웃
        if (profileErr || !profile) {
          console.warn('[auto-recovery] 세션은 있지만 profile 없음 → 정리:', profileErr?.message)
          await supabase.auth.signOut()
          setCheckingAuth(false)
          return
        }

        // 🆕 삭제된 계정은 강제 로그아웃
        if (profile.deleted_at) {
          await supabase.auth.signOut()
          setError('이 계정은 관리자에 의해 삭제되었어요.\n관리자에게 문의해주세요.')
          setCheckingAuth(false)
          return
        }

        // 🆕 자동 복구: 역할이 학생 등 잘못된 경우도 정리
        if (profile.role === 'teacher' || profile.role === 'admin') {
          router.replace('/teacher')
          return
        }
        // 그 외 (student 등) → signOut 후 로그인 폼
        console.warn('[auto-recovery] role 불일치 → 정리:', profile.role)
        await supabase.auth.signOut()
      }
    } catch (e) {
      console.error('checkSession 오류 → 깨끗한 상태로 복구:', e)
      try { await supabase.auth.signOut() } catch(_) {}
    }
    setCheckingAuth(false)
  }

  const persistOptions = () => {
    if (typeof window === 'undefined') return
    if (saveUsername && username) {
      localStorage.setItem(SAVED_USERNAME_KEY, username)
    } else {
      localStorage.removeItem(SAVED_USERNAME_KEY)
    }
    if (autoLogin) {
      localStorage.removeItem(NO_AUTO_LOGIN_KEY)
      sessionStorage.removeItem(SESSION_ACTIVE_KEY)
    } else {
      localStorage.setItem(NO_AUTO_LOGIN_KEY, 'true')
      sessionStorage.setItem(SESSION_ACTIVE_KEY, 'true')
    }
  }

  // form onSubmit: 엔터키든 버튼이든 다 여기로
  // setTimeout 0ms: 마지막 onChange의 setState가 반영된 뒤 실행되도록 보장
  const handleFormSubmit = (e) => {
    if (e?.preventDefault) e.preventDefault()
    if (loading) return
    setTimeout(() => {
      if (mode === 'signup') {
        if (!username || !password || !realname || !className || !secretCode || !school) {
          setError('모든 항목을 입력해주세요')
          return
        }
        if (password.length < 6) {
          setError('비밀번호는 6자 이상이어야 해요')
          return
        }
        if (!agreeTerms || !agreePrivacy) {
          setError('이용약관과 개인정보처리방침에 동의해주세요')
          return
        }
        handleSubmit()
      } else {
        handleSubmit()
      }
    }, 0)
  }

  // 추가 안전망: input에서 엔터 직접 캐치
  const handleEnter = (e) => {
    if (e.key !== 'Enter') return
    if (e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    handleFormSubmit(e)
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError('')
    const email = `${username.toLowerCase()}@writing.class`

    try {
      if (mode === 'login') {
        const { data: loginData, error: err } = await supabase.auth.signInWithPassword({ email, password })
        if (err) throw err
        
        const { data: profile } = await supabase.from('profiles').select('role, realname, is_banned').eq('id', loginData.user.id).maybeSingle()
        
        if (!profile) {
          await supabase.auth.signOut()
          throw new Error('회원 정보를 찾을 수 없어요. 가입을 먼저 해주세요.')
        }
        
        if (profile.is_banned) {
          await supabase.auth.signOut()
          throw new Error('이 계정은 관리자에 의해 차단되었어요. 문의: 사이트 운영자')
        }
        
        if (profile.role === 'student') {
          await supabase.auth.signOut()
          throw new Error(`이 계정은 학생 계정이에요!\n\n${profile.realname}님, "🎒 학생이에요" 버튼으로 다시 들어가주세요.`)
        }
        
        if (profile.role !== 'teacher' && profile.role !== 'admin') {
          await supabase.auth.signOut()
          throw new Error('선생님/관리자 권한이 없는 계정이에요.')
        }
        
        persistOptions()
        router.push('/teacher')
      } else {
        const codeRes = await fetch('/api/verify-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: secretCode, role: signupRole })
        })
        if (!codeRes.ok) {
          const data = await codeRes.json()
          throw new Error(data.error || '가입 코드가 잘못됐어요')
        }

        // admin 중복가입 확인은 /api/verify-code(서버)에서 수행 (step148 RLS로 이동)

        const { data, error: err } = await supabase.auth.signUp({ email, password })
        if (err) {
          if (err.message.includes('already')) throw new Error('이미 가입된 아이디예요')
          throw err
        }

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

        const { data: newClass, error: classErr } = await supabase.from('classes')
          .insert({ name: className.trim(), code: newCode, teacher_id: data.user.id, school: school.trim(), school_code: schoolCode || null })
          .select().single()
        if (classErr) throw new Error('학급 생성 실패: ' + classErr.message)

        await supabase.from('profiles').insert({
          id: data.user.id, username: username.toLowerCase(), realname: realname.trim(), school: school.trim(),
          school_code: schoolCode || null, school_region: schoolRegion || null, role: signupRole, class_id: newClass.id
        })

        persistOptions()
        router.push('/teacher')
      }
    } catch(e) {
      const errMsg = getAuthErrorMessage(e, mode === 'signup' ? 'signup' : 'teacherLogin')
      setError(errMsg)
      setLoading(false)
    }
  }

  if (checkingAuth) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500 text-sm">로딩 중...</div></div>

  return (
    <>
      <Head><title>선생님 로그인 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-md mx-auto flex items-center gap-3">
            <Link href="/" className="text-gray-600 hover:text-gray-900">←</Link>
            <h1 className="text-base font-bold">선생님 로그인</h1>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="text-center mb-6">
              <div className="text-5xl mb-2">👩‍🏫</div>
              <h2 className="text-xl font-bold">{mode === 'login' ? '선생님 로그인' : '선생님 가입'}</h2>
            </div>

            <div className="flex gap-2 mb-6 bg-gray-100 rounded-xl p-1">
              <button type="button" onClick={() => { setMode('login'); setError(''); setStep('form'); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'login' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                로그인
              </button>
              <button type="button" onClick={() => { setMode('signup'); setError(''); setStep('form'); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode === 'signup' ? 'bg-white shadow-sm' : 'text-gray-600'}`}>
                회원가입
              </button>
            </div>

            <div className="space-y-3">
                {mode === 'signup' && (
                  <>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 leading-relaxed">
                      👋 처음 오셨나요? 아래 정보를 채우면 <strong>나만의 학급</strong>이 만들어져요.
                      가입 후 학생 등록 → API 키 등록 순서로 안내해드릴게요.
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">가입 유형</label>
                      <select value={signupRole} onChange={e => setSignupRole(e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-lg">
                        <option value="teacher">담임 교사</option>
                        <option value="admin">관리자 (운영자)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        💡 대부분 <strong>담임 교사</strong>예요. 관리자는 앱 운영자만 선택하세요.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        {signupRole === 'admin' ? '관리자 코드' : '교사 가입 코드'}
                      </label>
                      <input type="password" value={secretCode} onChange={e => setSecretCode(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="가입 코드" />
                      <p className="text-xs text-gray-500 mt-1">
                        💡 앱을 소개해준 분(운영자)에게 받은 코드예요. 모르면 운영자에게 문의하세요.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">이름</label>
                      <input type="text" value={realname} onChange={e => setRealname(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="실명 (예: 김선생)" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">학교명</label>
                      <SchoolAutocomplete
                        value={school}
                        onChange={({ school: s, school_code, school_region }) => {
                          setSchool(s); setSchoolCode(school_code || ''); setSchoolRegion(school_region || '')
                        }}
                        onEnter={handleEnter}
                        placeholder="학교명 입력 후 목록에서 선택"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        💡 학교명을 입력하면 목록이 떠요. 목록에서 고르면 나중에 아이디·비밀번호 찾기가 정확해져요. 안 나오면 직접 입력해도 돼요.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">학급 이름</label>
                      <input type="text" value={className} onChange={e => setClassName(e.target.value)}
                        onKeyDown={handleEnter}
                        className="w-full p-3 border border-gray-200 rounded-lg" placeholder="예: 5학년 1반" />
                      <p className="text-xs text-gray-500 mt-1">
                        💡 가입하면 이 학급이 자동으로 만들어져요. 나중에 학급을 더 추가할 수도 있어요.
                      </p>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">아이디</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg" placeholder="영문 아이디 (예: kim2024)" autoComplete="username" />
                  {mode === 'signup' && (
                    <p className="text-xs text-gray-500 mt-1">
                      💡 영문·숫자로 짧고 기억하기 쉽게. 로그인할 때 매번 쓰는 아이디예요.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">비밀번호</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    onKeyDown={handleEnter}
                    className="w-full p-3 border border-gray-200 rounded-lg" placeholder={mode === 'signup' ? '6자 이상' : '비밀번호'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                  {mode === 'signup' && (
                    <p className="text-xs text-gray-500 mt-1">
                      💡 잊지 않도록 기억해주세요. 잊으면 운영자가 초기화해드려요.
                    </p>
                  )}
                </div>

                {/* 옵션 체크박스 (로그인 모드일 때만) */}
                {mode === 'login' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saveUsername}
                        onChange={e => setSaveUsername(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span>아이디 저장</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoLogin}
                        onChange={e => setAutoLogin(e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span>자동 로그인</span>
                    </label>
                  </div>
                )}

                {/* 가입 모드: 동의 체크박스 (한 화면에 같이) */}
                {mode === 'signup' && (
                  <div className="space-y-2 pt-2 border-t border-gray-100">
                    <p className="text-xs text-gray-600">가입 전 동의해주세요</p>
                    <label className="flex items-center gap-2 p-2 bg-gray-50 rounded font-medium text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agreeTerms && agreePrivacy}
                        onChange={() => {
                          const all = !(agreeTerms && agreePrivacy)
                          setAgreeTerms(all); setAgreePrivacy(all)
                        }}
                        className="w-4 h-4"
                      />
                      <span>모두 동의합니다 (필수)</span>
                    </label>
                    <div className="space-y-1.5 px-1">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agreeTerms}
                          onChange={e => setAgreeTerms(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span>
                          (필수) <Link href="/terms" target="_blank" className="text-primary underline">이용약관</Link>에 동의합니다
                        </span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agreePrivacy}
                          onChange={e => setAgreePrivacy(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span>
                          (필수) <Link href="/privacy" target="_blank" className="text-primary underline">개인정보처리방침</Link>에 동의합니다
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded whitespace-pre-line border border-red-200">{error}</div>}
                <button
                  type="button"
                  onClick={handleFormSubmit}
                  disabled={loading}
                  className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark disabled:opacity-50"
                >
                  {loading ? '처리 중...' : (mode === 'login' ? '로그인' : '가입하기')}
                </button>
              </div>

            <div className="mt-4 text-center space-y-1.5">
              {/* 로그인·가입 양쪽 표시(단일 정의) — 아이디 잊은 교사의 재가입(빈 계정 생성·기존 학급 고아화) 방지 */}
              <p className="text-xs text-gray-500">
                {mode === 'signup' ? (
                  <>이미 계정이 있으신가요? 새로 가입하면 <span className="text-amber-700">기존 학급·학생·글과 연결이 끊겨요.</span>{' '}아이디를 잊으셨다면{' '}</>
                ) : (
                  <>🔑 아이디 또는 비밀번호를 잊으셨나요?{' '}</>
                )}
                <button
                  type="button"
                  onClick={() => setShowResetRequest(true)}
                  className="text-blue-600 font-medium underline hover:text-blue-800">
                  {mode === 'signup' ? '아이디·비밀번호 찾기' : '찾기 요청하기'}
                </button>
                {mode === 'login' && (
                  <>
                    <br />
                    <span className="text-amber-700">재가입하지 마세요</span>
                    <span className="text-gray-400"> — 기존 학급·학생·글과 연결이 끊겨요.</span>
                  </>
                )}
              </p>
              <Link href="/api-key-guide" className="text-xs text-gray-500 hover:text-primary inline-block">
                Gemini API 키 발급 방법 →
              </Link>
            </div>
          </div>
        </main>

        {/* 🆕 비밀번호 초기화 요청 모달 */}
        {showResetRequest && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => !resetSubmitting && !findLoading && closeResetModal()}>
            <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3 shadow-2xl"
              onClick={e => e.stopPropagation()}>
              <h3 className="font-bold text-gray-900">🔑 아이디 / 비밀번호 찾기</h3>

              {/* 요청 종류 선택 (아이디 찾기 먼저) */}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => { setResetForm({ ...resetForm, type: 'find_id' }); setFindResult(null) }}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold ${resetForm.type === 'find_id' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'}`}>
                  🔍 아이디 찾기
                </button>
                <button
                  type="button"
                  onClick={() => { setResetForm({ ...resetForm, type: 'reset_password' }); setFindResult(null) }}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold ${resetForm.type !== 'find_id' ? 'bg-white text-primary shadow-sm' : 'text-gray-500'}`}>
                  🔑 비밀번호 초기화
                </button>
              </div>

              <p className="text-xs text-gray-500 leading-relaxed">
                {resetForm.type === 'find_id'
                  ? '이름·학교를 넣으면 바로 아이디 일부를 보여드려요. 가입할 때 쓴 이름·학교를 정확히 입력해주세요.'
                  : '관리자가 확인 후 임시 비밀번호를 만들어 전달해드려요. 본인 확인을 위해 가입할 때 쓴 정보를 입력해주세요.'}
              </p>

              {/* 아이디 찾기일 때는 아이디 입력칸 숨김 */}
              {resetForm.type !== 'find_id' && (
                <input
                  type="text"
                  placeholder="아이디 (필수)"
                  value={resetForm.username}
                  onChange={e => setResetForm({ ...resetForm, username: e.target.value })}
                  className="w-full p-3 border border-gray-200 rounded-lg text-sm"
                />
              )}
              <input
                type="text"
                placeholder="이름 (필수)"
                value={resetForm.realname}
                onChange={e => { setResetForm({ ...resetForm, realname: e.target.value }); if (findResult) setFindResult(null) }}
                className="w-full p-3 border border-gray-200 rounded-lg text-sm"
              />
              <SchoolAutocomplete
                value={resetForm.school}
                onChange={({ school: s, school_code, school_region }) => {
                  setResetForm(prev => ({ ...prev, school: s, school_code: school_code || '' }))
                  if (findResult) setFindResult(null)
                }}
                placeholder={resetForm.type === 'find_id' ? '학교 (필수) — 목록에서 선택' : '학교 (선택)'}
                inputClassName="w-full p-3 border border-gray-200 rounded-lg text-base"
              />

              {/* 비번 초기화 요청에만 연락처 입력 (아이디 찾기는 자동 표시라 불필요) */}
              {resetForm.type !== 'find_id' && (
                <>
                  <input
                    type="text"
                    placeholder="연락받을 방법 (예: 카톡 ID, 이메일 등)"
                    value={resetForm.contact}
                    onChange={e => setResetForm({ ...resetForm, contact: e.target.value })}
                    className="w-full p-3 border border-gray-200 rounded-lg text-sm"
                  />
                  <p className="text-[11px] text-gray-400">
                    연락 방법을 안 남기면 함께 아는 분(동료 선생님 등)을 통해 전달될 수 있어요.
                  </p>
                </>
              )}

              {/* 🆕 step162/164: 아이디 자동 찾기 결과 */}
              {resetForm.type === 'find_id' && findResult && (
                <div className="border-t border-gray-100 pt-3 text-sm">
                  {findResult.status === 'found' && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-gray-700 text-xs mb-1">회원님의 아이디예요 (보안을 위해 일부만 표시)</p>
                      <p className="font-mono font-bold text-lg text-green-800 tracking-wide">{findResult.maskedUsername}</p>
                      <p className="text-[11px] text-gray-500 mt-1">전체 아이디가 기억나지 않으면 가운데 글자를 떠올려보세요. 그래도 모르면 아래 "관리자에게 요청"을 눌러주세요.</p>
                    </div>
                  )}
                  {/* 🆕 step164: 동명이인 — 학급 가입코드 2차 확인 */}
                  {findResult.status === 'need_class_code' && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                      <p className="text-xs text-blue-800">
                        같은 이름의 선생님이 있어요. 본인 학급의 <strong>가입코드</strong>(학생에게 나눠준 4자리 코드)를 입력해주세요.
                      </p>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="학급 가입코드 4자리"
                        value={resetForm.class_code}
                        onChange={e => setResetForm({ ...resetForm, class_code: e.target.value.replace(/[^0-9]/g, '') })}
                        className="w-full p-2.5 border border-blue-200 rounded-lg text-sm tracking-widest"
                      />
                      <button
                        onClick={submitFindId}
                        disabled={findLoading || resetForm.class_code.trim().length < 4}
                        className="w-full py-2 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                        {findLoading ? '확인 중...' : '이 코드로 확인'}
                      </button>
                    </div>
                  )}
                  {findResult.status === 'none' && (
                    <p className="text-red-600 text-xs">일치하는 계정이 없어요. 이름·학교를 가입할 때처럼 정확히 입력했는지 확인해주세요.</p>
                  )}
                  {findResult.status === 'multiple' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                      입력한 가입코드로 본인 학급을 확인하지 못했어요. 코드를 다시 확인하시거나, 아래 "관리자에게 요청"을 눌러주시면 관리자가 확인 후 알려드려요.
                    </div>
                  )}
                  {(findResult.status === 'none' || findResult.status === 'multiple') && (
                    <button
                      onClick={submitResetRequest}
                      disabled={resetSubmitting}
                      className="mt-2 w-full py-2.5 border border-primary text-primary rounded-lg text-sm font-semibold disabled:opacity-50">
                      {resetSubmitting ? '접수 중...' : '관리자에게 요청하기'}
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={closeResetModal}
                  disabled={resetSubmitting || findLoading}
                  className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm disabled:opacity-50">
                  {findResult?.status === 'found' ? '닫기' : '취소'}
                </button>
                {resetForm.type === 'find_id' ? (
                  <button
                    onClick={submitFindId}
                    disabled={findLoading}
                    className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {findLoading ? '찾는 중...' : '아이디 찾기'}
                  </button>
                ) : (
                  <button
                    onClick={submitResetRequest}
                    disabled={resetSubmitting}
                    className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                    {resetSubmitting ? '접수 중...' : '요청 보내기'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

```

## pages/teacher/parent-consent.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import ConsentDocument from '../../components/ConsentDocument'

export default function ParentConsent() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(name)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
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
            <button onClick={printDoc} className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium">
              🖨️ 인쇄하기 (A4 한 장)
            </button>
          </div>
        </div>

        <main className="max-w-3xl mx-auto px-4 py-6">
          {/* 공용 양식 컴포넌트 — props 없이 빈 양식(기존 종이 인쇄와 동일) */}
          <ConsentDocument school={user.school} className={classInfo?.name} />
        </main>
      </div>
    </>
  )
}

```

## pages/teacher/record.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import { getFriendlyErrorMessage } from '../../lib/gemini'
import { callAI } from '../../lib/aiClient'
import Header from '../../components/Header'
import { displayStudentName } from '../../lib/displayName'

async function loadSummaries(studentId) {
  const { data } = await supabase.from('submissions')
    .select('id, topic_title, total_score, max_score, feedback_overall, feedback_good, feedback_improve, attempt, created_at, topic_id')
    .eq('user_id', studentId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  const byTopic = {}
  ;(data || []).forEach(s => {
    const k = s.topic_id || s.id
    if (!byTopic[k] || (s.attempt || 1) >= (byTopic[k].attempt || 1)) byTopic[k] = s
  })
  return Object.values(byTopic).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
}

function autoLevel(subs) {
  if (!subs.length) return ''
  const ratios = subs.map(s => (s.total_score ?? 0) / (s.max_score || 100))
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length
  return avg >= 0.9 ? '매우잘함' : avg >= 0.7 ? '잘함' : avg >= 0.5 ? '보통' : '노력요함'
}

function toSummaries(subs) {
  return subs.map(s => ({
    title: s.topic_title || '글',
    score: s.total_score ?? 0,
    max: s.max_score ?? 100,
    overall: s.feedback_overall || '',
    good: s.feedback_good || '',
    improve: s.feedback_improve || ''
  }))
}

export default function RecordPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [hasApiKey, setHasApiKey] = useState(false)  // 키 서버격리(step153~): class_secrets 기준
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [gradeText, setGradeText] = useState('초등학교')

  const [standards, setStandards] = useState('')
  const [copied, setCopied] = useState('')

  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, current: '' })
  const [batchResults, setBatchResults] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())  // 평어 만들 학생 선택

  const [showSingle, setShowSingle] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [subs, setSubs] = useState([])
  const [level, setLevel] = useState('')
  const [generating, setGenerating] = useState(false)
  const [single, setSingle] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles')
      .select('*, classes:class_id(id, name, code, grade, school)')
      .eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    // 키 서버격리(step153~): 키 등록 여부만 확인. AI 호출은 서버가 학급 키 조회.
    if (profile.classes?.id) {
      try {
        const { data: keyCheck } = await supabase.from('class_secrets')
          .select('class_id').eq('class_id', profile.classes.id).maybeSingle()
        setHasApiKey(!!keyCheck)
      } catch (e) { setHasApiKey(false) }
    }

    let gt = '초등학교'
    if (profile.classes?.grade) gt = `초등학교 ${profile.classes.grade}학년`
    else if (profile.classes?.name) {
      const m = profile.classes.name.match(/(\d)\s*학년/); if (m) gt = `초등학교 ${m[1]}학년`
    }
    setGradeText(gt)

    const { data: studs } = await supabase.from('profiles')
      .select('id, realname, nickname, username, number, is_hidden')
      .eq('class_id', profile.classes?.id).eq('role', 'student')
    const visible = (studs || []).filter(s => !s.is_hidden)
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999))
    setStudents(visible)

    // 저장된 평어 불러오기 (토큰 없이 복원)
    try {
      const { data: saved } = await supabase.from('school_records')
        .select('student_id, sentences, level')
        .eq('teacher_id', profile.id)
      if (saved && saved.length > 0) {
        const savedMap = {}
        saved.forEach(r => { savedMap[r.student_id] = r })
        const restored = visible
          .filter(s => savedMap[s.id])
          .map(s => ({
            student: s,
            sentences: savedMap[s.id].sentences || [],
            level: savedMap[s.id].level || '',
            fromSaved: true
          }))
        if (restored.length > 0) setBatchResults(restored)
      }
    } catch (e) { /* 테이블 없으면 조용히 무시 */ }

    setLoading(false)
  }

  // 체크박스 토글
  const toggleStudent = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    if (selectedIds.size === students.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(students.map(s => s.id)))
  }

  const runBatch = async () => {
    if (!hasApiKey) { alert('학급 API 키가 설정되어 있지 않아요. 설정에서 등록해주세요.'); return }
    const targets = students.filter(s => selectedIds.has(s.id))
    if (targets.length === 0) { alert('평어를 만들 학생을 먼저 선택해주세요.'); return }
    if (!confirm(`선택한 학생 ${targets.length}명의 평어를 만들까요?\n\n· AI를 학생 수만큼 호출해요\n· 글이 없는 학생은 건너뜁니다`)) return

    setBatchRunning(true)
    setBatchProgress({ done: 0, total: targets.length, current: '' })

    // 기존 결과를 맵으로 (선택 안 한 학생 평어는 유지)
    const merged = {}
    batchResults.forEach(r => { merged[r.student.id] = r })

    for (let i = 0; i < targets.length; i++) {
      const stu = targets[i]
      setBatchProgress({ done: i, total: targets.length, current: displayStudentName(stu) })
      try {
        const studentSubs = await loadSummaries(stu.id)
        if (studentSubs.length === 0) {
          merged[stu.id] = { student: stu, sentences: [], level: '', skipped: true }
        } else {
          const lv = autoLevel(studentSubs)
          const r = await callAI('schoolRecord', {
            gradeText, summaries: toSummaries(studentSubs), level: lv, standards, count: 2
          })
          merged[stu.id] = { student: stu, sentences: r.sentences || [], level: lv }
          try {
            await supabase.from('school_records').upsert({
              student_id: stu.id, teacher_id: user.id,
              sentences: r.sentences || [], level: lv, standards, created_at: new Date().toISOString()
            }, { onConflict: 'student_id' })
          } catch (e) { /* 저장 실패 무시 */ }
        }
      } catch (e) {
        merged[stu.id] = { student: stu, sentences: [], error: getFriendlyErrorMessage ? getFriendlyErrorMessage(e) : (e.message || '실패') }
      }
      // 학생 번호순으로 정렬해서 표시
      const ordered = students.filter(s => merged[s.id]).map(s => merged[s.id])
      setBatchResults(ordered)
    }
    setBatchProgress({ done: targets.length, total: targets.length, current: '' })
    setBatchRunning(false)
    setSelectedIds(new Set())  // 생성 후 선택 해제
  }

  const pickStudent = async (id) => {
    setSelectedId(id); setSingle(null); setError('')
    if (!id) { setSubs([]); setLevel(''); return }
    const studentSubs = await loadSummaries(id)
    setSubs(studentSubs)
    setLevel(autoLevel(studentSubs))
  }

  const genSingle = async () => {
    setError(''); setSingle(null)
    if (subs.length === 0) { setError('이 학생의 글 기록이 없어요.'); return }
    if (!hasApiKey) { setError('학급 API 키가 설정되어 있지 않아요.'); return }
    setGenerating(true)
    try {
      const r = await callAI('schoolRecord', {
        gradeText, summaries: toSummaries(subs), level, standards, count: 4
      })
      setSingle(r)
    } catch (e) {
      setError(getFriendlyErrorMessage ? getFriendlyErrorMessage(e) : (e.message || '생성 중 오류'))
    }
    setGenerating(false)
  }

  const copy = async (text, k) => {
    try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1500) } catch {}
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-500">불러오는 중...</p></div>
  }

  return (
    <>
      <Head><title>생기부 평어 도우미 · 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} />
        <main className={`mx-auto px-4 py-6 sm:py-8 transition-all ${batchResults.length > 0 ? 'max-w-6xl' : 'max-w-3xl'}`}>
          <div className="mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">📝 생기부 평어 도우미</h1>
            <p className="text-sm text-gray-600 mt-1">
              학생을 선택해 한 문장 평어를 만들고, 골라서 바로 붙여넣으세요.
              초안이니 <strong>반드시 교사가 검토·수정</strong>한 뒤 사용하세요.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-5 shadow-sm mb-5">
            <label className="block text-sm font-semibold text-gray-800 mb-1">
              성취기준 <span className="text-gray-400 font-normal">(선택 · 입력하면 이 기준에 근거해 평어를 작성해요)</span>
            </label>
            <textarea
              value={standards}
              onChange={e => setStandards(e.target.value)}
              rows={2}
              placeholder={'예) [6국03-04] 적절한 근거와 알맞은 표현을 사용하여 주장하는 글을 쓴다.\n비워두면 글쓰기 능력 중심으로 작성돼요.'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
            <button
              onClick={runBatch}
              disabled={batchRunning || selectedIds.size === 0}
              className="mt-3 w-full sm:w-auto bg-primary text-white px-6 py-3 rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors"
            >
              {batchRunning
                ? `만드는 중... (${batchProgress.done}/${batchProgress.total})`
                : `✨ 선택한 학생 평어 만들기 (${selectedIds.size}명)`}
            </button>
          </div>

          {/* 학생 선택 (체크박스) */}
          <div className="bg-white rounded-2xl p-5 shadow-sm mb-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800">학생 선택</h3>
              <button onClick={toggleAll} className="text-xs text-primary hover:underline">
                {selectedIds.size === students.length ? '전체 해제' : '전체 선택'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {students.map(s => {
                const checked = selectedIds.has(s.id)
                const hasSaved = batchResults.find(r => r.student.id === s.id && !r.skipped && !r.error)
                return (
                  <label key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${checked ? 'border-primary bg-primary/5' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleStudent(s.id)} className="accent-primary" />
                    <span className="truncate">{s.number ? `${s.number}번 ` : ''}{displayStudentName(s)}</span>
                    {hasSaved && <span className="ml-auto text-[10px] text-green-600">●</span>}
                  </label>
                )
              })}
            </div>
            {batchResults.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">● 표시: 평어가 이미 만들어진 학생 (다시 만들려면 체크 후 생성)</p>
            )}
          </div>

          {batchRunning && (
            <div className="bg-white rounded-2xl p-4 shadow-sm mb-5">
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="bg-primary h-full transition-all" style={{ width: `${batchProgress.total ? (batchProgress.done / batchProgress.total * 100) : 0}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {batchProgress.current ? `${batchProgress.current} 작성 중...` : '준비 중...'} ({batchProgress.done}/{batchProgress.total})
              </p>
            </div>
          )}

          {batchResults.length > 0 && (
            <>
            <div className="space-y-2 mb-6">
              {batchResults.map(({ student, sentences, level: lv, error: err, skipped }) => (
                <div key={student.id} className="bg-white rounded-xl p-3 shadow-sm flex flex-col sm:flex-row sm:items-stretch gap-3">
                  {/* 이름 (왼쪽 고정폭) */}
                  <div className="sm:w-32 sm:flex-shrink-0 flex sm:flex-col sm:justify-center gap-1">
                    <h3 className="text-sm font-bold text-gray-900">
                      {student.number ? `${student.number}번 ` : ''}{displayStudentName(student)}
                    </h3>
                    {lv && <span className="text-[11px] text-gray-400">{lv}</span>}
                  </div>
                  {/* 평어들 (오른쪽 가로 배치) */}
                  {skipped ? (
                    <p className="text-xs text-gray-400 self-center">쓴 글이 없어 건너뜀</p>
                  ) : err ? (
                    <p className="text-xs text-red-500 self-center">{err}</p>
                  ) : (
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                      {sentences.map((sent, i) => (
                        <button
                          key={i}
                          onClick={() => copy(sent, `${student.id}-${i}`)}
                          className="text-left text-sm text-gray-800 bg-gray-50 hover:bg-primary/10 border border-gray-200 rounded-lg px-3 py-2.5 transition-colors flex items-start justify-between gap-2 group"
                        >
                          <span className="leading-relaxed break-keep">{sent}</span>
                          <span className="text-[11px] text-gray-400 group-hover:text-primary whitespace-nowrap mt-0.5">
                            {copied === `${student.id}-${i}` ? '✓' : '복사'}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 leading-relaxed mb-6 -mt-3">
              ⚠️ AI가 만든 <strong>초안</strong>이에요. 학생을 가장 잘 아는 선생님이 사실과 다른 부분을 고치고 실제 관찰을 더해 완성해주세요.
            </div>
            </>
          )}

          <details className="bg-white rounded-2xl shadow-sm" open={showSingle} onToggle={e => setShowSingle(e.target.open)}>
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-gray-700 select-none">
              🔍 학생 한 명 자세히 보기 (평어 더 많이)
            </summary>
            <div className="px-5 pb-5 space-y-4">
              <select
                value={selectedId}
                onChange={e => pickStudent(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="">— 학생 선택 —</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>{s.number ? `${s.number}번 ` : ''}{displayStudentName(s)}</option>
                ))}
              </select>

              {selectedId && subs.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-600">글 {subs.length}편 · 평균 {Math.round(subs.reduce((a, s) => a + (s.total_score ?? 0), 0) / subs.length)}점</span>
                  <label className="text-sm text-gray-700 ml-2">수준:</label>
                  <select value={level} onChange={e => setLevel(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm">
                    <option value="매우잘함">매우잘함</option>
                    <option value="잘함">잘함</option>
                    <option value="보통">보통</option>
                    <option value="노력요함">노력요함</option>
                  </select>
                  <button onClick={genSingle} disabled={generating} className="bg-primary text-white px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50">
                    {generating ? '작성 중...' : '평어 만들기'}
                  </button>
                </div>
              )}
              {selectedId && subs.length === 0 && <p className="text-sm text-gray-400">이 학생은 쓴 글이 없어요.</p>}
              {error && <p className="text-sm text-red-600">{error}</p>}

              {single && Array.isArray(single.sentences) && (
                <div>
                  <ul className="space-y-2">
                    {single.sentences.map((sent, i) => (
                      <li key={i}>
                        <button
                          onClick={() => copy(sent, `single-${i}`)}
                          className="w-full text-left text-sm text-gray-800 bg-gray-50 hover:bg-primary/10 border border-gray-200 rounded-lg px-3 py-2.5 transition-colors flex items-start justify-between gap-2 group"
                        >
                          <span className="leading-relaxed break-keep">{sent}</span>
                          <span className="text-[11px] text-gray-400 group-hover:text-primary whitespace-nowrap mt-0.5">
                            {copied === `single-${i}` ? '✓ 복사됨' : '복사'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {(single.strengths || single.growth) && (
                    <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900">
                      {single.strengths && <p><strong>강점:</strong> {single.strengths}</p>}
                      {single.growth && <p className="mt-1"><strong>성장:</strong> {single.growth}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>
        </main>
      </div>
    </>
  )
}

```

## pages/teacher/status.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import { displayStudentName } from '../../lib/displayName'

// 한국 시간 기준 오늘 날짜
function todayStr() {
  const now = new Date()
  const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
  return kst.toISOString().slice(0, 10)
}

export default function SubmissionStatus() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [topics, setTopics] = useState([])
  const [selectedTopicId, setSelectedTopicId] = useState('')
  const [students, setStudents] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name, school)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    if (profile.classes?.id) {
      // 주제 목록 (최근 30개)
      const { data: topicList } = await supabase.from('topics')
        .select('id, date, title')
        .eq('teacher_id', profile.id)
        .order('date', { ascending: false })
        .limit(30)
      setTopics(topicList || [])

      // 오늘 주제를 기본 선택
      const today = todayStr()
      const todayTopic = (topicList || []).find(t => t.date === today)
      const initialId = todayTopic ? todayTopic.id : (topicList?.[0]?.id || '')
      setSelectedTopicId(initialId)

      // 학급 학생 목록 (숨김 제외)
      const { data: studentList } = await supabase.from('profiles')
        .select('id, realname, nickname, username, number, is_hidden')
        .eq('class_id', profile.classes.id).eq('role', 'student')
      const visibleStudents = (studentList || []).filter(s => !s.is_hidden)
      setStudents(visibleStudents)

      // 선택된 주제의 제출 목록 로드
      if (initialId && visibleStudents.length > 0) {
        await loadSubmissions(initialId, visibleStudents)
      }
    }
    setLoading(false)
  }

  const loadSubmissions = async (topicId, studentList = students) => {
    const studentIds = studentList.map(s => s.id)
    if (studentIds.length === 0) { setSubmissions([]); return }

    const { data: subs } = await supabase.from('submissions')
      .select('id, user_id, total_score, max_score, created_at, attempt, reported, teacher_comment')
      .eq('topic_id', topicId)
      .in('user_id', studentIds)
      .is('deleted_at', null)
    setSubmissions(subs || [])
  }

  const handleTopicChange = async (topicId) => {
    setSelectedTopicId(topicId)
    if (topicId) await loadSubmissions(topicId)
  }

  // 미제출 학생 명단을 클립보드에 복사
  const copyAbsentList = (list, label = '미제출') => {
    if (list.length === 0) return alert(`${label} 학생이 없어요!`)
    const text = list
      .map(s => `${s.number ? s.number + '번 ' : ''}${displayStudentName(s)}`)
      .join(', ')
    navigator.clipboard.writeText(text)
      .then(() => alert(`📋 ${list.length}명의 명단이 복사됐어요!\n\n${text}`))
      .catch(() => prompt('아래 내용을 복사해주세요:', text))
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  // 제출/미제출 분류
  const submittedUserIds = new Set(submissions.map(s => s.user_id))
  const submitted = students.filter(s => submittedUserIds.has(s.id))
  const absent = students.filter(s => !submittedUserIds.has(s.id))
  const selectedTopic = topics.find(t => t.id === selectedTopicId)

  // 정렬: 번호순
  const sortByNumber = (a, b) => {
    const na = parseInt(a.number) || 999
    const nb = parseInt(b.number) || 999
    if (na !== nb) return na - nb
    return displayStudentName(a).localeCompare(displayStudentName(b))
  }
  submitted.sort(sortByNumber)
  absent.sort(sortByNumber)

  // 학생별 최고 점수 (attempt 여러 개일 때)
  const bestSubByUser = {}
  submissions.forEach(s => {
    const cur = bestSubByUser[s.user_id]
    if (!cur || (s.total_score || 0) > (cur.total_score || 0)) {
      bestSubByUser[s.user_id] = s
    }
  })

  // 💡 도움이 필요한 학생: 최고 점수가 만점의 60% 미만
  const needHelp = submitted.filter(s => {
    const best = bestSubByUser[s.id]
    if (!best) return false
    const max = best.max_score || 100
    return (best.total_score || 0) / max < 0.6
  })

  // 💬 코멘트 대기: 최신 글에 담임 코멘트가 없는 학생
  const latestSubByUser = {}
  submissions.forEach(s => {
    const cur = latestSubByUser[s.user_id]
    if (!cur || (s.attempt || 1) > (cur.attempt || 1)) latestSubByUser[s.user_id] = s
  })
  const needComment = submitted.filter(s => {
    const latest = latestSubByUser[s.id]
    return latest && !latest.teacher_comment
  })

  return (
    <>
      <Head><title>제출 현황 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">📋 제출 현황</h1>
          </div>

          {/* 주제 선택 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <label className="block text-xs text-gray-600 mb-1">주제 선택</label>
            {topics.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">등록된 주제가 없어요</p>
            ) : (
              <select value={selectedTopicId} onChange={e => handleTopicChange(e.target.value)}
                className="w-full p-2 border border-gray-200 rounded-lg text-sm">
                {topics.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.date === todayStr() ? '🌟 ' : ''}{t.date} · {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {students.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 text-center text-gray-500">
              <p className="text-sm">학급에 학생이 없어요</p>
              <Link href="/teacher/students" className="text-xs text-primary underline mt-2 inline-block">
                학생 관리로 이동 →
              </Link>
            </div>
          ) : !selectedTopic ? (
            <div className="bg-white rounded-2xl p-10 text-center text-gray-500">
              <p className="text-sm">주제를 선택해주세요</p>
            </div>
          ) : (
            <>
              {/* 요약 카드 */}
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                <div className="bg-white rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-2xl font-bold text-primary">{students.length}</div>
                  <div className="text-xs text-gray-500 mt-1">전체</div>
                </div>
                <div className="bg-green-50 rounded-2xl p-4 text-center border border-green-200">
                  <div className="text-2xl font-bold text-green-700">{submitted.length}</div>
                  <div className="text-xs text-green-700 mt-1">✓ 제출</div>
                </div>
                <div className="bg-amber-50 rounded-2xl p-4 text-center border border-amber-200">
                  <div className="text-2xl font-bold text-amber-700">{absent.length}</div>
                  <div className="text-xs text-amber-700 mt-1">미제출</div>
                </div>
                <div className="bg-rose-50 rounded-2xl p-4 text-center border border-rose-200">
                  <div className="text-2xl font-bold text-rose-700">{needHelp.length}</div>
                  <div className="text-xs text-rose-700 mt-1">💡 도움 필요</div>
                </div>
                <div className="bg-blue-50 rounded-2xl p-4 text-center border border-blue-200">
                  <div className="text-2xl font-bold text-blue-700">{needComment.length}</div>
                  <div className="text-xs text-blue-700 mt-1">💬 코멘트 대기</div>
                </div>
              </div>

              {/* 진행률 바 */}
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex justify-between items-center mb-2 text-xs">
                  <span className="text-gray-600">제출률</span>
                  <span className="font-bold text-primary">
                    {Math.round((submitted.length / students.length) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="bg-gradient-to-r from-green-400 to-green-600 h-full transition-all"
                    style={{width: `${(submitted.length / students.length) * 100}%`}} />
                </div>
              </div>

              {/* 미제출 학생 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                  <h3 className="font-bold text-amber-900">
                    🚨 미제출 학생 ({absent.length}명)
                  </h3>
                  {absent.length > 0 && (
                    <button onClick={() => copyAbsentList(absent)}
                      className="text-xs bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded-full">
                      📋 명단 복사
                    </button>
                  )}
                </div>
                {absent.length === 0 ? (
                  <p className="text-sm text-green-600 py-4 text-center">🎉 모두 제출했어요!</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {absent.map(s => (
                      <div key={s.id} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm">
                        {s.number && <span className="text-xs text-amber-700 mr-1.5">{s.number}번</span>}
                        <span className="font-medium">{displayStudentName(s)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 💡 도움이 필요한 학생 (점수 60% 미만) */}
              {needHelp.length > 0 && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                    <h3 className="font-bold text-rose-900">
                      💡 도움이 필요한 학생 ({needHelp.length}명)
                      <span className="text-xs font-normal text-gray-400 ml-2">점수가 60% 미만이에요</span>
                    </h3>
                    <button onClick={() => copyAbsentList(needHelp, '도움 필요')}
                      className="text-xs bg-rose-100 text-rose-800 hover:bg-rose-200 px-3 py-1.5 rounded-full">
                      📋 명단 복사
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {needHelp.sort(sortByNumber).map(s => {
                      const best = bestSubByUser[s.id]
                      return (
                        <Link key={s.id} href={`/teacher/submissions?topic=${selectedTopicId}&student=${s.id}`}
                          className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-sm flex items-center justify-between hover:bg-rose-100 hover:border-rose-300 transition-colors">
                          <span>
                            {s.number && <span className="text-xs text-rose-700 mr-1.5">{s.number}번</span>}
                            <span className="font-medium">{displayStudentName(s)}</span>
                          </span>
                          <span className="text-xs text-rose-600">{best?.total_score ?? 0}/{best?.max_score ?? 100}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 💬 코멘트 대기 (최신 글에 담임 코멘트 없음) */}
              {needComment.length > 0 && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
                    <h3 className="font-bold text-blue-900">
                      💬 코멘트 기다리는 학생 ({needComment.length}명)
                      <span className="text-xs font-normal text-gray-400 ml-2">최신 글에 담임 코멘트가 아직 없어요</span>
                    </h3>
                    <Link href={`/teacher/submissions?topic=${selectedTopicId}`}
                      className="text-xs bg-blue-100 text-blue-800 hover:bg-blue-200 px-3 py-1.5 rounded-full">
                      ✏️ 코멘트 쓰러 가기
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {needComment.sort(sortByNumber).map(s => (
                      <Link key={s.id} href={`/teacher/submissions?topic=${selectedTopicId}&student=${s.id}`}
                        className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm hover:bg-blue-100 hover:border-blue-300 transition-colors block">
                        {s.number && <span className="text-xs text-blue-700 mr-1.5">{s.number}번</span>}
                        <span className="font-medium">{displayStudentName(s)}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* 제출 학생 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <h3 className="font-bold text-green-900 mb-3">
                  ✅ 제출한 학생 ({submitted.length}명)
                </h3>
                {submitted.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">아직 제출한 학생이 없어요</p>
                ) : (
                  <>
                    <p className="text-xs text-gray-500 mb-2">💡 학생 이름을 클릭하면 글과 피드백을 바로 볼 수 있어요</p>
                    <div className="space-y-1">
                      {submitted.map(s => {
                        const best = bestSubByUser[s.id]
                        const userSubs = submissions.filter(sub => sub.user_id === s.id)
                        const hasReport = userSubs.some(sub => sub.reported)
                        return (
                          <Link
                            key={s.id}
                            href={`/teacher/submissions?topic=${selectedTopicId}&student=${s.id}`}
                            className="flex items-center justify-between p-2 rounded hover:bg-blue-50 text-sm cursor-pointer transition group"
                          >
                            <div className="flex items-center gap-2">
                              {s.number && (
                                <span className="text-xs text-gray-500 font-mono w-8 text-center">{s.number}번</span>
                              )}
                              <span className="font-medium group-hover:text-primary group-hover:underline">{displayStudentName(s)}</span>
                              {userSubs.length > 1 && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  +{userSubs.length - 1} 수정
                                </span>
                              )}
                              {hasReport && (
                                <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                                  🚨 신고
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {best && (
                                <span className="text-xs font-mono text-gray-600">
                                  {best.total_score}/{best.max_score}
                                </span>
                              )}
                              <span className="text-gray-400 group-hover:text-primary">→</span>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>

              <div className="text-center pt-2">
                <Link href={`/teacher/submissions?topic=${selectedTopicId}`} className="text-sm text-primary hover:underline">
                  → 전체 학생 글 보기
                </Link>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}

```

## pages/teacher/student-growth.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import { displayStudentNameWithNumber } from '../../lib/displayName'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, BarElement } from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend)

export default function StudentGrowth() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [allSubmissions, setAllSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStudent, setSelectedStudent] = useState('all')

  useEffect(() => { check() }, [])

  const check = async () => {
    const { data: { user: au } } = await supabase.auth.getUser()
    if (!au) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name, school)').eq('id', au.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    if (profile.classes?.id) {
      const { data: studentList } = await supabase.from('profiles').select('id, realname, nickname, username, number, is_hidden').eq('class_id', profile.classes.id).eq('role', 'student').order('username')
      const visibleStudents = (studentList || []).filter(s => !s.is_hidden)
      setStudents(visibleStudents)

      const studentIds = visibleStudents.map(s => s.id)
      if (studentIds.length > 0) {
        const { data: subs } = await supabase.from('submissions').select('*, topics(date)').in('user_id', studentIds).is('deleted_at', null).order('created_at')
        setAllSubmissions(subs || [])
      }
    }
    setLoading(false)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 학급 평균 그래프 데이터
  const getClassAvgChart = () => {
    // 주제별 평균 (최종본 기준, 100점 환산)
    const byTopic = {}
    allSubmissions.forEach(s => {
      const tId = s.topic_id
      if (!byTopic[tId]) byTopic[tId] = { date: s.topics?.date || s.created_at?.slice(0,10), title: s.topic_title || '주제', latest: {} }
      const cur = byTopic[tId].latest[s.user_id]
      if (!cur || (s.attempt || 1) > (cur.attempt || 1)) byTopic[tId].latest[s.user_id] = s
    })
    
    const sorted = Object.values(byTopic).sort((a,b) => new Date(a.date) - new Date(b.date))
    const labels = sorted.map(t => t.date?.slice(5) || '')
    const avgs = sorted.map(t => {
      const items = Object.values(t.latest)
      if (items.length === 0) return 0
      const total = items.reduce((sum, s) => sum + (s.total_score / s.max_score) * 100, 0)
      return Math.round(total / items.length)
    })
    
    return {
      labels,
      datasets: [{
        label: '학급 평균 (100점 환산)',
        data: avgs,
        borderColor: '#2d6a4f',
        backgroundColor: 'rgba(45, 106, 79, 0.1)',
        tension: 0.3,
        fill: true
      }]
    }
  }

  // 학생별 성장 그래프
  const getStudentChart = (studentId) => {
    const subs = allSubmissions.filter(s => s.user_id === studentId)
    const byTopic = {}
    subs.forEach(s => {
      const tId = s.topic_id
      if (!byTopic[tId]) byTopic[tId] = []
      byTopic[tId].push(s)
    })
    
    const sorted = Object.values(byTopic).map(items => {
      const sortedItems = [...items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
      return sortedItems[sortedItems.length - 1]
    }).sort((a,b) => new Date(a.created_at) - new Date(b.created_at))
    
    return {
      labels: sorted.map(s => s.topics?.date?.slice(5) || s.created_at?.slice(5,10) || ''),
      datasets: [{
        label: '점수 (100점 환산)',
        data: sorted.map(s => Math.round((s.total_score / s.max_score) * 100)),
        borderColor: '#2d6a4f',
        backgroundColor: 'rgba(45, 106, 79, 0.1)',
        tension: 0.3
      }]
    }
  }

  // 학생별 평균 점수 비교 (막대)
  const getStudentRankChart = () => {
    const studentAvgs = students.map(student => {
      const subs = allSubmissions.filter(s => s.user_id === student.id)
      const byTopic = {}
      subs.forEach(s => {
        const tId = s.topic_id
        const cur = byTopic[tId]
        if (!cur || (s.attempt||1) > (cur.attempt||1)) byTopic[tId] = s
      })
      const items = Object.values(byTopic)
      if (items.length === 0) return { name: displayStudentNameWithNumber(student), avg: 0, count: 0 }
      const avg = items.reduce((sum, s) => sum + (s.total_score / s.max_score) * 100, 0) / items.length
      return { name: displayStudentNameWithNumber(student), avg: Math.round(avg), count: items.length }
    }).filter(s => s.count > 0).sort((a,b) => b.avg - a.avg)

    return {
      labels: studentAvgs.map(s => s.name),
      datasets: [{
        label: '학생별 평균 (100점 환산)',
        data: studentAvgs.map(s => s.avg),
        backgroundColor: 'rgba(45, 106, 79, 0.6)'
      }]
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  const classChart = getClassAvgChart()
  const rankChart = getStudentRankChart()
  const studentChart = selectedStudent !== 'all' ? getStudentChart(selectedStudent) : null

  const chartOptions = (title) => ({
    responsive: true,
    plugins: { legend: { display: false }, title: { display: true, text: title } },
    scales: { y: { min: 0, max: 100, ticks: { stepSize: 20 } } }
  })

  return (
    <>
      <Head><title>학생 성장 그래프 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">📊 학생 성장 그래프</h1>
          </div>

          {allSubmissions.length === 0 ? (
            <div className="bg-white rounded-2xl p-8 text-center text-gray-500">
              <p>아직 제출된 글이 없어요</p>
            </div>
          ) : (
            <>
              {/* 학급 평균 추이 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <Line data={classChart} options={chartOptions('학급 평균 점수 추이')} />
              </div>

              {/* 학생별 평균 비교 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <Bar data={rankChart} options={chartOptions('학생별 평균 점수')} />
              </div>

              {/* 개별 학생 그래프 */}
              <div className="bg-white rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold">개별 학생 성장 추이</h3>
                  <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
                    className="text-sm border border-gray-200 rounded p-2">
                    <option value="all">학생 선택</option>
                    {students.map(s => <option key={s.id} value={s.id}>{displayStudentNameWithNumber(s)}</option>)}
                  </select>
                </div>
                {studentChart && studentChart.labels.length > 0 ? (
                  <Line data={studentChart} options={chartOptions(displayStudentNameWithNumber(students.find(s => s.id === selectedStudent) || {}) + ' 학생')} />
                ) : (
                  <p className="text-sm text-gray-500 py-8 text-center">학생을 선택해주세요</p>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}

```

## pages/teacher/students.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import NicknameChangeModal from '../../components/NicknameChangeModal'
import ImpersonationBanner from '../../components/ImpersonationBanner'
import { displayStudentName } from '../../lib/displayName'
import { getEffectiveProfile, withImpersonation, isImpersonatingNow } from '../../lib/impersonation'
import { makeUsernameVariant } from '../../lib/usernameGen'

export default function StudentsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [isImpersonating, setIsImpersonating] = useState(false)  // 🆕
  const [uploadStatus, setUploadStatus] = useState(null)
  const [parsedStudents, setParsedStudents] = useState([])
  const [dragOver, setDragOver] = useState(false)   // 명렬표 드롭존 드래그 하이라이트
  const [uploading, setUploading] = useState(false)
  // 아이디 prefix (예: "hr" → hr5101)
  const [idPrefix, setIdPrefix] = useState('')
  const [defaultPrefix, setDefaultPrefix] = useState('') // 학교 초성 기본값
  // 🆕 step158: 학생 1명 개별 추가 (step160: 아이디 직접 지정 옵션)
  const [showAddOne, setShowAddOne] = useState(false)
  const [addOneForm, setAddOneForm] = useState({ realname: '', number: '', username: '' })
  const [addOneIdManual, setAddOneIdManual] = useState(false) // 교사가 아이디를 직접 손대면 true
  const [addOneIdHint, setAddOneIdHint] = useState('')         // 아이디 입력 즉시 안내
  const [addingOne, setAddingOne] = useState(false)
  const [addOneResult, setAddOneResult] = useState(null) // { username, password }
  // 인라인 편집 상태
  const [editingNumbers, setEditingNumbers] = useState({}) // {studentId: number}
  const [editingUsernames, setEditingUsernames] = useState({}) // {parsedIdx: username} - 미리보기에서 개별 수정
  const [editingExistingUsernames, setEditingExistingUsernames] = useState({}) // {studentId: username} - 기존 학생 아이디 인라인 수정
  const [editingRealnames, setEditingRealnames] = useState({}) // {studentId: realname} - 학생 이름 인라인 수정
  const [savingId, setSavingId] = useState(null)
  // 숨김 학생 보기 토글
  const [showHidden, setShowHidden] = useState(false)
  // 닉네임 변경 모달 (선생님이 학생 닉네임 변경)
  const [editingNicknameStudent, setEditingNicknameStudent] = useState(null)
  // 선택된 학생 ID들 (체크박스 - 일괄 비번 초기화용)
  const [selectedStudentIds, setSelectedStudentIds] = useState(new Set())
  // 🆕 step207-D: 탭 전환 — 'register'(등록) | 'list'(목록). 동의는 별도 화면(/consent)으로 이동.
  //   null이면 학생 수에 따라 기본 탭을 파생(0명→등록, 있으면→목록). 사용자가 누르면 그 값으로 고정.
  const [mode, setMode] = useState(null)
  // 🆕 step234: 실명→닉네임 전환 공지 배너 닫힘 여부 (교사별 localStorage, step220 방식 lc-..-dismissed:<id>)
  const [relockNoticeDismissed, setRelockNoticeDismissed] = useState(false)

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

    // 🆕 step234: 닉네임 전환 공지 배너를 이 교사가 이미 닫았는지 복원 (교사별 키)
    try {
      if (profile?.id && localStorage.getItem('lc-relock-notice-dismissed:' + profile.id) === '1') {
        setRelockNoticeDismissed(true)
      }
    } catch {}

    // 학교명에서 기본 prefix 계산 (예: "한국초등학교" → "hgc")
    if (profile.school) {
      try {
        const { toInitialAlpha } = await import('../../lib/usernameGen')
        const core = profile.school.replace('초등학교', '초').replace('중학교', '중').replace('고등학교', '고')
        const def = toInitialAlpha(core)
        setDefaultPrefix(def)
        setIdPrefix(def) // 기본값
      } catch(e) {}
    }

    await loadStudents(profile.classes?.id)
    setLoading(false)
  }

  const loadStudents = async (classId) => {
    if (!classId) return
    const { data } = await supabase.from('profiles').select('*').eq('class_id', classId).eq('role', 'student').order('username')
    setStudents(data || [])

    // 🆕 학생이 이미 있는데 학급 안내가 비어있으면 자동 백필
    // (구버전에서 등록된 학급, 또는 _auto 조건이 안 맞았던 학급 구제)
    if (data && data.length >= 2 && !isImpersonating) {
      try {
        const { ensureLoginHint } = await import('../../lib/loginHint')
        await ensureLoginHint(classId, {
          existingUsernames: data.map(s => s.username).filter(Boolean)
        })
      } catch(e) {
        console.warn('학급 안내 백필 실패:', e)
      }
    }
  }

  const logout = async () => {
    if (isImpersonating) { router.push('/admin'); return }
    await supabase.auth.signOut(); router.push('/')
  }

  // 🆕 step234: 닉네임 전환 공지 배너 영구 닫기 — 교사별 localStorage에 기록
  const dismissRelockNotice = () => {
    setRelockNoticeDismissed(true)
    try { if (user?.id) localStorage.setItem('lc-relock-notice-dismissed:' + user.id, '1') } catch {}
  }

  // 자동 아이디 생성 (prefix 기반)
  // prefix가 있으면 그걸 사용, 비어있으면 학교 초성 사용
  const buildUsername = (prefix, grade, classNum, number) => {
    const p = (prefix || '').trim().toLowerCase() || 'sch'
    const g = String(grade || '0').trim()
    const c = String(classNum || '0').trim()
    const n = String(number || '0').trim().padStart(2, '0')
    return `${p}${g}${c}${n}`
  }

  // prefix가 바뀌면 미리보기 학생들의 username 재생성
  const updatePrefixAndRegenerate = (newPrefix) => {
    setIdPrefix(newPrefix)
    // 자동 생성 학생들만 username 갱신
    setParsedStudents(prev => prev.map(s => {
      if (s._auto && s._grade && s._class && s.number) {
        return {
          ...s,
          username: buildUsername(newPrefix, s._grade, s._class, s.number)
        }
      }
      return s
    }))
    // 개별 편집 중인 것들 초기화
    setEditingUsernames({})
  }

  // 🆕 빈 양식 다운로드 — 나이스 명렬표를 못 받는 경우 직접 채워서 올리기
  const downloadTemplate = async () => {
    const XLSX = (await import('xlsx')).default || (await import('xlsx'))
    const grade = classInfo?.grade || 5
    const rows = [
      ['학년', '반', '번호', '성명'],
      [grade, 1, 1, '김예시'],
      [grade, 1, 2, '이예시'],
      [grade, 1, 3, '박예시'],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '학생명단')
    XLSX.writeFile(wb, '학생등록_양식.xlsx')
    alert(
      '📄 양식이 다운로드됐어요!\n\n' +
      '1. 예시 줄(김예시 등)을 지우고 우리 반 학생으로 채워주세요\n' +
      '2. 학년·반·번호는 숫자로, 성명은 실명으로\n' +
      '3. 저장 후 이 화면에 다시 업로드하면 끝!'
    )
  }

  // 이벤트(<input onChange>) 또는 파일(드래그앤드롭) 둘 다 허용.
  const handleFile = async (eOrFile) => {
    const isEvent = !!(eOrFile && eOrFile.target && eOrFile.target.files)
    const file = isEvent ? eOrFile.target.files[0] : eOrFile
    if (!file) return
    // input 값 초기화는 이벤트(파일 선택)일 때만 — 드롭 파일은 input과 무관.
    const resetInput = () => { if (isEvent) { try { eOrFile.target.value = '' } catch {} } }

    if (!user?.school || !user.school.trim()) {
      alert('학교명이 등록되지 않았어요!\n선생님 메인 화면 → "✏️ 내 정보 수정"에서 학교명을 먼저 입력해주세요.')
      resetInput()
      return
    }

    const fileName = file.name.toLowerCase()
    const isPdf = fileName.endsWith('.pdf') || file.type === 'application/pdf'
    const isExcel = fileName.match(/\.(xlsx|xls)$/)

    if (!isPdf && !isExcel) {
      alert(
        '❌ 인식할 수 없는 파일 형식이에요.\n\n' +
        '✅ 엑셀 (.xlsx, .xls) - 권장\n' +
        '✅ PDF (.pdf) - 텍스트 PDF만 가능\n\n' +
        '나이스 → [기본학적관리] → [명렬표 출력] → [엑셀 내려받기]'
      )
      resetInput()
      return
    }

    setUploadStatus('📄 파일을 분석하는 중...')

    // PDF 처리
    if (isPdf) {
      try {
        const { parsePdfStudentList } = await import('../../lib/pdfParser')
        const pdfStudents = await parsePdfStudentList(file)

        if (pdfStudents.length === 0) {
          setUploadStatus(null)
          alert(
            '❌ PDF에서 학생 명단을 인식하지 못했어요.\n\n' +
            '가능한 원인:\n' +
            '· 이미지로 된 PDF (스캔본)\n' +
            '· 표 형식이 일반적인 나이스 명렬표와 다름\n\n' +
            '✅ 해결 방법:\n' +
            '나이스 → [엑셀 내려받기] 초록색 버튼으로 엑셀 파일을 받아 올려주세요.'
          )
          resetInput()
          return
        }

        const currentPrefix = idPrefix || defaultPrefix
        const parsed = pdfStudents.map(s => ({
          number: s.number,
          realname: s.name,
          username: buildUsername(currentPrefix, s.grade, s.classNum, s.number),
          _auto: true,
          _grade: s.grade,
          _class: s.classNum
        }))

        setParsedStudents(parsed)
        setEditingUsernames({})

        const sample = parsed[0]
        setUploadStatus(
          `📋 PDF에서 ${parsed.length}명 인식 완료!\n` +
          `🆔 아이디 자동 생성됨 (예: ${sample?.username})\n` +
          `⚠️ PDF는 인식 정확도가 100%는 아니에요. 아래 명단을 꼭 확인해주세요!\n` +
          `💡 인식 오류가 있으면 개별 수정 가능합니다.`
        )
        return
      } catch(err) {
        setUploadStatus(null)
        alert(
          '❌ PDF 처리 실패: ' + err.message + '\n\n' +
          '엑셀 파일로 다시 시도해주세요.'
        )
        resetInput()
        return
      }
    }

    // 엑셀 처리 (기존 로직)
    const XLSX = (await import('xlsx')).default || (await import('xlsx'))

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

        // 헤더 찾기
        const header = rows[0] || []
        const gradeIdx = header.findIndex(h => String(h).trim() === '학년')
        const classIdx = header.findIndex(h => String(h).trim() === '반')
        const numIdx = header.findIndex(h => String(h).includes('번호'))
        const nameIdx = header.findIndex(h => String(h).includes('성명') || String(h).includes('이름'))
        const idIdx = header.findIndex(h => String(h).includes('아이디'))

        const isNiceFormat = gradeIdx !== -1 && classIdx !== -1 && numIdx !== -1 && nameIdx !== -1
        const isOldFormat = nameIdx !== -1 && idIdx !== -1

        if (!isNiceFormat && !isOldFormat) {
          alert(
            '엑셀 형식을 인식할 수 없어요.\n\n' +
            '✅ 권장: 나이스 명렬표 (학년 | 반 | 번호 | 성명)\n' +
            '✅ 또는: 성명 + 아이디 컬럼이 있는 엑셀'
          )
          return
        }

        const parsed = []
        const currentPrefix = idPrefix || defaultPrefix

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          if (!row) continue

          if (isNiceFormat) {
            const name = row[nameIdx] ? String(row[nameIdx]).trim() : ''
            const grade = row[gradeIdx]
            const classNum = row[classIdx]
            const number = row[numIdx]
            if (!name || !grade || !classNum || !number) continue

            const username = buildUsername(currentPrefix, grade, classNum, number)

            parsed.push({
              number: String(number).trim(),
              realname: name,
              username,
              _auto: true,
              _grade: String(grade),
              _class: String(classNum)
            })
          } else {
            if (!row[nameIdx] || !row[idIdx]) continue
            parsed.push({
              number: row[numIdx] ? String(row[numIdx]).trim() : '',
              realname: String(row[nameIdx]).trim(),
              username: String(row[idIdx]).trim().toLowerCase()
            })
          }
        }

        setParsedStudents(parsed)
        setEditingUsernames({})

        if (isNiceFormat) {
          const sample = parsed[0]
          setUploadStatus(
            `📋 나이스 명렬표 인식: ${parsed.length}명\n` +
            `🆔 아이디 자동 생성됨 (예: ${sample?.username})\n` +
            `💡 아이디 앞부분(prefix)을 바꾸면 모두 한꺼번에 변경돼요. 개별 수정도 가능합니다.`
          )
        } else {
          setUploadStatus(`📋 ${parsed.length}명의 학생이 감지되었어요.`)
        }
      } catch(err) {
        alert('엑셀 파일 읽기 실패: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const submitBulk = async () => {
    if (parsedStudents.length === 0) return

    // 최종 아이디 결정: editingUsernames에 값이 있으면 그걸, 없으면 username 사용
    const finalStudents = parsedStudents.map((s, idx) => ({
      number: s.number,
      realname: s.realname,
      username: ((editingUsernames[idx] !== undefined ? editingUsernames[idx] : s.username) || '').trim().toLowerCase()
    }))

    // 유효성 검사
    const invalid = finalStudents.filter(s => !s.username || !/^[a-z0-9_-]+$/i.test(s.username))
    if (invalid.length > 0) {
      alert(
        `❌ 아이디 형식이 잘못된 학생이 있어요:\n\n` +
        invalid.slice(0, 5).map(s => `- ${s.realname}: "${s.username}"`).join('\n') +
        (invalid.length > 5 ? `\n... 외 ${invalid.length - 5}명` : '') +
        `\n\n아이디는 영문/숫자/_/-만 사용 가능해요.`
      )
      return
    }

    // 중복 체크 (같은 배치 안에서)
    const seen = new Set()
    const dupes = []
    finalStudents.forEach(s => {
      if (seen.has(s.username)) dupes.push(s.username)
      seen.add(s.username)
    })
    if (dupes.length > 0) {
      alert(`❌ 중복된 아이디가 있어요:\n${[...new Set(dupes)].join(', ')}\n\n각각 다르게 수정해주세요.`)
      return
    }

    if (!confirm(`${finalStudents.length}명을 일괄 등록할게요.\n\n초기 비밀번호는 모두 "123456" 입니다.\n진행할까요?`)) return

    setUploading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('로그인 세션이 만료됐어요. 다시 로그인해주세요.')
        setUploading(false)
        return
      }

      const res = await fetch('/api/students-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ students: finalStudents, classId: classInfo.id, accessToken: session.access_token })
      })
      const result = await res.json()

      // 실패 명단 친절하게 변환
      const friendlyError = (errStr) => {
        if (!errStr) return '알 수 없는 오류'
        if (errStr.includes('이미 가입')) return '이미 가입된 아이디 (다른 학급/학교 학생일 수 있음)'
        if (errStr.includes('Password should be at least')) {
          const m = errStr.match(/at least (\d+)/)
          return `비밀번호 ${m ? m[1] : 6}자 이상 필요 (Supabase 정책)`
        }
        if (errStr.includes('Unable to validate email')) return '아이디 형식 오류 (영문/숫자만)'
        if (errStr.includes('아이디/이름 누락')) return '엑셀에 아이디 또는 이름이 비어 있음'
        return errStr
      }

      let msg = `✅ 성공: ${result.success.length}명\n❌ 실패: ${result.failed.length}명`
      if (result.success.length > 0) {
        msg += `\n\n🔒 실명은 보호자 동의 전까지 자동으로 잠겨 닉네임으로 표시돼요. 동의 안내는 아래 '학부모 동의'에서 보낼 수 있어요.`
      }

      if (result.failed.length > 0) {
        // 동일 사유 그룹핑
        const errorGroups = {}
        result.failed.forEach(f => {
          const reason = friendlyError(f.error)
          if (!errorGroups[reason]) errorGroups[reason] = []
          errorGroups[reason].push(`${f.realname}(${f.username})`)
        })
        msg += '\n\n📋 실패 사유:\n'
        for (const [reason, list] of Object.entries(errorGroups)) {
          msg += `\n[${reason}]\n - ${list.join(', ')}\n`
        }

        // 가장 흔한 케이스 안내
        const allAlreadyJoined = result.failed.every(f => (f.error || '').includes('이미 가입'))
        if (allAlreadyJoined) {
          msg += '\n💡 이미 가입된 학생들은 그대로 로그인하면 돼요!\n비밀번호를 모르면 학생 관리에서 🔑로 초기화하세요.'
        }
      }

      alert(msg)

      // 🆕 학급 로그인 안내 자동 설정 (학생 일괄 등록과 동시에)
      // ⓑ: _auto 조건이 안 맞아도 등록된 아이디들에서 공통 접두사 자동 추출
      try {
        if (result.success.length > 0) {
          const firstAuto = finalStudents.find(s => s._auto && s._grade && s._class)
          // 방금 등록된 학생들의 아이디 모음 (fallback용)
          const registeredUsernames = finalStudents
            .map(s => s.username)
            .filter(Boolean)

          const { ensureLoginHint } = await import('../../lib/loginHint')
          await ensureLoginHint(classInfo.id, {
            autoMeta: firstAuto ? {
              prefix: idPrefix,
              grade: firstAuto._grade,
              class: firstAuto._class
            } : null,
            existingUsernames: registeredUsernames
          })
        }
      } catch (e) {
        console.warn('학급 안내 자동 저장 실패 (학생 등록은 성공):', e)
      }

      setParsedStudents([])
      setEditingUsernames({})
      setUploadStatus(null)
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('일괄 등록 실패: ' + e.message)
    }
    setUploading(false)
  }

  // 🆕 step158: 기존 학생 아이디에서 공통 줄기(번호 2자리 앞부분) 추출
  const deriveUsernameStem = () => {
    const unames = students.map(s => s.username).filter(Boolean)
    if (unames.length > 0) {
      const stems = unames.map(u => /\d{2}$/.test(u) ? u.slice(0, -2) : u)
      const freq = {}
      stems.forEach(st => { freq[st] = (freq[st] || 0) + 1 })
      return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
    }
    // 기존 학생이 없으면: 로그인 안내 prefix → 학교초성+학년+1반
    if (classInfo?.login_username_prefix) return classInfo.login_username_prefix.trim().toLowerCase()
    return buildUsername(idPrefix, classInfo?.grade || '5', '1', '').replace(/00$/, '')
  }

  // 🆕 step160: 번호로 자동 아이디 계산 (기존 규칙 재사용 + 학급 내 중복 회피)
  // students에는 숨김 학생도 포함되므로 학급 전체와 대조한다.
  const computeAutoUsername = (numberStr) => {
    const taken = new Set(students.map(s => (s.username || '').toLowerCase()).filter(Boolean))
    const stem = deriveUsernameStem()
    const explicit = String(numberStr || '').trim() !== ''

    // 시작 번호: 명시값 우선, 없으면 다음 번호
    let n
    if (explicit) {
      n = parseInt(numberStr, 10)
      if (isNaN(n)) n = 1
    } else {
      const nums = students.map(s => parseInt(s.number, 10)).filter(x => !isNaN(x))
      n = nums.length ? Math.max(...nums) + 1 : 1
    }
    let candidate = `${stem}${String(n).padStart(2, '0')}`.toLowerCase()

    // 1) 번호 자동배정이면 빈 번호로 증가시켜 충돌 회피
    if (!explicit) {
      let guard = 0
      while (taken.has(candidate) && guard < 300) {
        n++; guard++
        candidate = `${stem}${String(n).padStart(2, '0')}`.toLowerCase()
      }
    }
    // 2) 그래도 충돌(명시 번호 or 번호 소진)이면 숫자 suffix 변형
    if (taken.has(candidate)) {
      const base = candidate
      let suffix = 2, guard = 0
      while (taken.has(candidate) && guard < 100) {
        candidate = makeUsernameVariant(base, suffix).toLowerCase()
        suffix++; guard++
      }
    }
    return candidate
  }

  // 🆕 step160: 폼 열기 — 초기화
  const openAddOne = () => {
    setShowAddOne(true)
    setAddOneResult(null)
    setAddOneIdManual(false)
    setAddOneIdHint('')
    setAddOneForm({ realname: '', number: '', username: '' })
  }

  // 이름/번호 변경 — 수동 모드가 아니면 아이디 미리보기 자동 갱신
  const onAddOneFieldChange = (field, value) => {
    setAddOneForm(f => {
      const nf = { ...f, [field]: value }
      if (!addOneIdManual) nf.username = computeAutoUsername(field === 'number' ? value : nf.number)
      return nf
    })
  }

  // 아이디 직접 수정 — 즉시 소문자화·허용문자 정리 + 안내, 수동 모드로 전환
  const onAddOneIdChange = (raw) => {
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
    setAddOneIdManual(true)
    setAddOneForm(f => ({ ...f, username: cleaned }))
    if (raw !== cleaned) setAddOneIdHint('아이디는 영문 소문자·숫자만 쓸 수 있어요')
    else if (cleaned && (cleaned.length < 4 || cleaned.length > 20)) setAddOneIdHint('아이디는 4~20자로 입력해주세요')
    else setAddOneIdHint('')
  }

  // 🔄 자동으로 — 자동생성 값으로 복원
  const resetAddOneIdToAuto = () => {
    setAddOneIdManual(false)
    setAddOneIdHint('')
    setAddOneForm(f => ({ ...f, username: computeAutoUsername(f.number) }))
  }

  // 🆕 step158/160: 학생 1명 추가 (기존 /api/students-bulk를 1명 배열로 재사용)
  const submitAddOne = async () => {
    const realname = addOneForm.realname.trim()
    if (!realname) return alert('이름을 입력해주세요')

    // 아이디: 폼 값 우선, 비었으면 자동 생성
    let username = (addOneForm.username || '').trim().toLowerCase()
    if (!username) username = computeAutoUsername(addOneForm.number)

    if (!/^[a-z0-9]{4,20}$/.test(username)) {
      setAddOneIdHint('아이디는 영문 소문자·숫자 4~20자로 입력해주세요')
      return alert('아이디는 영문 소문자·숫자 4~20자로 입력해주세요.')
    }

    // 번호: 입력값 우선, 비었으면 다음 번호 자동 배정 (기록·정렬용)
    let number = String(addOneForm.number || '').trim()
    if (!number) {
      const nums = students.map(s => parseInt(s.number, 10)).filter(n => !isNaN(n))
      number = String(nums.length ? Math.max(...nums) + 1 : 1)
    }

    if (!confirm(`"${realname}" 학생을 추가할게요.\n\n아이디: ${username}\n초기 비밀번호: 123456\n\n진행할까요?`)) return

    setAddingOne(true)
    setAddOneResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('로그인 세션이 만료됐어요. 다시 로그인해주세요.')
        setAddingOne(false)
        return
      }
      const res = await fetch('/api/students-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students: [{ username, realname, number }],
          classId: classInfo.id,
          accessToken: session.access_token,
        }),
      })
      const result = await res.json()

      if (result?.success?.length > 0) {
        // 로그인 안내 prefix 동기화 (첫 학생이면 여기서 세팅됨)
        try {
          const { ensureLoginHint } = await import('../../lib/loginHint')
          await ensureLoginHint(classInfo.id, {
            existingUsernames: [...students.map(s => s.username).filter(Boolean), username],
          })
        } catch (e) { /* 안내 저장 실패해도 등록은 성공 */ }

        setAddOneResult({ username, password: '123456' })
        setAddOneForm({ realname: '', number: '', username: '' })
        setAddOneIdManual(false)
        setAddOneIdHint('')
        await loadStudents(classInfo.id)
      } else {
        // 실패 — 폼·입력값 그대로 유지
        const err = result?.failed?.[0]?.error || '알 수 없는 오류'
        let friendly = err
        if (err.includes('이미 가입')) {
          // 학급 내 중복은 미리보기에서 회피되므로, 여기 도달하면 보통 다른 학급/학교와 전역 충돌
          friendly = `이 아이디는 다른 학급에서 사용 중이에요 (${username}).\n아이디를 조금 바꿔주세요.`
          setAddOneIdManual(true)  // 직접 수정 모드로 (이름/번호 바꿔도 안 덮어쓰게)
          setAddOneIdHint('다른 학급에서 쓰는 아이디예요. 조금 바꿔주세요')
        }
        else if (err.includes('아이디 형식')) friendly = '아이디는 영문 소문자·숫자 4~20자로 해주세요.'
        else if (err.includes('아이디/이름 누락')) friendly = '이름이 비어 있어요.'
        alert('추가 실패: ' + friendly)
      }
    } catch (e) {
      alert('추가 실패: ' + (e.message || '잠시 후 다시 시도해주세요'))
    }
    setAddingOne(false)
  }

  // 비밀번호 초기화 (공란 = 123456, 입력값 = 그 값으로)
  const resetPassword = async (studentId, username, realname) => {
    const input = prompt(
      `🔐 "${realname}" 학생의 비밀번호 초기화\n\n` +
      `새 비밀번호를 입력하세요.\n` +
      `※ 그대로 [확인] 누르면 "123456"으로 초기화됩니다.\n` +
      `※ 6자 이상 입력 가능`,
      ''
    )
    if (input === null) return // 취소 버튼

    let newPassword = input.trim()
    if (newPassword === '') {
      newPassword = '123456'
    } else if (newPassword.length < 6) {
      alert('비밀번호는 6자 이상이어야 해요')
      return
    }

    if (!confirm(
      `다음 학생의 비밀번호를 "${newPassword}"로 초기화할까요?\n\n` +
      `학생: ${realname} (${username})\n\n` +
      `학생에게 이 비밀번호를 알려주고 로그인 후 변경하라고 안내해주세요.`
    )) return

    setSavingId(studentId)
    try {
      // 현재 로그인 세션의 access token 가져오기
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        alert('로그인 세션이 만료됐어요. 다시 로그인해주세요.')
        setSavingId(null)
        return
      }

      const res = await fetch('/api/reset-student-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          newPassword,
          accessToken: session.access_token
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '초기화 실패')

      alert(
        `✅ 비밀번호 초기화 완료!\n\n` +
        `학생: ${realname}\n` +
        `새 비밀번호: ${newPassword}\n\n` +
        `학생에게 이 비밀번호를 전달해주세요.`
      )
    } catch(e) {
      // 친절한 에러 메시지 변환
      let msg = e.message || '알 수 없는 오류'
      if (msg.includes('Service Role Key') || msg.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        msg = '⚠️ Vercel 환경변수 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았어요.\n관리자에게 문의하세요.'
      } else if (msg.includes('Password should be at least')) {
        const m = msg.match(/at least (\d+)/)
        msg = `비밀번호는 ${m ? m[1] : 6}자 이상이어야 해요.`
      } else if (msg.includes('User not found')) {
        msg = '해당 학생 계정을 찾을 수 없어요.'
      } else if (msg.includes('rate limit') || msg.includes('429')) {
        msg = '잠시 후 다시 시도해주세요. (요청 한도 초과)'
      }
      alert('실패: ' + msg)
    }
    setSavingId(null)
  }

  // 🔐 선택한 학생들 비밀번호 일괄 초기화
  const resetPasswordsBulk = async () => {
    const targetIds = [...selectedStudentIds].filter(id => {
      const s = students.find(x => x.id === id)
      return s && !s.is_hidden
    })
    if (targetIds.length === 0) return alert('선택된 학생이 없어요 (숨김 학생은 제외돼요)')

    const input = prompt(
      `🔐 선택한 ${targetIds.length}명의 비밀번호를 일괄 초기화합니다.\n\n` +
      `새 비밀번호를 입력하세요.\n` +
      `※ 그대로 [확인] 누르면 "123456"으로 초기화됩니다.\n` +
      `※ 6자 이상 입력 가능`,
      ''
    )
    if (input === null) return

    let newPassword = input.trim()
    if (newPassword === '') newPassword = '123456'
    else if (newPassword.length < 6) {
      alert('비밀번호는 6자 이상이어야 해요')
      return
    }

    if (!confirm(
      `${targetIds.length}명의 비밀번호를 모두 "${newPassword}"로 초기화할까요?\n\n` +
      `학생들에게 이 비밀번호를 알려주고 로그인 후 변경하라고 안내해주세요.`
    )) return

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      alert('로그인 세션이 만료됐어요. 다시 로그인해주세요.')
      return
    }

    let success = 0, failed = 0
    const failedNames = []
    for (const studentId of targetIds) {
      try {
        const res = await fetch('/api/reset-student-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, newPassword, accessToken: session.access_token })
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || '실패')
        }
        success++
      } catch(e) {
        failed++
        const s = students.find(x => x.id === studentId)
        if (s) failedNames.push(s.realname)
      }
    }

    alert(
      `✅ 성공: ${success}명\n` +
      (failed > 0 ? `❌ 실패: ${failed}명 (${failedNames.join(', ')})\n\n` : '') +
      `새 비밀번호: ${newPassword}\n\n` +
      `학생들에게 이 비밀번호를 전달해주세요.`
    )
    setSelectedStudentIds(new Set())
  }

  // 🆔 학생 아이디 수정 (인라인)
  const saveUsername = async (studentId, originalUsername) => {
    const newUsername = (editingExistingUsernames[studentId] || '').trim().toLowerCase()
    if (!newUsername || newUsername === originalUsername) {
      // 변경 없음
      setEditingExistingUsernames(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
      return
    }

    // 형식 검증
    if (!/^[a-z0-9_]{3,20}$/.test(newUsername)) {
      alert('아이디는 영문 소문자, 숫자, 밑줄(_)만 사용 가능하고 3~20자여야 해요')
      return
    }

    // 중복 확인 (같은 학급 또는 전체)
    const duplicate = students.find(s => s.id !== studentId && s.username === newUsername)
    if (duplicate) {
      alert(`이미 사용 중인 아이디예요: ${duplicate.realname}`)
      return
    }

    if (!confirm(
      `학생 아이디를 변경할까요?\n\n` +
      `이전: ${originalUsername}\n` +
      `새 아이디: ${newUsername}\n\n` +
      `학생에게 새 아이디를 꼭 알려주세요!`
    )) return

    setSavingId(studentId)
    try {
      // 1) auth email 변경 필요 (가짜 이메일 구조: username@literacy.local)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('로그인 세션 만료')

      const res = await fetch('/api/update-student-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, newUsername, accessToken: session.access_token })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '아이디 변경 실패')

      alert(`✅ 아이디가 변경되었어요!\n\n새 아이디: ${newUsername}`)
      setEditingExistingUsernames(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('아이디 변경 실패: ' + (e.message || e))
    }
    setSavingId(null)
  }

  // 🆔 학생 이름 수정 (인라인)
  const saveRealname = async (studentId, originalName) => {
    const newName = (editingRealnames[studentId] || '').trim()
    if (!newName || newName === originalName) {
      setEditingRealnames(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
      return
    }

    if (newName.length < 1 || newName.length > 20) {
      alert('이름은 1~20자 사이로 입력해주세요')
      return
    }

    if (!confirm(
      `학생 이름을 변경할까요?\n\n` +
      `이전: ${originalName}\n` +
      `새 이름: ${newName}`
    )) return

    setSavingId(studentId)
    try {
      const { error } = await supabase.from('profiles')
        .update({ realname: newName })
        .eq('id', studentId)
      if (error) throw error

      setEditingRealnames(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('이름 변경 실패: ' + (e.message || e))
    }
    setSavingId(null)
  }

  // 학생 체크박스 토글
  const toggleStudentSelect = (id) => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 번호 인라인 편집 저장
  const saveNumber = async (studentId) => {
    const newNumber = (editingNumbers[studentId] || '').trim()
    setSavingId(studentId)
    try {
      const { error } = await supabase.from('profiles')
        .update({ number: newNumber || null })
        .eq('id', studentId)
      if (error) throw error
      // 로컬 상태 업데이트
      setStudents(prev => prev.map(s =>
        s.id === studentId ? { ...s, number: newNumber || null } : s
      ))
      // 편집 상태 클리어
      setEditingNumbers(prev => {
        const next = { ...prev }
        delete next[studentId]
        return next
      })
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 동의서 회신 체크 토글
  // ★ 켤 때(newValue=true)는 종이 동의 처리 API(/api/consent-paper)를 경유해 실명 잠금까지 해제.
  //   끌 때(false)는 기존대로 consent_received만 내림(실명 재잠금은 범위 밖).
  const toggleConsent = async (studentId, currentValue) => {
    if (isImpersonating) return  // 임퍼소네이션(읽기 전용) 중엔 실행 안 함
    const newValue = !currentValue
    // 단건 확인 다이얼로그 — 실명 공개/철회는 학부모 재동의 없이는 되돌리기 부담이라 오클릭을 막는다.
    //  표시 이름(displayStudentName)만 사용 — 잠금 상태면 닉네임/번호가 들어감(평문 실명을 새로 끌어오지 않음).
    const s = students.find(x => x.id === studentId)
    const who = s ? displayStudentName(s) : '이 학생'
    const ok = confirm(newValue
      ? `${who} 학생의 동의서를 받은 것으로 처리합니다.\n학생의 실명이 선생님 화면에 공개됩니다. 진행할까요?`
      : `${who} 학생의 동의를 철회하고 실명을 다시 가립니다.\n학부모가 다시 동의해야 공개됩니다. 진행할까요?`)
    if (!ok) return
    setSavingId(studentId)
    try {
      if (newValue) {
        // 종이 동의 ✓ — 새 API로 실명 해제 + 동의 기록
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('로그인 세션이 만료됐어요. 새로고침 후 다시 시도해주세요.')
        const res = await fetch('/api/consent-paper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentIds: [studentId], accessToken: session.access_token })
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || '처리에 실패했어요.')
        const r = data.results || {}
        if ((r.unlockFailed || []).length > 0) {
          alert('동의 처리는 됐지만 실명 자동 표시에 실패했어요. 목록에서 이름을 직접 입력해주세요.')
        }
      } else {
        // 동의 철회 — 새 API(action:'lock')로 실명 재잠금(닉네임 전환) + 동의 해제
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('로그인 세션이 만료됐어요. 새로고침 후 다시 시도해주세요.')
        const res = await fetch('/api/consent-paper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentIds: [studentId], accessToken: session.access_token, action: 'lock' })
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || '처리에 실패했어요.')
      }
      await loadStudents(classInfo.id)  // realname도 바뀌므로 재조회
    } catch(e) {
      alert('저장 실패: ' + (e.message || e))
    }
    setSavingId(null)
  }

  // 학생 숨김/복원 토글
  const toggleHidden = async (studentId, studentName, currentValue) => {
    const newValue = !currentValue
    if (newValue) {
      // 숨김 처리
      const reason = prompt(
        `🙈 "${studentName}" 학생을 숨김 처리할까요?\n\n` +
        `숨김 처리하면:\n` +
        `- 통계/그래프/제출 현황에서 제외됩니다\n` +
        `- 학생 본인은 여전히 로그인 가능 (데이터 보존)\n` +
        `- 언제든지 복원 가능합니다\n\n` +
        `사유를 입력해주세요 (선택, 예: 전출, 휴학 등):`,
        '전출'
      )
      if (reason === null) return // 취소

      setSavingId(studentId)
      try {
        const { error } = await supabase.from('profiles').update({
          is_hidden: true,
          hidden_at: new Date().toISOString(),
          hidden_reason: (reason || '').trim() || null
        }).eq('id', studentId)
        if (error) throw error
        await loadStudents(classInfo.id)
      } catch(e) {
        alert('실패: ' + e.message)
      }
      setSavingId(null)
    } else {
      // 복원
      if (!confirm(`"${studentName}" 학생을 다시 활성화할까요?`)) return
      setSavingId(studentId)
      try {
        const { error } = await supabase.from('profiles').update({
          is_hidden: false,
          hidden_at: null,
          hidden_reason: null
        }).eq('id', studentId)
        if (error) throw error
        await loadStudents(classInfo.id)
      } catch(e) {
        alert('실패: ' + e.message)
      }
      setSavingId(null)
    }
  }

  // 🆕 step255: 선택 학생 일괄 숨김 (확인창·건수명시, 임퍼소네이션 차단)
  const bulkHide = async () => {
    if (isImpersonating) return  // 읽기 전용 모드 차단
    const targets = students.filter(s => selectedStudentIds.has(s.id) && !s.is_hidden).map(s => s.id)
    if (targets.length === 0) {
      alert('선택한 학생이 이미 모두 숨김 처리돼 있어요')
      return
    }
    if (!confirm(`선택한 ${targets.length}명을 숨길까요?\n\n통계·목록에서 빠지지만 학생 로그인·글은 그대로 보존돼요. 언제든 복원할 수 있어요.`)) return
    const reason = prompt('사유 (선택, 예: 전출·휴학):', '전출')
    if (reason === null) return  // 취소
    setSavingId('bulk')
    try {
      const { error } = await supabase.from('profiles').update({
        is_hidden: true,
        hidden_at: new Date().toISOString(),
        hidden_reason: (reason || '').trim() || null
      }).in('id', targets)
      if (error) throw error
      clearSelection()
      await loadStudents(classInfo.id)
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 🆕 step255: 선택 학생 일괄 해제(복원)
  const bulkUnhide = async () => {
    if (isImpersonating) return  // 읽기 전용 모드 차단
    const targets = students.filter(s => selectedStudentIds.has(s.id) && s.is_hidden).map(s => s.id)
    if (targets.length === 0) {
      alert('선택한 학생 중 숨김 상태가 없어요')
      return
    }
    if (!confirm(`선택한 ${targets.length}명을 다시 보이게 할까요?`)) return
    setSavingId('bulk')
    try {
      const { error } = await supabase.from('profiles').update({
        is_hidden: false,
        hidden_at: null,
        hidden_reason: null
      }).in('id', targets)
      if (error) throw error
      clearSelection()
      await loadStudents(classInfo.id)
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 동의서 일괄 처리 (체크 / 해제)
  // ★ 켤 때(newValue=true)는 종이 동의 API(/api/consent-paper) 1회 호출로 실명 잠금까지 해제.
  //   끌 때(false)는 기존대로 consent_received만 내림(실명 재잠금 범위 밖).
  const bulkToggleConsent = async (newValue) => {
    if (isImpersonating) return  // 임퍼소네이션(읽기 전용) 중엔 실행 안 함
    const targets = students.filter(s => !s.is_hidden && s.consent_received !== newValue)
    if (targets.length === 0) {
      alert(newValue ? '이미 모든 학생이 회신 처리되어 있어요' : '회신 처리된 학생이 없어요')
      return
    }
    // 해제(재잠금)는 실명 가림 경고를 명확히 — 체크와 다른 문구.
    const ok = newValue
      ? confirm(`${targets.length}명의 동의서를 "회신 완료로 일괄 처리"할까요?`)
      : confirm('선택한 학생의 실명을 다시 가립니다. 학부모가 다시 동의해야 공개돼요. 진행할까요?')
    if (!ok) return

    setSavingId('bulk-consent')
    try {
      if (newValue) {
        // 종이 동의 ✓ 일괄 — 새 API 1회 호출
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('로그인 세션이 만료됐어요. 새로고침 후 다시 시도해주세요.')
        const res = await fetch('/api/consent-paper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentIds: targets.map(s => s.id), accessToken: session.access_token })
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || '처리에 실패했어요.')
        const r = data.results || {}
        const nUnlock = (r.unlocked || []).length
        const nConsent = (r.consentOnly || []).length
        const nAlready = (r.alreadyDone || []).length
        const nFail = (r.unlockFailed || []).length
        const nSkip = (r.skipped || []).length
        let msg = `✅ 실명 표시 ${nUnlock}명 · 동의 처리 ${nConsent}명`
        if (nAlready > 0) msg += `\n이미 완료 ${nAlready}명`
        if (nSkip > 0) msg += `\n건너뜀 ${nSkip}명`
        if (nFail > 0) msg += `\n⚠️ 이름 수동 입력 필요 ${nFail}명 (동의는 처리됨 — 목록에서 이름을 직접 입력해주세요)`
        alert(msg)
      } else {
        // 동의 일괄 철회 — 새 API(action:'lock')로 실명 재잠금(닉네임 전환) + 동의 해제
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('로그인 세션이 만료됐어요. 새로고침 후 다시 시도해주세요.')
        const res = await fetch('/api/consent-paper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentIds: targets.map(s => s.id), accessToken: session.access_token, action: 'lock' })
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data.ok) throw new Error(data.error || '처리에 실패했어요.')
        const r = data.results || {}
        const nRelock = (r.relocked || []).length
        const nSkip = (r.skipped || []).length
        let msg = `✅ 닉네임으로 전환 ${nRelock}명`
        if (nSkip > 0) msg += `\n이미 닉네임 상태 ${nSkip}명은 그대로`
        alert(msg)
      }
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('실패: ' + (e.message || e))
    }
    setSavingId(null)
  }

  // 모든 학생 번호 일괄 저장 (편집 중인 것들만)
  const saveAllNumbers = async () => {
    const ids = Object.keys(editingNumbers)
    if (ids.length === 0) return alert('변경된 번호가 없어요')
    if (!confirm(`${ids.length}명의 번호를 저장할까요?`)) return

    let success = 0, failed = 0
    for (const id of ids) {
      try {
        const num = (editingNumbers[id] || '').trim()
        const { error } = await supabase.from('profiles')
          .update({ number: num || null }).eq('id', id)
        if (error) throw error
        success++
      } catch(e) { failed++ }
    }
    alert(`✅ 성공: ${success}명${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
    setEditingNumbers({})
    await loadStudents(classInfo.id)
  }

  // 학생 명단 엑셀 다운로드 (담임용 출력)
  const downloadStudentList = async () => {
    if (!students.length) return alert('등록된 학생이 없어요')

    const includeHidden = confirm(
      `👥 학생 명단을 엑셀로 다운로드할까요?\n\n` +
      `[확인] 활성 + 숨김 학생 모두 다운로드\n` +
      `[취소] 활성 학생만 다운로드 (전출생 제외)`
    )

    const reason = prompt(
      `📝 다운로드 사유를 입력해주세요 (감사용 기록):\n\n` +
      `예: "학생들에게 아이디 안내", "백업용", "학기말 정리" 등\n\n` +
      `※ 학생 개인정보가 포함된 파일이니 안전하게 관리해주세요.\n` +
      `※ 다운로드 후 사용 끝나면 즉시 파일을 삭제해주세요.`,
      ''
    )
    if (reason === null) return

    setSavingId('download')
    try {
      const XLSX = (await import('xlsx')).default || (await import('xlsx'))

      const targets = includeHidden ? [...students] : students.filter(s => !s.is_hidden)
      // 정렬: 활성 먼저, 번호순
      targets.sort((a, b) => {
        if (a.is_hidden !== b.is_hidden) return a.is_hidden ? 1 : -1
        const na = parseInt(a.number) || 999
        const nb = parseInt(b.number) || 999
        if (na !== nb) return na - nb
        return (a.realname || '').localeCompare(b.realname || '')
      })

      // 시트1: 학생 명단
      const sheet1Data = targets.map(s => ({
        '번호': s.number || '',
        '이름': s.realname || '',
        '아이디': s.username || '',
        '초기 비밀번호': '123456',
        '닉네임': s.nickname || '',
        '동의서 회신': s.consent_received ? '✓' : '',
        '상태': s.is_hidden ? `숨김${s.hidden_reason ? ' (' + s.hidden_reason + ')' : ''}` : '활성'
      }))
      const ws1 = XLSX.utils.json_to_sheet(sheet1Data)
      ws1['!cols'] = [
        { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 18 }
      ]

      // 시트2: 메타 정보
      const now = new Date()
      const dateStr = now.toLocaleString('ko-KR')
      const meta = [
        ['항목', '값'],
        ['다운로드 일시', dateStr],
        ['다운로드 사유', reason.trim() || '(미입력)'],
        ['학교', user?.school || '-'],
        ['학급', classInfo?.name || '-'],
        ['담임', user?.realname || '-'],
        ['전체 학생 수', String(targets.length)],
        ['활성 학생', String(targets.filter(s => !s.is_hidden).length)],
        ['숨김 학생', String(targets.filter(s => s.is_hidden).length)],
        ['', ''],
        ['※ 주의', '본 파일은 학생 개인정보를 포함합니다.'],
        ['', '안전하게 관리하시고, 사용 후 즉시 삭제해주세요.'],
        ['', '초기 비밀번호는 모든 학생이 동일하게 "123456"입니다.'],
        ['', '학생이 비밀번호를 변경한 경우 위 값과 다를 수 있습니다.']
      ]
      const ws2 = XLSX.utils.aoa_to_sheet(meta)
      ws2['!cols'] = [{ wch: 18 }, { wch: 50 }]

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws1, '학생 명단')
      XLSX.utils.book_append_sheet(wb, ws2, '메타 정보')

      const fileName = `학생명단_${classInfo?.name || ''}_${now.toISOString().slice(0,10)}.xlsx`
      XLSX.writeFile(wb, fileName)
    } catch(e) {
      alert('다운로드 실패: ' + e.message)
    }
    setSavingId(null)
  }

  // 닉네임 없는 학생에게 일괄 부여
  const assignMissingNicknames = async () => {
    const targets = students.filter(s => !s.nickname && !s.is_hidden)
    if (targets.length === 0) {
      alert('모든 학생이 이미 닉네임을 가지고 있어요!')
      return
    }
    if (!confirm(
      `🎭 닉네임 없는 학생 ${targets.length}명에게 닉네임을 부여할까요?\n\n` +
      `예: "용감한 코끼리", "푸른 토끼" 등\n` +
      `학급 내 중복 없이 자동 생성됩니다.`
    )) return

    setSavingId('bulk-nickname')
    try {
      const { generateUniqueNickname } = await import('../../lib/nickname')
      // 현재 사용 중인 닉네임 수집
      const used = students.map(s => s.nickname).filter(Boolean)

      let success = 0, failed = 0
      for (const s of targets) {
        try {
          const nickname = generateUniqueNickname(used)
          used.push(nickname)
          const { error } = await supabase.from('profiles')
            .update({ nickname }).eq('id', s.id)
          if (error) throw error
          success++
        } catch(e) {
          failed++
        }
      }
      alert(`✅ 닉네임 부여 완료!\n성공: ${success}명${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
      await loadStudents(classInfo.id)
    } catch(e) {
      alert('실패: ' + e.message)
    }
    setSavingId(null)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  // 🆕 step207-D: 컨시어지 단계 판정 (students 배열에서 파생 — 새 상태값 없음)
  //   active=활성(숨김 제외) 학생 수, locked=동의 대기(realname 빈값, step188 기준)
  //   step 1 등록 → 2 동의(선택) → 3 수업. ★동의는 게이트가 아니라 진행 표시(게이지)일 뿐.
  const conciergeActive = students.filter(s => !s.is_hidden).length
  const conciergeLocked = students.filter(s => !s.is_hidden && !(s.realname && String(s.realname).trim())).length
  const conciergeStep = conciergeActive === 0 ? 1 : (conciergeLocked > 0 ? 2 : 3)
  // 기본 탭: 활성 0명이면 등록, 있으면 목록. 사용자가 누르면 mode가 고정됨.
  const effectiveMode = mode || (conciergeActive === 0 ? 'register' : 'list')

  return (
    <>
      <Head><title>학생 관리 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user.realname} targetSchool={user.school} />}
        <Header user={user} onLogout={logout} />
        <main className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          <div className="flex items-center gap-3">
            <Link href={withImpersonation("/teacher")} className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">학생 관리</h1>
          </div>

          {/* 학급 정보 */}
          {classInfo && (
            <div className="bg-primary-light border border-primary rounded-2xl p-4">
              <div className="text-sm text-primary-dark">
                <strong>{classInfo.name}</strong> · 학생 가입 코드: <span className="font-mono font-bold tracking-widest">{classInfo.code}</span>
              </div>
            </div>
          )}

          {/* 🆕 임퍼소네이션 안내 */}
          {isImpersonating && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              📖 읽기 전용입니다. 학생 등록/수정/삭제, 비밀번호 초기화 등 모든 변경 작업은 차단되어 있어요.
            </div>
          )}

          {/* 🆕 step207-D: 진행표시 게이지 (①학생등록 ②동의(선택) ③수업) — 띠만, 행동 배너는 메인 허브로 */}
          {classInfo && (
            <div className="flex items-center gap-1 sm:gap-2">
              {[
                { n: 1, label: '학생 등록' },
                { n: 2, label: '동의', sub: '(선택)' },
                { n: 3, label: '수업 시작' },
              ].map((s, i) => {
                const done = s.n < conciergeStep
                const current = s.n === conciergeStep
                return (
                  <div key={s.n} className="flex items-center gap-1 sm:gap-2 flex-1 last:flex-none">
                    <div className={`flex items-center gap-1.5 ${current ? '' : 'opacity-60'}`}>
                      <span className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                        ${done ? 'bg-green-500 text-white' : current ? 'bg-green-600 text-white ring-4 ring-green-100' : 'bg-gray-100 text-gray-400'}`}>
                        {done ? '✓' : s.n}
                      </span>
                      <span className={`text-xs sm:text-sm font-semibold ${current ? 'text-green-700' : 'text-gray-500'}`}>
                        {s.label}<span className="font-normal text-gray-400">{s.sub || ''}</span>
                      </span>
                    </div>
                    {i < 2 && <div className={`h-0.5 flex-1 rounded ${done ? 'bg-green-300' : 'bg-gray-100'}`} />}
                  </div>
                )
              })}
            </div>
          )}

          {/* 🆕 step207-D: 탭 배너 3개 — [📋등록][👥목록][🔒동의(→/consent)] */}
          {classInfo && (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <button onClick={() => setMode('register')}
                className={`rounded-2xl p-3 text-left border-2 transition ${effectiveMode === 'register' ? 'border-primary bg-primary-light shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className="text-sm sm:text-base font-bold">📋 학생 등록</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{conciergeActive > 0 ? `${conciergeActive}명 등록됨` : '아직 없어요'}</div>
              </button>
              <button onClick={() => setMode('list')}
                className={`rounded-2xl p-3 text-left border-2 transition ${effectiveMode === 'list' ? 'border-primary bg-primary-light shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className="text-sm sm:text-base font-bold">👥 학생 목록</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{conciergeActive}명 보기</div>
              </button>
              <Link href={withImpersonation('/teacher/students/consent')}
                className="rounded-2xl p-3 text-left border-2 border-gray-200 bg-white hover:border-gray-300 transition">
                <div className="text-sm sm:text-base font-bold">🔒 동의서 관리</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{conciergeLocked > 0 ? `대기 ${conciergeLocked}명 →` : '관리 →'}</div>
              </Link>
            </div>
          )}

          {/* ===== 등록 탭 ===== */}
          {effectiveMode === 'register' && (<>

          {/* 🆕 step158: 학생 1명 개별 추가 (신규 교사 간보기 / 전학생 추가) */}
          {!isImpersonating && (
            <div className="bg-white rounded-2xl p-5 shadow-sm border-2 border-green-200">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="font-bold">➕ 학생 1명 추가</h3>
                  <p className="text-sm text-gray-600">테스트로 1명만 먼저 만들거나, 전학생 1명을 추가할 때 좋아요</p>
                </div>
                {!showAddOne && (
                  <button
                    type="button"
                    onClick={openAddOne}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 flex-shrink-0">
                    ➕ 한 명 추가
                  </button>
                )}
              </div>

              {showAddOne && (
                <div className="mt-3 space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    <input
                      type="text"
                      value={addOneForm.realname}
                      onChange={e => onAddOneFieldChange('realname', e.target.value)}
                      placeholder="이름 (필수)"
                      className="flex-1 min-w-[140px] px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      autoFocus
                    />
                    <input
                      type="number"
                      value={addOneForm.number}
                      onChange={e => onAddOneFieldChange('number', e.target.value)}
                      placeholder="번호 (선택)"
                      className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>

                  {/* 🆕 step160: 아이디 직접 지정 (자동 미리보기 + 수동 수정) */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-gray-700">아이디</label>
                      {addOneIdManual && (
                        <button
                          type="button"
                          onClick={resetAddOneIdToAuto}
                          className="text-xs px-2 py-0.5 border border-gray-200 text-gray-600 rounded hover:bg-gray-50">
                          🔄 자동으로
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={addOneForm.username}
                      onChange={e => onAddOneIdChange(e.target.value)}
                      placeholder="이름·번호 입력 시 자동으로 채워져요"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono"
                      maxLength={20}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    {addOneIdHint
                      ? <p className="text-xs text-red-600 mt-1">{addOneIdHint}</p>
                      : <p className="text-xs text-gray-500 mt-1">{addOneIdManual ? '직접 지정한 아이디를 사용해요 (영문 소문자·숫자 4~20자)' : '자동 생성된 아이디예요. 직접 고쳐도 돼요.'}</p>
                    }
                  </div>

                  <p className="text-xs text-gray-500">
                    번호를 비우면 다음 번호로 자동 배정돼요. 초기 비밀번호는 <strong>123456</strong>입니다.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowAddOne(false); setAddOneResult(null) }}
                      className="flex-1 py-2 border border-gray-200 rounded-lg text-sm">
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={submitAddOne}
                      disabled={addingOne}
                      className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-60">
                      {addingOne ? '추가 중...' : '추가하기'}
                    </button>
                  </div>
                </div>
              )}

              {addOneResult && (
                <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                  <p className="font-semibold text-green-900 mb-1">✅ 추가 완료! 학생에게 알려주세요</p>
                  <div className="flex gap-4 flex-wrap font-mono">
                    <span>아이디: <strong className="text-green-800">{addOneResult.username}</strong></span>
                    <span>비밀번호: <strong className="text-green-800">{addOneResult.password}</strong></span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">학생은 학급 가입 코드 없이 이 아이디·비밀번호로 바로 로그인할 수 있어요.</p>
                </div>
              )}
            </div>
          )}

          {/* 일괄 등록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold mb-2">📋 학급명렬표 일괄 등록</h3>

            {/* 🔒 명단 처리 안심 안내 — 카드 첫 요소(실명 올리기 전 가장 먼저 보이게). 코드로 확인된 사실만, 단정 금지. */}
            <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm p-3 rounded-lg mb-3 leading-relaxed">
              <p className="font-semibold mb-2">🔒 학생 명단, 이렇게 안전하게 지켜져요</p>
              {/* 핵심 안심 — 흰 배경 강조 줄 */}
              <p className="bg-white border border-blue-200 rounded-md px-3 py-2 mb-2 text-[15px] font-semibold text-blue-900 leading-relaxed">
                👉 지금 학부모 동의를 먼저 안 받아도 명렬표를 올릴 수 있어요 — 실명은 동의 전까지 암호화돼 잠겨 있어요.
              </p>
              <ul className="text-xs space-y-1.5 text-blue-800">
                <li>· 명렬표 파일은 선생님 브라우저에서만 읽어요. 파일 자체는 서버에 올라가지 않아요.</li>
                <li>· 학생 이름은 암호화돼 잠긴 채 보관되고, 화면엔 닉네임으로 표시돼요. AI 채점에도 실명은 안 가요(글 내용만).</li>
                <li>· 실명은 학부모 동의를 받은 학생만 풀려요. 동의 전까진 닉네임으로 모든 기능을 써요.</li>
                <li>· 선생님 재량 사용은 학교운영위 심의 대상으로 보기 어려워요(학교가 정규 교육과정 교재로 공식 채택할 땐 심의 필요). 학교마다 기준이 다르니 확인은 권장드려요.</li>
              </ul>
            </div>

            {!user?.school && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm p-3 rounded-lg mb-3">
                ⚠️ 학교명이 등록되지 않았어요!<br/>
                메인 화면 → "✏️ 내 정보 수정"에서 학교명을 먼저 입력해주세요.
              </div>
            )}
            <div className="space-y-3">
              {/* 드래그앤드롭 드롭존 — 드롭한 파일도 기존 handleFile 검증(확장자·이미지PDF 거부 등)을 그대로 탄다 */}
              <div
                onDragOver={(e) => { if (!user?.school) return; e.preventDefault(); setDragOver(true) }}
                onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false)
                  if (!user?.school) return
                  const f = e.dataTransfer?.files?.[0]
                  if (f) handleFile(f)   // 이벤트가 아닌 파일을 직접 전달 → handleFile이 둘 다 허용
                }}
                className={`rounded-lg border-2 border-dashed p-4 text-center transition ${
                  dragOver ? 'border-primary bg-primary-light' : 'border-gray-300 bg-gray-50'
                } ${!user?.school ? 'opacity-50' : ''}`}>
                <p className="text-sm text-gray-600 mb-2">
                  📂 여기로 파일을 끌어다 놓거나, <strong>[파일 선택]</strong>을 눌러 올리세요
                  <span className="block text-xs text-gray-400 mt-0.5">엑셀(.xlsx, .xls) · 텍스트 PDF(.pdf) 지원</span>
                </p>
                <label className="inline-block">
                  <span className="sr-only">엑셀 또는 PDF 파일 선택</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.pdf"
                    onChange={handleFile}
                    disabled={!user?.school}
                    className="w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-primary file:text-white file:cursor-pointer disabled:opacity-50"
                  />
                </label>
              </div>
              {uploadStatus && (
                <div className="text-sm bg-blue-50 text-blue-900 p-3 rounded-lg whitespace-pre-line">{uploadStatus}</div>
              )}
              {parsedStudents.length > 0 && (
                <>
                  {/* prefix 일괄 변경 (자동 생성된 학생이 있을 때만) */}
                  {parsedStudents.some(s => s._auto) && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <label className="block text-sm font-medium text-blue-900 mb-1">
                        🆔 아이디 앞부분 (prefix) - 일괄 변경
                      </label>
                      <div className="flex gap-2 items-center flex-wrap">
                        <input
                          type="text"
                          value={idPrefix}
                          onChange={e => updatePrefixAndRegenerate(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                          placeholder="예: hr, abc, gildong"
                          className="flex-1 min-w-[120px] px-3 py-2 border border-blue-200 rounded text-sm font-mono"
                          maxLength="10"
                        />
                        {defaultPrefix && idPrefix !== defaultPrefix && (
                          <button
                            onClick={() => updatePrefixAndRegenerate(defaultPrefix)}
                            className="text-xs px-2 py-2 border border-blue-200 text-blue-700 rounded hover:bg-blue-100">
                            ↻ 기본값 ({defaultPrefix})
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-blue-700 mt-2">
                        💡 prefix를 바꾸면 모든 학생 아이디가 자동 변경돼요.
                        형식: <code className="font-mono bg-white px-1">[prefix][학년][반][번호 2자리]</code>
                        {parsedStudents[0]?._auto && (
                          <span> (예: <code className="font-mono bg-white px-1">{parsedStudents[0]?.username}</code>)</span>
                        )}
                      </p>
                    </div>
                  )}

                  <div className="bg-gray-50 rounded-lg p-3 max-h-72 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-sm min-w-[320px]">
                      <thead><tr className="text-left border-b">
                        <th className="py-1 px-2 w-14">번호</th>
                        <th className="py-1 px-2 w-24">이름</th>
                        <th className="py-1 px-2">아이디 (개별 수정 가능)</th>
                      </tr></thead>
                      <tbody>
                        {parsedStudents.map((s, i) => {
                          const editValue = editingUsernames[i] !== undefined ? editingUsernames[i] : s.username
                          const isEdited = editingUsernames[i] !== undefined && editingUsernames[i] !== s.username
                          return (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="py-1 px-2">{s.number}</td>
                              <td className="py-1 px-2">{displayStudentName(s)}</td>
                              <td className="py-1 px-2">
                                <input
                                  type="text"
                                  value={editValue}
                                  onChange={e => setEditingUsernames(prev => ({
                                    ...prev,
                                    [i]: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')
                                  }))}
                                  className={`w-full px-2 py-1 text-xs font-mono border rounded ${
                                    isEdited ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                                  }`}
                                  maxLength="30"
                                />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setParsedStudents([])
                        setEditingUsernames({})
                        setUploadStatus(null)
                      }}
                      disabled={uploading}
                      className="px-4 py-3 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-50">
                      ✖ 취소
                    </button>
                    <button onClick={submitBulk} disabled={uploading}
                      className="flex-1 py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                      {uploading ? '등록 중...' : `📥 ${parsedStudents.length}명 일괄 등록`}
                    </button>
                  </div>
                </>
              )}
              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer hover:text-gray-700">📖 명렬표 형식 안내</summary>
                <div className="mt-2 p-3 bg-gray-50 rounded space-y-2">
                  <div>
                    <p className="font-semibold text-gray-700">✅ 권장: 나이스 학급명렬표</p>
                    <code className="block mt-1 font-mono text-[11px]">학년 | 반 | 번호 | 성명 | 비고</code>
                    <p className="mt-1">→ 아이디는 자동 생성: <strong>[학교초성][학년][반][번호]</strong></p>
                    <p>예: ○○초등학교(초성 abc) 5학년 1반 1번 → <code className="font-mono">abc5101</code></p>
                    <p className="mt-1 text-amber-700">학생들에게 본인 아이디 알려주는 것 잊지 마세요!</p>
                  </div>
                  <div className="pt-2 border-t border-gray-200">
                    <p className="font-semibold text-gray-700">✅ 또는: 아이디 직접 지정</p>
                    <code className="block mt-1 font-mono text-[11px]">학년 | 반 | 번호 | 성명 | 아이디 | 비고</code>
                    <p className="mt-1">아이디 컬럼이 있으면 그 값을 그대로 사용합니다.</p>
                  </div>
                </div>
              </details>
            </div>

            {/* 설명 블록 — 드롭존 아래로 이동(드롭존을 설명보다 먼저 보이게) */}
            <p className="text-sm text-gray-600 mt-4 mb-3">
              <strong>나이스에서 다운받은 학급명렬표 엑셀(.xlsx)</strong>을 그대로 올리면 돼요.
              아이디는 자동으로 만들어지고, 초기 비밀번호는 모두 <strong>123456</strong>입니다.
            </p>

            {/* 나이스 다운로드 경로 안내 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
              <p className="font-bold mb-2">📍 나이스에서 명렬표 받는 방법</p>
              <ol className="list-decimal pl-5 space-y-1 leading-relaxed">
                <li>나이스 접속 → <strong>[기본학적관리]</strong> 메뉴</li>
                <li><strong>[명렬표 출력]</strong> 클릭</li>
                <li><strong>[조회]</strong> 클릭하여 우리 반 학생 목록 표시</li>
                <li>오른쪽 위 <strong className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded">[엑셀 내려받기]</strong> 초록색 버튼 클릭 (권장)</li>
                <li>다운로드된 파일을 위 업로드 칸에 올리기</li>
              </ol>
              <div className="mt-2 bg-white rounded p-2 space-y-1">
                <p>✅ <strong>엑셀 (.xlsx)</strong> - 가장 정확, 권장</p>
                <p>✅ <strong>PDF (.pdf)</strong> - 텍스트 PDF만 가능 (인식 후 결과 확인 필수)</p>
                <p className="text-red-700">❌ <strong>이미지 PDF (스캔본)</strong> - 인식 불가</p>
              </div>
              {/* 🆕 나이스를 못 쓰는 경우 — 빈 양식 직접 작성 */}
              <div className="mt-2 flex items-center justify-between flex-wrap gap-2 bg-white rounded p-2">
                <span className="text-blue-900">
                  📄 나이스 명렬표를 받기 어렵나요? 빈 양식을 받아 직접 채워도 돼요
                  <span className="text-blue-700/70"> (전입생 추가 등록에도 좋아요)</span>
                </span>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 flex-shrink-0">
                  📥 양식 다운로드
                </button>
              </div>
            </div>
          </div>

          </>)}
          {/* ===== /등록 탭 ===== */}

          {/* ===== 목록 탭 ===== */}
          {effectiveMode === 'list' && (
          /* 등록된 학생 목록 */
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-bold">
                👥 등록된 학생
                {(() => {
                  const active = students.filter(s => !s.is_hidden).length
                  const hidden = students.filter(s => s.is_hidden).length
                  const noNickname = students.filter(s => !s.is_hidden && !s.nickname).length
                  return (
                    <span className="ml-1">
                      ({active}명{hidden > 0 && <span className="text-gray-400"> · 숨김 {hidden}명</span>}
                      {noNickname > 0 && <span className="text-amber-600 ml-1">· 닉네임 없음 {noNickname}</span>})
                    </span>
                  )
                })()}
                {students.filter(s => !s.is_hidden).length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    동의서 회신 {students.filter(s => !s.is_hidden && s.consent_received).length}/{students.filter(s => !s.is_hidden).length}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {students.filter(s => !s.is_hidden).length > 0 && (
                  <>
                    <button onClick={downloadStudentList}
                      disabled={savingId === 'download'}
                      className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-full disabled:opacity-50">
                      {savingId === 'download' ? '⏳' : '📥 명단 엑셀'}
                    </button>
                    {(() => {
                      const active = students.filter(s => !s.is_hidden)
                      const notYet = active.filter(s => !s.consent_received).length
                      const received = active.length - notYet   // 동의 처리된(실명 공개) 학생 수
                      return (
                        <>
                          {notYet > 0 && (
                            <button onClick={() => bulkToggleConsent(true)}
                              disabled={savingId === 'bulk-consent'}
                              className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-full disabled:opacity-50"
                              title="미회신 학생들을 일괄 회신 처리">
                              {savingId === 'bulk-consent' ? '⏳' : `✓ 동의서 일괄 체크 (미회신 ${notYet}명)`}
                            </button>
                          )}
                          {received > 0 && (
                            <button onClick={() => bulkToggleConsent(false)}
                              disabled={savingId === 'bulk-consent'}
                              className="text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1 rounded-full disabled:opacity-50"
                              title="동의 처리된 학생의 실명을 다시 가림(닉네임으로 전환)">
                              {savingId === 'bulk-consent' ? '⏳' : '↻ 동의서 일괄 해제'}
                            </button>
                          )}
                        </>
                      )
                    })()}
                  </>
                )}
                {students.filter(s => !s.is_hidden && !s.nickname).length > 0 && (
                  <button onClick={assignMissingNicknames}
                    disabled={savingId === 'bulk-nickname'}
                    className="text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 px-3 py-1 rounded-full disabled:opacity-50">
                    {savingId === 'bulk-nickname' ? '⏳ 부여 중...' : `🎭 닉네임 일괄 부여 (${students.filter(s => !s.is_hidden && !s.nickname).length}명)`}
                  </button>
                )}
                {students.some(s => s.is_hidden) && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={showHidden}
                      onChange={e => setShowHidden(e.target.checked)}
                      className="w-3.5 h-3.5" />
                    <span>숨김 학생 보기</span>
                  </label>
                )}
                {Object.keys(editingNumbers).length > 0 && (
                  <button onClick={saveAllNumbers}
                    className="text-xs bg-primary text-white px-3 py-1 rounded-full">
                    💾 변경된 번호 {Object.keys(editingNumbers).length}건 일괄 저장
                  </button>
                )}
              </div>
            </div>

            {students.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">아직 등록된 학생이 없어요</p>
            ) : (() => {
              const visibleStudents = [...students]
                .filter(s => showHidden || !s.is_hidden)
                .sort((a, b) => {
                  if (a.is_hidden !== b.is_hidden) return a.is_hidden ? 1 : -1
                  const na = parseInt(a.number) || 999
                  const nb = parseInt(b.number) || 999
                  if (na !== nb) return na - nb
                  return (a.username || '').localeCompare(b.username || '')
                })
              const selectableStudents = visibleStudents.filter(s => !s.is_hidden)
              const allSelected = selectableStudents.length > 0 &&
                selectableStudents.every(s => selectedStudentIds.has(s.id))
              const selectAll = () => setSelectedStudentIds(new Set(selectableStudents.map(s => s.id)))
              const clearSelection = () => setSelectedStudentIds(new Set())
              return (
              <>
                {/* 🆕 step234: 실명→닉네임 전환 공지 — 잠긴(동의 대기) 학생이 있는 교사에게만, 교사별 1회 닫기 가능 */}
                {conciergeLocked > 0 && !relockNoticeDismissed && (
                  <div className="relative bg-amber-50 border border-amber-200 text-amber-900 text-xs sm:text-sm p-3 pr-8 rounded-lg mb-3 leading-relaxed">
                    <button
                      onClick={dismissRelockNotice}
                      className="absolute top-1.5 right-2 text-amber-400 hover:text-amber-700 font-bold leading-none text-base"
                      title="이 안내 다시 안 보기"
                      aria-label="안내 닫기">×</button>
                    🔒 개인정보 보호를 위해, 학부모 동의가 없는 학생 이름을 닉네임으로 전환했어요.{' '}
                    <Link href={withImpersonation('/teacher/students/consent')} className="font-semibold text-primary underline hover:text-primary-dark">[동의서 관리]</Link>에서 학부모 동의를 받으면 실명으로 다시 표시됩니다.{' '}
                    <span className="text-amber-700/80">(학생들은 닉네임으로 모든 기능을 그대로 이용해요.)</span>
                  </div>
                )}
                {/* 🔒 잠긴(동의 대기) 신규 학생이 한 명이라도 있을 때만 안내 — realname 빈값 기준 */}
                {students.some(s => !s.is_hidden && !(s.realname && s.realname.trim())) && (
                  <div className="bg-blue-50 border border-blue-200 text-blue-900 text-xs sm:text-sm p-3 rounded-lg mb-3 leading-relaxed">
                    💡 개인정보 보호를 위해, 동의 전 학생은 <strong>닉네임</strong>으로 표시됩니다.
                    동의가 완료된 학생은 실명으로 표시돼요.
                    <div className="mt-2 text-sm font-semibold text-blue-900">
                      👉 학부모 동의는 <Link href={withImpersonation('/teacher/students/consent')} className="text-primary underline hover:text-primary-dark">[동의서 관리]</Link>에서 보내고 받을 수 있어요
                    </div>
                    <div className="text-[11px] text-blue-700/80 mt-1">
                      아래 목록에서 <strong>🔒 동의 대기</strong> 표시가 있는 학생이 닉네임으로 보이는 중이에요 — <Link href={withImpersonation('/teacher/students/consent')} className="underline hover:text-blue-900">동의서 관리</Link>에서 동의를 받으면 실명으로 바뀌어요.
                    </div>
                  </div>
                )}
                <p className="text-xs text-gray-500 mb-2">
                  💡 번호/이름/아이디 칸 클릭해서 수정 · 동의서 ✓ · 🔑 비번 초기화 · 🙈 전출생 숨김
                </p>

                {/* 선택 도구 */}
                {selectedStudentIds.size > 0 && (
                  <div className="bg-blue-50 border border-blue-300 rounded-lg p-3 mb-3 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-blue-900">
                      ☑️ {selectedStudentIds.size}명 선택됨
                    </span>
                    <div className="flex gap-1.5 flex-wrap ml-auto">
                      <button onClick={resetPasswordsBulk}
                        className="text-xs bg-amber-500 text-white px-3 py-1 rounded hover:bg-amber-600 font-medium">
                        🔑 비밀번호 일괄 초기화
                      </button>
                      {/* 🆕 step255: 선택 학생 일괄 숨김/해제 */}
                      <button onClick={bulkHide} disabled={isImpersonating}
                        className="text-xs bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                        🙈 선택 숨김
                      </button>
                      <button onClick={bulkUnhide} disabled={isImpersonating}
                        className="text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1 rounded hover:bg-gray-50 font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                        ↻ 선택 해제(복원)
                      </button>
                      <button onClick={clearSelection}
                        className="text-xs text-gray-600 hover:text-gray-800 px-2">
                        ✕ 선택 해제
                      </button>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        <th className="py-2 px-1 w-8">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={() => allSelected ? clearSelection() : selectAll()}
                            className="w-4 h-4 cursor-pointer"
                            title="전체 선택"
                          />
                        </th>
                        <th className="py-2 px-2 w-16">번호</th>
                        <th className="py-2 px-2">이름</th>
                        <th className="py-2 px-2 hidden sm:table-cell">아이디</th>
                        <th className="py-2 px-2 text-center w-16">동의서</th>
                        <th className="py-2 px-2 text-center w-12">비번</th>
                        <th className="py-2 px-2 text-center w-12">숨김</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleStudents.map(s => {
                        const currentNumber = editingNumbers[s.id] !== undefined
                          ? editingNumbers[s.id]
                          : (s.number || '')
                        const isDirtyNum = editingNumbers[s.id] !== undefined && editingNumbers[s.id] !== (s.number || '')

                        const currentUsername = editingExistingUsernames[s.id] !== undefined
                          ? editingExistingUsernames[s.id]
                          : (s.username || '')
                        const isDirtyUsername = editingExistingUsernames[s.id] !== undefined &&
                          editingExistingUsernames[s.id] !== (s.username || '')

                        const currentRealname = editingRealnames[s.id] !== undefined
                          ? editingRealnames[s.id]
                          : displayStudentName(s)
                        const isDirtyName = editingRealnames[s.id] !== undefined &&
                          editingRealnames[s.id] !== (s.realname || '')

                        return (
                          <tr key={s.id}
                            className={`border-b border-gray-100 hover:bg-gray-50 ${
                              s.is_hidden ? 'opacity-50 bg-gray-50' :
                              selectedStudentIds.has(s.id) ? 'bg-blue-50' : ''
                            }`}>
                            <td className="py-2 px-1">
                              {!s.is_hidden && (
                                <input
                                  type="checkbox"
                                  checked={selectedStudentIds.has(s.id)}
                                  onChange={() => toggleStudentSelect(s.id)}
                                  className="w-4 h-4 cursor-pointer"
                                />
                              )}
                            </td>
                            <td className="py-2 px-2">
                              <input
                                type="text"
                                value={currentNumber}
                                onChange={e => setEditingNumbers(prev => ({ ...prev, [s.id]: e.target.value }))}
                                onBlur={() => { if (isDirtyNum) saveNumber(s.id) }}
                                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                placeholder="-"
                                className={`w-14 p-1 text-center text-sm border rounded font-mono ${
                                  isDirtyNum ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                                }`}
                                disabled={savingId === s.id || s.is_hidden}
                              />
                            </td>
                            <td className="py-2 px-2 font-medium">
                              <input
                                type="text"
                                value={currentRealname}
                                onChange={e => setEditingRealnames(prev => ({ ...prev, [s.id]: e.target.value }))}
                                onBlur={() => { if (isDirtyName) saveRealname(s.id, s.realname) }}
                                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                className={`w-full max-w-[120px] p-1 text-sm border rounded ${
                                  isDirtyName ? 'border-amber-400 bg-amber-50' : 'border-transparent hover:border-gray-200 bg-transparent'
                                }`}
                                disabled={savingId === s.id || s.is_hidden}
                                title="클릭해서 이름 수정"
                              />
                              {/* 🔒 realname이 빈값이면 잠긴(동의 대기) 신규 학생 — 닉네임은 위 입력칸에 displayStudentName으로 표시됨 */}
                              {!s.is_hidden && !(s.realname && s.realname.trim()) && (
                                <span
                                  className="inline-block mt-0.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full cursor-help"
                                  title="학부모 동의가 완료되면 실명으로 표시됩니다"
                                >🔒 동의 대기</span>
                              )}
                              {s.nickname ? (
                                <div className="text-[10px] text-purple-600 mt-0.5 flex items-center gap-1 flex-wrap">
                                  <span>🎭 {s.nickname}</span>
                                  <button
                                    onClick={() => setEditingNicknameStudent(s)}
                                    disabled={s.is_hidden}
                                    className="text-purple-500 hover:text-purple-900 underline disabled:opacity-40"
                                    title="닉네임 변경"
                                  >
                                    변경
                                  </button>
                                </div>
                              ) : (
                                !s.is_hidden && (
                                  <button
                                    onClick={() => setEditingNicknameStudent(s)}
                                    className="text-[10px] text-purple-500 hover:text-purple-900 underline mt-0.5"
                                  >
                                    🎭 닉네임 직접 부여
                                  </button>
                                )
                              )}
                              {s.is_hidden && s.hidden_reason && (
                                <div className="text-xs text-gray-400 mt-0.5">({s.hidden_reason})</div>
                              )}
                            </td>
                            <td className="py-2 px-2 text-xs hidden sm:table-cell">
                              <input
                                type="text"
                                value={currentUsername}
                                onChange={e => setEditingExistingUsernames(prev => ({ ...prev, [s.id]: e.target.value.toLowerCase() }))}
                                onBlur={() => { if (isDirtyUsername) saveUsername(s.id, s.username) }}
                                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                className={`w-full max-w-[140px] p-1 text-xs border rounded font-mono ${
                                  isDirtyUsername ? 'border-amber-400 bg-amber-50' : 'border-transparent hover:border-gray-200 bg-transparent'
                                }`}
                                disabled={savingId === s.id || s.is_hidden}
                                title="클릭해서 아이디 수정"
                              />
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => toggleConsent(s.id, s.consent_received)}
                                disabled={savingId === s.id || s.is_hidden}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded ${
                                  s.consent_received
                                    ? 'bg-green-100 text-green-700 border border-green-300'
                                    : 'bg-gray-100 text-gray-400 border border-gray-200 hover:bg-gray-200'
                                } disabled:opacity-40`}
                                title={s.consent_received ? '동의서 회신됨' : '동의서 미회신'}
                              >
                                {s.consent_received ? '✓' : '·'}
                              </button>
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => resetPassword(s.id, s.username, s.realname)}
                                disabled={savingId === s.id || s.is_hidden}
                                className="inline-flex items-center justify-center w-7 h-7 rounded text-sm text-gray-400 hover:bg-amber-100 hover:text-amber-700 disabled:opacity-40"
                                title="비밀번호 초기화 (학생이 비번 잊었을 때)"
                              >
                                🔑
                              </button>
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => toggleHidden(s.id, s.realname, s.is_hidden)}
                                disabled={savingId === s.id}
                                className={`inline-flex items-center justify-center w-7 h-7 rounded text-sm ${
                                  s.is_hidden
                                    ? 'bg-blue-100 text-blue-700 border border-blue-300 hover:bg-blue-200'
                                    : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
                                }`}
                                title={s.is_hidden ? '숨김 해제 (활성화)' : '숨김 처리 (전출생 등)'}
                              >
                                {s.is_hidden ? '↻' : '🙈'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
              )
            })()}
          </div>
          )}
          {/* ===== /목록 탭 ===== */}
        </main>
        {editingNicknameStudent && (
          <NicknameChangeModal
            targetUserId={editingNicknameStudent.id}
            currentNickname={editingNicknameStudent.nickname}
            classId={classInfo?.id}
            displayName={editingNicknameStudent.realname}
            onClose={() => setEditingNicknameStudent(null)}
            onSuccess={() => loadStudents(classInfo.id)}
          />
        )}
      </div>
    </>
  )
}

```

## pages/teacher/students/consent.js

```js
// 학부모 동의서 관리 — 온라인/종이 두 갈래 (step207-B 신설 · step207-C 두 갈래)
// ★ConsentPanel은 그대로 재사용(폴백·안내문·왜동의/학운위 문구 단일 출처) — 위치만 옮김.
//   종이 갈래는 기존 인쇄 화면(/teacher/parent-consent)을 그대로 연결(방식 b) — print 동작·출력물 유지.
//   진입: /teacher/students/consent. 교사 가드는 students.js와 동일 패턴.
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import Header from '../../../components/Header'
import ImpersonationBanner from '../../../components/ImpersonationBanner'
import ConsentPanel from '../../../components/ConsentPanel'
import GrayZonePanel from '../../../components/GrayZonePanel'
import { getEffectiveProfile, withImpersonation } from '../../../lib/impersonation'

export default function StudentsConsentPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [students, setStudents] = useState([])
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('online') // 'online' | 'paper'

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

          {/* 두 갈래 선택 */}
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setMode('online')}
              className={`rounded-2xl p-4 text-left border-2 transition ${mode === 'online' ? 'border-primary bg-primary-light shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <div className="text-lg font-bold">🔗 온라인으로 받기</div>
              <div className="text-xs text-gray-600 mt-1">링크·QR·동의번호를 보내 학부모가 휴대폰으로 동의</div>
            </button>
            <button onClick={() => setMode('paper')}
              className={`rounded-2xl p-4 text-left border-2 transition ${mode === 'paper' ? 'border-primary bg-primary-light shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <div className="text-lg font-bold">🖨 종이로 받기</div>
              <div className="text-xs text-gray-600 mt-1">A4 한 장으로 인쇄해 가정통신문으로 배부·회수</div>
            </button>
          </div>

          {/* 🆕 F-2: 제출된 동의서 보기 진입점 */}
          <Link href={withImpersonation('/teacher/students/consent/submissions')}
            className="block bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition text-sm">
            📄 <strong>제출된 동의서 보기</strong> — 보호자명·동의일시·서명 확인
          </Link>

          {/* 회색지대 배너 — 탭 분기 위 공통 영역(온라인·종이 양쪽에서 보임). 0명이면 안 뜸 */}
          <GrayZonePanel classInfo={classInfo} readOnly={isImpersonating} />

          {/* 온라인 갈래 — ConsentPanel(왜동의/학운위/폴백 안내문 모두 이 안에 단일 출처) */}
          {mode === 'online' && classInfo && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
                <ConsentPanel classInfo={classInfo} readOnly={isImpersonating} teacherSchool={user?.school} />
              </div>
              {/* 종이로 오가는 배너 */}
              <button onClick={() => setMode('paper')}
                className="w-full text-left bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition text-sm">
                🖨 종이가 편하세요? → <strong>종이로 받기</strong>
              </button>
            </div>
          )}

          {/* 종이 갈래 — 기존 인쇄 화면 연결(방식 b: print 동작·출력물 그대로 유지) */}
          {mode === 'paper' && (
            <div className="space-y-3">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-blue-100">
                <h3 className="font-bold text-gray-900 mb-1">🖨 종이 동의서 (A4 한 장)</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  가정통신문으로 배부할 인쇄용 동의서예요. 아래 버튼을 누르면 인쇄 화면이 열리고, 거기서 <strong>🖨️ 인쇄하기</strong>로 출력하면 됩니다.
                  학생이 받아온 종이의 동의 여부는 학생 목록에서 <strong>동의서 ✓</strong>로 직접 체크하세요.
                </p>
                <Link href={withImpersonation('/teacher/parent-consent')}
                  className="inline-block mt-3 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark">
                  📄 인쇄용 동의서 열기
                </Link>
              </div>
              {/* 온라인으로 오가는 배너 */}
              <button onClick={() => setMode('online')}
                className="w-full text-left bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition text-sm">
                ← <strong>온라인으로 받기</strong> (링크·QR로 더 간편하게)
              </button>
            </div>
          )}
        </main>
      </div>
    </>
  )
}

```

## pages/teacher/students/consent/submissions.js

```js
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

```

## pages/teacher/submissions.js

```js
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'
import useGrammarTooltip from '../../lib/useGrammarTooltip'
import { regradeSubmission } from '../../lib/regrade'
import { findOriginalRange } from '../../lib/koreanRules'
import { GRAMMAR_NOTICE_TEACHER } from '../../lib/notices'
import { callAI } from '../../lib/aiClient'
import { toKST } from '../../lib/timeFormat'
import { splitFeedbackItems } from '../../lib/feedbackFormat'
import { displayStudentName, displayStudentNameWithNumber } from '../../lib/displayName'
import ImpersonationBanner from '../../components/ImpersonationBanner'
import KeyNavHint from '../../components/KeyNavHint'
import { getEffectiveProfile, withImpersonation } from '../../lib/impersonation'

function FeedbackList({ text, color = 'gray' }) {
  if (!text) return null
  const items = splitFeedbackItems(text)
  
  const colorClasses = { green: 'text-green-900', amber: 'text-amber-900', blue: 'text-blue-900', gray: 'text-gray-700' }
  const dotClasses = { green: 'bg-green-600', amber: 'bg-amber-600', blue: 'bg-blue-600', gray: 'bg-gray-400' }
  
  if (items.length <= 1) {
    return <p className={`text-sm ${colorClasses[color]} break-keep leading-relaxed`}>{items[0] || text}</p>
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${dotClasses[color]} mt-2`}></span>
          <span className={`text-sm ${colorClasses[color]} break-keep leading-relaxed flex-1`}>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function escapeHtml(text) {
  if (!text) return ''
  return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function applyGrammar(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections?.length) return escapeHtml(essayText).replace(/\n/g,'<br>')
  const matches = []
  corrections.forEach(c => {
    const orig = c.original || c.error || c.wrong || ''
    const corr = c.correction || c.fixed || ''
    const reason = c.reason || c.type || ''
    if (!orig) return
    let from = 0
    let placed = false
    while (true) {
      const idx = essayText.indexOf(orig, from)
      if (idx === -1) break
      const overlap = matches.some(m => idx < m.end && idx + orig.length > m.start)
      if (!overlap) { matches.push({ start: idx, end: idx + orig.length, orig, corr, reason }); placed = true; break }
      from = idx + 1
    }
    // 🆕 정확 일치 실패 시 공백 허용 매칭 (위치 불확실하면 긋지 않음)
    if (!placed) {
      const range = findOriginalRange(essayText, orig)
      if (range && !range.exact) {
        const overlap = matches.some(m => range.start < m.end && range.end > m.start)
        if (!overlap) { matches.push({ start: range.start, end: range.end, orig: essayText.slice(range.start, range.end), corr, reason }) }
      }
    }
  })
  matches.sort((a,b) => a.start - b.start)
  let result = '', last = 0
  matches.forEach(m => {
    if (m.start > last) result += escapeHtml(essayText.slice(last, m.start))
    const tip = m.corr ? `${m.corr}${m.reason ? ' (' + m.reason + ')' : ''}` : '오류'
    result += `<span class="grammar-error" data-correction="${escapeHtml(tip)}">${escapeHtml(m.orig)}</span>`
    last = m.end
  })
  if (last < essayText.length) result += escapeHtml(essayText.slice(last))
  return result.replace(/\n/g, '<br>')
}

// 두 텍스트의 유사도 계산 (베껴쓰기 의심 감지용)
// 5글자 이상 연속 일치하는 부분의 비율 측정
function calcSimilarity(textA, textB) {
  if (!textA || !textB) return { score: 0, matchedChars: 0, longestMatch: '' }
  const a = textA.replace(/\s+/g, '').toLowerCase()
  const b = textB.replace(/\s+/g, '').toLowerCase()
  if (a.length < 10 || b.length < 10) return { score: 0, matchedChars: 0, longestMatch: '' }

  // 5글자 이상 연속 일치 부분 찾기
  const minLen = 5
  const matched = new Set() // 학생 글에서 일치한 인덱스
  let longest = ''
  for (let i = 0; i < a.length - minLen; i++) {
    let bestLen = 0
    for (let j = 0; j < b.length - minLen; j++) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++
      if (k >= minLen && k > bestLen) bestLen = k
    }
    if (bestLen >= minLen) {
      for (let m = 0; m < bestLen; m++) matched.add(i + m)
      const snippet = textA.slice(i, i + bestLen).replace(/\s+/g, ' ').trim()
      if (snippet.length > longest.length) longest = snippet
      i += bestLen - 1 // 이미 매칭된 부분 건너뛰기 (성능)
    }
  }
  return {
    score: matched.size / a.length, // 0~1
    matchedChars: matched.size,
    longestMatch: longest.slice(0, 30) // 최대 30자만
  }
}

export default function TeacherSubmissions() {
  const router = useRouter()
  useGrammarTooltip()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [hasApiKey, setHasApiKey] = useState(false)  // 키 서버격리(step153~): class_secrets 기준
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('topics') // topics / topicStudents / studentDetail / allFinal
  const [selectedTopic, setSelectedTopic] = useState(null)
  const [topicStudents, setTopicStudents] = useState([])
  const [expandedEssays, setExpandedEssays] = useState({})  // 🆕 전체 최종본 뷰: 학생별 본문 더보기 토글
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [isImpersonating, setIsImpersonating] = useState(false)  // 🆕

  // router.isReady 전엔 router.query가 비어 있어 URL 복원(?topic=&student=)이 안 됨
  useEffect(() => { if (router.isReady) checkAuth() }, [router.isReady])

  const checkAuth = async () => {
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name, code)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)

    // 키 서버격리(step153~): 키 등록 여부만 확인. AI 호출은 서버가 학급 키 조회.
    if (profile.classes?.id) {
      try {
        const { data: keyCheck } = await supabase.from('class_secrets')
          .select('class_id').eq('class_id', profile.classes.id).maybeSingle()
        setHasApiKey(!!keyCheck)
      } catch (e) { setHasApiKey(false) }
    }

    const { data } = await supabase.from('topics').select('*').eq('teacher_id', profile.id).order('date', { ascending: false }).limit(30)
    setTopics(data || [])
    setLoading(false)

    // URL query로 자동 진입 (?topic=ID 또는 ?topic=ID&student=ID)
    const { topic: qTopic, student: qStudent } = router.query
    if (qTopic && data) {
      const t = data.find(x => x.id === qTopic)
      if (t) {
        // classInfo가 아직 state에 안 반영됐을 수 있으므로 직접 전달
        await openTopicWithClass(t, profile.classes, qStudent)
      }
    }
  }

  // classInfo state 의존하지 않는 버전 (URL query 자동 진입용)
  const openTopicWithClass = async (topic, cls, autoStudentId = null) => {
    setSelectedTopic(topic)
    const { data: students } = await supabase.from('profiles')
      .select('id, realname, nickname, username, number, is_hidden')
      .eq('class_id', cls.id).eq('role', 'student')
    const visibleStudents = (students || []).filter(s => !s.is_hidden)
    const studentIds = visibleStudents.map(s => s.id)
    if (studentIds.length === 0) { setTopicStudents([]); setView('topicStudents'); return }

    const { data: subs } = await supabase.from('submissions').select('*').eq('topic_id', topic.id).in('user_id', studentIds).is('deleted_at', null)

    const byStudent = {}
    visibleStudents.forEach(s => { byStudent[s.id] = { profile: s, items: [] } })
    ;(subs || []).forEach(s => {
      if (byStudent[s.user_id]) byStudent[s.user_id].items.push(s)
    })

    // 미제출 학생까지 모두 포함, 번호순 정렬
    const groups = Object.values(byStudent).sort((a, b) => {
      const na = parseInt(a.profile.number) || 999
      const nb = parseInt(b.profile.number) || 999
      if (na !== nb) return na - nb
      return displayStudentName(a.profile).localeCompare(displayStudentName(b.profile))
    })
    setTopicStudents(groups)

    // 학생 자동 선택? (제출한 학생만 자동 진입)
    if (autoStudentId) {
      const target = groups.find(g => g.profile.id === autoStudentId && g.items.length > 0)
      if (target) {
        setSelectedStudent(target)
        setView('studentDetail')
        return
      }
    }
    setView('topicStudents')
  }

  const logout = async () => {
    if (isImpersonating) { router.push('/admin'); return }
    await supabase.auth.signOut(); router.push('/')
  }

  // 화면 상태를 URL에 반영 — 새로고침해도 같은 화면 유지
  const syncUrl = (topicId = null, studentId = null) => {
    const q = {}
    if (topicId) q.topic = topicId
    if (studentId) q.student = studentId
    router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true })
  }

  const openTopic = async (topic, keepStudentId = null) => {
    setSelectedTopic(topic)
    
    // 같은 학급 학생들의 이 주제 제출본 (숨김 학생 제외)
    const { data: students } = await supabase.from('profiles')
      .select('id, realname, nickname, username, number, is_hidden')
      .eq('class_id', classInfo.id).eq('role', 'student')
    const visibleStudents = (students || []).filter(s => !s.is_hidden)
    const studentIds = visibleStudents.map(s => s.id)
    if (studentIds.length === 0) { setTopicStudents([]); setView('topicStudents'); return }
    
    const { data: subs } = await supabase.from('submissions').select('*').eq('topic_id', topic.id).in('user_id', studentIds).is('deleted_at', null)
    
    const byStudent = {}
    visibleStudents.forEach(s => { byStudent[s.id] = { profile: s, items: [] } })
    ;(subs || []).forEach(s => {
      if (byStudent[s.user_id]) byStudent[s.user_id].items.push(s)
    })
    
    // 미제출 학생까지 모두 포함, 번호순 정렬
    const groups = Object.values(byStudent).sort((a, b) => {
      const na = parseInt(a.profile.number) || 999
      const nb = parseInt(b.profile.number) || 999
      if (na !== nb) return na - nb
      return displayStudentName(a.profile).localeCompare(displayStudentName(b.profile))
    })
    setTopicStudents(groups)

    // 🆕 특정 학생 화면을 유지해야 하면(재평가 등) 그 학생 상세로 복귀
    if (keepStudentId) {
      const keep = groups.find(g => g.profile.id === keepStudentId)
      if (keep && keep.items.length > 0) {
        setSelectedStudent(keep)
        setView('studentDetail')
        syncUrl(topic.id, keepStudentId)
        return
      }
    }
    setView('topicStudents')
    syncUrl(topic.id)
  }

  const openStudent = (student) => {
    setSelectedStudent(student)
    setView('studentDetail')
    syncUrl(selectedTopic?.id, student.profile.id)
  }

  // 🆕 일일 워크플로우: 이전/다음 학생 이동 (제출한 학생만 대상)
  const submittedStudents = topicStudents.filter(g => g.items.length > 0)
  const currentStudentIdx = selectedStudent
    ? submittedStudents.findIndex(g => g.profile.id === selectedStudent.profile.id)
    : -1

  const goPrevStudent = () => {
    if (currentStudentIdx > 0) {
      const prev = submittedStudents[currentStudentIdx - 1]
      setSelectedStudent(prev)
      syncUrl(selectedTopic?.id, prev.profile.id)
      window.scrollTo({ top: 0 })
    }
  }
  const goNextStudent = () => {
    if (currentStudentIdx >= 0 && currentStudentIdx < submittedStudents.length - 1) {
      const next = submittedStudents[currentStudentIdx + 1]
      setSelectedStudent(next)
      syncUrl(selectedTopic?.id, next.profile.id)
      window.scrollTo({ top: 0 })
    }
  }

  // 🆕 키보드 ←/→ (입력 중일 땐 무시)
  useEffect(() => {
    if (view !== 'studentDetail') return
    const onKey = (e) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'textarea' || tag === 'input' || tag === 'select') return
      if (e.key === 'ArrowLeft') goPrevStudent()
      if (e.key === 'ArrowRight') goNextStudent()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, currentStudentIdx, submittedStudents.length])

  const downloadExcel = async () => {
    // 다운로드 사유 선택 (개인정보 보호 차원에서 목적 명시)
    const purpose = prompt(
      `📥 학생 글 일괄 다운로드\n\n` +
      `⚠️ 학생 개인정보가 포함된 자료입니다.\n` +
      `다운로드 후 외부 공유·유출은 금지됩니다.\n\n` +
      `사용 목적을 입력해주세요 (취소하려면 빈칸):\n` +
      `예: 학기말 평가 자료, 포트폴리오, 학부모 상담 자료 등`,
      ''
    )
    if (!purpose || !purpose.trim()) return

    const includeFeedback = confirm(
      `AI 피드백(잘한 점/발전 점)도 포함할까요?\n\n` +
      `[확인] 글 + 점수 + 피드백 (전체)\n` +
      `[취소] 글 + 점수만 (간소)`
    )
    
    const XLSX = (await import('xlsx')).default || (await import('xlsx'))
    
    const rows = []
    const baseHeader = ['번호', '이름', '아이디', '시도', '점수', '총점', '제출시각', '복붙', '글 내용']
    const fullHeader = [...baseHeader, '종합 의견', '잘한 점', '발전 점']
    rows.push(includeFeedback ? fullHeader : baseHeader)
    
    topicStudents.forEach((g, gIdx) => {
      const sorted = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
      sorted.forEach(s => {
        const baseRow = [
          g.profile.number || (gIdx + 1),
          g.profile.realname,
          g.profile.username,
          (s.attempt||1) === 1 ? '첫 글' : `수정본 ${(s.attempt||1) - 1}차`,
          s.total_score,
          s.max_score,
          toKST(s.created_at),
          s.paste_detected ? `Y(${s.paste_count})` : 'N',
          s.essay_text || ''
        ]
        if (includeFeedback) {
          baseRow.push(
            s.feedback_overall || '',
            s.feedback_good || '',
            s.feedback_improve || ''
          )
        }
        rows.push(baseRow)
      })
    })
    
    const ws = XLSX.utils.aoa_to_sheet(rows)
    // 컬럼 너비
    if (includeFeedback) {
      ws['!cols'] = [
        { wch: 5 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 6 },
        { wch: 18 }, { wch: 7 }, { wch: 50 }, { wch: 30 }, { wch: 30 }, { wch: 30 }
      ]
    } else {
      ws['!cols'] = [
        { wch: 5 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 6 },
        { wch: 18 }, { wch: 7 }, { wch: 60 }
      ]
    }
    
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '학생글')
    
    // 사유를 두 번째 시트에 기록 (다운로드 이력)
    const meta = [
      ['항목', '내용'],
      ['주제', selectedTopic.title],
      ['날짜', selectedTopic.date],
      ['다운로드 일시', new Date().toLocaleString('ko-KR')],
      ['다운로드 사유', purpose.trim()],
      ['다운로드한 교사', user.realname],
      ['포함 항목', includeFeedback ? '글 + 점수 + AI 피드백' : '글 + 점수만'],
      ['※ 주의', '학생 개인정보 포함. 외부 유출/공유 금지']
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(meta)
    ws2['!cols'] = [{ wch: 18 }, { wch: 50 }]
    XLSX.utils.book_append_sheet(wb, ws2, '다운로드정보')
    
    const filename = `${selectedTopic.title}_${selectedTopic.date}.xlsx`
    XLSX.writeFile(wb, filename)
  }

  const allowExtraRewrite = async (subId) => {
    if (!confirm('이 학생에게 추가 수정을 허용하시겠어요?\n허용하면 학생이 한 번 더 글을 고칠 수 있어요.')) return
    const { error } = await supabase.from('submissions').update({ extra_rewrite_allowed: true }).eq('id', subId)
    if (error) return alert('실패: ' + error.message)
    alert('✅ 추가 수정이 허용되었어요!')
    openTopic(selectedTopic) // 새로고침
  }

  // 🗑️ 쓰레기통으로 이동 (soft delete, 30일 후 자동 영구 삭제)
  const moveToTrash = async (subId, studentName) => {
    const reason = prompt(
      `🗑️ "${studentName}" 학생의 글을 쓰레기통으로 보낼까요?\n\n` +
      `· 30일 동안 보관 후 자동 영구 삭제\n` +
      `· 그 전에 학급 설정 > 쓰레기통에서 복원 가능\n` +
      `· 학생/통계/랭킹에서 사라짐\n\n` +
      `삭제 사유를 입력해주세요 (선택, 메모용):`,
      ''
    )
    if (reason === null) return // 취소
    const { data: { user: authUser } } = await supabase.auth.getUser()
    const { error } = await supabase.from('submissions').update({
      deleted_at: new Date().toISOString(),
      deleted_by: authUser?.id || null,
      delete_reason: reason.trim() || null
    }).eq('id', subId)
    if (error) return alert('실패: ' + error.message)
    alert('🗑️ 쓰레기통으로 이동되었어요.\n학급 설정 > 쓰레기통에서 복원 가능합니다.')
    openTopic(selectedTopic) // 새로고침
  }

  // 🔄 단일 글 재평가
  const [regrading, setRegrading] = useState(null) // subId
  const [regradeResult, setRegradeResult] = useState(null) // { oldScore, newScore, maxScore } 화면 내 안내용
  const regradeOne = async (sub, studentName) => {
    if (!confirm(
      `🔄 "${studentName}" 학생의 글을 다시 평가할까요?\n\n` +
      `· AI가 현재 평가기준으로 새로 채점합니다\n` +
      `· 이전 점수/피드백은 자동 백업됩니다\n` +
      `· AI 호출 1회 사용`
    )) return

    if (!hasApiKey) return alert('AI 기능이 활성화되지 않았어요')

    setRegrading(sub.id)
    setRegradeResult(null)
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      const result = await regradeSubmission(sub, selectedTopic, authUser?.id, { withExample: true })
      if (!result.success) {
        alert('재평가 실패: ' + result.error)
      } else {
        // 🆕 현재 보고 있던 학생 ID 기억해서 재진입 후 그대로 유지 (와이프 피드백)
        const currentStudentId = selectedStudent?.profile?.id
        await openTopic(selectedTopic, currentStudentId)
        // 화면 내 결과 안내 (alert 대신 — 와이프 피드백: 화면 그대로 유지)
        setRegradeResult({
          subId: sub.id,
          oldScore: result.oldScore,
          newScore: result.newScore,
          maxScore: result.maxScore
        })
        // 5초 후 자동 사라짐
        setTimeout(() => setRegradeResult(prev => prev?.subId === sub.id ? null : prev), 5000)
      }
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setRegrading(null)
  }

  // 🔄 학급 전체 일괄 재평가
  const [bulkRegrading, setBulkRegrading] = useState(false)
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, current: '', failed: [] })
  const regradeAll = async () => {
    if (!selectedTopic) return
    // 대상: 쓰레기통 제외, 평가기준 변경 반영 위해 모든 attempt 다 재평가
    const allSubs = []
    topicStudents.forEach(g => {
      g.items.forEach(s => allSubs.push({ sub: s, student: g.profile }))
    })
    if (allSubs.length === 0) return alert('재평가할 글이 없어요')

    if (!confirm(
      `🔄 이 주제의 글 ${allSubs.length}개를 모두 다시 평가할까요?\n\n` +
      `· AI가 현재 평가기준으로 새로 채점\n` +
      `· 이전 점수는 자동 백업\n` +
      `· AI 호출 ${allSubs.length}회 사용 (수 분 소요)\n` +
      `· 일일 한도 부족 시 중간에 멈출 수 있음`
    )) return

    if (!hasApiKey) return alert('AI 기능이 활성화되지 않았어요')

    setBulkRegrading(true)
    setBulkProgress({ done: 0, total: allSubs.length, current: '', failed: [] })

    const { data: { user: authUser } } = await supabase.auth.getUser()
    const failed = []
    for (let i = 0; i < allSubs.length; i++) {
      const { sub, student } = allSubs[i]
      setBulkProgress({
        done: i,
        total: allSubs.length,
        current: `${student.realname} (${(sub.attempt||1) === 1 ? '첫 글' : `수정본 ${(sub.attempt||1) - 1}차`})`,
        failed
      })
      const result = await regradeSubmission(sub, selectedTopic, authUser?.id)
      if (!result.success) {
        failed.push({ name: student.realname, attempt: sub.attempt, error: result.error })
        // 일일 한도 도달이면 중단
        if (result.error && (result.error.includes('일일 한도') || result.error.includes('per day') || result.error.includes('PerDay'))) {
          alert(
            `⚠️ AI 일일 한도 도달!\n\n` +
            `${i}/${allSubs.length}개 완료\n` +
            `한국 시간 오후 5시 이후 다시 시도해주세요.`
          )
          break
        }
      }
    }

    setBulkProgress({ done: allSubs.length, total: allSubs.length, current: '', failed })
    setBulkRegrading(false)

    const successCount = allSubs.length - failed.length
    alert(
      `✅ 재평가 완료!\n\n` +
      `성공: ${successCount}개\n` +
      (failed.length > 0 ? `실패: ${failed.length}개\n  · ${failed.slice(0, 5).map(f => f.name).join(', ')}${failed.length > 5 ? ` 외 ${failed.length - 5}명` : ''}` : '')
    )

    await openTopic(selectedTopic) // 새로고침
  }

  // 일괄 추가 수정 허용
  const allowAllExtraRewrites = async () => {
    if (!selectedTopic) return
    // 대상: 각 학생의 최신 attempt 글 중 extra_rewrite_allowed가 아닌 것
    // topicStudents = [{profile, items: [submission, ...]}]
    const subsByStudent = {}
    topicStudents.forEach(g => {
      g.items.forEach(s => {
        const cur = subsByStudent[s.user_id]
        if (!cur || (s.attempt || 1) > (cur.attempt || 1)) subsByStudent[s.user_id] = s
      })
    })
    const latestSubs = Object.values(subsByStudent)

    const maxRewrites = selectedTopic?.max_rewrites !== undefined && selectedTopic?.max_rewrites !== null
      ? selectedTopic.max_rewrites : 1
    // 최대 횟수 도달 학생만 대상
    const targets = latestSubs.filter(s =>
      (s.attempt || 1) >= 1 + maxRewrites && !s.extra_rewrite_allowed
    )

    if (targets.length === 0) {
      alert(
        `일괄 허용 대상이 없어요.\n\n` +
        `최대 수정 횟수(${maxRewrites}회)에 도달한 학생이 없거나,\n` +
        `이미 추가 허용된 학생만 있어요.`
      )
      return
    }

    if (!confirm(
      `📝 "${selectedTopic.title}" 주제에 대해\n` +
      `${targets.length}명에게 추가 수정을 일괄 허용할까요?\n\n` +
      `허용 후 학생들이 한 번 더 글을 고칠 수 있어요.`
    )) return

    let success = 0, failed = 0
    for (const s of targets) {
      try {
        const { error } = await supabase.from('submissions')
          .update({ extra_rewrite_allowed: true }).eq('id', s.id)
        if (error) throw error
        success++
      } catch(e) { failed++ }
    }
    alert(`✅ 성공: ${success}명${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
    openTopic(selectedTopic)
  }

  // 🆕 일괄 격려 코멘트 — 코멘트 없는 학생의 최신 글에만 (기존 코멘트 안 건드림)
  const bulkEncourageComment = async () => {
    if (!selectedTopic || isImpersonating) return

    // 각 학생의 최신 글
    const subsByStudent = {}
    topicStudents.forEach(g => {
      g.items.forEach(s => {
        const cur = subsByStudent[s.user_id]
        if (!cur || (s.attempt || 1) > (cur.attempt || 1)) subsByStudent[s.user_id] = s
      })
    })
    // 이 주제에서 코멘트를 하나도 못 받은 학생의 최신 글만 대상
    const studentsWithComment = new Set()
    topicStudents.forEach(g => {
      if (g.items.some(s => s.teacher_comment)) studentsWithComment.add(g.profile.id)
    })
    const targets = Object.values(subsByStudent).filter(s => !studentsWithComment.has(s.user_id))

    if (targets.length === 0) {
      alert('모든 제출 학생이 이미 코멘트를 받았어요! 👏')
      return
    }

    const msg = prompt(
      `📣 일괄 격려 코멘트\n\n` +
      `아직 코멘트를 못 받은 ${targets.length}명의 최신 글에 같은 코멘트를 답니다.\n` +
      `(이미 코멘트 받은 학생은 건드리지 않아요)\n\n` +
      `코멘트 내용을 입력하세요:`,
      '오늘도 열심히 써줘서 고마워요! 꾸준히 쓰는 모습이 멋져요 💪'
    )
    if (!msg || !msg.trim()) return
    if (msg.length > 1000) { alert('코멘트는 1000자 이하로 해주세요'); return }

    if (!confirm(`${targets.length}명에게 아래 코멘트를 일괄 작성할까요?\n\n"${msg.trim()}"`)) return

    let success = 0, failed = 0
    for (const s of targets) {
      try {
        const { error } = await supabase.from('submissions')
          .update({
            teacher_comment: msg.trim(),
            teacher_comment_at: new Date().toISOString(),
            teacher_comment_read_at: null  // 학생에게 새 알림으로
          }).eq('id', s.id)
        if (error) throw error
        success++
      } catch(e) { failed++ }
    }
    alert(`✅ ${success}명에게 코멘트 작성 완료${failed > 0 ? `\n❌ 실패: ${failed}명` : ''}`)
    openTopic(selectedTopic)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>학생 글 보기 - 다온클래스</title></Head>
      <style>{`
        .grammar-error { text-decoration: underline wavy #dc2626; text-decoration-thickness: 2px; text-underline-offset: 3px; background: #fee2e2; padding: 0 2px; border-radius: 2px; cursor: pointer; }
      `}</style>
      <div className="min-h-screen bg-gray-50">
        {isImpersonating && <ImpersonationBanner targetName={user.realname} targetSchool={user.school} />}
        <Header user={user} onLogout={logout} />
        <main className={`mx-auto w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4 ${
          view === 'studentDetail' ? 'max-w-4xl xl:max-w-[1600px]' : 'max-w-[1400px]'
        }`}>
          
          {view === 'topics' && (
            <>
              <div className="flex items-center gap-3">
                <Link href={withImpersonation("/teacher")} className="text-gray-600">←</Link>
                <h1 className="text-xl font-bold">학생 글 보기</h1>
              </div>
              <div className="bg-white rounded-2xl p-5 shadow-sm">
                <h3 className="font-bold mb-3">📚 등록된 주제 ({topics.length}개)</h3>
                {topics.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8 text-center">등록된 주제가 없어요. 먼저 주제를 등록해주세요.</p>
                ) : (
                  <div className="space-y-2">
                    {topics.map(t => (
                      <button key={t.id} onClick={() => openTopic(t)}
                        className="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition">
                        <div className="font-medium text-sm">{t.title}</div>
                        <div className="text-xs text-gray-500 mt-1">{t.date}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {view === 'topicStudents' && selectedTopic && (
            <>
              <button onClick={() => { setView('topics'); syncUrl(); }} className="text-sm text-gray-600">← 주제 목록</button>
              {(() => {
                const submittedCount = topicStudents.filter(g => g.items.length > 0).length
                const absentCount = topicStudents.filter(g => g.items.length === 0).length
                const maxRewrites = selectedTopic?.max_rewrites !== undefined && selectedTopic?.max_rewrites !== null
                  ? selectedTopic.max_rewrites : 1
                // 일괄 허용 가능한 대상 수 계산
                const subsByStudent = {}
                topicStudents.forEach(g => {
                  g.items.forEach(s => {
                    const cur = subsByStudent[s.user_id]
                    if (!cur || (s.attempt || 1) > (cur.attempt || 1)) subsByStudent[s.user_id] = s
                  })
                })
                const needExtraCount = Object.values(subsByStudent).filter(s =>
                  (s.attempt || 1) >= 1 + maxRewrites && !s.extra_rewrite_allowed
                ).length

                // 🆕 코멘트 못 받은 제출 학생 수
                const noCommentCount = topicStudents.filter(g =>
                  g.items.length > 0 && !g.items.some(s => s.teacher_comment)
                ).length

                return (
                  <div className="bg-primary-light rounded-2xl p-4 flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="text-xs text-primary-dark">📅 {selectedTopic.date}</div>
                      <h2 className="text-lg font-bold text-primary-dark">{selectedTopic.title}</h2>
                      <div className="text-xs text-primary-dark mt-1 space-x-2">
                        <span>✅ {submittedCount}명 제출</span>
                        {absentCount > 0 && <span className="text-amber-700">🚨 {absentCount}명 미제출</span>}
                        {noCommentCount > 0 && <span className="text-yellow-700">💬 코멘트 전 {noCommentCount}명</span>}
                        <span className="text-gray-600">
                          · 최소 {selectedTopic.min_length || 30}자 / 수정 {maxRewrites}회
                        </span>
                        {selectedTopic.deadline_date && (() => {
                          const dl = new Date(`${selectedTopic.deadline_date}T${selectedTopic.deadline_time || '23:59'}:00+09:00`)
                          const isPast = new Date() > dl
                          return (
                            <span className={isPast ? 'text-red-600 font-medium' : 'text-emerald-700'}>
                              · {isPast ? '⏰ 마감됨' : '📅 마감'} {selectedTopic.deadline_date.slice(5)} {selectedTopic.deadline_time || '23:59'}
                            </span>
                          )
                        })()}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {needExtraCount > 0 && (
                        <button onClick={allowAllExtraRewrites}
                          className="bg-amber-100 border border-amber-300 text-amber-900 px-3 py-2 rounded-lg text-xs font-medium hover:bg-amber-200">
                          ✏️ 전체 추가 수정 허용 ({needExtraCount}명)
                        </button>
                      )}
                      {submittedCount > 0 && (
                        <>
                          <button onClick={() => setView('allFinal')}
                            className="bg-primary text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-primary-dark">
                            📄 전체 최종본 한눈에 보기
                          </button>
                          {noCommentCount > 0 && !isImpersonating && (
                            <button onClick={bulkEncourageComment}
                              className="bg-yellow-100 border border-yellow-300 text-yellow-900 px-3 py-2 rounded-lg text-xs font-medium hover:bg-yellow-200">
                              📣 일괄 격려 코멘트 ({noCommentCount}명)
                            </button>
                          )}
                          <button onClick={regradeAll} disabled={bulkRegrading}
                            className="bg-blue-100 border border-blue-300 text-blue-900 px-3 py-2 rounded-lg text-xs font-medium hover:bg-blue-200 disabled:opacity-50">
                            🔄 전체 다시 평가 ({submittedCount}명)
                          </button>
                          <button onClick={downloadExcel}
                            className="bg-white border border-primary text-primary px-3 py-2 rounded-lg text-xs font-medium hover:bg-primary-light">
                            📥 Excel 다운로드
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })()}

              {/* 🔄 일괄 재평가 진행 상황 */}
              {bulkRegrading && (
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-blue-900">🔄 학급 전체 재평가 진행 중...</span>
                    <span className="text-xs text-blue-700">{bulkProgress.done}/{bulkProgress.total}</span>
                  </div>
                  {/* 진행 바 */}
                  <div className="w-full bg-blue-100 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${bulkProgress.total > 0 ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }} />
                  </div>
                  {bulkProgress.current && (
                    <p className="text-xs text-blue-800">처리 중: {bulkProgress.current}</p>
                  )}
                  {bulkProgress.failed.length > 0 && (
                    <p className="text-xs text-amber-700">
                      ⚠️ 실패 {bulkProgress.failed.length}개 (계속 진행 중)
                    </p>
                  )}
                </div>
              )}

              {topicStudents.length === 0 ? (
                <div className="bg-white rounded-2xl p-8 text-center text-gray-500">
                  <p>학급에 학생이 없어요</p>
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-5 shadow-sm space-y-2">
                  {topicStudents.map(g => {
                    // 미제출 학생
                    if (g.items.length === 0) {
                      return (
                        <div key={g.profile.id}
                          className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3 opacity-90">
                          {g.profile.number && (
                            <span className="text-xs text-gray-500 font-mono w-10 text-center shrink-0">{g.profile.number}번</span>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-gray-800">
                              {displayStudentName(g.profile)}
                              <span className="ml-2 text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">미제출</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">@{g.profile.username}</div>
                          </div>
                          <div className="text-xs text-amber-700 w-32 text-right shrink-0">-</div>
                        </div>
                      )
                    }

                    // 제출 학생
                    const sorted = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
                    const first = sorted[0]
                    const last = sorted[sorted.length - 1]
                    const isImproved = first.id !== last.id
                    const pasted = sorted.some(s => s.paste_detected)
                    const noComment = !sorted.some(s => s.teacher_comment)  // 🆕 코멘트 안 단 학생
                    return (
                      <button key={g.profile.id} onClick={() => openStudent(g)}
                        className="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition flex items-center gap-3">
                        {g.profile.number && (
                          <span className="text-xs text-gray-500 font-mono w-10 text-center shrink-0">{g.profile.number}번</span>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {displayStudentName(g.profile)}
                            {pasted && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">⚠️ 복붙</span>}
                            {sorted.some(s => s.is_fallback_graded) && (
                              <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full" title="메인 모델 한도로 보조 모델 채점됨 - 재평가 권장">
                                🔁 보조 채점
                              </span>
                            )}
                            {noComment && (
                              <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full" title="아직 담임 코멘트를 안 달았어요">
                                💬 코멘트 전
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">@{g.profile.username}</div>
                        </div>
                        <div className="text-right text-xs w-32 shrink-0">
                          {isImproved ? (
                            <>
                              <div className="text-gray-500">첫 {first.total_score}점</div>
                              <div className="font-bold">최종 {last.total_score}/{last.max_score}점
                                {last.total_score > first.total_score && <span className="text-green-600 ml-1">↑{last.total_score - first.total_score}</span>}
                              </div>
                            </>
                          ) : (
                            <div className="font-bold">{last.total_score}/{last.max_score}점</div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* 🆕 전체 학생 최종본 한눈에 보기 (통독 모드) — 추가 fetch 없이 topicStudents 재사용 */}
          {view === 'allFinal' && selectedTopic && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <button onClick={() => setView('topicStudents')} className="text-sm text-gray-600">← 학생 목록</button>
                <span className="hidden sm:inline text-xs text-gray-500">학생 이름을 누르면 상세(고쳐쓰기 기록)로 이동해요</span>
              </div>
              <div className="bg-primary-light rounded-2xl p-4">
                <div className="text-xs text-primary-dark">📅 {selectedTopic.date}</div>
                <h2 className="text-lg font-bold text-primary-dark">📄 전체 최종본 한눈에 보기</h2>
                <div className="text-xs text-primary-dark mt-1">
                  {selectedTopic.title} · ✅ {submittedStudents.length}명 최종본
                </div>
              </div>

              <div className="space-y-4">
                {topicStudents.map(g => {
                  // 미제출 학생
                  if (g.items.length === 0) {
                    return (
                      <div key={g.profile.id}
                        className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-2 flex-wrap">
                        {g.profile.number && (
                          <span className="text-xs text-gray-500 font-mono w-10 text-center">{g.profile.number}번</span>
                        )}
                        <span className="font-semibold text-gray-800">{displayStudentName(g.profile)}</span>
                        <span className="text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">미제출</span>
                      </div>
                    )
                  }
                  // 최종본 = 최대 attempt (기존 max-attempt 패턴 재사용)
                  const sorted = [...g.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
                  const last = sorted[sorted.length - 1]
                  const attemptNo = last.attempt || 1
                  const expanded = !!expandedEssays[g.profile.id]
                  const isLong = (last.essay_text || '').length > 200
                  return (
                    <div key={g.profile.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                      {/* 헤더: 번호·이름(클릭→상세) + 점수 */}
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <button onClick={() => openStudent(g)} className="text-left group">
                          <div className="flex items-center gap-2 flex-wrap">
                            {g.profile.number && (
                              <span className="text-xs text-gray-500 font-mono">{g.profile.number}번</span>
                            )}
                            <span className="font-bold text-base text-gray-900 group-hover:text-primary group-hover:underline underline-offset-2">
                              {displayStudentName(g.profile)}
                            </span>
                            {attemptNo >= 2 && (
                              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">수정본 {attemptNo - 1}차</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">눌러서 상세 보기 →</div>
                        </button>
                        {typeof last.total_score === 'number' && (
                          <div className="font-bold text-lg text-gray-900 flex-shrink-0">
                            {last.total_score}<span className="text-sm text-gray-400">/{last.max_score}점</span>
                          </div>
                        )}
                      </div>

                      {/* 글 제목(주제) */}
                      <div className="text-sm font-semibold text-gray-700 mt-3">📝 {selectedTopic.title}</div>

                      {/* 본문 — 통독용 큰 글씨, 길면 line-clamp + 더보기 */}
                      <div className="mt-1 bg-gray-50 rounded-lg p-4 text-[15px] leading-7 text-gray-800 whitespace-pre-wrap"
                        style={{
                          overflowWrap: 'anywhere', wordBreak: 'break-word',
                          ...((!expanded && isLong) ? { display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {})
                        }}>
                        {last.essay_text}
                      </div>
                      {isLong && (
                        <button
                          onClick={() => setExpandedEssays(prev => ({ ...prev, [g.profile.id]: !expanded }))}
                          className="mt-1 text-xs text-primary hover:underline">
                          {expanded ? '접기 ▲' : '더보기 ▼'}
                        </button>
                      )}

                      {/* AI 피드백 — 기본 접기 */}
                      {last.feedback_overall && (
                        <details className="mt-2 group">
                          <summary className="cursor-pointer text-sm font-semibold text-gray-600 hover:text-gray-900 flex items-center gap-1 py-2 px-2 bg-gray-50 rounded-lg select-none list-none">
                            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                            🤖 AI 피드백 보기
                          </summary>
                          <div className="mt-2 bg-blue-50 rounded-lg p-3 border border-blue-100 text-sm text-blue-900 break-keep leading-relaxed whitespace-pre-wrap">
                            {last.feedback_overall}
                          </div>
                        </details>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {view === 'studentDetail' && selectedStudent && selectedTopic && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <button onClick={() => { setView('topicStudents'); setSelectedStudent(null); syncUrl(selectedTopic?.id); }} className="text-sm text-gray-600">← 학생 목록</button>
                {/* 🆕 이전/다음 학생 네비게이션 (키보드 ←/→도 가능) */}
                {submittedStudents.length > 1 && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <button
                      onClick={goPrevStudent}
                      disabled={currentStudentIdx <= 0}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      ← 이전 학생
                    </button>
                    <span className="text-gray-500 px-1">
                      {currentStudentIdx + 1} / {submittedStudents.length}
                    </span>
                    <button
                      onClick={goNextStudent}
                      disabled={currentStudentIdx >= submittedStudents.length - 1}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      다음 학생 →
                    </button>
                    {/* 키보드 단축키 안내 (공용 컴포넌트 — 데스크톱 전용, 펄스/끄기/교사별 dismiss 포함) */}
                    <KeyNavHint label="학생 글 넘기기" storageKey="lc-essaynav-hint-dismissed" teacherId={user?.id} />
                  </div>
                )}
              </div>
              <div className="bg-primary-light rounded-2xl p-4">
                <h2 className="text-lg font-bold text-primary-dark">{displayStudentNameWithNumber(selectedStudent.profile)}</h2>
                <div className="text-xs text-primary-dark mt-1">{selectedTopic.title} · {selectedTopic.date}</div>
              </div>

              {/* 🆕 최신 2개를 위에 병렬(직전=왼쪽, 최신=오른쪽), 그 이전 글은 아래로 */}
              {(() => {
                const ordered = [...selectedStudent.items].sort((a,b) => (a.attempt||1) - (b.attempt||1))
                const topTwo = ordered.slice(-2)   // 최신 2개 (직전, 최신)
                const older = ordered.slice(0, -2)  // 그 이전 글들

                const labelFor = (s) => {
                  const a = s.attempt || 1
                  return a === 1 ? '📝 첫 번째 글' : a === 2 ? '✨ 수정본 (1차)' : `✨ 수정본 ${a - 1}차`
                }

                const renderCard = (s, idxInOrdered) => {
                  const isLast = (s.attempt || 1) === (ordered[ordered.length - 1].attempt || 1)
                  const showAllowBtn = isLast && (s.attempt||1) >= 2 && !s.extra_rewrite_allowed
                  const prevSub = ordered[idxInOrdered - 1]
                  const prevExample = prevSub?.example_text
                  const similarity = prevExample
                    ? calcSimilarity(s.essay_text, prevExample)
                    : { score: 0, matchedChars: 0, longestMatch: '' }
                  const isSuspicious = similarity.score >= 0.3
                  const isHighlySuspicious = similarity.score >= 0.5
                  return (
                    <div key={s.id} className={`bg-white rounded-2xl p-5 shadow-sm space-y-3 h-full min-w-0 ${
                      isHighlySuspicious ? 'border-2 border-red-400' : isSuspicious ? 'border-2 border-amber-400' : ''
                    }`}>
                      <div className="flex justify-between items-center flex-wrap gap-2">
                        <h3 className="font-bold text-sm">{labelFor(s)}</h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          {s.paste_detected && <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">⚠️ 복붙 {s.paste_count || 1}회</span>}
                          {s.is_fallback_graded && (
                            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full" title={`채점 모델: ${s.graded_with_model || '?'} - 메인 모델 한도로 보조 모델 사용. 재평가 권장.`}>
                              🔁 보조 채점
                            </span>
                          )}
                        {isHighlySuspicious && (
                          <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full font-bold">
                            🚨 예시 유사도 {Math.round(similarity.score * 100)}%
                          </span>
                        )}
                        {isSuspicious && !isHighlySuspicious && (
                          <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full">
                            ⚠️ 예시 유사도 {Math.round(similarity.score * 100)}%
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 🆕 채점 시각 (작게) — 모델명은 숨김 */}
                    <div className="text-[11px] text-gray-500 -mt-2">
                      {s.re_graded_at ? (
                        <>🔄 재평가: {toKST(s.re_graded_at)}</>
                      ) : (
                        <>🤖 AI 채점: {toKST(s.created_at)}</>
                      )}
                    </div>

                    {/* 베껴쓰기 의심 경고 */}
                    {isSuspicious && (
                      <div className={`rounded-lg p-3 text-xs ${
                        isHighlySuspicious
                          ? 'bg-red-50 border border-red-200 text-red-900'
                          : 'bg-amber-50 border border-amber-200 text-amber-900'
                      }`}>
                        <div className="font-bold mb-1">
                          {isHighlySuspicious ? '🚨 AI 예시를 거의 그대로 베낀 것으로 의심됨' : '⚠️ AI 예시와 일부 일치'}
                        </div>
                        <div>
                          이전에 제공된 AI 예시 작품과 {Math.round(similarity.score * 100)}%가 일치합니다.
                          {similarity.longestMatch && (
                            <span className="block mt-1">가장 긴 일치 부분: "<span className="font-mono bg-white px-1 rounded">{similarity.longestMatch}{similarity.longestMatch.length === 30 ? '...' : ''}</span>"</span>
                          )}
                        </div>
                      </div>
                    )}

                    {s.corrections?.length > 0 && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full inline-block">
                        맞춤법/띄어쓰기 {s.corrections.length}개
                      </span>
                    )}
                    {/* 🆕 맞춤법 AI 보조 안내 + 다시 검사(재평가) 배너 — 기존 regradeOne 재사용 */}
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2 flex-wrap">
                      <p className="text-sm text-amber-800 leading-snug flex-1 min-w-[140px]">{GRAMMAR_NOTICE_TEACHER}</p>
                      <button onClick={() => regradeOne(s, selectedStudent.profile.realname)}
                        disabled={regrading === s.id || bulkRegrading}
                        className="text-xs bg-amber-600 text-white px-2.5 py-1 rounded-lg hover:bg-amber-700 transition disabled:opacity-50 whitespace-nowrap">
                        {regrading === s.id ? '🔄 평가 중...' : '🔄 다시 평가하기'}
                      </button>
                    </div>
                    <div className={`bg-gray-50 rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      ordered.length >= 2 ? 'lg:h-[420px] lg:overflow-y-auto' : ''
                    }`}
                      style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                      dangerouslySetInnerHTML={{__html: applyGrammar(s.essay_text, s.corrections)}} />

                    {/* 🆕 담임 코멘트 — 학생 글 바로 아래 (가까이) */}
                    <TeacherCommentBox
                      submission={s}
                      studentName={displayStudentName(selectedStudent.profile)}
                      onUpdated={() => openTopic(selectedTopic, selectedStudent.profile.id)}
                      disabled={isImpersonating}
                      maskNames={topicStudents.map(g => g.profile.realname).filter(Boolean)}
                    />

                    {/* 🆕 AI 점수·피드백 — 열고 닫기 (기본 열림) */}
                    <details className="group">
                      <summary className="cursor-pointer text-sm font-semibold text-gray-700 hover:text-gray-900 flex items-center gap-1 py-2 px-2 bg-gray-50 rounded-lg select-none list-none">
                        <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                        🤖 AI 점수·피드백 보기
                        <span className="ml-auto font-bold text-gray-900">{s.total_score}/{s.max_score}점</span>
                      </summary>
                      <div className="space-y-3 mt-2">

                    {Array.isArray(s.scores) && (
                      <div className="space-y-2">
                        {s.scores.map((sc, idx) => {
                          const r = selectedTopic.rubrics[idx] || { name: `기준 ${idx+1}`, score: 25 }
                          const pct = Math.round((sc / r.score) * 100)
                          const isFull = sc >= r.score
                          const reason = Array.isArray(s.rubric_reasons) ? s.rubric_reasons[idx] : null
                          const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
                          return (
                            <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-100 lg:min-h-[150px]">
                              <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-800 font-semibold">
                                  {r.name}
                                  {isFull && <span className="ml-1 text-green-600">✓</span>}
                                </span>
                                <span className={`font-bold ${isFull ? 'text-green-700' : 'text-gray-700'}`}>
                                  {sc}/{r.score}점
                                </span>
                              </div>
                              {r.hint && <div className="text-xs text-gray-500 mb-1.5">📌 {r.hint}</div>}
                              <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
                                <div className={`${barColor} h-full transition-all`} style={{width: pct + '%'}} />
                              </div>
                              {/* 🆕 점수 근거 (와이프 피드백: 왜 감점됐는지) */}
                              {reason ? (
                                <p className="text-xs text-gray-700 leading-relaxed break-keep bg-white rounded p-2 border border-gray-200 mt-2">
                                  <span className="font-semibold text-gray-800">💡 이유: </span>
                                  {reason}
                                </p>
                              ) : !isFull ? (
                                <p className="text-xs text-amber-700 leading-relaxed bg-amber-50 rounded p-2 border border-amber-200 mt-2">
                                  ⚠️ 점수 근거가 기록되지 않았어요. 재평가하면 채워집니다.
                                </p>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div className="space-y-2 text-sm pt-3 border-t">
                      <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                        <h4 className="font-bold mb-1 text-blue-900 text-sm">💬 종합 의견</h4>
                        <p className="text-blue-900 break-keep leading-relaxed">{s.feedback_overall}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 border border-green-100">
                        <h4 className="font-bold mb-1 text-green-900 text-sm">⭐ 잘한 점</h4>
                        <FeedbackList text={s.feedback_good} color="green" />
                      </div>
                      <div className="bg-amber-50 rounded-lg p-3 border border-amber-100">
                        <h4 className="font-bold mb-1 text-amber-900 text-sm">🌱 발전시킬 점</h4>
                        <FeedbackList text={s.feedback_improve} color="amber" />
                      </div>

                      {/* 🆕 발전점 구체 예시 (와이프 피드백: 어떻게 고치면 좋을지) */}
                      {Array.isArray(s.improve_examples) && s.improve_examples.length > 0 && (
                        <div className="bg-purple-50 rounded-lg p-3 border-2 border-purple-200">
                          <h4 className="font-bold mb-2 text-purple-900 text-sm">✏️ 이렇게 바꿔보면 어떨까요?</h4>
                          <p className="text-xs text-purple-700 mb-2">학생이 보는 화면에 함께 표시되는 예시예요.</p>
                          <div className="space-y-2">
                            {s.improve_examples.map((ex, exIdx) => (
                              <div key={exIdx} className="bg-white rounded-lg border border-purple-200 overflow-hidden">
                                <div className="px-3 py-2 bg-red-50 border-b border-red-100">
                                  <div className="text-[11px] text-red-700 font-semibold mb-0.5">현재</div>
                                  <p className="text-sm text-gray-800 break-keep">{ex.original}</p>
                                </div>
                                <div className="px-3 py-2 bg-green-50 border-b border-green-100">
                                  <div className="text-[11px] text-green-700 font-semibold mb-0.5">예시</div>
                                  <p className="text-sm text-gray-900 break-keep leading-relaxed">{ex.suggested}</p>
                                </div>
                                {ex.reason && (
                                  <div className="px-3 py-1.5 bg-purple-50 border-t border-purple-100">
                                    <p className="text-[11px] text-purple-700 break-keep">💡 {ex.reason}</p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                      </div>
                    </details>

                    {/* 이 글이 학생에게 제공한 AI 예시 작품 */}
                    {s.example_text && (
                      <details className="pt-3 border-t">
                        <summary className="cursor-pointer text-sm font-bold text-purple-700 hover:text-purple-900">
                          📖 이 글에 대해 AI가 학생에게 보여준 예시 작품 보기
                        </summary>
                        <div className="mt-2 bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm whitespace-pre-wrap leading-relaxed text-purple-900">
                          {s.example_text}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          💡 다음 수정본이 이 예시와 비슷하다면 베껴 썼을 가능성이 있어요
                        </p>
                      </details>
                    )}

                    {showAllowBtn && (
                      <button onClick={() => allowExtraRewrite(s.id)}
                        className="w-full py-2 bg-purple-100 text-purple-700 rounded-lg font-medium text-sm hover:bg-purple-200">
                        ✏️ 이 학생에게 추가 수정 허용
                      </button>
                    )}
                    {isLast && s.extra_rewrite_allowed && (
                      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs p-2 rounded text-center">
                        ✓ 추가 수정 허용됨 (학생이 다시 쓰기 가능)
                      </div>
                    )}

                    {/* 🔄 재평가 + 🗑️ 쓰레기통 (선생님만) */}
                    <div className="flex gap-2">
                      <button onClick={() => regradeOne(s, selectedStudent.profile.realname)}
                        disabled={regrading === s.id || bulkRegrading}
                        className="flex-1 py-2 bg-blue-50 text-blue-700 rounded-lg text-xs hover:bg-blue-100 transition disabled:opacity-50">
                        {regrading === s.id ? '🔄 평가 중...' : '🔄 이 글 다시 평가'}
                      </button>
                      <button onClick={() => moveToTrash(s.id, selectedStudent.profile.realname)}
                        disabled={regrading === s.id || bulkRegrading}
                        className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs hover:bg-red-100 hover:text-red-700 transition disabled:opacity-50">
                        🗑️ 쓰레기통으로
                      </button>
                    </div>

                    {/* 🆕 재평가 결과 안내 (와이프 피드백: 화면 그대로 유지) */}
                    {regradeResult && regradeResult.subId === s.id && (
                      <div className="bg-green-50 border-2 border-green-300 rounded-lg p-3 animate-pulse">
                        <div className="text-sm font-bold text-green-900 mb-1">✅ 재평가 완료!</div>
                        <div className="text-xs text-green-800 flex items-center gap-2 flex-wrap">
                          <span>이전: <strong>{regradeResult.oldScore ?? '-'}</strong>/{regradeResult.maxScore}</span>
                          <span className="text-green-600">→</span>
                          <span>새 점수: <strong>{regradeResult.newScore}</strong>/{regradeResult.maxScore}</span>
                          {typeof regradeResult.oldScore === 'number' && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              regradeResult.newScore > regradeResult.oldScore ? 'bg-green-200 text-green-900' :
                              regradeResult.newScore < regradeResult.oldScore ? 'bg-red-200 text-red-900' :
                              'bg-gray-200 text-gray-700'
                            }`}>
                              {regradeResult.newScore > regradeResult.oldScore ? '↑' :
                               regradeResult.newScore < regradeResult.oldScore ? '↓' : '='}
                              {regradeResult.newScore - regradeResult.oldScore !== 0 && (
                                ` ${regradeResult.newScore - regradeResult.oldScore > 0 ? '+' : ''}${regradeResult.newScore - regradeResult.oldScore}점`
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                      {/* 재평가된 글이면 이전 점수 표시 */}
                      {s.re_graded_at && s.previous_total_score !== null && s.previous_total_score !== undefined && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                            📊 이전 평가 보기 ({s.previous_total_score}/{s.previous_max_score}점)
                          </summary>
                          <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 text-gray-700">
                            <div className="text-xs">
                              이전 채점: <strong>{s.previous_total_score}/{s.previous_max_score}점</strong>
                              {s.re_graded_at && (
                                <span className="ml-2 text-gray-500">
                                  · {new Date(s.re_graded_at).toLocaleString('ko-KR')} 재평가
                                </span>
                              )}
                            </div>
                            {s.previous_feedback_overall && (
                              <div>
                                <div className="font-semibold text-xs mb-0.5">종합의견 (이전)</div>
                                <p className="whitespace-pre-wrap">{s.previous_feedback_overall}</p>
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  )
                }

                return (
                  <>
                    {/* 최신 2개: 직전(왼쪽) vs 최신(오른쪽) 병렬 — 카드 라벨로 위치를 분명히(모호한 ← 제거) */}
                    {/* 1칸뿐(수정 안 한 학생)이면 비교 안내 자체를 숨김 */}
                    {topTwo.length >= 2 && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600 mb-2 bg-blue-50 border border-blue-100 rounded-lg py-2 px-3">
                        <span className="text-gray-500">🔍 나란히 비교</span>
                        <span className="font-semibold text-gray-800">{labelFor(topTwo[0])}</span>
                        <span className="text-sm text-blue-400 font-bold">↔</span>
                        <span className="font-semibold text-gray-800">{labelFor(topTwo[1])}</span>
                        {older.length > 0 && (
                          <span className="text-gray-400 sm:ml-auto">더 이전 글은 아래 [📂 이전 글 더 보기]에 있어요</span>
                        )}
                      </div>
                    )}
                    <div className={`grid gap-4 items-stretch ${topTwo.length >= 2 ? 'lg:grid-cols-2' : ''}`}>
                      {topTwo.map(s => renderCard(s, ordered.indexOf(s)))}
                    </div>

                    {/* 그 이전 글들 — 아래에 세로로 (최신순) */}
                    {older.length > 0 && (
                      <details className="mt-4" open={false}>
                        <summary className="cursor-pointer text-sm font-semibold text-gray-600 hover:text-gray-900 py-2 px-2 bg-gray-50 rounded-lg select-none">
                          📂 이전 글 더 보기 ({older.length}개)
                        </summary>
                        <div className="space-y-4 mt-3">
                          {[...older].reverse().map(s => renderCard(s, ordered.indexOf(s)))}
                        </div>
                      </details>
                    )}
                  </>
                )
              })()}
            </>
          )}
        </main>
      </div>
    </>
  )
}

// ============================================
// 🆕 담임 코멘트 박스 (와이프 피드백)
// 학생 글 1편당 코멘트 1개. 작성·수정·삭제 가능.
// 임퍼소네이션 중에는 작성 차단 (disabled prop).
// ============================================
function TeacherCommentBox({ submission, studentName, onUpdated, disabled, maskNames = [] }) {
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(submission.teacher_comment || '')
  const [saving, setSaving] = useState(false)
  const [templates, setTemplates] = useState([])
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState([])

  // ✨ AI 추천: 내 기존 코멘트 말투를 학습해 이 글에 맞는 초안 생성
  const fetchSuggestions = async () => {
    // 키 서버격리(step153~): 키 미등록이면 서버가 명확한 에러 반환 → catch에서 안내
    setSuggesting(true)
    setSuggestions([])
    try {
      // 내가 쓴 최근 코멘트 15개 (말투 샘플) — RLS로 내 학급만 조회됨
      const { data: recent } = await supabase.from('submissions')
        .select('teacher_comment')
        .not('teacher_comment', 'is', null)
        .neq('id', submission.id)
        .order('teacher_comment_at', { ascending: false })
        .limit(15)

      // 학생 이름 마스킹 (개인정보 — AI에 이름 안 보냄)
      const mask = (t) => {
        let out = t
        maskNames.forEach(n => {
          if (n && n.length >= 2) out = out.split(n).join('○○')
        })
        return out
      }
      const styleSamples = (recent || []).map(r => mask(r.teacher_comment)).filter(Boolean)

      const r = await callAI('commentSuggest', {
        styleSamples,
        essay: submission.essay_text,
        score: submission.total_score,
        max: submission.max_score,
        aiOverall: submission.feedback_overall,
        aiImprove: submission.feedback_improve,
      })
      setSuggestions(Array.isArray(r.comments) ? r.comments : [])
    } catch (e) {
      alert('추천 생성 실패: ' + (e.message || '잠시 후 다시 시도해주세요'))
    }
    setSuggesting(false)
  }

  // 자주 쓰는 코멘트 (localStorage)
  const TPL_KEY = 'teacher_comment_templates'
  const DEFAULT_TPLS = [
    '글이 점점 좋아지고 있어요! 꾸준히 쓰는 모습이 멋져요. 👍',
    '구체적인 표현이 정말 인상 깊었어요. 다음 글도 기대할게요!',
    'AI 피드백을 읽고 한 가지만 골라 고쳐쓰기에 도전해볼까요?',
    '솔직한 마음이 잘 느껴지는 글이었어요. 선생님이 감동했어요. 💛',
  ]
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TPL_KEY)
      setTemplates(stored ? JSON.parse(stored) : DEFAULT_TPLS)
    } catch { setTemplates(DEFAULT_TPLS) }
  }, [])
  const saveTemplates = (next) => {
    setTemplates(next)
    try { localStorage.setItem(TPL_KEY, JSON.stringify(next)) } catch {}
  }
  const insertTemplate = (t) => {
    setContent(prev => prev.trim() ? prev.trimEnd() + '\n' + t : t)
  }
  const addCurrentAsTemplate = () => {
    const t = content.trim()
    if (!t) return alert('저장할 문구를 먼저 입력해주세요!')
    if (templates.includes(t)) return alert('이미 저장된 문구예요.')
    saveTemplates([...templates, t])
  }
  const removeTemplate = (idx) => {
    saveTemplates(templates.filter((_, i) => i !== idx))
  }

  // submission 바뀌면 초기값 동기화
  useEffect(() => {
    setContent(submission.teacher_comment || '')
    setEditing(false)
  }, [submission.id, submission.teacher_comment])

  const hasComment = !!submission.teacher_comment
  const updatedAt = submission.teacher_comment_at

  const save = async () => {
    if (disabled) return
    const trimmed = content.trim()
    if (!trimmed) return alert('코멘트를 입력해주세요!')
    setSaving(true)
    try {
      const { error } = await supabase.from('submissions').update({
        teacher_comment: trimmed,
        teacher_comment_at: new Date().toISOString()
      }).eq('id', submission.id)
      if (error) throw error
      setEditing(false)
      if (onUpdated) await onUpdated()
    } catch (e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const remove = async () => {
    if (disabled) return
    if (!confirm(`${studentName} 학생의 코멘트를 지울까요?`)) return
    setSaving(true)
    try {
      const { error } = await supabase.from('submissions').update({
        teacher_comment: null,
        teacher_comment_at: null
      }).eq('id', submission.id)
      if (error) throw error
      setContent('')
      setEditing(false)
      if (onUpdated) await onUpdated()
    } catch (e) {
      alert('삭제 실패: ' + e.message)
    }
    setSaving(false)
  }

  // 작성 모드 — 데스크탑(lg+)은 하단 고정 패널, 모바일은 제자리 인라인
  // (모바일에서 fixed bottom은 가상 키보드에 가려지는 문제가 있어 인라인으로)
  if (editing) {
    const editorBody = (
      <>
        <div className="flex items-center justify-between flex-wrap gap-1">
          <h4 className="text-sm font-bold text-yellow-900">
            💬 {studentName} {(submission.attempt||1) === 1 ? '첫 글' : `수정본`} 코멘트 {hasComment ? '수정' : '작성'}
          </h4>
          <span className="text-[10px] text-yellow-700">학생에게 그대로 보입니다</span>
        </div>
        {/* 자주 쓰는 문구 + AI 추천 */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <button
            onClick={fetchSuggestions}
            disabled={suggesting}
            className="inline-flex items-center gap-1 bg-primary/10 border border-primary/30 text-primary rounded-full px-2.5 py-0.5 text-[11px] font-semibold hover:bg-primary/20 disabled:opacity-50"
            title="내가 평소 쓰는 말투로, 이 글에 맞는 코멘트를 추천받아요">
            {suggesting ? '추천 만드는 중...' : '✨ 추천 받기'}
          </button>
          {templates.map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-yellow-100 border border-yellow-300 rounded-full pl-2.5 pr-1 py-0.5 text-[11px] text-yellow-900 max-w-[260px]">
              <button onClick={() => insertTemplate(t)} className="truncate hover:underline" title={t}>
                {t.length > 22 ? t.slice(0, 22) + '…' : t}
              </button>
              <button onClick={() => removeTemplate(i)} className="text-yellow-500 hover:text-red-600 px-0.5" title="이 문구 삭제">×</button>
            </span>
          ))}
        </div>
        {/* AI 추천 결과 — 클릭하면 삽입 */}
        {suggestions.length > 0 && (
          <div className="space-y-1.5">
            {suggestions.map((sug, i) => (
              <button key={i}
                onClick={() => { insertTemplate(sug); }}
                className="w-full text-left text-xs text-gray-800 bg-primary/5 hover:bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 transition-colors leading-relaxed break-keep">
                {sug}
              </button>
            ))}
            <p className="text-[10px] text-gray-400">초안이에요 — 선생님 마음을 담아 다듬어 주세요.</p>
          </div>
        )}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`${studentName} 학생에게 하고 싶은 말을 적어주세요...\n(예: 비유 표현이 정말 좋았어요! 다음엔 결말을 좀 더 자세히 써보면 어떨까요?)`}
          rows="3"
          className="w-full p-2 border border-yellow-300 rounded text-sm leading-relaxed bg-white"
        />
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] ${content.length > 1000 ? 'text-red-600' : 'text-gray-500'}`}>
              {content.length}자 {content.length > 1000 && '(너무 길어요)'}
            </span>
            <button
              onClick={addCurrentAsTemplate}
              disabled={!content.trim()}
              className="text-[11px] text-yellow-700 hover:text-yellow-900 underline disabled:opacity-40"
              title="지금 쓴 문구를 자주 쓰는 문구로 저장">
              + 문구 저장
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setContent(submission.teacher_comment || ''); setEditing(false) }}
              disabled={saving}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50">
              취소
            </button>
            <button
              onClick={save}
              disabled={saving || !content.trim() || content.length > 1000}
              className="text-xs px-4 py-1.5 bg-yellow-600 text-white rounded font-semibold hover:bg-yellow-700 disabled:opacity-50">
              {saving ? '저장 중...' : '💾 저장'}
            </button>
          </div>
        </div>
      </>
    )

    return (
      <>
        {/* 모바일: 제자리 인라인 편집 */}
        <div className="lg:hidden bg-yellow-50 border-2 border-yellow-300 rounded-lg p-3 space-y-2">
          {editorBody}
        </div>

        {/* 데스크탑: 제자리 안내 + 하단 고정 패널 */}
        <div className="hidden lg:block bg-yellow-50 border-2 border-dashed border-yellow-300 rounded-lg p-3 text-sm text-yellow-800">
          ✍️ 화면 아래에서 코멘트 작성 중... 위아래 스크롤하며 AI 피드백을 참고하세요.
        </div>
        <div className="hidden lg:block fixed bottom-0 left-0 right-0 z-50 bg-yellow-50 border-t-2 border-yellow-400 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
          <div className="max-w-3xl mx-auto p-3 space-y-2">
            {editorBody}
          </div>
        </div>
      </>
    )
  }

  // 코멘트 있음 - 표시 모드
  if (hasComment) {
    return (
      <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <h4 className="text-sm font-bold text-yellow-900">💬 선생님 코멘트</h4>
          <div className="flex items-center gap-2">
            {updatedAt && (
              <span className="text-[10px] text-yellow-700">
                {new Date(updatedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {!disabled && (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="text-[11px] text-yellow-800 hover:bg-yellow-200 px-2 py-0.5 rounded">
                  ✏️ 수정
                </button>
                <button
                  onClick={remove}
                  disabled={saving}
                  className="text-[11px] text-gray-500 hover:bg-gray-200 px-2 py-0.5 rounded disabled:opacity-50">
                  🗑️ 지우기
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-sm text-yellow-900 whitespace-pre-wrap leading-relaxed break-keep">
          {submission.teacher_comment}
        </p>
      </div>
    )
  }

  // 코멘트 없음 - 작성 안내 (담임만)
  if (disabled) return null  // 임퍼소네이션 중엔 안 보임
  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full py-2 border-2 border-dashed border-yellow-300 rounded-lg text-sm text-yellow-700 hover:bg-yellow-50 hover:border-yellow-400 transition">
      💬 이 글에 직접 코멘트 달기
    </button>
  )
}


```

## pages/teacher/topics.js

```js
import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getFriendlyErrorMessage } from '../../lib/gemini'
import { callAI } from '../../lib/aiClient'
import Header from '../../components/Header'
import SuggestionLogPanel from '../../components/SuggestionLogPanel'

// 🆕 step159: AI 작업 중 가시화용 로딩 블록 (스피너 + 큰 문구)
function AiLoadingBlock({ title, sub }) {
  return (
    <div className="bg-indigo-50 border-2 border-indigo-200 rounded-xl p-5 flex items-center gap-4">
      <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin flex-shrink-0" />
      <div>
        <p className="font-bold text-indigo-900">{title}</p>
        {sub && <p className="text-sm text-indigo-700/80 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

const DEFAULT_RUBRICS = [
  { name: '주제에 맞는 내용', hint: '주제에서 벗어나지 않고 핵심을 잘 표현', score: 25 },
  { name: '글의 짜임새', hint: '처음-가운데-끝의 흐름이 자연스러운가', score: 25 },
  { name: '풍부한 표현', hint: '다양한 어휘와 생생한 묘사', score: 25 },
  { name: '맞춤법과 문법', hint: '정확한 표기와 띄어쓰기', score: 25 }
]

export default function TopicsPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [hasApiKey, setHasApiKey] = useState(false)  // 키 서버격리(step153~): class_secrets 기준
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)
  
  // 새 주제 입력
  const [date, setDate] = useState(() => {
    const now = new Date()
    const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
    return kst.toISOString().slice(0, 10)
  })
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [rubrics, setRubrics] = useState(DEFAULT_RUBRICS)
  const [lockEnabled, setLockEnabled] = useState(false)
  const [lockStartTime, setLockStartTime] = useState('09:00')
  const [lockEndTime, setLockEndTime] = useState('10:00')
  // 글자수 + 재수정 설정
  const [minLength, setMinLength] = useState(30)
  const [maxLength, setMaxLength] = useState('') // 글 최대 길이 (빈 칸=제한 없음)
  const [maxRewrites, setMaxRewrites] = useState(1)
  const [requireRewriteChange, setRequireRewriteChange] = useState(true)
  // 제출 기한 (옵션)
  const [deadlineEnabled, setDeadlineEnabled] = useState(false)
  const [deadlineDate, setDeadlineDate] = useState('')
  const [deadlineTime, setDeadlineTime] = useState('23:59')
  const [saving, setSaving] = useState(false)
  const [aiSuggesting, setAiSuggesting] = useState(false)
  // AI 추천 옵션
  const [showAiOptions, setShowAiOptions] = useState(false)
  const [aiGrade, setAiGrade] = useState('') // '', '3', '4', '5', '6'
  const [aiLevel, setAiLevel] = useState('보통') // 쉬움/보통/어려움
  const [aiCategory, setAiCategory] = useState('') // 빈 값이면 랜덤
  const [aiUserRequest, setAiUserRequest] = useState('') // 사용자 자유 요청
  // 🆕 3개 추천 결과 (와이프 피드백): { id (log id), suggestions: [{title, description, category}] }
  const [aiPicker, setAiPicker] = useState(null)
  // 🆕 한 번에 받을 추천 개수 (1·2·3)
  const [aiCount, setAiCount] = useState(3)
  // 🆕 한 카드만 다시 추천 시 어느 카드가 로딩 중인지 (-1: 없음)
  const [refreshingIdx, setRefreshingIdx] = useState(-1)
  // 🆕 카드별 카테고리 (다시 추천할 때 이 카드 카테고리 유지/변경)
  // 🆕 "3개 서로 다른 카테고리" 모드 (기본 ON, 와이프 피드백)
  const [diverseMode, setDiverseMode] = useState(true)
  // 역방향: 주제 → 평가기준 자동 생성
  const [generatingRubrics, setGeneratingRubrics] = useState(false)
  // 🆕 step159: AI 완료 후 "주제 등록" 버튼으로 유도 (스크롤 + 강조)
  const [highlightRegister, setHighlightRegister] = useState(false)
  const formStartRef = useRef(null)
  const registerBtnRef = useRef(null)
  // 평가기준 생성 완료 후 등록 버튼으로 부드럽게 안내
  const guideToRegister = () => {
    setTimeout(() => {
      try { registerBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } catch (e) {}
      setHighlightRegister(true)
      setTimeout(() => setHighlightRegister(false), 4500)
    }, 120)
  }

  // 📅 기간 일괄 등록 모드
  const [batchMode, setBatchMode] = useState(false)
  const [batchStartDate, setBatchStartDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 9)
    return d.toISOString().split('T')[0]
  })
  const [batchEndDate, setBatchEndDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 9)
    d.setDate(d.getDate() + 6) // 기본 7일
    return d.toISOString().split('T')[0]
  })
  const [batchExcludeWeekend, setBatchExcludeWeekend] = useState(true)
  const [batchTheme, setBatchTheme] = useState('') // 주제 방향 (선택)
  const [batchGenerating, setBatchGenerating] = useState(false)
  const [batchProgress, setBatchProgress] = useState('') // 진행 상황 표시
  const [batchPreview, setBatchPreview] = useState(null) // 생성된 주제 리스트 미리보기
  const [batchSaving, setBatchSaving] = useState(false)
  // 등록된 주제 펼침 (평가기준 확인용)
  const [expandedTopicId, setExpandedTopicId] = useState(null)
  // 🆕 AI 추천 로그
  const [suggestionLogs, setSuggestionLogs] = useState([])
  const [sharedSuggestionLogs, setSharedSuggestionLogs] = useState([])  // 🆕 다른 선생님 공유 추천
  const [logsLoading, setLogsLoading] = useState(false)
  // 🆕 마지막에 선택된 추천 로그 ID (주제 등록 시 link 위해)
  const [lastSelectedLogId, setLastSelectedLogId] = useState(null)
  // 🆕 다른 선생님 공유 주제를 가져왔을 때의 출처 { logId, index } (등록 완료 시 topic_copies 기록용)
  const [copiedSource, setCopiedSource] = useState(null)
  // 🆕 손제작 주제를 다른 선생님 추천 풀에 공유할지 (옵트인) — 켜면 등록 시 합성 추천 로그 생성
  const [shareToPool, setShareToPool] = useState(false)
  // 🆕 step278: 체크 없이 등록한 손제작 주제에 대해 등록 직후 공유 여부 1회 확인 { topicId, title, description }
  const [sharePrompt, setSharePrompt] = useState(null)
  const [dontAskShare, setDontAskShare] = useState(false) // 이번 세션 한정 "다시 묻지 않기"
  // 편집 모드 (특정 주제 수정 중인지)
  const [editingTopicId, setEditingTopicId] = useState(null)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles').select('*, classes:class_id(id, name, code, grade)').eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)

    // 학급 학년 자동 추출/세팅
    let gradeStr = ''
    if (profile.classes?.grade) {
      gradeStr = String(profile.classes.grade)
    } else if (profile.classes?.name) {
      // 학급명에서 학년 추출 ("5학년 1반" → "5")
      const m = profile.classes.name.match(/(\d)\s*학년/)
      if (m) gradeStr = m[1]
    }
    setAiGrade(gradeStr)

    // 키 서버격리(step153~): 키 등록 여부만 확인 (값은 안 가져옴). AI 호출은 서버가 키 조회.
    if (profile.classes?.id) {
      try {
        const { data: keyCheck } = await supabase.from('class_secrets')
          .select('class_id').eq('class_id', profile.classes.id).maybeSingle()
        setHasApiKey(!!keyCheck)
      } catch (e) { setHasApiKey(false) }
    }

    await loadTopics(profile.id, profile.classes?.id)
    await loadSuggestionLogs(profile.id)  // 🆕 사이드 패널용 미리 로드
    setLoading(false)
  }

  const loadTopics = async (teacherId, classId = null) => {
    if (!teacherId) return
    const { data } = await supabase.from('topics')
      .select('*')
      .eq('teacher_id', teacherId)
      .order('date', { ascending: false })
      .limit(50)

    if (!data || data.length === 0) {
      setTopics([])
      return
    }

    // 우리 학급 학생 ID 목록 (숨김 제외) - 제출 카운트 정확하게 계산하기 위해
    const cid = classId || classInfo?.id
    let visibleStudents = []
    let visibleStudentIds = []
    if (cid) {
      const { data: studs } = await supabase.from('profiles')
        .select('id, realname, number, is_hidden').eq('class_id', cid).eq('role', 'student')
      visibleStudents = (studs || []).filter(s => !s.is_hidden)
        .sort((a, b) => (a.number || 999) - (b.number || 999))
      visibleStudentIds = visibleStudents.map(s => s.id)
    }

    // 주제별 제출 학생 수 (한 학생이 여러 번 제출해도 1명으로)
    const topicIds = data.map(t => t.id)
    const { data: subs } = await supabase.from('submissions')
      .select('topic_id, user_id')
      .in('topic_id', topicIds)
      .in('user_id', visibleStudentIds.length > 0 ? visibleStudentIds : ['00000000-0000-0000-0000-000000000000'])
      .is('deleted_at', null)

    // topic_id → Set of unique user_id
    const submitMap = {}
    ;(subs || []).forEach(s => {
      if (!submitMap[s.topic_id]) submitMap[s.topic_id] = new Set()
      submitMap[s.topic_id].add(s.user_id)
    })

    const enriched = data.map(t => {
      const submittedIds = submitMap[t.id] || new Set()
      const submittedStudents = visibleStudents.filter(s => submittedIds.has(s.id))
      const notSubmittedStudents = visibleStudents.filter(s => !submittedIds.has(s.id))
      return {
        ...t,
        submitted_count: submittedIds.size,
        total_students: visibleStudentIds.length,
        submitted_students: submittedStudents,
        not_submitted_students: notSubmittedStudents
      }
    })
    setTopics(enriched)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 루브릭 조작
  const updateRubric = (i, key, val) => {
    const next = [...rubrics]
    next[i][key] = key === 'score' ? parseInt(val) || 0 : val
    setRubrics(next)
  }
  const addRubric = () => setRubrics([...rubrics, { name: '새 기준', score: 10 }])
  const removeRubric = (i) => setRubrics(rubrics.filter((_, idx) => idx !== i))

  const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)

  // 📅 기간 내 날짜 목록 생성 (주말 제외 옵션)
  const getDatesInRange = (start, end, excludeWeekend) => {
    const dates = []
    const cur = new Date(start)
    const stop = new Date(end)
    while (cur <= stop) {
      const day = cur.getDay()
      if (!excludeWeekend || (day !== 0 && day !== 6)) {
        const y = cur.getFullYear()
        const m = String(cur.getMonth() + 1).padStart(2, '0')
        const d = String(cur.getDate()).padStart(2, '0')
        dates.push(`${y}-${m}-${d}`)
      }
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  }

  // 📅 기간 일괄 AI 주제 생성 (미리보기)
  const generateBatchTopics = async () => {
    if (!batchStartDate || !batchEndDate) return alert('시작/종료 날짜를 모두 선택해주세요')
    if (new Date(batchStartDate) > new Date(batchEndDate)) return alert('종료일이 시작일보다 빠를 수 없어요')

    if (!hasApiKey) return alert('Gemini API 키를 먼저 등록해주세요!')

    const dates = getDatesInRange(batchStartDate, batchEndDate, batchExcludeWeekend)
    if (dates.length === 0) return alert('생성할 날짜가 없어요 (주말만 선택됨)')
    if (dates.length > 14) return alert('한 번에 최대 14일까지만 가능해요 (현재 ' + dates.length + '일)')

    // 이미 등록된 날짜 체크
    const existingDates = new Set(topics.map(t => t.date))
    const conflictDates = dates.filter(d => existingDates.has(d))
    if (conflictDates.length > 0) {
      const proceed = confirm(
        `이미 등록된 날짜가 ${conflictDates.length}개 있어요:\n` +
        conflictDates.slice(0, 5).join(', ') + (conflictDates.length > 5 ? ' ...' : '') +
        `\n\n이 날짜들은 건너뛰고 나머지만 생성할까요?`
      )
      if (!proceed) return
    }
    const targetDates = dates.filter(d => !existingDates.has(d))
    if (targetDates.length === 0) return alert('생성할 날짜가 없어요 (모두 등록됨)')

    setBatchGenerating(true)
    setBatchPreview(null)
    setBatchProgress('AI 호출 준비 중...')
    try {
      const gradeText = classInfo?.grade ? `초등 ${classInfo.grade}학년` : '초등 5학년'
      // 최근 30개까지 중복 회피 (15개로는 부족)
      const recentTitles = topics.slice(0, 30).map(t => t.title).join(', ')

      const hasTheme = batchTheme && batchTheme.trim()

      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('topicBatch', {
        gradeText, count: targetDates.length,
        theme: batchTheme, recentTitles, style: 'batch',
        maxTokens: 6000,
      })

      let aiTopics = Array.isArray(result.topics) ? result.topics : []
      if (aiTopics.length < targetDates.length) {
        alert(`AI가 ${aiTopics.length}개만 생성했어요. 필요한 ${targetDates.length}개보다 적어요. 다시 시도해주세요.`)
        return
      }
      // 정확히 필요한 개수만 잘라서 사용
      aiTopics = aiTopics.slice(0, targetDates.length)

      // 미리보기 데이터 만들기 (날짜 + 주제 매핑)
      const preview = targetDates.map((d, i) => ({
        date: d,
        title: aiTopics[i]?.title || '',
        description: aiTopics[i]?.description || '',
        category: aiTopics[i]?.category || ''
      }))
      setBatchPreview(preview)
    } catch(e) {
      console.error('일괄 생성 오류:', e)
      alert('생성 실패: ' + (e.message || e))
    }
    setBatchGenerating(false)
    setBatchProgress('')
  }

  // 📅 미리보기 항목 수정
  const updatePreviewItem = (idx, field, value) => {
    setBatchPreview(prev => prev.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item
    ))
  }

  // 📅 미리보기 항목 제거
  const removePreviewItem = (idx) => {
    setBatchPreview(prev => prev.filter((_, i) => i !== idx))
  }

  // 📅 개별 항목 재추천 (그 날짜 하나만 AI 새로 받아옴)
  const [regeneratingIdx, setRegeneratingIdx] = useState(null)
  const regenerateSingle = async (idx) => {
    const item = batchPreview[idx]
    if (!item) return

    if (!hasApiKey) return alert('Gemini API 키를 먼저 등록해주세요')

    setRegeneratingIdx(idx)
    try {
      const gradeText = classInfo?.grade ? `초등 ${classInfo.grade}학년` : '초등 5학년'
      // 다른 항목들과 중복되지 않게 + 최근 등록 주제 고려
      const otherTitles = batchPreview.filter((_, i) => i !== idx).map(p => p.title).filter(Boolean).join(', ')
      const recentTitles = topics.slice(0, 15).map(t => t.title).join(', ')
      const hasTheme = batchTheme && batchTheme.trim()

      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('topicSingle', {
        gradeText, theme: batchTheme,
        otherTitles, recentTitles, style: 'batch',
        maxTokens: 1500,
      })

      if (result.title) {
        setBatchPreview(prev => prev.map((p, i) =>
          i === idx ? {
            ...p,
            title: result.title,
            description: result.description || p.description,
            // category는 단일 추천 schema에 없으니 기존 유지
          } : p
        ))
      }
    } catch(e) {
      alert('재추천 실패: ' + (e.message || e))
    }
    setRegeneratingIdx(null)
  }

  // 📅 일괄 저장 (DB에 한 번에 등록)
  const saveBatchTopics = async () => {
    if (!batchPreview || batchPreview.length === 0) return

    // 빈 주제 검증
    const invalid = batchPreview.filter(p => !p.title.trim())
    if (invalid.length > 0) {
      return alert(`주제 제목이 비어있는 항목이 ${invalid.length}개 있어요. 직접 입력하거나 삭제해주세요.`)
    }

    if (!confirm(
      `📅 ${batchPreview.length}개 주제를 등록할까요?\n\n` +
      `각 주제는 기본 평가 기준 + 글자수 30자 + 수정 1회로 등록돼요.\n` +
      `등록 후 개별 주제를 수정할 수 있어요.`
    )) return

    setBatchSaving(true)
    try {
      const insertRows = batchPreview.map(p => ({
        date: p.date,
        title: p.title.trim(),
        description: p.description.trim(),
        rubrics: DEFAULT_RUBRICS,
        teacher_id: user.id,
        min_length: 30,
        max_rewrites: 1,
        lock_enabled: false
      }))

      const { error } = await supabase.from('topics').insert(insertRows)
      if (error) throw error

      alert(`✅ ${batchPreview.length}개 주제가 등록되었어요!`)
      setBatchPreview(null)
      setBatchTheme('')
      // 단일 모드로 돌아가서 목록 새로고침
      setBatchMode(false)
      await loadTopics(user.id, classInfo?.id)
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setBatchSaving(false)
  }

  // 주제 저장
  // 주제를 편집 폼에 로드
  const loadTopicForEdit = (t) => {
    // 단일 모드로 전환
    setBatchMode(false)
    setBatchPreview(null)
    setEditingTopicId(t.id)
    setDate(t.date)
    setTitle(t.title || '')
    setDesc(t.description || '')
    setRubrics(t.rubrics && t.rubrics.length > 0 ? t.rubrics : DEFAULT_RUBRICS)
    setLockEnabled(!!t.lock_enabled)
    setLockStartTime(t.lock_start_time || '09:00')
    setLockEndTime(t.lock_end_time || '10:00')
    setMinLength(t.min_length || 30)
    setMaxLength(t.max_length || '')
    setMaxRewrites(t.max_rewrites !== undefined && t.max_rewrites !== null ? t.max_rewrites : 1)
    setRequireRewriteChange(t.require_rewrite_change !== false)
    setDeadlineEnabled(!!t.deadline_date)
    setDeadlineDate(t.deadline_date || '')
    setDeadlineTime(t.deadline_time || '23:59')
    // 펼침 닫고 위로 스크롤
    setExpandedTopicId(null)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 편집 모드 취소
  const cancelEdit = () => {
    setEditingTopicId(null)
    setTitle('')
    setDesc('')
    setRubrics(DEFAULT_RUBRICS)
    setLockEnabled(false)
    setMinLength(30); setMaxLength('')
    setMaxRewrites(1)
    setRequireRewriteChange(true)
    setDeadlineEnabled(false)
  }

  const saveTopic = async () => {
    if (!date || !title.trim()) return alert('날짜와 주제를 입력해주세요')
    if (rubrics.length === 0) return alert('평가 기준을 1개 이상 추가해주세요')

    // 글자수 검증
    const minLen = parseInt(minLength)
    if (isNaN(minLen) || minLen < 10 || minLen > 5000) {
      return alert('최소 글자수는 10~5000자 범위로 입력해주세요')
    }
    const maxLen = maxLength ? parseInt(maxLength) : null
    if (maxLen !== null && (isNaN(maxLen) || maxLen < minLen || maxLen > 5000)) {
      return alert(`최대 글자수는 최소 글자수(${minLen}) 이상, 5000 이하여야 해요`)
    }
    const maxRew = parseInt(maxRewrites)
    if (isNaN(maxRew) || maxRew < 0 || maxRew > 5) {
      return alert('최대 재수정 횟수는 0~5회 범위로 입력해주세요')
    }

    setSaving(true)
    try {
      // 기존 주제 수정 모드인지 확인 (편집 버튼으로 진입한 경우만)
      // 단순히 같은 날짜에 주제가 있다고 해서 자동 덮어쓰기 X
      // → 하루 여러 주제 등록 가능
      const isEditMode = !!editingTopicId
      let existing = null
      if (isEditMode) {
        const { data } = await supabase.from('topics')
          .select('id').eq('id', editingTopicId).maybeSingle()
        existing = data
      }

      let error
      if (existing) {
        const r = await supabase.from('topics').update({
          date,
          title: title.trim(),
          description: desc.trim(),
          rubrics: rubrics,
          lock_enabled: lockEnabled,
          lock_start_time: lockEnabled ? lockStartTime : null,
          lock_end_time: lockEnabled ? lockEndTime : null,
          min_length: minLen,
          max_length: maxLen,
          max_rewrites: maxRew,
          require_rewrite_change: requireRewriteChange,
          deadline_date: deadlineEnabled ? (deadlineDate || date) : null,
          deadline_time: deadlineEnabled ? deadlineTime : null
        }).eq('id', existing.id)
        error = r.error
      } else {
        const r = await supabase.from('topics').insert({
          date,
          title: title.trim(),
          description: desc.trim(),
          rubrics: rubrics,
          teacher_id: user.id,
          lock_enabled: lockEnabled,
          lock_start_time: lockEnabled ? lockStartTime : null,
          lock_end_time: lockEnabled ? lockEndTime : null,
          min_length: minLen,
          max_length: maxLen,
          max_rewrites: maxRew,
          require_rewrite_change: requireRewriteChange,
          deadline_date: deadlineEnabled ? (deadlineDate || date) : null,
          deadline_time: deadlineEnabled ? deadlineTime : null
        }).select('id').single()
        error = r.error
        // 🆕 AI 추천에서 온 주제면 로그에 resulting_topic_id 연결
        if (!error && r.data?.id && lastSelectedLogId) {
          try {
            await supabase.from('topic_suggestion_logs')
              .update({ resulting_topic_id: r.data.id })
              .eq('id', lastSelectedLogId)
          } catch(e) { console.warn('로그 연결 실패:', e) }
          setLastSelectedLogId(null)
        }
        // 🆕 다른 선생님 공유 주제를 가져와 등록한 경우 출처 기록 (집계용 — 화면 변화 없음)
        // 새 주제는 독립 유지(resulting_topic_id 재연결 안 함). 기록 실패는 등록 흐름을 막지 않음.
        if (!error && r.data?.id && copiedSource?.logId) {
          try {
            const { error: copyErr } = await supabase.from('topic_copies').insert({
              source_log_id: copiedSource.logId,
              source_index: copiedSource.index,
              copied_by_teacher_id: user.id,
              copied_topic_id: r.data.id,
            })
            // UNIQUE 중복 등은 무시(같은 교사 재가져오기) — 등록은 정상 완료
            if (copyErr) console.warn('출처 기록 건너뜀(등록은 정상):', copyErr.message)
          } catch(e) { console.warn('출처 기록 예외(등록은 정상):', e) }
          setCopiedSource(null)
        }
        // 🆕 손제작 주제를 추천 풀에 공유(옵트인): 합성 추천 로그를 만들어 자동공유 경로에 얹는다.
        // AI 추천 출신(lastSelectedLogId)은 이미 resulting_topic_id로 공유되므로 중복 생성 안 함.
        // 기록 실패는 등록 흐름을 막지 않음(topic_copies와 동일 패턴).
        if (!error && r.data?.id && shareToPool && !lastSelectedLogId) {
          try {
            const { error: shareErr } = await supabase.from('topic_suggestion_logs').insert({
              teacher_id: user.id,
              class_id: classInfo?.id ?? null,
              suggestions: [{ title: title.trim(), description: desc.trim(), category: '직접 작성' }],
              selected_index: 0,
              resulting_topic_id: r.data.id,
              model_used: null,
            })
            if (shareErr) console.warn('풀 공유 건너뜀(등록은 정상):', shareErr.message)
          } catch(e) { console.warn('풀 공유 예외(등록은 정상):', e) }
        }
        // 🆕 step278: 체크 없이 등록한 손제작 주제면 등록 직후 1회 공유 여부 확인
        // (폼이 곧 리셋되므로 title/description을 함께 보관)
        if (!error && r.data?.id && !lastSelectedLogId && !shareToPool && !dontAskShare) {
          setSharePrompt({ topicId: r.data.id, title: title.trim(), description: desc.trim() })
        }
      }

      if (error) throw error

      alert(existing ? '주제 수정 완료!' : '주제 등록 완료!')
      setTitle('')
      setDesc('')
      setRubrics(DEFAULT_RUBRICS)
      setLockEnabled(false)
      setLockStartTime('09:00')
      setLockEndTime('10:00')
      setMinLength(30); setMaxLength('')
      setMaxRewrites(1)
      setDeadlineEnabled(false)
      setDeadlineDate('')
      setDeadlineTime('23:59')
      setShareToPool(false)
      setEditingTopicId(null) // 편집 모드 해제
      await loadTopics(user.id, classInfo?.id)
    } catch(e) {
      alert('저장 실패: ' + e.message)
    }
    setSaving(false)
  }

  const deleteTopic = async (id) => {
    if (!confirm('이 주제를 삭제할까요? (학생 글은 유지됨)')) return
    const { error } = await supabase.from('topics').delete().eq('id', id)
    if (error) return alert('삭제 실패: ' + error.message)
    await loadTopics(user.id, classInfo?.id)
  }

  // AI 주제 추천 — 3개 받아서 와이프가 고름 (와이프 피드백)
  const suggestTopic = async () => {
    if (!hasApiKey) {
      alert('Gemini API 키를 먼저 등록해주세요! (선생님 메인 화면에서 등록 가능)')
      return
    }

    setAiSuggesting(true)
    setAiPicker(null)  // 기존 카드 닫음 (다시 추천하는 경우)
    try {
      // 카테고리 풀
      const categories = [
        '일상 경험', '계절과 자연', '가족과 친구', '꿈과 미래', '책과 영화',
        '학교 생활', '취미와 관심사', '음식과 추억', '여행과 모험', '감정과 마음',
        '상상력', '시간 여행', '미래의 나',
        '신비한 일', '재미있는 발견', '동물 친구', '사회와 환경', '교과 연계'
      ]
      // 골고루 모드면 → 모델한테 N개 서로 다른 카테고리 지시
      // 카테고리 지정 모드면 → 지정된 1개 카테고리로 통일
      // 둘 다 아니면 → 단일 카테고리 (랜덤)
      // aiCount=1이면 골고루 의미 없음 → 자동 단일
      const useCategorySpread = diverseMode && !aiCategory && aiCount >= 2
      let cat, recentTitles
      if (useCategorySpread) {
        // aiCount개 무작위 카테고리
        const shuffled = [...categories].sort(() => Math.random() - 0.5)
        cat = shuffled.slice(0, aiCount).join(' / ')
      } else {
        cat = aiCategory || categories[Math.floor(Math.random() * categories.length)]
      }
      // 최근 30개까지 중복 회피
      recentTitles = topics.slice(0, 30).map(t => t.title).join(', ')

      const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'
      const levelText = aiLevel || '보통'

      // N개 주제 한 번에 받기 — topicBatch 스키마 재사용
      const N = aiCount
      // 개수에 따라 토큰 조정 (1개: 3000, 2개: 5500, 3개: 8000)
      const tokenBudget = 3000 + (N - 1) * 2500
      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('topicBatch', {
        gradeText, count: N, categoryText: cat, levelText,
        recentTitles, userRequest: aiUserRequest, useCategorySpread,
        style: 'suggest', maxTokens: tokenBudget,
      })

      if (!Array.isArray(result.topics) || result.topics.length === 0) {
        throw new Error('추천 결과가 비어있어요. 다시 시도해주세요.')
      }

      // 잘린 주제 필터링
      const validTopics = result.topics.filter(t => {
        if (!t.title || !t.title.trim()) return false
        const desc = (t.description || '').trim()
        if (desc.length > 0 && desc.length < 20) return false
        if (desc.length > 0 && !/[\.\!\?다요세죠나]$/.test(desc.slice(-1))) {
          console.warn(`[추천] 잘림 의심 주제 제외: "${t.title}" desc="${desc.slice(-20)}"`)
          return false
        }
        return true
      })

      if (validTopics.length === 0) {
        throw new Error('추천 응답이 잘렸어요. 다시 시도해주세요.')
      }

      // N개로 자르기 (사용자가 요청한 만큼만)
      const suggestions = validTopics.slice(0, N).map(t => ({
        title: t.title || '',
        description: t.description || '',
        category: t.category || cat
      })).filter(s => s.title)

      if (suggestions.length === 0) {
        throw new Error('유효한 추천 주제가 없어요. 다시 시도해주세요.')
      }

      // 3개 미만이면 알림 (2개라도 보여주되 안내)
      if (suggestions.length < 3) {
        console.log(`[추천] ${suggestions.length}개만 받았어요 (응답 일부 잘림). 표시는 계속.`)
      }

      // 로그 저장 (실패해도 추천 흐름은 계속) — RLS RETURNING 이슈 회피를 위해 두 단계
      let logId = null
      try {
        // 1. ID를 클라이언트에서 직접 생성해서 RETURNING 의존 제거
        const newLogId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : null
        const insertPayload = {
          teacher_id: user.id,
          class_id: classInfo?.id || null,
          request_category: cat,
          request_level: levelText,
          request_user_message: aiUserRequest?.trim() || null,
          suggestions: suggestions,
          model_used: result.__usedModel || null
        }
        if (newLogId) insertPayload.id = newLogId

        const { error: insErr } = await supabase.from('topic_suggestion_logs')
          .insert(insertPayload)
        if (!insErr) {
          logId = newLogId
        } else {
          console.warn('추천 로그 insert 실패 (추천은 계속):', insErr)
        }
      } catch(logErr) {
        console.warn('추천 로그 저장 실패:', logErr)
      }

      // 화면에 카드 표시
      setAiPicker({ logId, suggestions })
    } catch(e) {
      console.error('AI 추천 오류:', e)
      alert(getFriendlyErrorMessage(e))
    }
    setAiSuggesting(false)
  }

  // 🆕 카드 1개만 다시 추천 (다른 2개는 그대로 유지)
  const refreshSingleSuggestion = async (idx, overrideCategory = null) => {
    if (!aiPicker || !aiPicker.suggestions[idx]) return
    if (!hasApiKey) return alert('Gemini API 키를 먼저 등록해주세요!')

    setRefreshingIdx(idx)
    try {
      const categories = [
        '일상 경험', '계절과 자연', '가족과 친구', '꿈과 미래', '책과 영화',
        '학교 생활', '취미와 관심사', '음식과 추억', '여행과 모험', '감정과 마음',
        '상상력', '시간 여행', '미래의 나',
        '신비한 일', '재미있는 발견', '동물 친구', '사회와 환경', '교과 연계'
      ]
      // 카테고리 결정: 명시적 override > 현재 카드의 카테고리 > 랜덤
      const currentCat = aiPicker.suggestions[idx]?.category
      const cat = overrideCategory || currentCat || categories[Math.floor(Math.random() * categories.length)]

      const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'
      const levelText = aiLevel || '보통'

      // 이번 카드 빼고 나머지 카드들 + 최근 등록된 주제는 중복 회피
      const otherTitles = aiPicker.suggestions
        .filter((_, i) => i !== idx)
        .map(s => s.title)
      const recentTitles = [...otherTitles, ...topics.slice(0, 20).map(t => t.title)].join(', ')

      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('topicSingle', {
        gradeText, categoryText: cat, levelText,
        recentTitles, userRequest: aiUserRequest,
        style: 'suggest', maxTokens: 2000,
      })

      const newSug = {
        title: result.title || '',
        description: result.description || '',
        category: cat
      }
      if (!newSug.title) {
        alert('새 주제를 받지 못했어요. 다시 시도해주세요.')
        setRefreshingIdx(-1)
        return
      }

      // 해당 idx만 교체
      setAiPicker(prev => ({
        ...prev,
        suggestions: prev.suggestions.map((s, i) => i === idx ? newSug : s)
      }))

      // 로그도 새로 (별개 entry로 — "1개 교체" 액션도 추적)
      try {
        const newLogId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID() : null
        const payload = {
          teacher_id: user.id,
          class_id: classInfo?.id || null,
          request_category: cat,
          request_level: levelText,
          request_user_message: `[카드 ${idx + 1}번만 교체]` + (aiUserRequest?.trim() ? ' ' + aiUserRequest.trim() : ''),
          suggestions: [newSug],
          model_used: result.__usedModel || null
        }
        if (newLogId) payload.id = newLogId
        await supabase.from('topic_suggestion_logs').insert(payload)
      } catch(e) { /* 무시 */ }
    } catch(e) {
      console.error('단일 추천 오류:', e)
      alert(getFriendlyErrorMessage(e))
    }
    setRefreshingIdx(-1)
  }
  // 🆕 사이드 패널에서 과거 추천 항목을 바로 적용 (와이프 피드백)
  const applyFromLog = async (sug) => {
    if (!sug || !sug.title) return
    setTitle(sug.title)
    setDesc(sug.description || '')
    setLastSelectedLogId(null)
    // 🆕 "다른 선생님" 공유 카드에서 온 경우만 출처 기억 (내 추천/직접작성은 null)
    // sourceIndex는 0일 수 있으니 logId 존재 여부로 판정
    setCopiedSource(sug.sourceLogId ? { logId: sug.sourceLogId, index: sug.sourceIndex } : null)

    if (!hasApiKey) {
      // 평가기준 없이도 폼은 채워짐
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'

    setGeneratingRubrics(true)
    try {
      // 🔒 프롬프트는 서버에서 구성
      const result2 = await callAI('rubricGen', {
        gradeText, title: sug.title, description: sug.description,
      })
      if (Array.isArray(result2.rubrics) && result2.rubrics.length > 0) {
        const cleaned = result2.rubrics.map(r => ({
          name: r.name || '평가 기준',
          hint: (r.hint && r.hint.trim()) ? r.hint.trim() : '이 항목에서 무엇을 잘 표현해야 하는지',
          score: Number(r.score) || 25
        }))
        const total = cleaned.reduce((s, r) => s + r.score, 0)
        if (total !== 100 && total > 0) {
          cleaned.forEach(r => { r.score = Math.round((r.score / total) * 100) })
          const newTotal = cleaned.reduce((s, r) => s + r.score, 0)
          if (newTotal !== 100) cleaned[cleaned.length - 1].score += (100 - newTotal)
        }
        setRubrics(cleaned)
      }
    } catch(e) {
      console.error('평가 기준 생성 실패:', e)
      // 변환 누락 메우기: 다른 rubricGen catch처럼 친절 메시지로 안내 (Failed to fetch 등 포함)
      alert(getFriendlyErrorMessage(e))
    }
    setGeneratingRubrics(false)

    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const applySuggestion = async (idx) => {
    if (!aiPicker || !aiPicker.suggestions[idx]) return
    const picked = aiPicker.suggestions[idx]

    // 폼에 채우기
    setTitle(picked.title)
    setDesc(picked.description)
    // 카드는 닫음 (재선택은 다시 추천 받으면 됨)
    setAiPicker(null)
    // 🆕 step159: 폼이 채워지는 모습 + 평가기준 생성 로딩이 보이게 스크롤
    setTimeout(() => {
      try { formStartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (e) {}
    }, 50)
    // 등록 시 로그와 연결할 수 있게 보관
    setLastSelectedLogId(aiPicker.logId || null)

    // 로그 업데이트 (선택 인덱스 기록)
    if (aiPicker.logId) {
      try {
        await supabase.from('topic_suggestion_logs')
          .update({ selected_index: idx })
          .eq('id', aiPicker.logId)
      } catch(e) {
        console.warn('선택 기록 실패:', e)
      }
    }

    // 평가기준 자동 생성
    if (!hasApiKey) return
    const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'

    setGeneratingRubrics(true)
    try {
      // 🔒 프롬프트는 서버에서 구성
      const result2 = await callAI('rubricGen', {
        gradeText, title: picked.title, description: picked.description,
      })

      if (Array.isArray(result2.rubrics) && result2.rubrics.length > 0) {
        const cleaned = result2.rubrics.map(r => ({
          name: r.name || '평가 기준',
          hint: (r.hint && r.hint.trim()) ? r.hint.trim() : '이 항목에서 무엇을 잘 표현해야 하는지',
          score: Number(r.score) || 25
        }))
        // 합계 100 보정
        const total = cleaned.reduce((s, r) => s + r.score, 0)
        if (total !== 100 && total > 0) {
          cleaned.forEach(r => { r.score = Math.round((r.score / total) * 100) })
          const newTotal = cleaned.reduce((s, r) => s + r.score, 0)
          if (newTotal !== 100) {
            cleaned[cleaned.length - 1].score += (100 - newTotal)
          }
        }
        setRubrics(cleaned)
      }
    } catch(e) {
      console.error('평가 기준 생성 실패 (주제는 유지):', e)
      alert('주제는 채워졌지만 평가 기준 생성은 실패했어요.\n기본 평가기준을 사용하거나 다시 시도해주세요.\n\n' + getFriendlyErrorMessage(e))
    }
    setGeneratingRubrics(false)
    guideToRegister()  // 🆕 step159: 완료 → 등록 버튼으로 유도
  }

  // 🆕 추천 로그 불러오기 (와이프 피드백: AI 추천 기록 보기)
  const loadSuggestionLogs = async (uidArg) => {
    const uid = uidArg || user?.id
    if (!uid) return
    setLogsLoading(true)
    try {
      // 본인 로그 (모든 상태)
      const ownPromise = supabase.from('topic_suggestion_logs')
        .select('*, resulting_topic:topics(id, title, date)')
        .eq('teacher_id', uid)
        .order('created_at', { ascending: false })
        .limit(50)

      // 다른 선생님이 공유한 추천 (등록 자동 공유 + 개별 카드 공유)
      // 익명 — author 정보는 가져오지 않음
      const sharedPromise = supabase.from('topic_suggestion_logs')
        .select('*, resulting_topic:topics(id, title, date)')
        .neq('teacher_id', uid)
        .or('resulting_topic_id.not.is.null,is_shared.eq.true,shared_indexes.neq.[]')
        .order('created_at', { ascending: false })
        .limit(100)

      const [ownRes, sharedRes] = await Promise.all([ownPromise, sharedPromise])
      if (ownRes.error) throw ownRes.error
      setSuggestionLogs(ownRes.data || [])

      // shared는 에러 나도 본인 것은 보여줘야 함
      if (sharedRes.error) {
        console.warn('공유 추천 로드 실패 (본인 것만 표시):', sharedRes.error)
        setSharedSuggestionLogs([])
      } else {
        setSharedSuggestionLogs(sharedRes.data || [])
      }
    } catch(e) {
      console.error('로그 로드 실패:', e)
    }
    setLogsLoading(false)
  }

  // 🆕 본인 추천 카드 공유 토글 (와이프 피드백)
  // 🆕 개별 추천 공유 토글 (카드 단위 — 묶음 전체가 아님)
  const toggleShareSuggestion = async (logId, suggestionIdx, share) => {
    if (!logId || suggestionIdx === undefined || suggestionIdx === null) return
    try {
      // 현재 로그의 shared_indexes 가져와서 추가/제거
      const log = suggestionLogs.find(l => l.id === logId)
      if (!log) return
      const current = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
      const next = share
        ? [...new Set([...current, suggestionIdx])]
        : current.filter(i => i !== suggestionIdx)

      const { error } = await supabase.from('topic_suggestion_logs')
        .update({ shared_indexes: next })
        .eq('id', logId)
      if (error) throw error
      // 화면 즉시 갱신
      setSuggestionLogs(prev => prev.map(l =>
        l.id === logId ? { ...l, shared_indexes: next } : l
      ))
    } catch(e) {
      alert('공유 상태 변경 실패: ' + e.message)
    }
  }

  // 🆕 step279: 등록 주제 공유 취소 (추천 풀에서 내리기)
  // - DELETE 금지(topic_copies가 source_log_id ON DELETE CASCADE라 행 삭제 시
  //   가져간 추적이 연쇄삭제됨). resulting_topic_id=null로 무력화 → 추적·FK 보존.
  // - 손제작/AI 구분 없이 resulting_topic_id로 공유 중인 주제면 동일하게 취소 가능.
  const cancelTopicShare = async (topicId) => {
    if (!topicId || !user?.id) return
    if (!confirm('이 주제를 추천 풀에서 내릴까요? 이미 가져간 선생님 자료는 그대로예요.')) return
    try {
      const { error } = await supabase.from('topic_suggestion_logs')
        .update({ resulting_topic_id: null, is_shared: false, shared_indexes: [] })
        .eq('resulting_topic_id', topicId)
        .eq('teacher_id', user.id)
      if (error) throw error
      await Promise.all([ loadTopics(user.id, classInfo?.id), loadSuggestionLogs(user.id) ])
    } catch(e) { alert('공유 취소 실패: ' + e.message) }
  }

  // 역방향 기능: 선생님이 주제만 입력 → AI가 설명 + 평가기준 자동 생성
  const generateFromTopic = async () => {
    if (!title.trim()) {
      alert('먼저 주제를 입력해주세요!')
      return
    }
    if (!hasApiKey) {
      alert('Gemini API 키를 먼저 등록해주세요!')
      return
    }

    setGeneratingRubrics(true)
    try {
      const gradeText = aiGrade ? `초등 ${aiGrade}학년` : '초등 5학년'
      const levelText = aiLevel || '보통'

      // 1단계: 주제 설명 (description) 생성
      if (!desc.trim()) {
        try {
          // 🔒 프롬프트는 서버에서 구성
          const descResult = await callAI('topicDesc', {
            gradeText, title: title.trim(), levelText,
          })
          if (descResult.description) setDesc(descResult.description)
        } catch(e) {
          console.warn('설명 생성 실패:', e)
        }
      }

      // 2단계: 평가 기준 생성
      // 🔒 프롬프트는 서버에서 구성
      const result = await callAI('rubricGen', {
        gradeText, title: title.trim(), description: desc.trim(),
      })
      if (Array.isArray(result.rubrics) && result.rubrics.length > 0) {
        const cleaned = result.rubrics.slice(0, 4).map(r => ({
          name: r.name || '평가 기준',
          score: r.score || 25,
          hint: r.hint || '이 항목에서 무엇을 잘 표현해야 하는지'
        }))
        // 총점 100점 보장
        const sum = cleaned.reduce((s, r) => s + r.score, 0)
        if (sum !== 100 && cleaned.length === 4) {
          cleaned.forEach(r => { r.score = 25 })
        }
        setRubrics(cleaned)
      }
    } catch(e) {
      console.error('평가 기준 생성 오류:', e)
      alert(getFriendlyErrorMessage(e))
    }
    setGeneratingRubrics(false)
    guideToRegister()  // 🆕 step159: 완료 → 등록 버튼으로 유도 (alert 대신 시각 유도)
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>주제 관리 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">주제 관리</h1>
          </div>

          {/* 모드 전환 탭 */}
          <div className="bg-white rounded-2xl p-1 shadow-sm flex gap-1">
            <button onClick={() => { setBatchMode(false); setBatchPreview(null) }}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                !batchMode ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              ✏️ 하루 주제 등록
            </button>
            <button onClick={() => setBatchMode(true)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${
                batchMode ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>
              📅 기간 일괄 등록
            </button>
          </div>

          {/* 📅 기간 일괄 등록 모드 */}
          {batchMode && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-start gap-3 mb-3">
                <div className="text-3xl">📅</div>
                <div>
                  <h3 className="font-bold">기간 일괄 등록</h3>
                  <p className="text-xs text-gray-600 mt-0.5">
                    휴가나 출장 대비, AI가 여러 날치 주제를 한 번에 만들어줘요.
                    생성 후 확인/수정한 다음 일괄 등록합니다.
                  </p>
                </div>
              </div>

              {!batchPreview && (
                <div className="space-y-3">
                  {/* 날짜 범위 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">시작 날짜</label>
                      <input type="date" value={batchStartDate} onChange={e => setBatchStartDate(e.target.value)}
                        className="w-full p-2 border border-gray-200 rounded-lg" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">종료 날짜</label>
                      <input type="date" value={batchEndDate} onChange={e => setBatchEndDate(e.target.value)}
                        className="w-full p-2 border border-gray-200 rounded-lg" />
                    </div>
                  </div>

                  {/* 주말 제외 */}
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={batchExcludeWeekend}
                      onChange={e => setBatchExcludeWeekend(e.target.checked)}
                      className="w-4 h-4" />
                    <span>주말(토/일) 제외</span>
                  </label>

                  {/* 선택: 주제 방향 */}
                  <div>
                    <label className="block text-sm font-medium mb-1">주제 방향 (선택)</label>
                    <input type="text" value={batchTheme} onChange={e => setBatchTheme(e.target.value)}
                      placeholder="예: 봄 관련 주제, 또는 환경 보호 단원에 맞춰서"
                      className="w-full p-2 border border-gray-200 rounded-lg text-sm" />
                    <p className="text-xs text-gray-500 mt-1">
                      💡 빈 칸이면 다양한 카테고리로 자동 생성돼요
                    </p>
                  </div>

                  {/* 생성될 날짜 수 미리 안내 */}
                  {(() => {
                    if (!batchStartDate || !batchEndDate) return null
                    if (new Date(batchStartDate) > new Date(batchEndDate)) return null
                    const dates = getDatesInRange(batchStartDate, batchEndDate, batchExcludeWeekend)
                    if (dates.length === 0) return null
                    return (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                        📊 <strong>{dates.length}개</strong>의 주제가 생성됩니다 ({dates[0]} ~ {dates[dates.length-1]})
                        {dates.length > 14 && <span className="block text-red-700 mt-1">⚠️ 한 번에 최대 14개까지 가능해요</span>}
                      </div>
                    )
                  })()}

                  <button onClick={generateBatchTopics} disabled={batchGenerating}
                    className="w-full py-3 bg-purple-600 text-white rounded-xl font-semibold disabled:opacity-50 hover:bg-purple-700">
                    {batchGenerating ? '🤖 AI가 주제 만드는 중...' : '✨ AI로 주제 일괄 생성'}
                  </button>
                  {batchGenerating && (
                    <AiLoadingBlock
                      title="AI가 여러 주제를 한 번에 만들고 있어요..."
                      sub={batchProgress ? `🔄 ${batchProgress}` : '약 10~30초 정도 걸려요 — 잠시만 기다려 주세요'} />
                  )}
                </div>
              )}

              {/* 미리보기 + 수정 */}
              {batchPreview && (
                <div className="space-y-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    <p className="text-sm font-semibold text-emerald-900">✅ {batchPreview.length}개 주제가 생성되었어요</p>
                    <p className="text-xs text-emerald-800 mt-1">
                      각 주제를 확인하고 필요하면 수정하세요. 마음에 안 들면 삭제하거나 다시 생성할 수 있어요.
                    </p>
                  </div>

                  <div className="space-y-2 max-h-[500px] overflow-y-auto">
                    {batchPreview.map((item, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-gray-600">
                            📅 {item.date}
                            {item.category && <span className="ml-2 bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-xs">{item.category}</span>}
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => regenerateSingle(idx)}
                              disabled={regeneratingIdx !== null}
                              className="text-xs text-purple-700 hover:text-purple-900 disabled:opacity-40">
                              {regeneratingIdx === idx ? '🤖 추천 중...' : '✨ 다시 추천'}
                            </button>
                            <button onClick={() => removePreviewItem(idx)}
                              className="text-xs text-red-600 hover:text-red-800">
                              ✕ 삭제
                            </button>
                          </div>
                        </div>
                        <input type="text" value={item.title}
                          onChange={e => updatePreviewItem(idx, 'title', e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm font-medium" />
                        <textarea value={item.description}
                          onChange={e => updatePreviewItem(idx, 'description', e.target.value)}
                          rows="2"
                          className="w-full p-2 border border-gray-200 rounded text-xs leading-relaxed" />
                      </div>
                    ))}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setBatchPreview(null)}
                      className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm">
                      다시 생성
                    </button>
                    <button onClick={saveBatchTopics} disabled={batchSaving || batchPreview.length === 0}
                      className="flex-[2] py-2.5 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                      {batchSaving ? '저장 중...' : `📥 ${batchPreview.length}개 모두 등록`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 새 주제 등록 (단일 모드) */}
          {!batchMode && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold">{editingTopicId ? '✏️ 주제 수정 중' : '✏️ 주제 등록'}</h3>
              {editingTopicId && (
                <button onClick={cancelEdit}
                  className="text-xs text-gray-500 hover:text-gray-800 underline">
                  취소 (새 주제 모드로)
                </button>
              )}
            </div>
            {editingTopicId && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mb-3 text-xs text-amber-900">
                💡 기존 주제를 수정하고 있어요. 저장하면 덮어쓰기 돼요.
              </div>
            )}
            <div className="space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">날짜</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)}
                    className="w-full p-2 border border-gray-200 rounded-lg" />
                </div>
                <div className="sm:col-span-2 flex items-end gap-2">
                  <button onClick={suggestTopic} disabled={aiSuggesting || generatingRubrics}
                    className="flex-1 py-2 bg-purple-100 text-purple-700 rounded-lg font-medium hover:bg-purple-200 disabled:opacity-50">
                    {aiSuggesting ? '추천 중...' : generatingRubrics ? '평가기준 만드는 중...' : `✨ AI 주제 추천 (${aiCount}개)`}
                  </button>
                  <select value={aiCount} onChange={e => setAiCount(Number(e.target.value))}
                    disabled={aiSuggesting || generatingRubrics}
                    className="py-2 px-2 border border-purple-200 text-purple-700 rounded-lg text-sm bg-white disabled:opacity-50"
                    title="한 번에 추천받을 주제 개수">
                    <option value="1">1개</option>
                    <option value="2">2개</option>
                    <option value="3">3개</option>
                  </select>
                  <button onClick={() => setShowAiOptions(!showAiOptions)}
                    className="px-3 py-2 border border-purple-200 text-purple-700 rounded-lg hover:bg-purple-50 text-sm">
                    {showAiOptions ? '▲ 옵션' : '▼ 옵션'}
                  </button>
                </div>
              </div>

              {/* AI 추천 옵션 패널 */}
              {showAiOptions && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-purple-900 mb-1">학년</label>
                      <select value={aiGrade} onChange={e => setAiGrade(e.target.value)}
                        className="w-full p-2 border border-purple-200 rounded-lg text-sm bg-white">
                        <option value="">선택 안 함</option>
                        <option value="1">초등 1학년</option>
                        <option value="2">초등 2학년</option>
                        <option value="3">초등 3학년</option>
                        <option value="4">초등 4학년</option>
                        <option value="5">초등 5학년</option>
                        <option value="6">초등 6학년</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-purple-900 mb-1">난이도</label>
                      <select value={aiLevel} onChange={e => setAiLevel(e.target.value)}
                        className="w-full p-2 border border-purple-200 rounded-lg text-sm bg-white">
                        <option value="쉬움">쉬움 (경험·취향 위주)</option>
                        <option value="보통">보통 (약간의 상상력)</option>
                        <option value="어려움">어려움 (의견·분석)</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-purple-900 mb-1">카테고리 (선택)</label>
                    <select value={aiCategory} onChange={e => setAiCategory(e.target.value)}
                      className="w-full p-2 border border-purple-200 rounded-lg text-sm bg-white">
                      <option value="">랜덤</option>
                      <option value="일상 경험">일상 경험</option>
                      <option value="가족과 친구">가족과 친구</option>
                      <option value="학교 생활">학교 생활</option>
                      <option value="감정과 마음">감정과 마음</option>
                      <option value="꿈과 미래">꿈과 미래</option>
                      <option value="상상력">상상력 (만약에~)</option>
                      <option value="시간 여행">시간 여행</option>
                      <option value="내가 만든 세상">내가 만든 세상</option>
                      <option value="동물 친구">동물 친구</option>
                      <option value="음식과 추억">음식과 추억</option>
                      <option value="여행과 모험">여행과 모험</option>
                      <option value="계절과 자연">계절과 자연</option>
                      <option value="책과 영화">책과 영화</option>
                      <option value="취미와 관심사">취미와 관심사</option>
                      <option value="사회와 환경">사회와 환경</option>
                      <option value="교과 연계">교과 연계 (국어/사회/과학)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-purple-900 mb-1">
                      자유 요청 (선택)
                    </label>
                    <textarea value={aiUserRequest} onChange={e => setAiUserRequest(e.target.value)}
                      rows="2" placeholder='예: "추석 관련 주제로", "환경 보호에 관한 주제", "친구와의 갈등을 다루는 주제"'
                      className="w-full p-2 border border-purple-200 rounded-lg text-sm bg-white" />
                    <p className="text-xs text-purple-700 mt-1">💡 원하는 분야나 키워드를 자유롭게 적어주세요</p>
                  </div>
                </div>
              )}

              {/* 🆕 추천 기록 인라인 미리보기 (와이프 피드백: 추천 전에 기록을 쭉 보기) */}
              {!aiPicker && (suggestionLogs.length > 0 || sharedSuggestionLogs.length > 0) && (
                <InlineSuggestionPreview
                  myLogs={suggestionLogs}
                  sharedLogs={sharedSuggestionLogs}
                  onSelect={applyFromLog}
                  generating={generatingRubrics}
                />
              )}

              {/* 🆕 step159: 주제 추천 생성 중 로딩 블록 */}
              {aiSuggesting && !aiPicker && (
                <AiLoadingBlock
                  title="AI가 주제를 추천하고 있어요..."
                  sub="잠시만 기다려 주세요 (보통 10~20초)" />
              )}

              {/* 🆕 3개 추천 카드 (와이프 피드백) */}
              {aiPicker && aiPicker.suggestions && aiPicker.suggestions.length > 0 && (
                <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-4 space-y-3">
                  {/* 🆕 step159: 다음 행동 유도 배너 */}
                  <div className="bg-purple-600 text-white rounded-lg px-3 py-2 text-sm font-semibold text-center">
                    👇 마음에 드는 주제를 클릭하면 평가기준까지 자동으로 만들어져요
                  </div>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <h4 className="font-bold text-purple-900">
                        ✨ {aiPicker.suggestions.length}개 중에 골라보세요
                      </h4>
                      <p className="text-xs text-purple-700/80 mt-0.5">
                        카드 옆 🔄로 그 칸만 바꿀 수 있어요.
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => suggestTopic()}
                        disabled={aiSuggesting || generatingRubrics || refreshingIdx >= 0}
                        className="text-xs px-3 py-1.5 bg-white border border-purple-300 text-purple-700 rounded hover:bg-purple-100 disabled:opacity-50">
                        🔄 다시 받기
                      </button>
                      <button
                        onClick={() => setAiPicker(null)}
                        className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
                        ✖ 닫기
                      </button>
                    </div>
                  </div>

                  {/* 골고루 토글 — 카테고리 미지정 + 2개 이상일 때만 의미 있음 */}
                  {!aiCategory && aiPicker.suggestions.length >= 2 && (
                    <label className="flex items-center gap-2 text-xs text-purple-800 bg-white border border-purple-200 rounded px-2 py-1.5 cursor-pointer hover:bg-purple-50 w-fit">
                      <input
                        type="checkbox"
                        checked={diverseMode}
                        onChange={e => setDiverseMode(e.target.checked)}
                        className="accent-purple-600"
                      />
                      🌈 서로 다른 카테고리에서 받기
                    </label>
                  )}

                  <div className="space-y-2">
                    {aiPicker.suggestions.map((s, idx) => (
                      <div key={idx}
                        className="bg-white border border-purple-200 rounded-lg overflow-hidden hover:border-purple-500 hover:shadow-md transition">
                        <div className="flex items-stretch">
                          <button
                            onClick={() => applySuggestion(idx)}
                            disabled={generatingRubrics || refreshingIdx >= 0}
                            className="flex-1 text-left hover:bg-purple-50 p-3 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-7 h-7 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-sm font-bold">
                                {idx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-gray-900">
                                  {refreshingIdx === idx ? (
                                    <span className="text-gray-400">⏳ 새 주제 받는 중...</span>
                                  ) : s.title}
                                </div>
                                {refreshingIdx !== idx && s.description && (
                                  <div className="text-xs text-gray-600 mt-1 leading-relaxed break-keep">
                                    {s.description}
                                  </div>
                                )}
                                {refreshingIdx !== idx && (
                                  <div className="flex items-center gap-2 mt-1.5">
                                    {s.category && <span className="text-[11px] text-purple-600">#{s.category}</span>}
                                    <span className="text-[11px] font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">이 주제 선택 →</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>

                          {/* 🆕 카드별 다시 추천: 카테고리 선택 + 🔄 버튼 */}
                          <div className="flex items-center border-l border-purple-100 px-2 gap-1">
                            <select
                              defaultValue=""
                              disabled={refreshingIdx >= 0 || generatingRubrics}
                              onChange={(e) => {
                                const newCat = e.target.value
                                e.target.value = ''  // 초기화 (다음에 또 누를 수 있게)
                                refreshSingleSuggestion(idx, newCat || null)
                              }}
                              className="text-xs border border-gray-200 rounded px-1 py-1 bg-white text-gray-700 max-w-[110px]"
                              title="다른 카테고리로 이 카드만 교체"
                            >
                              <option value="">카테고리 바꾸기...</option>
                              {[
                                '일상 경험','계절과 자연','가족과 친구','꿈과 미래','책과 영화',
                                '학교 생활','취미와 관심사','음식과 추억','여행과 모험','감정과 마음',
                                '상상력','시간 여행','미래의 나',
                                '신비한 일','재미있는 발견','동물 친구','사회와 환경','교과 연계'
                              ].map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <button
                              onClick={() => refreshSingleSuggestion(idx)}
                              disabled={refreshingIdx >= 0 || generatingRubrics}
                              title="이 카드만 다시 추천 (같은 카테고리)"
                              className="px-2 py-1.5 text-purple-700 hover:bg-purple-100 rounded text-sm disabled:opacity-30">
                              🔄
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div ref={formStartRef}>
                <label className="block text-sm font-medium mb-1">주제</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="예: 가장 기억에 남는 여행"
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">설명 (선택)</label>
                <textarea value={desc} onChange={e => setDesc(e.target.value)}
                  rows="3" placeholder="학생들에게 보여줄 안내 내용"
                  className="w-full p-3 border border-gray-200 rounded-lg" />
              </div>

              {/* 역방향 AI 버튼: 직접 입력한 주제에 대해 설명+평가기준 자동 생성 */}
              {title.trim() && (
                <button onClick={generateFromTopic} disabled={generatingRubrics}
                  className="w-full py-2 bg-indigo-100 text-indigo-700 rounded-lg font-medium hover:bg-indigo-200 disabled:opacity-50 text-sm">
                  {generatingRubrics
                    ? '⏳ AI가 생성 중...'
                    : `🤖 위 주제 "${title.trim().slice(0, 20)}${title.length > 20 ? '...' : ''}"에 맞는 ${desc.trim() ? '평가기준' : '설명 + 평가기준'} 자동 생성`}
                </button>
              )}

              {/* 🆕 step159: 평가기준 생성 중 로딩 블록 (주제 클릭/역방향 생성 공통) */}
              {generatingRubrics && (
                <AiLoadingBlock
                  title="AI가 평가기준을 만들고 있어요..."
                  sub="거의 다 됐어요 (보통 10~20초) — 잠시만 기다려 주세요" />
              )}

              {/* 루브릭 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">평가 기준 (총 {totalMax}점)</label>
                  <button onClick={addRubric} className="text-xs text-primary hover:underline">+ 기준 추가</button>
                </div>
                <div className="space-y-3">
                  {rubrics.map((r, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                      <div className="flex gap-2 items-center">
                        <input type="text" value={r.name} onChange={e => updateRubric(i, 'name', e.target.value)}
                          placeholder="평가 기준 이름"
                          className="flex-1 min-w-0 p-2 border border-gray-200 rounded text-sm font-medium" />
                        <div className="flex items-center bg-white border border-gray-200 rounded flex-shrink-0">
                          <input type="number" value={r.score} onChange={e => updateRubric(i, 'score', e.target.value)}
                            className="w-12 p-2 text-sm text-right border-0 focus:outline-none" min="1" />
                          <span className="text-xs text-gray-500 pr-2">점</span>
                        </div>
                        <button onClick={() => removeRubric(i)}
                          className="text-red-500 text-sm w-7 h-9 flex items-center justify-center hover:bg-red-50 rounded flex-shrink-0"
                          title="이 기준 삭제">✕</button>
                      </div>
                      <input type="text" value={r.hint || ''} onChange={e => updateRubric(i, 'hint', e.target.value)}
                        placeholder="부가 설명 (예: 주인공의 삶, 주인공의 모습 등)"
                        className="w-full p-2 border border-gray-100 rounded text-xs text-gray-600 bg-gray-50" />
                    </div>
                  ))}
                </div>
              </div>

              {/* 글자수 + 재수정 횟수 */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <p className="text-sm font-medium">✏️ 글쓰기 분량 + 수정 횟수</p>

                {/* 글자수 프리셋 + 직접 입력 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">최소 글자수 (이보다 적으면 제출 안 됨)</label>
                  <div className="flex gap-1.5 flex-wrap mb-1.5">
                    {[
                      { v: 30, label: '짧은 글', desc: '30자' },
                      { v: 100, label: '중간 글', desc: '100자' },
                      { v: 200, label: '긴 글', desc: '200자' },
                      { v: 400, label: '아주 긴 글', desc: '400자' }
                    ].map(p => (
                      <button key={p.v} onClick={() => setMinLength(p.v)}
                        className={`px-2 py-1 rounded text-xs ${
                          minLength === p.v
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                        {p.label} ({p.desc})
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">또는 직접 입력:</span>
                    <input type="number" value={minLength}
                      onChange={e => setMinLength(e.target.value)}
                      min="10" max="5000"
                      className="w-20 p-1 border border-gray-200 rounded text-sm" />
                    <span className="text-xs text-gray-500">자 이상</span>
                  </div>
                </div>

                {/* 최대 글자수 (토큰 절약) */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    최대 글자수 (이보다 길면 제출 안 됨)
                    <span className="text-gray-400 ml-1">- AI 처리량 절약</span>
                  </label>
                  <div className="flex gap-1.5 flex-wrap mb-1.5">
                    {[
                      { v: 300, label: '짧게', desc: '300자' },
                      { v: 500, label: '보통', desc: '500자' },
                      { v: 800, label: '길게', desc: '800자' },
                      { v: '', label: '제한 없음', desc: '' }
                    ].map(p => (
                      <button key={p.label} onClick={() => setMaxLength(p.v)}
                        className={`px-2 py-1 rounded text-xs ${
                          String(maxLength) === String(p.v)
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                        {p.label} {p.desc && `(${p.desc})`}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500">또는 직접 입력:</span>
                    <input type="number" value={maxLength}
                      onChange={e => setMaxLength(e.target.value)}
                      min="50" max="5000" placeholder="빈 칸=제한 없음"
                      className="w-24 p-1 border border-gray-200 rounded text-sm" />
                    <span className="text-xs text-gray-500">자 이하</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    💡 짧을수록 AI 호출 한도가 덜 소진돼요. 500자 권장.
                  </p>
                </div>

                {/* 최대 재수정 횟수 */}
                <div>
                  <label className="block text-xs text-gray-600 mb-1">최대 재수정 횟수</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      { v: 0, label: '0회', desc: '수정 없음' },
                      { v: 1, label: '1회', desc: '기본' },
                      { v: 2, label: '2회' },
                      { v: 3, label: '3회' }
                    ].map(p => (
                      <button key={p.v} onClick={() => setMaxRewrites(p.v)}
                        className={`px-2 py-1 rounded text-xs ${
                          maxRewrites === p.v
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}>
                        {p.label}{p.desc ? ` (${p.desc})` : ''}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5">
                    💡 첫 글 외에 수정본을 몇 번까지 쓸 수 있는지 정해요. 학생이 다 쓰면 선생님이 추가 허용 가능.
                  </p>

                  {/* 맞춤법만 고친 수정본 차단 (수정 허용 시에만) */}
                  {maxRewrites > 0 && (
                    <label className="flex items-start gap-2 mt-3 pt-3 border-t border-gray-100 cursor-pointer">
                      <input type="checkbox" checked={requireRewriteChange}
                        onChange={e => setRequireRewriteChange(e.target.checked)}
                        className="w-4 h-4 mt-0.5" />
                      <span className="text-xs text-gray-700">
                        <strong>맞춤법만 고친 수정본은 제출 막기</strong>
                        <br />
                        <span className="text-gray-500">
                          첫 글과 거의 똑같으면(내용을 거의 안 바꾸면) 제출이 안 돼요. 내용을 더 발전시키도록 유도해요.
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              </div>

              {/* 수업 시간 락 */}
              <div className="border border-gray-200 rounded-lg p-3">
                <label className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={lockEnabled}
                    onChange={e => setLockEnabled(e.target.checked)}
                    className="w-4 h-4" />
                  <span className="text-sm font-medium">🔒 수업 시간에만 글쓰기 허용</span>
                </label>
                {lockEnabled && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">시작</label>
                        <input type="time" value={lockStartTime}
                          onChange={e => setLockStartTime(e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">종료</label>
                        <input type="time" value={lockEndTime}
                          onChange={e => setLockEndTime(e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      💡 이 시간대 밖에서는 학생이 새 글 제출/수정을 할 수 없어요. 작성된 글 보기는 항상 가능.
                    </p>
                  </>
                )}
              </div>

              {/* 📅 제출 기한 */}
              <div className="border border-gray-200 rounded-lg p-3">
                <label className="flex items-center gap-2 mb-2">
                  <input type="checkbox" checked={deadlineEnabled}
                    onChange={e => setDeadlineEnabled(e.target.checked)}
                    className="w-4 h-4" />
                  <span className="text-sm font-medium">📅 제출 기한 설정</span>
                </label>
                {deadlineEnabled && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">마감 날짜</label>
                        <input type="date" value={deadlineDate || date}
                          onChange={e => setDeadlineDate(e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-600 mb-1">마감 시각</label>
                        <input type="time" value={deadlineTime}
                          onChange={e => setDeadlineTime(e.target.value)}
                          className="w-full p-2 border border-gray-200 rounded text-sm" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      💡 기한이 지나면 학생은 새 글 제출/수정 불가. 기존 글은 그대로 보존돼요.
                    </p>
                  </>
                )}
              </div>

              {/* 🆕 손제작 주제 추천 풀 공유 (옵트인) — 새 주제 등록 시에만 */}
              {!editingTopicId && !lastSelectedLogId && (
                <div className="border-2 border-blue-300 bg-blue-50 rounded-lg p-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={shareToPool}
                      onChange={e => setShareToPool(e.target.checked)}
                      className="w-5 h-5 accent-blue-600" />
                    <span className="text-sm font-semibold text-blue-900">🌐 이 주제를 다른 선생님 추천 풀에 공유</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    💡 주제(제목·설명)만 다른 선생님께 공유돼요. 학생 글·이름·평가기준은 공유되지 않아요.
                  </p>
                </div>
              )}

              {/* 🆕 step159: 평가기준 생성 완료 후 등록 유도 */}
              {highlightRegister && !generatingRubrics && (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-800 text-center font-medium">
                  ✅ 평가기준까지 완성됐어요! 내용을 확인한 뒤 아래 <strong>[새 주제 등록]</strong>을 눌러주세요
                </div>
              )}
              <button ref={registerBtnRef} onClick={saveTopic} disabled={saving}
                className={`w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50 ${highlightRegister ? 'guide-highlight' : ''}`}>
                {saving ? '저장 중...' : (editingTopicId ? '💾 수정 저장' : '💾 새 주제 등록')}
              </button>
            </div>
          </div>
          )}

          {/* 🆕 step278: 체크 없이 등록한 손제작 주제 — 등록 직후 공유 여부 확인 (고정 모달) */}
          {sharePrompt && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-xl p-5 max-w-sm w-full shadow-xl">
                <h3 className="text-base font-bold text-blue-900 mb-2">🌐 방금 만든 주제, 다른 선생님께도 공유할까요?</h3>
                <p className="text-sm text-gray-600 mb-4">
                  주제(제목·설명)만 공유돼요. 학생 글·이름·평가기준은 공유되지 않아요.
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const { error: shareErr } = await supabase.from('topic_suggestion_logs').insert({
                          teacher_id: user.id,
                          class_id: classInfo?.id ?? null,
                          suggestions: [{ title: sharePrompt.title, description: sharePrompt.description, category: '직접 작성' }],
                          selected_index: 0,
                          resulting_topic_id: sharePrompt.topicId,
                          model_used: null,
                        })
                        if (shareErr) console.warn('풀 공유 건너뜀:', shareErr.message)
                      } catch(e) { console.warn('풀 공유 예외:', e) }
                      setSharePrompt(null)
                    }}
                    className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold">
                    🌐 공유하기
                  </button>
                  <button
                    onClick={() => setSharePrompt(null)}
                    className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">
                    아니요
                  </button>
                  <button
                    onClick={() => { setDontAskShare(true); setSharePrompt(null) }}
                    className="w-full py-1 text-gray-400 text-xs">
                    다시 묻지 않기
                  </button>
                </div>
              </div>
            </div>
          )}


          {/* 주제 목록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold mb-3">📚 등록된 주제 ({topics.length}개)</h3>
            {topics.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">아직 등록된 주제가 없어요</p>
            ) : (() => {
              const today = (() => {
                const now = new Date()
                const kst = new Date(now.getTime() + (9 * 3600 * 1000) - (now.getTimezoneOffset() * 60 * 1000))
                return kst.toISOString().slice(0, 10)
              })()
              const todayTopics = topics.filter(t => t.date === today)
              const futureTopics = topics.filter(t => t.date > today)
              const pastTopics = topics.filter(t => t.date < today)

              // 🆕 step279: 추천 풀에 공유 중인 주제 id 집합 (배지·취소 버튼용)
              const sharedTopicIds = new Set((suggestionLogs || []).filter(l => l.resulting_topic_id).map(l => l.resulting_topic_id))

              const renderTopic = (t) => {
                const isShared = sharedTopicIds.has(t.id)
                const submitted = t.submitted_count || 0
                const total = t.total_students || 0
                const allSubmitted = total > 0 && submitted === total
                const noSubmissions = submitted === 0
                const isExpanded = expandedTopicId === t.id
                return (
                  <div key={t.id} className="bg-gray-50 rounded-lg hover:bg-blue-50 transition">
                    <div className="flex items-center justify-between p-3 group">
                      <button
                        onClick={() => setExpandedTopicId(isExpanded ? null : t.id)}
                        className="flex-1 text-left cursor-pointer"
                      >
                        <div className="font-medium text-sm group-hover:text-primary flex items-center gap-1">
                          <span>{isExpanded ? '▼' : '▶'}</span>
                          <span>{t.title}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                          <span>{t.date}</span>
                          <span>·</span>
                          <span>평가기준 {t.rubrics?.length || 0}개</span>
                          <span>·</span>
                          <span>최소 {t.min_length || 30}자</span>
                          {total > 0 && (
                            <>
                              <span>·</span>
                              <span className={`px-1.5 py-0.5 rounded font-medium ${
                                allSubmitted ? 'bg-green-100 text-green-700' :
                                noSubmissions ? 'bg-gray-100 text-gray-500' :
                                'bg-blue-100 text-blue-700'
                              }`}>
                                📥 {submitted}/{total}명 제출
                              </span>
                            </>
                          )}
                          {t.lock_enabled && t.lock_start_time && t.lock_end_time && (
                            <>
                              <span>·</span>
                              <span className="text-amber-700">🔒 {t.lock_start_time}~{t.lock_end_time}</span>
                            </>
                          )}
                          {t.deadline_date && (
                            <>
                              <span>·</span>
                              <span className="text-emerald-700">📅 마감 {t.deadline_date.slice(5)}</span>
                            </>
                          )}
                          {isShared && (
                            <>
                              <span>·</span>
                              <span className="px-1.5 py-0.5 rounded font-medium bg-purple-100 text-purple-700">🌐 공유 중</span>
                            </>
                          )}
                        </div>
                      </button>
                      <div className="flex gap-1 flex-shrink-0 ml-2">
                        {isShared && (
                          <button onClick={() => cancelTopicShare(t.id)}
                            className="text-xs text-purple-600 hover:bg-purple-50 px-2 py-1 rounded">
                            공유 취소
                          </button>
                        )}
                        <Link
                          href={`/teacher/submissions?topic=${t.id}`}
                          className="text-xs text-primary hover:bg-primary-light px-2 py-1 rounded"
                        >
                          학생글
                        </Link>
                        <button onClick={() => deleteTopic(t.id)}
                          className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded">
                          삭제
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-200 px-3 py-3 space-y-3 bg-white rounded-b-lg">
                        {t.description && (
                          <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">📋 주제 설명</div>
                            <p className="text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 p-2 rounded">{t.description}</p>
                          </div>
                        )}

                        {t.rubrics && t.rubrics.length > 0 && (
                          <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">
                              📊 평가기준 ({t.rubrics.length}개, 총 {t.rubrics.reduce((s,r) => s + (r.score || 0), 0)}점)
                            </div>
                            <div className="space-y-1.5">
                              {t.rubrics.map((r, i) => (
                                <div key={i} className="text-xs bg-gray-50 rounded p-2">
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium">{i + 1}. {r.name}</span>
                                    <span className="text-gray-600 font-mono">{r.score}점</span>
                                  </div>
                                  {r.description && (
                                    <p className="text-gray-600 mt-1">{r.description}</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 제출/미제출 학생 명단 */}
                        {t.total_students > 0 && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              {/* 제출한 학생 */}
                              <div className="bg-green-50 rounded p-2">
                                <div className="text-xs font-semibold text-green-800 mb-1.5">
                                  ✅ 제출 ({t.submitted_students?.length || 0}명)
                                </div>
                                {t.submitted_students && t.submitted_students.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {t.submitted_students.map(s => (
                                      <span key={s.id} className="text-xs bg-white px-1.5 py-0.5 rounded border border-green-200 text-green-900">
                                        {s.number ? `${s.number}.` : ''}{s.realname}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-500">아직 없어요</p>
                                )}
                              </div>

                              {/* 미제출 학생 */}
                              <div className="bg-amber-50 rounded p-2">
                                <div className="text-xs font-semibold text-amber-800 mb-1.5">
                                  ⏳ 미제출 ({t.not_submitted_students?.length || 0}명)
                                </div>
                                {t.not_submitted_students && t.not_submitted_students.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {t.not_submitted_students.map(s => (
                                      <span key={s.id} className="text-xs bg-white px-1.5 py-0.5 rounded border border-amber-200 text-amber-900">
                                        {s.number ? `${s.number}.` : ''}{s.realname}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-500">전원 제출 완료! 🎉</p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="text-xs text-gray-500 grid grid-cols-2 gap-2 pt-1 border-t">
                          <div>📏 최소 글자수: <strong>{t.min_length || 30}자</strong></div>
                          <div>🔄 최대 수정 횟수: <strong>{t.max_rewrites !== undefined && t.max_rewrites !== null ? t.max_rewrites : 1}회</strong></div>
                        </div>

                        <div className="pt-2 border-t">
                          <button
                            onClick={() => loadTopicForEdit(t)}
                            className="text-xs bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded font-medium"
                          >
                            ✏️ 이 주제 수정하기
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <div className="space-y-4">
                  {todayTopics.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-primary-dark mb-2 flex items-center gap-1">
                        🌟 오늘 ({todayTopics.length})
                      </div>
                      <div className="space-y-2">{todayTopics.map(renderTopic)}</div>
                    </div>
                  )}
                  {futureTopics.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-blue-700 mb-2 flex items-center gap-1">
                        📅 예정 ({futureTopics.length}) <span className="font-normal text-gray-500">- 해당 날짜가 되면 학생에게 자동 노출</span>
                      </div>
                      <div className="space-y-2">{futureTopics.map(renderTopic)}</div>
                    </div>
                  )}
                  {pastTopics.length > 0 && (
                    <details>
                      <summary className="text-xs font-bold text-gray-500 mb-2 cursor-pointer hover:text-gray-700">
                        🗂 지난 ({pastTopics.length}) - 클릭해서 펼치기
                      </summary>
                      <div className="space-y-2 mt-2">{pastTopics.map(renderTopic)}</div>
                    </details>
                  )}
                </div>
              )
            })()}
          </div>
        </main>

        {/* 🆕 사이드 추천 로그 패널 (와이프 피드백) */}
        <SuggestionLogPanel
          logs={suggestionLogs}
          sharedLogs={sharedSuggestionLogs}
          loading={logsLoading}
          onSelect={applyFromLog}
          onRefresh={() => loadSuggestionLogs()}
          onToggleShare={toggleShareSuggestion}
          onCancelShare={cancelTopicShare}
          disabled={false}
        />
      </div>
    </>
  )
}

// ============================================
// 🆕 인라인 추천 기록 미리보기 (와이프 피드백)
// AI 추천 영역 바로 옆에 기록을 미리 보여줘서 추천 전에 빠르게 훑어볼 수 있게
// ============================================
function InlineSuggestionPreview({ myLogs, sharedLogs, onSelect, generating }) {
  const [tab, setTab] = useState('mine')
  const [expanded, setExpanded] = useState(false)  // 접힘/펼침

  // 평탄화 (사이드 패널과 같은 로직)
  const flatMine = []
  for (const log of myLogs || []) {
    const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
    sugs.forEach((s, idx) => {
      flatMine.push({
        key: `${log.id}-${idx}`,
        title: s.title,
        description: s.description,
        category: s.category,
        usedDate: log.selected_index === idx && log.resulting_topic?.date,
        wasSelected: log.selected_index === idx,
      })
    })
  }

  const flatShared = []
  for (const log of sharedLogs || []) {
    const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
    const sharedIdxs = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
    const seen = new Set()

    // 등록된 주제 (자동 공유)
    if (log.resulting_topic_id && log.selected_index !== null && log.selected_index !== undefined) {
      const picked = sugs[log.selected_index]
      if (picked && picked.title) {
        flatShared.push({
          key: `s-${log.id}-${log.selected_index}`,
          title: picked.title,
          description: picked.description,
          category: picked.category,
          usedDate: log.resulting_topic?.date,
          sourceLogId: log.id,                 // 🆕 가져오기 출처(집계용)
          sourceIndex: log.selected_index,
        })
        seen.add(log.selected_index)
      }
    }

    // 개별 공유된 카드
    for (const idx of sharedIdxs) {
      if (seen.has(idx)) continue
      const s = sugs[idx]
      if (!s || !s.title) continue
      flatShared.push({
        key: `s-${log.id}-${idx}`,
        title: s.title,
        description: s.description,
        category: s.category,
        sourceLogId: log.id,                   // 🆕 가져오기 출처(집계용)
        sourceIndex: idx,
      })
      seen.add(idx)
    }
  }

  const list = tab === 'mine' ? flatMine : flatShared
  // 접힘 상태에서는 6개만, 펼치면 다
  const displayList = expanded ? list : list.slice(0, 6)

  return (
    <div className="bg-gradient-to-br from-purple-50/50 to-indigo-50/50 border border-purple-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-purple-900">📚 추천 기록</span>
          <div className="flex bg-white rounded-lg p-0.5 gap-0.5 text-xs">
            <button
              onClick={() => setTab('mine')}
              className={`px-2.5 py-1 rounded ${
                tab === 'mine' ? 'bg-purple-100 text-purple-900 font-semibold' : 'text-gray-600'
              }`}>
              내 추천 {flatMine.length > 0 && `(${flatMine.length})`}
            </button>
            <button
              onClick={() => setTab('shared')}
              className={`px-2.5 py-1 rounded ${
                tab === 'shared' ? 'bg-purple-100 text-purple-900 font-semibold' : 'text-gray-600'
              }`}>
              다른 선생님 {flatShared.length > 0 && `(${flatShared.length})`}
            </button>
          </div>
        </div>
        <span className="text-[11px] text-purple-700/70">
          {tab === 'mine'
            ? '클릭하면 폼에 자동 입력돼요'
            : '다른 선생님이 등록·공유한 주제'}
        </span>
      </div>

      {list.length === 0 ? (
        <p className="text-xs text-gray-500 py-3 text-center">
          {tab === 'mine'
            ? '아직 추천받은 주제가 없어요. 아래 "AI 주제 추천" 버튼을 눌러보세요.'
            : '다른 선생님이 등록·공유한 추천이 아직 없어요.'}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {displayList.map(item => {
              const usedLabel = item.usedDate
                ? (() => {
                    const parts = String(item.usedDate).split('-')
                    return parts.length === 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : item.usedDate
                  })()
                : null
              return (
                <button
                  key={item.key}
                  onClick={() => onSelect?.({
                    title: item.title,
                    description: item.description,
                    category: item.category,
                    sourceLogId: item.sourceLogId,   // 🆕 공유 카드일 때만 존재
                    sourceIndex: item.sourceIndex
                  })}
                  disabled={generating}
                  className="text-left bg-white border border-gray-200 hover:border-purple-300 hover:bg-purple-50 rounded-lg p-2 transition disabled:opacity-50 disabled:cursor-not-allowed">
                  <div className="flex items-start justify-between gap-1 mb-0.5">
                    <div className="text-xs font-semibold text-gray-900 line-clamp-1 flex-1">
                      {item.title}
                    </div>
                    {usedLabel && (
                      <span className="text-[9px] bg-green-100 text-green-700 px-1 rounded flex-shrink-0">
                        ✓{usedLabel}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <div className="text-[11px] text-gray-600 line-clamp-2 leading-snug">
                      {item.description}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-1 mt-1">
                    {item.category && (
                      <span className="text-[10px] text-purple-600">#{item.category}</span>
                    )}
                    {tab === 'shared' && (
                      <span className="text-[10px] text-gray-400 ml-auto">
                        👤 다른 선생님
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          {list.length > 6 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full text-xs text-purple-700 hover:bg-purple-100 py-1 rounded mt-1">
              {expanded ? `▲ 접기 (${list.length}개 중 6개만 보기)` : `▼ 전체 ${list.length}개 보기`}
            </button>
          )}
        </>
      )}
    </div>
  )
}


```

## pages/teacher/trash.js

```js
// 🗑️ 선생님 쓰레기통
// - 30일 보관 후 자동 영구 삭제 (기간은 학급 설정에서 변경 가능)
// - [복원] / [영구 삭제] 가능
import { useEffect, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Header from '../../components/Header'

export default function TeacherTrash() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) { router.push('/teacher/login'); return }
    const { data: profile } = await supabase.from('profiles')
      .select('*, classes:class_id(id, name, code, trash_retention_days)')
      .eq('id', authUser.id).maybeSingle()
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setUser(profile)
    setClassInfo(profile.classes)
    await loadTrash(profile.classes?.id)
    setLoading(false)
  }

  const loadTrash = async (classId) => {
    if (!classId) return
    // 학급 학생들의 쓰레기통 글
    const { data: students } = await supabase.from('profiles')
      .select('id, realname, number').eq('class_id', classId).eq('role', 'student')
    const studentMap = {}
    ;(students || []).forEach(s => { studentMap[s.id] = s })
    const studentIds = (students || []).map(s => s.id)
    if (studentIds.length === 0) { setItems([]); return }

    const { data: subs } = await supabase.from('submissions')
      .select('*')
      .in('user_id', studentIds)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })

    const enriched = (subs || []).map(s => ({
      ...s,
      student: studentMap[s.user_id]
    }))
    setItems(enriched)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }

  // 복원
  const restore = async (subId, studentName) => {
    if (!confirm(`"${studentName}" 학생의 글을 복원할까요?\n다시 학생/통계/랭킹에 보이게 됩니다.`)) return
    setBusyId(subId)
    try {
      const { error } = await supabase.from('submissions').update({
        deleted_at: null,
        deleted_by: null,
        delete_reason: null
      }).eq('id', subId)
      if (error) throw error
      await loadTrash(classInfo.id)
      alert('✅ 복원 완료!')
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setBusyId(null)
  }

  // 영구 삭제
  const permaDelete = async (subId, studentName) => {
    if (!confirm(`⚠️ "${studentName}" 학생의 글을 영구 삭제할까요?\n\n· 이 작업은 되돌릴 수 없어요\n· DB에서 완전히 사라집니다\n· 다시 확인해주세요!`)) return
    if (!confirm(`정말로 영구 삭제하시겠습니까? 마지막 확인입니다.`)) return
    setBusyId(subId)
    try {
      const { error } = await supabase.from('submissions').delete().eq('id', subId)
      if (error) throw error
      await loadTrash(classInfo.id)
      alert('🗑️ 영구 삭제 완료')
    } catch (e) {
      alert('실패: ' + e.message)
    }
    setBusyId(null)
  }

  // 자동 삭제 기간 변경
  const updateRetention = async (days) => {
    if (!classInfo) return
    const { error } = await supabase.from('classes')
      .update({ trash_retention_days: days })
      .eq('id', classInfo.id)
    if (error) return alert('실패: ' + error.message)
    setClassInfo({ ...classInfo, trash_retention_days: days })
    alert(`✅ 자동 삭제 기간이 ${days}일로 변경됐어요.`)
  }

  // 남은 일수 계산
  const retentionDays = classInfo?.trash_retention_days || 30
  const daysLeft = (deletedAt) => {
    if (!deletedAt) return null
    const deleted = new Date(deletedAt).getTime()
    const expires = deleted + retentionDays * 24 * 60 * 60 * 1000
    const now = Date.now()
    const ms = expires - now
    if (ms <= 0) return 0
    return Math.ceil(ms / (24 * 60 * 60 * 1000))
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>쓰레기통 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <Header user={user} onLogout={logout} />
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
          <div className="flex items-center gap-3">
            <Link href="/teacher" className="text-gray-600">←</Link>
            <h1 className="text-xl font-bold">🗑️ 쓰레기통</h1>
          </div>

          {/* 자동 삭제 기간 설정 */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <h2 className="font-bold text-sm mb-2">⏳ 자동 영구 삭제 기간</h2>
            <p className="text-xs text-gray-600 mb-2">
              쓰레기통에 들어온 글은 <strong>{retentionDays}일 후</strong> 자동으로 영구 삭제됩니다.
            </p>
            <div className="flex gap-2 flex-wrap">
              {[7, 30, 60, 90, 180].map(d => (
                <button key={d}
                  onClick={() => updateRetention(d)}
                  className={`px-3 py-1.5 rounded text-xs font-medium ${
                    retentionDays === d
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}>
                  {d}일
                </button>
              ))}
            </div>
          </div>

          {/* 쓰레기통 글 목록 */}
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h2 className="font-bold mb-3">📋 보관된 글 ({items.length}개)</h2>

            {items.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <div className="text-4xl mb-2">🗑️</div>
                <p className="text-sm">쓰레기통이 비어있어요</p>
                <p className="text-xs text-gray-400 mt-1">학생글 보기에서 🗑️ 버튼으로 글을 옮길 수 있어요</p>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map(s => {
                  const left = daysLeft(s.deleted_at)
                  const isExpiringSoon = left !== null && left <= 7
                  return (
                    <div key={s.id} className={`border rounded-lg p-4 space-y-2 ${
                      isExpiringSoon ? 'border-red-200 bg-red-50/30' : 'border-gray-200'
                    }`}>
                      <div className="flex items-start justify-between flex-wrap gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">
                            {s.student?.number ? `${s.student.number}. ` : ''}{s.student?.realname || '(알 수 없음)'}
                            <span className="ml-2 text-xs text-gray-500">
                              {(s.attempt||1) === 1 ? '📝 첫 글' : `✨ 수정본 ${s.attempt}`}
                            </span>
                            {s.total_score !== null && s.total_score !== undefined && (
                              <span className="ml-2 text-xs text-gray-500">{s.total_score}/{s.max_score}점</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            📌 {s.topic_title || '(주제 없음)'}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            🗑️ 삭제: {new Date(s.deleted_at).toLocaleString('ko-KR')}
                            {s.delete_reason && <span className="ml-2 text-gray-700">· 사유: {s.delete_reason}</span>}
                          </div>
                        </div>
                        <div className={`text-xs font-bold px-2 py-1 rounded ${
                          isExpiringSoon ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {left === 0 ? '곧 자동 삭제' : `${left}일 남음`}
                        </div>
                      </div>

                      {/* 글 내용 미리보기 */}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">글 내용 미리보기</summary>
                        <div className="mt-2 bg-gray-50 rounded p-2 text-gray-700 whitespace-pre-wrap line-clamp-6 max-h-32 overflow-y-auto">
                          {s.essay_text}
                        </div>
                      </details>

                      {/* 액션 */}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => restore(s.id, s.student?.realname || '학생')}
                          disabled={busyId === s.id}
                          className="flex-1 py-1.5 bg-blue-100 text-blue-700 rounded text-xs font-medium hover:bg-blue-200 disabled:opacity-50"
                        >
                          ↻ 복원
                        </button>
                        <button
                          onClick={() => permaDelete(s.id, s.student?.realname || '학생')}
                          disabled={busyId === s.id}
                          className="flex-1 py-1.5 bg-red-100 text-red-700 rounded text-xs font-medium hover:bg-red-200 disabled:opacity-50"
                        >
                          🗑️ 영구 삭제
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}

```

## pages/terms.js

```js
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'

export default function Terms() {
  const router = useRouter()

  const goBack = () => {
    // 새 탭에서 열렸으면 창 닫기, 아니면 뒤로가기
    if (typeof window !== 'undefined' && window.history.length <= 1) {
      window.close()
      // 닫기가 안 되는 경우(같은 탭에서 직접 URL로 접속) → 홈으로
      setTimeout(() => router.push('/'), 100)
    } else {
      router.back()
    }
  }

  return (
    <>
      <Head><title>이용약관 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <button onClick={goBack} className="text-gray-600 hover:text-gray-900" title="뒤로 / 닫기">←</button>
            <h1 className="text-base font-bold">이용약관</h1>
          </div>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm space-y-6 text-sm leading-relaxed">
            <section>
              <h2 className="text-lg font-bold mb-2">제1조 (목적)</h2>
              <p>본 약관은 다온클래스(이하 "서비스")이 제공하는 AI 글쓰기 학습 서비스의 이용 조건과 절차, 기타 필요한 사항을 규정함을 목적으로 합니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제2조 (서비스의 제공)</h2>
              <p>1. 서비스는 초·중등 학교 교사가 학생에게 글쓰기 과제를 부여하고, 학생이 작성한 글에 대해 AI 기반 피드백을 제공받을 수 있는 플랫폼입니다.</p>
              <p>2. 현재 서비스는 베타 기간 동안 무료로 제공됩니다. 향후 유료 요금제가 도입될 수 있으며, 이 경우 시행 전 서비스 내 공지를 통해 안내합니다. AI 호출 비용(교사가 등록한 API 키로 발생)은 서비스 이용료와 별개입니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제3조 (회원가입)</h2>
              <p>1. 학생은 담임 교사가 발급한 학급 코드를 통해서만 가입할 수 있습니다.</p>
              <p>2. 교사는 운영자로부터 발급받은 가입 코드를 통해 가입할 수 있습니다.</p>
              <p>3. 모든 회원은 회원가입 시 본 약관 및 개인정보처리방침에 동의해야 합니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제4조 (회원의 의무)</h2>
              <p>1. 회원은 서비스를 학습 목적으로만 사용해야 합니다.</p>
              <p>2. 회원은 타인의 글을 무단으로 복제하거나 도용해서는 안 됩니다.</p>
              <p>3. 학생은 본인의 ID와 비밀번호를 타인에게 공유해서는 안 됩니다.</p>
              <p>4. 본 약관 및 관련 법령을 위반한 회원은 서비스 이용이 제한될 수 있습니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제5조 (서비스의 책임 한계)</h2>
              <p>1. 서비스는 AI가 제공하는 피드백의 정확성을 100% 보장하지 않으며, 참고 자료로만 활용해주시기 바랍니다.</p>
              <p>2. 서비스 운영 중 발생하는 일시적 장애, 데이터 손실 등에 대해 직접적인 책임을 지지 않습니다.</p>
              <p>3. 사용자의 부주의로 인한 API 키 노출, 비밀번호 유출 등은 사용자 본인의 책임입니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제6조 (저작권)</h2>
              <p>1. 학생이 작성한 글의 저작권은 학생에게 귀속됩니다.</p>
              <p>2. 서비스 자체는 학생 글을 AI 학습 데이터로 사용하지 않습니다.</p>
              <p>3. 단, AI 피드백 생성을 위해 외부 AI 제공자(Google Gemini 등)에 학생 글이 전달되며, 교사가 무료 등급 API 키를 사용하는 경우 해당 제공자의 정책에 따라 글이 AI 학습에 활용될 수 있습니다. 자세한 내용은 개인정보처리방침을 참고하시기 바랍니다.</p>
            </section>
            <section>
              <h2 className="text-lg font-bold mb-2">제7조 (약관의 변경)</h2>
              <p>본 약관은 필요 시 변경될 수 있으며, 변경 시 서비스 내 공지를 통해 안내합니다.</p>
            </section>
            <p className="text-gray-500 text-xs pt-4 border-t">시행일: 2026년 5월 7일 · 최종 개정: 2026년 6월 16일</p>
          </div>
        </main>
      </div>
    </>
  )
}

```

