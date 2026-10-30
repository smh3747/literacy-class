import Head from 'next/head'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { callAI } from '../../lib/aiClient'
import { decideExampleFlow } from '../../lib/exampleDefer'   // step627: 피크 시 예시 생성 보류 판정
import { canUseLockGrace } from '../../lib/lockGrace'        // step629: 시간 잠금 유예(종료 뒤 5분 안 1회)
import TutorChat from '../../components/TutorChat'
import Header from '../../components/Header'
import PasswordChangeModal from '../../components/PasswordChangeModal'
import NicknameChangeModal from '../../components/NicknameChangeModal'
import StudentTutorial from '../../components/StudentTutorial'
import StudentFeedbackCard from '../../components/StudentFeedbackCard'
import StrictPendingBadge from '../../components/StrictPendingBadge'  // step601: 맞춤법 보완 대기 배지(폴링 겸)
import useGrammarTooltip from '../../lib/useGrammarTooltip'
import { splitFeedbackItems } from '../../lib/feedbackFormat'
import { findOriginalRange } from '../../lib/koreanRules'
import { GRAMMAR_NOTICE_STUDENT } from '../../lib/notices'
import { pickStr } from '../../lib/pickStr'
import { escapeHtml } from '../../lib/escapeHtml'
import { todayStr } from '../../lib/kstDate'   // step498: KST 날짜 헬퍼 공용화
import { toKST } from '../../lib/timeFormat'   // step571: 초안 저장 시각(HH:MM) 표시
import { formatMyRank, cheerSeed } from '../../lib/rankDisplay'   // step539: 전국 순위 구간화 표시
// step606: AI 안전 필터 차단 → 점수 없이 저장·학생 안내·담임 알림 (헬퍼·문구는 lib/safetyBlock.js)
import { isSafetyBlockedErr, isBlockedSubmission, blockedRowFields, blockedNotificationArgs, STUDENT_BLOCKED_MESSAGE, SAFETY_BLOCK_CODE } from '../../lib/safetyBlock'
import PeerShareCard from '../../components/PeerShareCard'   // step621: 우리 반 친구들 글
import { fetchPeerShare, peerShareNotifyArgs } from '../../lib/peerShareClient'
// 👁 step633: 관리자 학생 엿보기(?as=) — 교사 페이지 관행(getEffectiveProfile·배너·쓰기 전면 차단)
import { getEffectiveProfile, withImpersonation, assertWritable, isImpersonatingNow, impersonationTargetId } from '../../lib/impersonation'
import { queryWithAuthRetry, logAuthBounce } from '../../lib/entryAuth'   // step637: 진입 401 → refresh 1회 재시도 + 튕김 기록
import { deriveGradingPath } from '../../lib/gradingTiming'   // step643: 채점 대기 시간 실측 — 경로 한 값 판정(순수)
import { REPORT_TAGS, REPORT_DETAIL_MAX, REPORT_DAILY_LIMIT, buildReportReason, isDailyLimitReached } from '../../lib/reportReason'   // step649: 신고 사유 칩
import { loadSlots, saveSlots, upsertSnapshot, removeSlotsFor, sortForList, previewOf } from '../../lib/draftSlots'   // step651: 게임식 저장 슬롯
import ImpersonationBanner from '../../components/ImpersonationBanner'
import { displayStudentNameWithNumber } from '../../lib/displayName'

// step481: 주제 카드 렌더 전용 — description에서 갈래 줄("✏️ 오늘은 ○○을 써요.")과
//   "✍️ 글쓰기 안내:" 뒷부분을 분리한다. 패턴이 없으면 통째로 body로 남아 기존 렌더와 동일(하위호환).
//   저장·채점 payload는 원문 description을 그대로 쓰므로 여기서 원본은 건드리지 않는다.
function parseTopicDescription(desc) {
  if (!desc) return { genreLabel: null, body: '', guide: null }
  let rest = desc, genreLabel = null
  const m = rest.match(/^✏️ 오늘은 (.+?)[을를] 써요\.\s*/)
  if (m) { genreLabel = m[1]; rest = rest.slice(m[0].length) }
  let guide = null
  const gi = rest.indexOf('✍️ 글쓰기 안내:')
  if (gi >= 0) {
    guide = rest.slice(gi + '✍️ 글쓰기 안내:'.length).trim()
    rest = rest.slice(0, gi)
  }
  return { genreLabel, body: rest.trim(), guide }
}

// ============================================
// 🆕 step651: 로컬 초안 금고(step571 draft:* 키·복원 배너) → 게임식 저장 슬롯(lib/draftSlots.js)으로 교체.
//   자동 저장(1.5초·pagehide·visibilitychange)은 "현재 슬롯"을 갱신하고, 80자 이상 변화·3분 경과면 새 슬롯.
//   어느 화면에서든 "📂 저장된 글 (N)"으로 불러오기/복사하기. 구 키는 lib가 첫 로드 때 1회 이관.
// ============================================

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
  const kst = new Date(Date.now() + 9 * 3600 * 1000)   // step497: 이중 가산 버그 수정(시간 락 시각 오판)
  const hh = String(kst.getUTCHours()).padStart(2, '0')
  const mm = String(kst.getUTCMinutes()).padStart(2, '0')
  const nowHM = `${hh}:${mm}`
  const start = topic.lock_start_time
  const end = topic.lock_end_time
  // step629: code('before'|'after')는 유예 판정(lib/lockGrace.js)용 — allowed·reason은 불변(추가만)
  if (nowHM < start) {
    return { allowed: false, code: 'before', reason: `아직 수업 시간이 아니에요. ${start}부터 글쓰기가 시작돼요.` }
  }
  if (nowHM > end) {
    return { allowed: false, code: 'after', reason: `수업 시간이 끝났어요. (${start}~${end})` }
  }
  return { allowed: true, reason: '' }
}

// HTML 이스케이프
// 🆕 step365: 접힘 카드 summary 공용 한 줄 (step341 어포던스 패턴 재사용 — 회전 화살표·hover·펼치기 힌트)
function CollapseSummary({ title, badge = null, tone = 'gray' }) {
  const c = tone === 'purple'
    ? { arrow: 'text-purple-400', hover: 'hover:bg-purple-100', hint: 'text-purple-400' }
    : { arrow: 'text-gray-400', hover: 'hover:bg-gray-50', hint: 'text-gray-400' }
  return (
    <summary className={`list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2 min-w-0 -mx-2 px-2 py-1 rounded-lg ${c.hover}`}>
      <span className={`${c.arrow} flex-shrink-0 transition-transform group-open:rotate-90`}>▶</span>
      {title}
      {badge}
      <span className={`ml-auto flex-shrink-0 text-xs ${c.hint} group-open:hidden`}>눌러서 펼치기</span>
    </summary>
  )
}

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


// 맞춤법 빨간 밑줄 적용
function applyGrammarHighlights(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections || corrections.length === 0) return escapeHtml(essayText).replace(/\n/g, '<br>')

  const matches = []
  corrections.forEach(c => {
    const original = pickStr(c.original, c.error, c.wrong)      // step427: 비문자열 방어(깨진 항목 조용히 제외)
    const correction = pickStr(c.correction, c.fixed, c.suggestion)
    const reason = pickStr(c.reason, c.type, c.category)
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
  const [isImpersonating, setIsImpersonating] = useState(false)   // 👁 step633: 관리자 학생 엿보기(읽기 전용)
  const [classInfo, setClassInfo] = useState(null)
  const [todayTopic, setTodayTopic] = useState(null)
  const [todayTopicList, setTodayTopicList] = useState([]) // 오늘 주제가 여러 개일 때
  const [pendingTopics, setPendingTopics] = useState([]) // 지난 미제출 주제들
  const [unreadComments, setUnreadComments] = useState([]) // 🆕 미확인 담임 코멘트
  const [showPendingPicker, setShowPendingPicker] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)  // 🆕 진입 실패/타임아웃 시 재시도 화면

  const [step, setStep] = useState('write') // write / feedback / done
  const [essay, setEssay] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [currentSub, setCurrentSub] = useState(null)
  // 📚 step621: 우리 반 친구들 글 — 제출 후(feedback/done)에만 조회. { items, showScore } | null. 반 주제만(챌린지 제외).
  const [peerShare, setPeerShare] = useState(null)
  const [peerNotified, setPeerNotified] = useState(() => new Set())
  const [feedbackResult, setFeedbackResult] = useState(null)
  const [exampleText, setExampleText] = useState('')
  const [exampleLoading, setExampleLoading] = useState(false)
  // step627: 피크 시 예시 작품 자동 생성 보류 — { essayText, totalMax, subId } 보관, "📖 예시 작품 보기" 누를 때 생성
  const [exampleDeferred, setExampleDeferred] = useState(null)
  // step644: 온디맨드 핸들러 공용화 — 피드백/완료 카드와 수정 화면의 "📖 예시 작품 보기"가 같은 동작(내용 불변)
  const showDeferredExample = () => {
    const d = exampleDeferred
    if (!d) return
    setExampleDeferred(null)
    generateExampleForSub(d.essayText, d.totalMax, d.subId)
  }
  
  const [rewriteEssay, setRewriteEssay] = useState('')
  const [rewriting, setRewriting] = useState(false)
  const [rewriteChecks, setRewriteChecks] = useState({})  // 🆕 step378: 고칠 것 체크(인덱스별, 화면 전용 — 저장 안 함)
  
  const [pasteWarning, setPasteWarning] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [showNicknameModal, setShowNicknameModal] = useState(false)
  // AI 호출 에러 모달
  const [errorModal, setErrorModal] = useState(null) // null 또는 { title, message }
  const [reportModal, setReportModal] = useState(null) // step649: null 또는 { tag, detail, busy } — 신고 사유 칩 모달
  // 🆕 step492: 전국 글쓰기 챌린지 — 학급 주제와 분리된 오늘의 챌린지 주제들(하루 2개 가능: 공통+학년밴드)
  const [challengeTopics, setChallengeTopics] = useState([])   // 각 항목 {...topic, myMaxAttempt}
  const [challengeRanks, setChallengeRanks] = useState({})     // { [source_supply_id]: { rank, total } } — step539 구조 확장
  const [showcaseModal, setShowcaseModal] = useState(null)   // null 또는 { loading } | { winners, myRank }
  // step571 초안 복원 배너(draftPrompt)는 step651에서 저장 슬롯으로 대체돼 제거됨
  // step651: 저장 슬롯 — slots(목록 표시용 사본), slotModal(null | { selected }), 저장 실패 1회 안내
  const [slots, setSlots] = useState([])
  const [slotModal, setSlotModal] = useState(null)
  const [slotTitles, setSlotTitles] = useState({})   // topicId → 제목(모달 열 때 1회 조회)
  const [saveWarn, setSaveWarn] = useState(false)
  const slotCurrentRef = useRef({ key: null, id: null })   // 현재 갱신 중인 슬롯(주제|단계별)
  const saveWarnShownRef = useRef(false)
  // 💬 step634: 내 의견에 달린 운영자 답장(교사 홈 step205-C 관행) — 본인 행만(fb_select user_id=auth.uid()), 엿보기 비활성
  const [replyNotifs, setReplyNotifs] = useState([])
  const [showReplies, setShowReplies] = useState(false)
  // AI 재시도 진행 표시 (null 또는 메시지)
  const [retryMessage, setRetryMessage] = useState(null)
  // step601: 첫 글 제출 진행 2단계 표시 — 'spell'(맞춤법 확인) → 6초 뒤 'grade'(글 평가). 시간 기반 근사(서버가 단계 신호를 주지 않음).
  const [gradingStage, setGradingStage] = useState(null)   // step629: 'spell'(0~6초) → 'grade'(6~20초) → 'queue'(20초~)
  const gradingStageTimerRef = useRef(null)
  // step629: 시간 잠금 유예 — topicId → 버튼 시점에 잠금을 통과한 시각(ms). 저장 성공 시 삭제, 남아 있으면 채점 실패.
  //   종료 뒤 재시도도 통과 5분 안이면 1회 허용(세션 메모리만, 서버 저장 불변).
  const lockPassRef = useRef(new Map())
  // 🆕 step516: 수정 허용 알림(action=rewrite) 직행 — 다시 쓰기 버튼 스크롤·강조
  const [rewriteSpotlight, setRewriteSpotlight] = useState(false)
  const rewriteBtnRef = useRef(null)
  const handledQueryRef = useRef(null)   // 자기 발신 replace·초기 로드가 처리한 쿼리 서명(topic|action)
  const pasteCountRef = useRef(0)
  const pasteDetectedRef = useRef(false)
  const backupTimerRef = useRef(null)
  // 🆕 step283: 제출 동기 재진입 가드 — state(submitting/rewriting)는 re-render 후에야 반영돼
  //   같은 프레임 연타·await 창 재진입을 못 막음(중복 insert 원인). ref는 즉시 잠겨 확실히 차단.
  const submittingRef = useRef(false)
  const gradeFailRef = useRef(new Set())   // step643: 실패 뒤 재시도 추적 — 키 `${topicId}|${attempt}`(경로 'error_then_retry' 판정용)
  // 🆕 step364: 채점 완료 직후 결과 시작점 착지용
  //   스크롤 코드가 없어도 브라우저 스크롤 앵커링이 하단 잔존 요소(내 글 기록 링크)를 붙잡아
  //   결과 맨 끝에 착지하는 문제 → 채점 직후에만 결과 상단으로 스크롤
  const resultTopRef = useRef(null)        // 결과 시작점 (feedback: 피드백 결과 카드 / done: 완료 배너)
  const scrollToResultRef = useRef(false)  // 채점 직후에만 발동 (기존 제출물 로드 시에는 스크롤 안 함)

  useEffect(() => {
    if (!router.isReady) return
    checkAuth()
  }, [router.isReady])

  // 🆕 step364: 채점 완료 직후에만 결과 시작점으로 스크롤
  useEffect(() => {
    if (step !== 'feedback' && step !== 'done') return
    if (!scrollToResultRef.current) return
    scrollToResultRef.current = false
    try { resultTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (e) {}
  }, [step])
  
  // step651: 자동 저장 1회 반영 — 현재 슬롯 갱신 또는 새 슬롯(lib/draftSlots upsertSnapshot). 엿보기는 저장 안 함(step633).
  //   저장 실패(용량·정책)는 1회만 작은 안내(saveWarn).
  const persistSnapshot = (text, phase) => {
    if (!todayTopic || !user || isImpersonatingNow()) return
    if (!text || !text.trim()) return
    try {
      const key = `${todayTopic.id}|${phase}`
      const curId = slotCurrentRef.current.key === key ? slotCurrentRef.current.id : null
      const r = upsertSnapshot(loadSlots(user.id), { topicId: todayTopic.id, phase, text, currentId: curId })
      slotCurrentRef.current = { key, id: r.currentId }
      const ok = saveSlots(user.id, r.slots)
      setSlots(r.slots)
      if (!ok && !saveWarnShownRef.current) { saveWarnShownRef.current = true; setSaveWarn(true) }
    } catch (e) {
      if (!saveWarnShownRef.current) { saveWarnShownRef.current = true; setSaveWarn(true) }
    }
  }

  // step651: 제출 성공 시 그 주제·단계 슬롯 삭제(종전 removeDraft 관행)
  const clearSlotsFor = (topicId, phase) => {
    if (!user) return
    try {
      const next = removeSlotsFor(loadSlots(user.id), topicId, phase)
      saveSlots(user.id, next)
      setSlots(next)
      if (slotCurrentRef.current.key === `${topicId}|${phase}`) slotCurrentRef.current = { key: null, id: null }
    } catch (e) {}
  }

  // step652: 글쓰기 화면 표시 — VersionChecker가 body[data-writing="1"]이면 자동 새로고침을 하지 않는다(배너만).
  useEffect(() => {
    try { document.body.dataset.writing = (step === 'write' || step === 'rewrite') && !!todayTopic ? '1' : '' } catch (e) {}
    return () => { try { document.body.dataset.writing = '' } catch (e) {} }
  }, [step, todayTopic])

  // step652: 주제 전환·종 알림으로 글이 비기 전 확인 — 쓰던 글이 있으면 먼저 저장하고 confirm. 취소면 false.
  const confirmLeaveDraft = () => {
    const cur = step === 'rewrite' ? rewriteEssay : step === 'write' ? essay : ''
    if (!todayTopic || !cur || !cur.trim()) return true
    persistSnapshot(cur, step)
    return confirm('쓰던 글이 있어요. 다른 주제로 넘어갈까요?\n쓰던 글은 📂 저장된 글에 있어요.')
  }
  const switchTopic = (topicId) => {
    if (topicId && todayTopic && topicId === todayTopic.id) { loadTodayTopic(user, topicId); return }
    if (!confirmLeaveDraft()) return
    loadTodayTopic(user, topicId)
  }

  // step651: 로그인 직후 슬롯 목록 적재(📂 버튼의 N). 구 키 이관은 loadSlots 안에서 1회.
  useEffect(() => {
    if (!user?.id || isImpersonatingNow()) return
    try { setSlots(loadSlots(user.id)) } catch (e) {}
  }, [user?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  // step571→651: 자동 저장 — 1.5초 디바운스, write/rewrite 단계에서만. 현재 슬롯 갱신(80자 이상 변화·3분 경과면 새 슬롯).
  useEffect(() => {
    if (!todayTopic || !user) return
    if (isImpersonatingNow()) return   // step633: 엿보기는 관리자 브라우저에 초안을 남기지 않음
    if (step !== 'write' && step !== 'rewrite') return
    if (backupTimerRef.current) clearTimeout(backupTimerRef.current)
    backupTimerRef.current = setTimeout(() => {
      const text = step === 'write' ? essay : rewriteEssay
      if (text && text.length > 0) persistSnapshot(text, step)
    }, 1500)
    return () => { if (backupTimerRef.current) clearTimeout(backupTimerRef.current) }
  }, [essay, rewriteEssay, step, todayTopic, user])   // eslint-disable-line react-hooks/exhaustive-deps

  // step571: 탭 닫힘·이탈 시 즉시 저장(디바운스 미발화분 방어) — pagehide는 모바일 사파리 포함 가장 넓게 잡힘
  //   step651: visibilitychange(hidden)에서도 즉시 저장 — 탭 메모리 해제·절전 탭은 pagehide가 안 뜰 수 있음
  useEffect(() => {
    const flush = () => {
      if (!todayTopic || !user) return
      if (isImpersonatingNow()) return   // step633
      if (step !== 'write' && step !== 'rewrite') return
      const text = step === 'write' ? essay : rewriteEssay
      if (text && text.length > 0) persistSnapshot(text, step)
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onVisibility) }
  }, [essay, rewriteEssay, step, todayTopic, user])   // eslint-disable-line react-hooks/exhaustive-deps

  // step651: 📂 저장된 글 — 목록 열기(최근 저장 순, 주제 제목은 1회 조회), 불러오기, 복사하기
  const openSlots = async () => {
    if (!user) return
    let list = []
    try { list = sortForList(loadSlots(user.id)) } catch (e) {}
    setSlots(list)
    setSlotModal({ selected: null })
    const missing = [...new Set(list.map(s => s.topicId))].filter(id => !slotTitles[id] && id !== todayTopic?.id)
    if (missing.length > 0) {
      try {
        const { data } = await supabase.from('topics').select('id, title, date').in('id', missing)
        const m = {}
        ;(data || []).forEach(t => { m[t.id] = `${t.title}${t.date ? ` (${t.date})` : ''}` })
        setSlotTitles(prev => ({ ...prev, ...m }))
      } catch (e) {}
    }
  }
  const slotTitle = (topicId) => (todayTopic && topicId === todayTopic.id) ? todayTopic.title : (slotTitles[topicId] || '다른 날의 주제')
  const currentPhase = () => (step === 'rewrite' ? 'rewrite' : step === 'write' ? 'write' : null)
  const canLoadSlot = (s) => !!todayTopic && s.topicId === todayTopic.id && currentPhase() === s.phase
  const loadSlotIntoEditor = (s) => {
    if (!canLoadSlot(s)) return
    const cur = step === 'rewrite' ? rewriteEssay : essay
    if (cur && cur.trim() && cur !== s.text) {
      if (!confirm('지금 쓰던 글도 자동 저장돼요. 저장된 글을 불러올까요?')) return
      persistSnapshot(cur, step)   // 지금 글을 먼저 한 번 더 저장
    }
    if (step === 'rewrite') setRewriteEssay(s.text); else setEssay(s.text)
    slotCurrentRef.current = { key: `${s.topicId}|${s.phase}`, id: s.id }   // 이어서 쓰면 이 슬롯을 갱신(복제 방지)
    setSlotModal(null)
  }
  const copySlot = async (s) => {
    try {
      await navigator.clipboard.writeText(s.text)
      alert('복사했어요. 글쓰기 칸에 붙여 넣어 주세요.')
    } catch (e) {
      alert('자동 복사가 안 돼요. 미리보기 글을 드래그해서 복사해 주세요.')
    }
  }

  // 💬 step634: 내 의견 중 답장 달린 것만 조회(교사 홈 step205-C와 같은 쿼리). 엿보기 중엔 세션이 admin이라 비활성.
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

  // 💬 step634: 답장 읽음 처리 — /api/feedback-mark-read(서비스롤, 본인 user_id 행만). 닫기 때 호출.
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

  // 🆕 step327: 어떤 조회든 무한 대기 방지 — 10초 타임아웃
  const withTimeout = (p, ms = 10000) => Promise.race([
    p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms))
  ])

  const checkAuth = async () => {
    const tStart = performance.now()
    setLoadError(false)
    try {
      // 🆕 step327: 진입 인증은 getSession(로컬 세션, 네트워크 왕복 없음) — getUser rate limit 회피.
      //   실질 검증은 아래 profile 조회의 RLS(토큰 검증) + role 가드가 담당.
      const tAuth = performance.now()
      const { data: { session } } = await supabase.auth.getSession()
      console.log(`[perf] auth 확인: ${Math.round(performance.now() - tAuth)}ms`)
      const uid = session?.user?.id
      if (!uid) { logAuthBounce({ screen: '/student', reason: 'no_session' }); router.push('/student/login'); return }   // step641: 세션 없음도 익명 기록

      const tProfile = performance.now()
      const PROFILE_SELECT = '*, classes:class_id(id, name, code, school, grade, tutor_chat_enabled, teacher_id, auto_supply_enabled, allow_paste)'
      // 👁 step633: ?as=가 있으면 getEffectiveProfile(admin만 통과, 대상은 학생만). 없으면 학생 본인 경로 종전 그대로.
      let profile, imp = false, profileRes = null
      if (isImpersonatingNow()) {
        const r = await withTimeout(getEffectiveProfile(PROFILE_SELECT, { allowedRoles: ['student'] }))
        profile = r.profile; imp = r.isImpersonating; profileRes = r.entryRes || null
      } else {
        // step637: 401/JWT 만료면 refresh 1회 후 같은 조회 1회 재시도(무한 재시도 없음). 시도마다 10초 타임아웃.
        profileRes = await queryWithAuthRetry(() => withTimeout(supabase.from('profiles').select(PROFILE_SELECT).eq('id', uid).maybeSingle()))
        profile = profileRes.data
      }
      console.log(`[perf] profile 조회: ${Math.round(performance.now() - tProfile)}ms, rows=${profile ? 1 : 0}${profileRes?.retried ? ' (세션 갱신 후 재시도)' : ''}`)
      if (!profile || profile.role !== 'student') {
        if (profile?.role === 'admin') { router.push('/admin'); return }   // step633: 엿보기 대상이 잘못돼도 관리자 세션은 끊지 않음
        // step637: 튕김 기록은 signOut 전에(비로그인 insert는 RLS 차단). 실패해도 진행.
        await logAuthBounce({ screen: '/student', reason: !profile ? (profileRes?.error ? 'query_error' : 'profile_null') : 'role_mismatch', res: profileRes, extra: profile ? { role: profile.role } : null })
        await supabase.auth.signOut({ scope: 'local' }); router.push('/student/login'); return
      }
      setIsImpersonating(imp)
      setUser(profile)
      setClassInfo(profile.classes)
      // 키 서버격리(step153~): 학생은 API 키를 다루지 않는다. AI 호출 시 서버가 학급 키를 조회한다.

      // URL 쿼리에 topic_id 있으면 그 주제로 진입 (history에서 "추가 수정" 등)
      const queryTopicId = router.query?.topic
      // step516: 초기 쿼리를 처리 완료로 선기록 — query 감시자의 중복 발화 방지
      handledQueryRef.current = `${queryTopicId || ''}|${router.query?.action || ''}`
      await loadTodayTopic(profile, queryTopicId || null)
      console.log(`[perf] 학생 진입 총계: ${Math.round(performance.now() - tStart)}ms`)
    } catch (e) {
      console.warn('[perf] 진입 실패:', e?.message || e)
      setLoadError(true)   // 무한 스피너 대신 재시도 UI
    } finally {
      setLoading(false)    // 어떤 경로로든 스피너 종료 보장
    }
  }

  // 📚 step621: 우리 반 친구들 글 — 반 주제(챌린지 제외)만, 서버(/api/peer-share)가 학급 ON·본인 제출을 검증.
  //   OFF·locked·실패 → null(카드 없음). 비차단.
  const loadPeerShareFor = async (topic) => {
    if (!topic?.id || topic.source_supply_id) { setPeerShare(null); return }
    try {
      const asId = impersonationTargetId()   // step633: 엿보기면 그 학생 시점(서버가 admin일 때만 인정)
      const r = await fetchPeerShare(supabase, topic.id, asId ? { asStudentId: asId } : {})
      const items = (r?.enabled && !r?.locked && Array.isArray(r.items)) ? r.items : []
      setPeerShare(items.length > 0 ? { topicId: topic.id, items, showScore: !!r.showScore } : null)
    } catch (e) {
      console.warn('친구 글 조회 실패(무시):', e?.message)
      setPeerShare(null)
    }
  }

  // "🙋 선생님께 알리기" — 담임 종 알림(type 'message' 재사용, 번호·닉네임만, 본문 미포함). 같은 글은 세션 내 1회.
  const notifyTeacherPeer = async (item) => {
    if (!item || peerNotified.has(item.key)) return
    if (!assertWritable()) return   // step633
    try {
      const args = peerShareNotifyArgs({ teacherId: user?.classes?.teacher_id, number: user?.number, topicId: todayTopic?.id, nickname: item.nickname })
      if (args) await supabase.rpc('create_notification', args)
      setPeerNotified(prev => new Set([...prev, item.key]))
    } catch (e) {
      console.warn('알림 생성 실패:', e?.message)
      alert('지금은 알리지 못했어요. 잠시 뒤 다시 눌러 주세요.')
    }
  }

  // 지난 주제 중 학생이 아직 제출하지 않은 것들 로드
  const loadPendingTopics = async (profile, teacherId) => {
    const today = todayStr()
    // 최근 30일 이내 주제 중 오늘보다 이전 것
    const tPast = performance.now()
    const { data: pastTopics } = await supabase.from('topics')
      .select('id, date, title, description, source_supply_id')
      .eq('teacher_id', teacherId)
      .is('supply_type', null)   // step479: 공급 원본 격리(담임=관리자 학급 노출 방지)
      .is('source_supply_id', null)   // step611: 챌린지 복사본은 당일만 유효 — 지난 글 목록에서 제외
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(30)
    console.log(`[perf] pastTopics 조회: ${Math.round(performance.now() - tPast)}ms, rows=${(pastTopics || []).length}`)

    if (!pastTopics || pastTopics.length === 0) {
      setPendingTopics([])
      return
    }

    // 이 학생의 제출 기록 확인
    const topicIds = pastTopics.map(t => t.id)
    const tPendSubs = performance.now()
    const { data: mySubs } = await supabase.from('submissions')
      .select('topic_id')
      .eq('user_id', profile.id)
      .in('topic_id', topicIds)
      .is('deleted_at', null)
    console.log(`[perf] pendingTopics mySubs 조회: ${Math.round(performance.now() - tPendSubs)}ms, rows=${(mySubs || []).length}`)

    const submittedSet = new Set((mySubs || []).map(s => s.topic_id))
    const pending = pastTopics.filter(t => !submittedSet.has(t.id))
    setPendingTopics(pending)
  }

  // 🆕 미확인 담임 코멘트 (학생 알림 — AI 추천 기록처럼 로그 형태)
  const loadUnreadComments = async (profile) => {
    try {
      const tUnread = performance.now()
      const { data } = await supabase.from('submissions')
        .select('id, topic_id, teacher_comment, teacher_comment_at, attempt, topics(title, date)')
        .eq('user_id', profile.id)
        .not('teacher_comment', 'is', null)
        .is('teacher_comment_read_at', null)
        .is('deleted_at', null)
        .order('teacher_comment_at', { ascending: false })
        .limit(10)
      console.log(`[perf] unreadComments 조회: ${Math.round(performance.now() - tUnread)}ms, rows=${(data || []).length}`)
      setUnreadComments(data || [])
    } catch(e) {
      setUnreadComments([])
    }
  }

  // step637: 챌린지 카드만 다시 받기 — 비차단 supply-adopt가 새 복사본을 만든 뒤 1회 호출. 학급 주제·글·단계 불변.
  //   myMaxAttempt 계산은 loadTodayTopic의 challenges 매핑과 동일(새 복사본은 제출 0건이지만 같은 식으로 산출).
  const refreshChallengeCards = async (profile, teacherId, today) => {
    try {
      const { data: tts } = await withTimeout(supabase.from('topics')
        .select('*').eq('teacher_id', teacherId).eq('date', today)
        .is('supply_type', null)
        .order('created_at', { ascending: true }))
      const challenges = (tts || []).filter(t => t.source_supply_id)
      if (challenges.length === 0) return
      const { data: mySubs } = await withTimeout(supabase.from('submissions')
        .select('topic_id, attempt').eq('user_id', profile.id).in('topic_id', challenges.map(t => t.id))
        .is('deleted_at', null)).catch(() => ({ data: [] }))
      const maxAttemptByTopic = {}
      ;(mySubs || []).forEach(s => {
        const cur = maxAttemptByTopic[s.topic_id] || 0
        if ((s.attempt || 1) > cur) maxAttemptByTopic[s.topic_id] = s.attempt || 1
      })
      setChallengeTopics(challenges.map(t => ({ ...t, myMaxAttempt: maxAttemptByTopic[t.id] || 0 })))
      console.log(`[perf] 챌린지 카드 재조회(자동 등록 반영): rows=${challenges.length}`)
    } catch (e) { console.warn('챌린지 카드 재조회 실패(무시):', e?.message) }
  }

  const loadTodayTopic = async (profile, targetTopicId = null) => {
   try {
    if (!profile.class_id) return

    // 🆕 step327: 담임 id는 profile.classes join에서 (classes 재조회 제거)
    const teacherId = profile.classes?.teacher_id
    if (!teacherId) return

    // step516: 알림 직행 여부 — action은 아래 syncTopicUrl이 URL에서 소비(제거)하므로 시작 시 선캡처
    const wantRewrite = router.query?.action === 'rewrite'

    // step513: 보던 주제 URL 동기화(shallow) — 새로고침 유지. 교사 submissions.js syncUrl 패턴 이식.
    //   명시 선택 성공만 기록, 폴백·빈 화면은 제거(묵은 ?topic=이 다음 날 붙잡는 역버그 방지).
    const syncTopicUrl = (topicId) => {
      try {
        const q = { ...router.query }
        if (topicId) q.topic = topicId
        else delete q.topic
        delete q.action   // step516: action은 1회 소비 — F5 재강조 방지
        handledQueryRef.current = `${topicId || ''}|`   // step516: 자기 발신 표시(감시자 무시)
        router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true })
      } catch (e) { /* URL 반영 실패는 무시 — 화면 동작에 영향 없음 */ }
    }

    let topic = null
    if (targetTopicId) {
      // 특정 주제 로드 (지난 주제 선택 시 또는 URL ?topic=)
      const { data } = await withTimeout(supabase.from('topics')
        .select('*').eq('id', targetTopicId).maybeSingle()).catch(() => ({ data: null }))
      // 우리 학급 담임 주제인지 검증 (다른 학급 침입 방지)
      // step479: 공급 원본(supply_type 있음)은 URL로 직접 열어도 차단 — 학급 주제(복사본)만 허용
      if (data && data.teacher_id === teacherId && !data.supply_type) {
        topic = data
      }
    }

    // 특정 주제가 없거나 검증 실패 → 오늘 주제로 폴백
    if (!topic) {
      const today = todayStr()

      // 🆕 step477: 전국 글쓰기 챌린지 주제 lazy 자동 등록 — 오늘 발행분이 아직 없으면 서버가 복사해 준다.
      //   step507: 토글 무관 상시 호출 — OFF 학급이면 서버가 전일 미제출 복사본 청소만 하고 disabled 반환.
      //   step637: 비차단 — 응답(함수 콜드 스타트 + 서버 쿼리 5~7)을 기다리지 않고 아래 조회로 바로 진행.
      //     응답의 adopted에 방금 받은 오늘 주제 목록에 없는 id가 있을 때만 챌린지 카드를 1회 재조회(아래 refreshChallengeCards).
      //     4초 타임아웃·실패 무시는 종전 그대로. 첫 진입 학생은 챌린지 카드가 1~2초 늦게 나타날 수 있다.
      let adoptP = null
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token && !isImpersonatingNow()) {   // step633: 엿보기는 자동 등록(서버 쓰기) 호출 안 함
          const tAdopt = performance.now()
          adoptP = withTimeout(fetch('/api/supply-adopt', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: session.access_token }),
          }), 4000)
            .then(r => r.json())
            .then(d => { console.log(`[perf] supply-adopt 응답(비차단): ${Math.round(performance.now() - tAdopt)}ms, adopted=${(d?.adopted || []).length}`); return d })
            .catch(e => { console.warn('공통 주제 자동 등록 실패(무시):', e?.message); return null })
        }
      } catch (e) { console.warn('공통 주제 자동 등록 실패(무시):', e?.message) }

      // 🆕 step327: 독립 조회 동시 실행 — todayTopics(핵심) + 지난주제(보조) + 미확인코멘트(보조)
      const tToday = performance.now()
      const todayTopicsP = withTimeout(supabase.from('topics')
        .select('*').eq('teacher_id', teacherId).eq('date', today)
        .is('supply_type', null)   // step479: 공급 원본 격리(발행 당일 오늘 주제 혼입 방지)
        .order('created_at', { ascending: true }))
      const pendingP = loadPendingTopics(profile, teacherId).catch(() => setPendingTopics([]))
      const unreadP = loadUnreadComments(profile)   // 내부 try/catch 유지
      const { data: todayTopics, error: todayTopicsErr } = await todayTopicsP
      // step651: 조회 오류(401·5xx)를 "오늘 주제 0행"으로 오판해 빈 화면을 띄우던 경로 차단 — throw → 재시도 화면(초안은 그대로)
      if (todayTopicsErr) throw todayTopicsErr
      console.log(`[perf] todayTopics 조회: ${Math.round(performance.now() - tToday)}ms, rows=${(todayTopics || []).length}`)

      if (todayTopics && todayTopics.length > 0) {
        // 학생이 아직 제출 안 한 주제 ID 찾기
        const topicIds = todayTopics.map(t => t.id)
        const tTodaySubs = performance.now()
        const { data: mySubs } = await withTimeout(supabase.from('submissions')
          .select('topic_id, attempt').eq('user_id', profile.id).in('topic_id', topicIds)
          .is('deleted_at', null)).catch(() => ({ data: [] }))
        console.log(`[perf] todayTopic mySubs 조회: ${Math.round(performance.now() - tTodaySubs)}ms, rows=${(mySubs || []).length}`)

        // 각 주제별로 최대 attempt 계산
        const maxAttemptByTopic = {}
        ;(mySubs || []).forEach(s => {
          const cur = maxAttemptByTopic[s.topic_id] || 0
          if ((s.attempt || 1) > cur) maxAttemptByTopic[s.topic_id] = s.attempt || 1
        })

        // 🆕 step492: 전국 글쓰기 챌린지 분리 — 자동 선택·선택 UI는 학급 주제만 대상
        const challenges = todayTopics.filter(t => t.source_supply_id)
        const classTopics = todayTopics.filter(t => !t.source_supply_id)
        setChallengeTopics(challenges.map(t => ({
          ...t,
          myMaxAttempt: maxAttemptByTopic[t.id] || 0
        })))

        // 미제출 주제 우선
        const unsubmitted = classTopics.filter(t => !maxAttemptByTopic[t.id])
        if (unsubmitted.length > 0) {
          topic = unsubmitted[0]
        } else {
          // 모두 제출했으면 첫 글만 쓰고 수정 안 한 것 우선
          const noRewrite = classTopics.filter(t => maxAttemptByTopic[t.id] === 1)
          topic = noRewrite[0] || classTopics[0]
        }

        // 오늘 학급 주제 여러 개라면 state에 저장 (화면 상단 선택 UI용)
        if (classTopics.length > 1) {
          setTodayTopicList(classTopics.map(t => ({
            ...t,
            myMaxAttempt: maxAttemptByTopic[t.id] || 0
          })))
        } else {
          setTodayTopicList([])
        }
      } else {
        setChallengeTopics([])   // step492: 폴백 재실행 시 잔존 방지
      }

      // step637: 자동 등록 응답이 오면(비차단) 방금 받은 목록에 없는 복사본이 있을 때만 챌린지 카드 재조회.
      //   주제 선택·글·단계는 건드리지 않는다(챌린지 복사본은 자동 선택 대상이 아님 — step492).
      if (adoptP) {
        const knownIds = new Set((todayTopics || []).map(t => t.id))
        adoptP.then(d => {
          const fresh = (d?.adopted || []).filter(a => a?.id && !knownIds.has(a.id))
          if (fresh.length > 0) refreshChallengeCards(profile, teacherId, today)
        })
      }

      // 보조 조회(지난 주제·미확인 코멘트) 완료 보장 — 실패해도 진행(화면 결과 동일)
      //   step637: allSettled → all(각 항목 catch) — iOS 12·Safari 12에는 allSettled이 없어 진입이 재시도 화면으로 떨어졌다. 동작 동일.
      await Promise.all([pendingP, unreadP].map(p => p.catch(() => null)))
    }

    if (!topic) { syncTopicUrl(null); return }   // step513: 빈 날(챌린지만 등) — 홈은 깨끗한 URL
    // step513: 명시 선택 성공만 기록, 폴백(오늘 기본·검증 실패)은 제거
    syncTopicUrl(targetTopicId && topic.id === targetTopicId ? topic.id : null)
    setTodayTopic(topic)
    setShowPendingPicker(false)
    // 화면 리셋
    setEssay('')
    setFeedbackResult(null)
    setExampleText('')
    setExampleDeferred(null)   // step627
    setCurrentSub(null)
    setStep('write')
    slotCurrentRef.current = { key: null, id: null }   // step651: 주제 전환 → 다음 자동 저장은 새 슬롯
    setPeerShare(null)    // step621: 제출 전엔 친구 글 카드 없음(주제 전환 잔존 방지)

    // 이미 제출했나 확인 (🆕 step327: select('*') → 화면에서 실제 읽는 컬럼만 명시)
    const tExisting = performance.now()
    const { data: existing, error: existingErr } = await withTimeout(supabase.from('submissions')
      .select('id, topic_id, user_id, attempt, essay_text, scores, rubric_reasons, improve_examples, corrections, total_score, max_score, feedback_overall, feedback_good, feedback_improve, example_text, teacher_comment, teacher_comment_at, teacher_stamp, created_at, re_graded_at, paste_detected, paste_count, reported, extra_rewrite_allowed, rewrite_requested_at, graded_with_model')   // step606: graded_with_model — 안전 필터 차단 표식 판정용
      .eq('user_id', profile.id).eq('topic_id', topic.id).order('attempt', { ascending: true })
      .is('deleted_at', null))
    // step575: 조회 실패(401/5xx)를 "제출 없음"으로 오판해 이미 제출한 학생에게 빈 글쓰기 폼을
    //   보여주던 경로 차단 — throw하면 기존 catch가 재시도 화면(loadError)으로 안내
    if (existingErr) throw existingErr
    console.log(`[perf] existing 제출 조회: ${Math.round(performance.now() - tExisting)}ms, rows=${(existing || []).length}`)

    if (existing && existing.length > 0) {
      const sorted = [...existing].sort((a,b) => (b.attempt||1) - (a.attempt||1))
      const last = sorted[0]
      const maxAttempt = last.attempt || 1
      loadPeerShareFor(topic)   // step621: 제출이 있는 주제 → 친구 글 조회(비차단, 서버가 ON·본인 제출 검증)

      if (maxAttempt === 1) {
        // 첫 글만 있음 → 피드백 화면 + 다시쓰기 가능
        // step601: 보완 대기 배지용 strict_status는 별도 보조 조회(step600 SQL 미적용이면 조용히 실패 → 배지 없음, 화면 정상)
        try {
          const { data: st } = await supabase.from('submissions').select('strict_status').eq('id', last.id).maybeSingle()
          if (st && st.strict_status) last.strict_status = st.strict_status
        } catch (_) { /* 컬럼 없음 등 — 배지만 생략 */ }
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

      // step651: 초안 복원 배너(step571) 제거 — 저장 슬롯 "📂 저장된 글"이 대체(주제·단계 무관하게 항상 보임)
    }

    // 🆕 step516: 알림 직행 — 재작성 가능(feedback: 첫 글만 있거나 추가 허용됨)일 때만 버튼 스크롤·강조.
    //   done(소진·회수)·새 주제(write)면 무시하고 일반 진입. 렌더 대기 후 실행(step506 패턴).
    if (wantRewrite && existing && existing.length > 0) {
      const lastSub = [...existing].sort((a, b) => (b.attempt || 1) - (a.attempt || 1))[0]
      const canRewrite = (lastSub.attempt || 1) === 1 || !!lastSub.extra_rewrite_allowed
      if (canRewrite) {
        setTimeout(() => {
          rewriteBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          setRewriteSpotlight(true)
          setTimeout(() => setRewriteSpotlight(false), 3000)
        }, 300)
      }
    }
   } catch (e) {
     // 🆕 step327: 핵심 조회 타임아웃/실패 → 무한 스피너 대신 재시도 화면
     console.warn('[perf] 주제 로드 실패:', e?.message || e)
     setLoadError(true)
   }
  }

  const logout = async () => {
    if (isImpersonating) { router.push('/admin'); return }   // step633: 엿보기 중 로그아웃은 관리자 페이지로(세션 유지)
    await supabase.auth.signOut({ scope: 'local' }); router.push('/')
  }

  const handlePaste = (e, type) => {
    // step536: 기본은 붙여넣기 차단. 학급 설정 allow_paste ON일 때만 허용(테스트·특별 수업 목적).
    //   차단 시엔 본문에 아무것도 안 들어가므로 감지 기록 안 함(억울한 복붙 배지·랭킹 제외 방지).
    if (!user?.classes?.allow_paste) {
      e.preventDefault()
      alert('직접 입력해 주세요 — 붙여넣기는 사용할 수 없어요')
      return
    }
    // 허용 학급은 기존 감지 로직 유지 — 챌린지 랭킹 제외 등 이중 방어
    pasteDetectedRef.current = true
    pasteCountRef.current++
    setPasteWarning(true)
    setTimeout(() => setPasteWarning(false), 5000)
  }

  // 첫 글 제출
  const submitEssay = async () => {
    if (submitting || submittingRef.current) return
    if (!assertWritable()) return   // step633: 엿보기 — AI 호출 전에 차단
    const minLen = todayTopic?.min_length || 30
    const maxLen = todayTopic?.max_length
    if (essay.trim().length < minLen) {
      return alert(`글을 더 써 주세요! (${minLen}자 이상)\n\n현재 ${essay.trim().length}자`)
    }
    if (maxLen && essay.trim().length > maxLen) {
      return alert(`글이 너무 길어요! (${maxLen}자 이하로 써주세요)\n\n현재 ${essay.trim().length}자`)
    }

    // 시간 락 검증 — step629: 통과 시각 기억, 종료로 막혔어도 통과 5분 안이면 1회 유예(채점 실패 재시도 구제)
    const lock = checkTimeLock(todayTopic)
    if (lock.allowed) {
      lockPassRef.current.set(todayTopic.id, Date.now())
    } else if (canUseLockGrace({ lock, passedAt: lockPassRef.current.get(todayTopic.id) })) {
      lockPassRef.current.delete(todayTopic.id)   // 1회만
      console.info('시간 잠금 유예 1회 사용(첫 글)')
    } else {
      alert('🔒 ' + lock.reason)
      return
    }

    // 🆕 제출 전 확인 (어린이 화면 — 짧고 쉽게)
    if (!confirm('이대로 제출할까요? 제출하면 AI가 채점해요.')) return

    submittingRef.current = true  // 🆕 step283: 첫 await 전 동기 잠금(연타 중복 방지)
    setSubmitting(true)
    const tGrade0 = performance.now()   // step643: 채점 대기 시간 측정 시작(확인 대화상자 통과 직후, 중복 확인 조회 포함)
    let gradingMs = null

    // 🆕 step575: insert 전 존재 확인 — attempt=1 중복행 사고(두 기기 동시 제출·AI 대기 중 이탈 후
    //   재제출·응답 유실 후 재시도) 차단. submittingRef는 마운트 로컬이라 이 검사가 유일한 교차 방어.
    //   조회 자체가 실패하면(401/네트워크) "없다"고 추측하지 않고 제출을 중단한다.
    try {
      const { data: dupCheck, error: dupErr } = await withTimeout(supabase.from('submissions')
        .select('id').eq('user_id', user.id).eq('topic_id', todayTopic.id)
        .is('deleted_at', null).limit(1))
      if (dupErr) throw dupErr
      if (dupCheck && dupCheck.length > 0) {
        submittingRef.current = false
        setSubmitting(false)
        alert('이 주제에는 이미 제출한 글이 있어요. 화면을 새로 불러올게요.')
        await loadTodayTopic(user, todayTopic.id)
        return
      }
    } catch (e) {
      submittingRef.current = false
      setSubmitting(false)
      alert('연결이 불안정해서 제출을 잠시 멈췄어요. 잠시 후 다시 눌러주세요.\n📝 쓴 글은 이 기기에 저장돼 있어요.')
      return
    }

    try {
      const rubrics = todayTopic.rubrics
      const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)
      // step601: 진행 2단계 표시 — 전용 맞춤법 검사(평균 수 초) 동안 '맞춤법 확인', 6초 뒤 '글 평가'로 전환(시간 근사)
      // step629: 3단계 — 20초 넘으면 '줄 서 있어요'(피크 대기 안내, 인원 수 표시 없음)
      setGradingStage('spell')
      if (gradingStageTimerRef.current) clearTimeout(gradingStageTimerRef.current)
      gradingStageTimerRef.current = setTimeout(() => {
        setGradingStage('grade')
        gradingStageTimerRef.current = setTimeout(() => setGradingStage('queue'), 14000)
      }, 6000)
      // 🔒 프롬프트는 서버(/api/ai)에서 구성 — 핵심 IP 보호
      // 키 서버격리(step153~): 키 미등록이면 서버가 명확한 에러를 반환 → catch에서 안내
      let result
      try {
        result = await callAI('grading', {
          topic: { title: todayTopic.title, description: todayTopic.description },
          essay,
          rubrics,
        })
        gradingMs = Math.round(performance.now() - tGrade0)   // step643: 결과 수신 시점
      } catch (aiErr) {
        if (!isSafetyBlockedErr(aiErr)) throw aiErr
        // 🟣 step606: 안전 필터 차단 — 같은 글은 다시 막히므로 재시도 없이 점수 없이 저장하고 끝(정리는 finally)
        await saveBlockedSubmission({ essayText: essay, totalMax, attempt: 1, isRewrite: false })
        return
      }

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

      // 규칙 기반 보강은 서버(pages/api/ai.js)에서 병합 완료 — result.corrections 그대로 사용

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
        is_final: false,
        // step600: 전용 맞춤법 검사 상태(서버 플래그가 있을 때만 — 컬럼 미적용 배포에서도 저장이 깨지지 않게)
        ...(result.__strictStatus ? {
          strict_status: result.__strictStatus,
          strict_at: result.__strictStatus === 'done' ? new Date().toISOString() : null
        } : {})
      }).select().single()

      if (error) throw error
      lockPassRef.current.delete(todayTopic.id)   // step629: 저장 성공 → 유예 기록 삭제

      // step643: 채점 대기 시간·경로를 별도 update로(컬럼 미적용이면 실패를 무시 — insert는 불변). 화면 영향 없음.
      try {
        const failKey = `${todayTopic.id}|1`
        const gradingPath = deriveGradingPath({ failedBefore: gradeFailRef.current.has(failKey), isFallback, attempts: result.__attempts, strictStatus: result.__strictStatus })
        gradeFailRef.current.delete(failKey)
        if (gradingMs !== null) await supabase.from('submissions').update({ grading_ms: gradingMs, grading_path: gradingPath }).eq('id', sub.id)
      } catch (_) { /* 측정 저장 실패는 무시 */ }

      // step571: 초안 정리 (새 키 + 구 백업 키)
      clearSlotsFor(todayTopic.id, 'write')   // step651: 제출 성공 → 이 주제 첫 글 슬롯 삭제
      // step575: 지난 글 목록에서 제거 — 제출한 주제가 "안 쓴 글" 목록에 남아 재제출을 유인하던 문제
      setPendingTopics(prev => prev.filter(t => t.id !== todayTopic.id))
      pasteDetectedRef.current = false
      pasteCountRef.current = 0

      setCurrentSub(sub)
      setFeedbackResult(result)
      scrollToResultRef.current = true  // 🆕 step364: 채점 직후 결과 상단 착지
      setStep('feedback')
      loadPeerShareFor(todayTopic)   // step621: 첫 제출 직후 친구 글 카드

      // 🆕 step492: 챌린지 제출이면 카드의 제출 상태·내 순위 즉시 갱신(스테일 방지)
      if (todayTopic.source_supply_id) {
        setChallengeTopics(prev => prev.map(t =>
          t.id === todayTopic.id ? { ...t, myMaxAttempt: Math.max(t.myMaxAttempt || 0, 1) } : t))
        fetchMyRank(todayTopic.source_supply_id)
      }

      // 예시 작품 생성 (백그라운드)
      // 🆕 step368: subId 명시 전달 — 기존 generateExample은 낡은 클로저의 currentSub(null)를 봐서
      //   첫 글 example_text가 DB에 저장된 적이 없었음(재방문 시 예시 미표시 원인)
      // 🆕 step627: 서버가 피크(__exampleDeferred)면 자동 생성 대신 보류 → 학생이 "📖 예시 작품 보기"를 누를 때 생성
      if (decideExampleFlow(result) === 'deferred') setExampleDeferred({ essayText: essay, totalMax, subId: sub.id })
      else generateExampleForSub(essay, totalMax, sub.id)
    } catch(e) {
      console.error('제출 오류:', e)
      try { gradeFailRef.current.add(`${todayTopic?.id}|1`) } catch (_) {}   // step643: 다음 성공 시 'error_then_retry'
      const rawMsg = e?.message || ''
      // 로그인 세션 만료(401)면 새로고침 버튼 노출 — 판정은 원본 메시지 기준
      const isAuthExpired = /인증|로그인/.test(rawMsg)
      // 유료 잔액 소진은 학생이 못 고침 → 선생님께 알리도록 안내 (버튼 없음)
      const isPrepayment = rawMsg.includes('prepayment') || rawMsg.includes('credits are depleted') || rawMsg.includes('billing#prepay')
      // step519: 키 무효는 원인이 학생에게 전달되게(담임에게는 서버가 종 알림)
      const isKeyInvalid = rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('API key not valid')
      // step606: 안전 필터 차단인데 점수 없이 저장까지 실패한 경우(컬럼 제약 등) — 재시도 권유 없이 선생님께
      const isBlocked = isSafetyBlockedErr(e)
      setErrorModal({
        title: isBlocked ? '🟣 AI가 이 글을 평가하지 못했어요' : '🚨 글 제출에 문제가 생겼어요',
        message: isBlocked
          ? STUDENT_BLOCKED_MESSAGE + '\n\n📝 쓴 글은 이 기기에 저장돼 있어요. 선생님께 말씀드려 주세요.'
          : isKeyInvalid
          ? '🔑 선생님의 API 키 확인이 필요해요. 선생님께 말씀드려 주세요.\n\n📝 쓴 글은 이 기기에 저장돼 있어요. 다시 로그인하면 복원할 수 있어요.'
          : isPrepayment
            ? '⏳ 지금 AI 사용에 문제가 생겼어요. 선생님께 알려주시면 금방 해결돼요.\n\n📝 쓴 글은 이 기기에 저장돼 있어요. 다시 로그인하면 복원할 수 있어요.'
            : '⏳ 지금은 채점이 잘 안 돼요. 잠시 후 다시 해보고, 계속 안 되면 선생님께 말씀드려요.\n\n📝 쓴 글은 이 기기에 저장돼 있어요. 다시 로그인하면 복원할 수 있어요.',
        showReload: isAuthExpired
      })
    } finally {
      // step606: 차단 분기의 early return에서도 정리가 빠지지 않게 finally로 이동(내용 불변)
      submittingRef.current = false
      setSubmitting(false); setRetryMessage(null)
      // step601: 진행 단계 표시 정리
      if (gradingStageTimerRef.current) { clearTimeout(gradingStageTimerRef.current); gradingStageTimerRef.current = null }
      setGradingStage(null)
    }
  }

  // 예시 작품 생성 (subId 명시 — 첫 글·수정본 공용, step368)
  const generateExampleForSub = async (studentEssay, totalMax, subId) => {
    if (!subId) return
    if (isImpersonatingNow()) return   // step633: 엿보기는 AI 호출·example_text 저장 없음

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

  // 🆕 step492: 내 순위 조회(비차단, 실패 무시) — 제출한 챌린지만 호출, null이면 미표시
  //   step539: {rank, total(rankedPool)} 구조로 저장 — 구간화 표시(formatMyRank) 분모 재료
  const fetchMyRank = async (sid) => {
    if (!sid) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      const asId = impersonationTargetId()   // step633: 엿보기면 그 학생 기준 순위(서버가 admin일 때만 인정)
      const res = await fetch('/api/supply-ranking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, supplyId: sid, ...(asId ? { asStudentId: asId } : {}) }),
      })
      const d = await res.json()
      if (res.ok && d?.ok && !d.locked && d.myRank != null) {
        setChallengeRanks(prev => ({ ...prev, [sid]: { rank: d.myRank, total: d.rankedPool ?? null } }))
      }
    } catch (e) { /* 무시 — 순위 없이도 카드는 동작 */ }
  }

  // step539: 전국 순위 구간화 한 줄 — 1~10위 등수 그대로 / ~상위 50% 퍼센트 / 하위 50% 격려형(숫자 없음)
  const challengeRankLine = (info) => {
    const fmt = info?.rank ? formatMyRank({ rank: info.rank, total: info.total, seed: cheerSeed(3) }) : null
    if (!fmt) return null
    if (fmt.band === 'exact') return `🏅 지금 내 순위: 전국 ${info.rank}위`
    if (fmt.band === 'percent') return `🏅 전국 ${fmt.text}`
    return fmt.text
  }

  // 🆕 step492: 제출한 챌린지의 내 순위 프리페치(카드 표시용)
  useEffect(() => {
    challengeTopics
      .filter(t => t.myMaxAttempt > 0 && challengeRanks[t.source_supply_id] == null)
      .forEach(t => fetchMyRank(t.source_supply_id))
  }, [challengeTopics])   // eslint-disable-line react-hooks/exhaustive-deps

  // 🆕 step516: same-route 쿼리 변경 감시 — 벨 알림 클릭(router.push)은 remount가 없어 여기서 데이터 리로드.
  //   자기 발신 replace(syncTopicUrl)·초기 로드가 기록한 서명과 같으면 무시(루프 방지).
  useEffect(() => {
    if (!user) return
    const sig = `${router.query?.topic || ''}|${router.query?.action || ''}`
    if (handledQueryRef.current === sig) return
    // step652: 종 알림 클릭 등으로 다른 주제가 요청됐는데 쓰던 글이 있으면 confirm. 취소하면 URL을 지금 주제로 되돌린다.
    const nextTopic = router.query?.topic || null
    if (nextTopic !== (todayTopic?.id || null) && !confirmLeaveDraft()) {
      const q = { ...router.query }
      if (todayTopic?.id) q.topic = todayTopic.id; else delete q.topic
      delete q.action
      handledQueryRef.current = `${todayTopic?.id || ''}|`
      try { router.replace({ pathname: router.pathname, query: q }, undefined, { shallow: true }) } catch (e) {}
      return
    }
    handledQueryRef.current = sig
    loadTodayTopic(user, nextTopic)
  }, [router.query?.topic, router.query?.action, user])   // eslint-disable-line react-hooks/exhaustive-deps

  // 🆕 step487: 챌린지 상위 글 모달 열기 — 항상 서버 재호출(제출 직후 잠금 해제 반영)
  //   step492: sid 인자화 — 챌린지 카드·주제 박스·제출 후 진입점이 각자 sid를 전달
  const openShowcase = async (sid) => {
    if (!sid || showcaseModal?.loading) return
    setShowcaseModal({ loading: true })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('로그인이 필요해요')
      const asId = impersonationTargetId()   // step633
      const res = await fetch('/api/supply-ranking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, supplyId: sid, ...(asId ? { asStudentId: asId } : {}) }),
      })
      const d = await res.json()
      if (!res.ok || !d?.ok) throw new Error(d?.error || '불러오지 못했어요')
      if (d.locked) {
        setShowcaseModal(null)
        alert('먼저 글을 쓰면 친구들 글을 볼 수 있어요!')
        return
      }
      if (d.myRank != null) setChallengeRanks(prev => ({ ...prev, [sid]: { rank: d.myRank, total: d.rankedPool ?? null } }))
      setShowcaseModal({ loading: false, winners: d.winners || [], myRank: d.myRank ?? null, rankedPool: d.rankedPool ?? null })
    } catch (e) {
      setShowcaseModal(null)
      alert('상위 글을 불러오지 못했어요. 잠시 후 다시 해봐요.')
      console.warn('showcase 조회 실패:', e?.message)
    }
  }

  // 🆕 step487: 원터치 신고 — 즉시 비공개, 복구는 관리자가
  const reportShowcase = async (w) => {
    if (!assertWritable()) return   // step633
    if (!confirm('이 글을 신고할까요?')) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('로그인이 필요해요')
      const res = await fetch('/api/supply-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, showcaseId: w.showcaseId }),
      })
      const d = await res.json()
      if (!res.ok || !d?.ok) throw new Error(d?.error || '')
      setShowcaseModal(prev => prev?.winners
        ? { ...prev, winners: prev.winners.map(x => x.showcaseId === w.showcaseId ? { ...x, essay: null, reportedByMe: true } : x) }
        : prev)
      alert('신고했어요. 확인 후 조치할게요.')
    } catch (e) {
      alert('신고에 실패했어요. 잠시 후 다시 해봐요.')
      console.warn('showcase 신고 실패:', e?.message)
    }
  }

  // 🆕 step512: 수정 소진 시 선생님께 수정 기회 요청 — 최신 글에 타임스탬프만 기록(자기 글 update, 기존 RLS 경로).
  //   추후 알림 센터 범용 알림으로 통합 예정.
  const requestRewriteChance = async () => {
    if (!currentSub?.id) return
    if (!assertWritable()) return   // step633
    if (!confirm('선생님께 수정 기회를 요청할까요?')) return
    try {
      const requestedAt = new Date().toISOString()
      const { error } = await supabase.from('submissions')
        .update({ rewrite_requested_at: requestedAt }).eq('id', currentSub.id)
      if (error) throw error
      setCurrentSub(prev => prev ? { ...prev, rewrite_requested_at: requestedAt } : prev)
    } catch (e) {
      alert('요청에 실패했어요. 잠시 후 다시 해봐요.')
      console.warn('수정 기회 요청 실패:', e?.message)
    }
  }

  // 🟣 step606: AI 안전 필터 차단 → 글을 점수 없이 저장(표식 graded_with_model='safety_blocked') + 담임 알림.
  //   채점 성공 경로와 분리된 별도 insert. 저장 실패면 code를 유지한 에러를 throw → 호출처 catch가 전용 모달(기기 초안 유지).
  const saveBlockedSubmission = async ({ essayText, totalMax, attempt, isRewrite }) => {
    const { data: sub, error } = await supabase.from('submissions').insert({
      user_id: user.id,
      topic_id: todayTopic.id,
      topic_title: todayTopic.title,
      topic_description: todayTopic.description,
      attempt,
      essay_text: essayText,
      ...blockedRowFields(totalMax),
      paste_detected: pasteDetectedRef.current,
      paste_count: pasteCountRef.current,
      is_final: !!isRewrite,
      ...(isRewrite ? { extra_rewrite_allowed: false } : {})
    }).select().single()
    if (error) {
      const err = new Error(error.message || '저장 실패')
      err.code = SAFETY_BLOCK_CODE
      err.saveFailed = true
      throw err
    }
    if (isRewrite) {
      await supabase.from('submissions').update({ is_final: true, extra_rewrite_allowed: false, rewrite_requested_at: null })
        .eq('user_id', user.id).eq('topic_id', todayTopic.id)
    }
    clearSlotsFor(todayTopic.id, isRewrite ? 'rewrite' : 'write')   // step651
    if (!isRewrite) setPendingTopics(prev => prev.filter(t => t.id !== todayTopic.id))
    pasteDetectedRef.current = false
    pasteCountRef.current = 0
    if (isRewrite) { setEssay(essayText); setExampleText(''); setExampleDeferred(null) }
    setCurrentSub(sub)
    setFeedbackResult({ blocked: true, scores: null, total: null, overall: '', good: '', improve: '', corrections: [] })
    scrollToResultRef.current = true
    setStep(isRewrite ? 'done' : 'feedback')
    if (todayTopic.source_supply_id) {
      setChallengeTopics(prev => prev.map(t =>
        t.id === todayTopic.id ? { ...t, myMaxAttempt: Math.max(t.myMaxAttempt || 0, attempt) } : t))
    }
    // 🔔 담임 알림(비차단, 실명 금지·번호만). 링크는 교사 제출물 페이지의 그 학생 글.
    try {
      const args = blockedNotificationArgs({
        teacherId: user?.classes?.teacher_id, number: user?.number, topicId: todayTopic.id, userId: user.id
      })
      if (args) await supabase.rpc('create_notification', args)
    } catch (e) { console.warn('차단 알림 생성 실패:', e?.message) }
  }

  // 다시 쓰기 시작
  const startRewrite = () => {
    setRewriteEssay(essay) // 처음 글로 채워둠
    setRewriteChecks({})   // 🆕 step378: 고칠 것 체크 리셋 (표시용 상태만)
    setStep('rewrite')
  }

  // 피드백 신고 — step649: prompt() 대신 사유 칩 모달(5개 중 1개 필수 + 선택 입력 40자). 글당 1회(reported)·하루 3회(KST) 제한.
  const reportFeedback = async () => {
    if (!currentSub?.id) return alert('아직 제출된 글이 없어요')
    if (!assertWritable()) return   // step633
    if (currentSub.reported) return alert('이미 신고했어요. 선생님께서 확인하실 거예요.')
    setReportModal({ tag: null, detail: '', busy: false })
  }

  const submitReport = async () => {
    if (!reportModal?.tag || reportModal.busy || !currentSub?.id) return
    if (!assertWritable()) return
    const reason = buildReportReason(reportModal.tag, reportModal.detail)
    if (!reason) return
    setReportModal(m => ({ ...m, busy: true }))
    try {
      // 하루 3회 제한(KST 자정 기준, 본인 행만 — sub_select RLS). 조회 실패 시엔 막지 않는다(학생 흐름 보호).
      try {
        const dayStart = new Date(todayStr() + 'T00:00:00+09:00').toISOString()
        const { count } = await supabase.from('submissions').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).gte('reported_at', dayStart)
        if (isDailyLimitReached(count)) {
          setReportModal(null)
          alert(`오늘은 신고를 ${REPORT_DAILY_LIMIT}번까지 보낼 수 있어요. 내일 다시 알려 주세요.\n급하면 선생님께 직접 말씀드려요.`)
          return
        }
      } catch (_) { /* 조회 실패 — 제한 없이 진행 */ }

      const { error } = await supabase.from('submissions').update({
        reported: true,
        report_reason: reason,
        reported_at: new Date().toISOString()
      }).eq('id', currentSub.id)
      if (error) throw error
      // 🔔 step348: 알림 센터 — 담임 교사에게 신고 알림(비차단, 실명 금지·번호만)
      try {
        const teacherId = user?.classes?.teacher_id
        if (teacherId) {
          await supabase.rpc('create_notification', {
            p_recipient: teacherId,
            p_type: 'report',
            p_title: '학생이 AI 피드백을 신고했어요',
            p_body: `${user?.number ? user.number + '번 ' : ''}학생이 신고했어요`,
            p_link: '/teacher/feedback-reports'
          })
        }
      } catch (e) { console.warn('알림 생성 실패:', e?.message) }
      // 🔔 step631: 관리자 전원에게도 종 알림(서버가 admin 목록 조회·일괄 insert). 비차단, 실패 무시 — 학생 흐름 불변.
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          fetch('/api/feedback-report-notify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: session.access_token, submissionId: currentSub.id }),
          }).catch(e => console.warn('관리자 신고 알림 실패(무시):', e?.message))
        }
      } catch (e) { console.warn('관리자 신고 알림 실패(무시):', e?.message) }
      setCurrentSub({ ...currentSub, reported: true, report_reason: reason })
      setReportModal(null)
      alert('🙏 신고가 접수됐어요!\n선생님께서 확인하시고 도와주실 거예요.')
    } catch(e) {
      setReportModal(m => (m ? { ...m, busy: false } : m))
      alert('신고 실패: ' + e.message)
    }
  }

  // 수정본 제출
  const submitRewrite = async () => {
    if (rewriting || submittingRef.current) return
    if (!assertWritable()) return   // step633: 엿보기 — AI 호출 전에 차단
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

    // 시간 락 검증 — step629: 통과 시각 기억 + 종료 뒤 5분 안 1회 유예(첫 글과 동일 규칙)
    const lock = checkTimeLock(todayTopic)
    if (lock.allowed) {
      lockPassRef.current.set(todayTopic.id, Date.now())
    } else if (canUseLockGrace({ lock, passedAt: lockPassRef.current.get(todayTopic.id) })) {
      lockPassRef.current.delete(todayTopic.id)   // 1회만
      console.info('시간 잠금 유예 1회 사용(수정본)')
    } else {
      alert('🔒 ' + lock.reason)
      return
    }

    // 🆕 step283: 첫 await(중복확인 쿼리) 전에 동기 잠금 — 연타/재진입으로 같은 attempt 중복 insert 방지.
    //   read-then-insert(아래 existingSubs→insert)가 비원자라, 동시 진입 시 모두 같은 attempt로 insert되던 버그.
    submittingRef.current = true
    const tGrade0 = performance.now()   // step643: 측정 시작(잠금 통과 직후, 수정 횟수 조회 포함)
    let gradingMs = null

    // 추가 수정 권한 체크
    const { data: existingSubs, error: existingSubsErr } = await supabase.from('submissions')
      .select('attempt, extra_rewrite_allowed').eq('user_id', user.id).eq('topic_id', todayTopic.id)
      .is('deleted_at', null)
    // step575: 조회 실패 시 attempt=2로 추측 insert하던 경로 차단(중복행 방지)
    if (existingSubsErr) {
      submittingRef.current = false
      return alert('연결이 불안정해서 제출을 잠시 멈췄어요. 잠시 후 다시 눌러주세요.\n📝 쓴 글은 이 기기에 저장돼 있어요.')
    }

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
        // step575: 동률(attempt 중복행) 안전 — 담임이 어느 행에 허가를 줬든 인정(find는 첫 행만 봐서 오반려)
        const allowed = existingSubs.filter(s => (s.attempt || 1) === maxAtt).some(s => s.extra_rewrite_allowed)
        if (!allowed) {
          submittingRef.current = false  // 🆕 잠금 해제 후 종료
          return alert(
            `수정 횟수를 모두 사용했어요 (${maxRewrites}회).\n` +
            `더 고치고 싶으면 선생님께 수정 기회를 요청할 수 있어요!`
          )
        }
      }
    }

    setRewriting(true)
    try {
      const rubrics = todayTopic.rubrics
      const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)
      // 🔒 프롬프트는 서버(/api/ai)에서 구성 — 핵심 IP 보호
      let result
      try {
        result = await callAI('rewriteGrading', {
          topic: { title: todayTopic.title, description: todayTopic.description },
          rewriteEssay,
          rubrics,
          topicId: todayTopic.id,  // 🆕 step442: 서버가 직전 채점 요약을 조회하는 식별자(요약 자체는 서버 생성)
        })
        gradingMs = Math.round(performance.now() - tGrade0)   // step643: 결과 수신 시점
      } catch (aiErr) {
        if (!isSafetyBlockedErr(aiErr)) throw aiErr
        // 🟣 step606: 안전 필터 차단 — 수정본도 점수 없이 저장(최종 처리), 점수 alert 없음(정리는 finally)
        await saveBlockedSubmission({ essayText: rewriteEssay, totalMax, attempt: nextAttempt, isRewrite: true })
        return
      }

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

      // 규칙 기반 보강은 서버(pages/api/ai.js)에서 병합 완료 — result.corrections 그대로 사용

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
      lockPassRef.current.delete(todayTopic.id)   // step629: 저장 성공 → 유예 기록 삭제

      // step643: 채점 대기 시간·경로 별도 update(실패 무시, insert 불변). 수정본은 전용 검사가 없어 pending 없음.
      try {
        const failKey = `${todayTopic.id}|${nextAttempt}`
        const gradingPath = deriveGradingPath({ failedBefore: gradeFailRef.current.has(failKey), isFallback: rwIsFallback, attempts: result.__attempts })
        gradeFailRef.current.delete(failKey)
        if (gradingMs !== null && newSub?.id) await supabase.from('submissions').update({ grading_ms: gradingMs, grading_path: gradingPath }).eq('id', newSub.id)
      } catch (_) { /* 측정 저장 실패는 무시 */ }

      // 이전 글들도 final 처리 (step512: 수정 기회 요청 흔적도 청소 — 요청이 이행됐으므로)
      await supabase.from('submissions').update({ is_final: true, extra_rewrite_allowed: false, rewrite_requested_at: null })
        .eq('user_id', user.id).eq('topic_id', todayTopic.id)

      clearSlotsFor(todayTopic.id, 'rewrite')  // step571→651: 수정본 제출 성공 → 수정본 슬롯 삭제
      pasteDetectedRef.current = false
      pasteCountRef.current = 0

      // 새 정보로 업데이트
      setEssay(rewriteEssay)
      setCurrentSub(newSub) // 수정본 row를 currentSub로 (예시 저장 대상)
      setFeedbackResult(result)
      setExampleText('') // 새 예시 받기 위해 비우기
      setExampleDeferred(null)   // step627
      scrollToResultRef.current = true  // 🆕 step364: 채점 직후 결과 상단 착지
      setStep('done')
      loadPeerShareFor(todayTopic)   // step621: 수정본 제출 직후 친구 글 카드 갱신

      // 🆕 step492: 챌린지 수정본이면 카드 상태·내 순위 즉시 갱신(스테일 방지)
      if (todayTopic.source_supply_id) {
        setChallengeTopics(prev => prev.map(t =>
          t.id === todayTopic.id ? { ...t, myMaxAttempt: Math.max(t.myMaxAttempt || 0, 2) } : t))
        fetchMyRank(todayTopic.source_supply_id)
      }
      alert(`🎉 수정본 제출 완료!\n최종 점수: ${result.total}/${totalMax}점`)

      // 수정본에 대한 새 예시 작품 생성 (백그라운드) — step627: 피크면 보류(온디맨드)
      if (decideExampleFlow(result) === 'deferred') setExampleDeferred({ essayText: rewriteEssay, totalMax, subId: newSub?.id })
      else generateExampleForSub(rewriteEssay, totalMax, newSub?.id)
    } catch(e) {
      console.error('수정본 제출 오류:', e)
      try { gradeFailRef.current.add(`${todayTopic?.id}|${nextAttempt}`) } catch (_) {}   // step643
      const rawMsg = e?.message || ''
      // 로그인 세션 만료(401)면 새로고침 버튼 노출 — 판정은 원본 메시지 기준
      const isAuthExpired = /인증|로그인/.test(rawMsg)
      // 유료 잔액 소진은 학생이 못 고침 → 선생님께 알리도록 안내 (버튼 없음)
      const isPrepayment = rawMsg.includes('prepayment') || rawMsg.includes('credits are depleted') || rawMsg.includes('billing#prepay')
      // step519: 키 무효는 원인이 학생에게 전달되게(담임에게는 서버가 종 알림)
      const isKeyInvalid = rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('API key not valid')
      // step606: 안전 필터 차단인데 저장까지 실패한 경우 — 재시도 권유 없이 선생님께
      const isBlocked = isSafetyBlockedErr(e)
      setErrorModal({
        title: isBlocked ? '🟣 AI가 이 글을 평가하지 못했어요' : '🚨 수정본 제출에 문제가 생겼어요',
        message: isBlocked
          ? STUDENT_BLOCKED_MESSAGE + '\n\n📝 쓴 글은 이 기기에 저장돼 있어요. 선생님께 말씀드려 주세요.'
          : isKeyInvalid
          ? '🔑 선생님의 API 키 확인이 필요해요. 선생님께 말씀드려 주세요.\n\n📝 쓴 글은 이 기기에 저장돼 있어요. 다시 로그인하면 복원할 수 있어요.'
          : isPrepayment
            ? '⏳ 지금 AI 사용에 문제가 생겼어요. 선생님께 알려주시면 금방 해결돼요.\n\n📝 쓴 글은 이 기기에 저장돼 있어요. 다시 로그인하면 복원할 수 있어요.'
            : '⏳ 지금은 채점이 잘 안 돼요. 잠시 후 다시 해보고, 계속 안 되면 선생님께 말씀드려요.\n\n📝 쓴 글은 이 기기에 저장돼 있어요. 다시 로그인하면 복원할 수 있어요.',
        showReload: isAuthExpired
      })
    } finally {
      // step606: 차단 분기의 early return에서도 정리가 빠지지 않게 finally로 이동(내용 불변)
      submittingRef.current = false
      setRewriting(false); setRetryMessage(null)
    }
  }

  // 🆕 step492: 전국 글쓰기 챌린지 카드 — 학급 주제 카드와 분리, 지금 쓰는 중인 챌린지는 숨김(중복 방지)
  const renderChallengeCards = () => challengeTopics
    .filter(t => t.id !== todayTopic?.id)
    .map(t => {
      const { genreLabel } = parseTopicDescription(t.description)
      const rankLine = challengeRankLine(challengeRanks[t.source_supply_id])   // step539: 구간화
      return (
        <div key={t.id} className="bg-sky-50 border border-sky-200 rounded-2xl p-4">
          <div className="text-xs text-sky-700 font-semibold mb-1">
            🌏 전국 글쓰기 챌린지
            {genreLabel && (
              <span className="ml-2 bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">📝 {genreLabel}</span>
            )}
            {t.myMaxAttempt > 0 && (
              <span className="ml-2 bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ 참여했어요</span>
            )}
          </div>
          <h3 className="font-bold text-sky-900">{t.title}</h3>
          {t.myMaxAttempt > 0 && rankLine && (
            <p className="text-xs text-sky-800 font-semibold mt-1">{rankLine}</p>
          )}
          <div className="flex gap-2 mt-3">
            <button onClick={() => switchTopic(t.id)}
              className="flex-1 bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold py-2 rounded-lg transition">
              ✍️ 챌린지 글쓰기
            </button>
            <button onClick={() => openShowcase(t.source_supply_id)}
              className="flex-1 bg-white border border-sky-300 hover:bg-sky-100 text-sky-800 text-sm font-semibold py-2 rounded-lg transition">
              🏆 상위 글 보기
            </button>
          </div>
        </div>
      )
    })

  // 🆕 step492: 안 쓴 글 목록(두 카드 공용). step611: 챌린지 복사본은 조회에서 제외되므로 학급 주제만 표시(챌린지 그룹 제거)
  const renderPendingList = () => {
    const classPending = pendingTopics.filter(t => !t.source_supply_id)
    const item = (t, challenge) => {
      // step491: 오늘 카드와 동일한 배지, 미리보기는 파서 body 기준(갈래 문구 중복 방지)
      const { genreLabel, body } = parseTopicDescription(t.description)
      return (
        <button key={t.id}
          onClick={() => switchTopic(t.id)}
          className={`w-full text-left p-3 border rounded-lg transition ${challenge ? 'bg-sky-50 border-sky-200 hover:bg-sky-100' : 'bg-amber-50 border-amber-200 hover:bg-amber-100'}`}>
          <div className={`text-xs font-semibold ${challenge ? 'text-sky-700' : 'text-amber-700'}`}>
            📅 {t.date}
            {challenge && (
              <span className="ml-2 bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full whitespace-nowrap">🌏 전국 글쓰기 챌린지</span>
            )}
            {genreLabel && (
              <span className="ml-2 bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">📝 {genreLabel}</span>
            )}
          </div>
          <div className="font-medium text-sm mt-0.5">{t.title}</div>
          {body && <div className="text-xs text-gray-600 mt-1 line-clamp-2">{body}</div>}
        </button>
      )
    }
    return <>{classPending.map(t => item(t, false))}</>
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-500">로딩 중...</div></div>

  // 🟣 step606: 지금 보고 있는 글이 AI 안전 필터 차단으로 점수 없이 저장된 글인지(제출 직후·재진입 모두 currentSub 기준)
  const feedbackBlocked = isBlockedSubmission(currentSub) || !!feedbackResult?.blocked

  // 🆕 step327: 진입 실패/타임아웃 시 무한 스피너 대신 재시도 화면
  if (loadError) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center space-y-3 max-w-xs">
        <div className="text-3xl">📡</div>
        <p className="text-gray-700 leading-relaxed">연결이 불안정해요. 다시 시도해 주세요.</p>
        <button
          onClick={() => { setLoadError(false); setLoading(true); checkAuth() }}
          className="px-5 py-2.5 bg-primary text-white rounded-lg font-semibold hover:bg-primary-dark">
          다시 시도
        </button>
      </div>
    </div>
  )

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
        {isImpersonating && <ImpersonationBanner kind="student" targetName={displayStudentNameWithNumber(user)} targetSchool={classInfo?.name} />}
        <Header user={user} onLogout={logout} />
        <main className={`mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-3 sm:space-y-4 ${
          step === 'rewrite' ? 'max-w-3xl lg:max-w-6xl' : 'max-w-3xl'
        }`}>
          {/* 💬 step634: 내 의견에 달린 운영자 답장 배너 — 안 읽은 게 있거나 펼친 상태일 때(교사 홈 step205-C 관행). 닫기 = 읽음 처리 + 숨김 */}
          {!isImpersonating && replyNotifs.length > 0 && (replyNotifs.some(r => !r.reply_read_at) || showReplies) && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-semibold text-blue-900">
                  💬 운영자 답장이 왔어요
                  {(() => {
                    const n = replyNotifs.filter(r => !r.reply_read_at).length
                    return n > 0 ? <span className="ml-1 text-blue-700">({n}건)</span> : null
                  })()}
                </p>
                {!showReplies ? (
                  <button onClick={() => setShowReplies(true)}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 flex-shrink-0">
                    📖 답장 보기
                  </button>
                ) : (
                  <button onClick={() => { setShowReplies(false); markRepliesRead() }}
                    className="text-xs text-blue-700 underline flex-shrink-0">✕ 닫기</button>
                )}
              </div>
              {showReplies && (
                <div className="mt-3 space-y-3">
                  {replyNotifs.map(r => (
                    <div key={r.id} className="bg-white rounded-lg p-3 border border-blue-100">
                      <p className="text-xs text-gray-500 mb-1">내가 보낸 의견</p>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap mb-2">{r.content}</p>
                      <p className="text-xs text-blue-700 font-medium mb-1">
                        💬 운영자 답장{r.replied_at && <span className="text-gray-400 font-normal ml-1">· {toKST(r.replied_at)}</span>}
                      </p>
                      <p className="text-sm text-blue-900 whitespace-pre-wrap bg-blue-50 rounded p-2">{r.reply_text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* step651: 자동 저장 실패 1회 안내(용량·정책) */}
          {saveWarn && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 text-sm text-amber-900 flex items-center gap-2">
              <span>⚠️ 이 기기에서는 자동 저장이 안 돼요. 글을 자주 제출해 주세요.</span>
              <button type="button" onClick={() => setSaveWarn(false)} className="ml-auto text-xs text-amber-700 hover:underline">닫기</button>
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
                    {!isImpersonating && (
                      <button onClick={() => setShowNicknameModal(true)}
                        className="text-purple-600 underline hover:text-purple-900">
                        변경
                      </button>
                    )}
                  </p>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <Link href={withImpersonation('/student/ranking')}
                  className="text-xs text-amber-700 hover:text-amber-900 px-3 py-1 rounded-full border border-amber-200 bg-amber-50">
                  🏆 랭킹
                </Link>
                {!isImpersonating && (   /* step633: 비밀번호 변경은 auth.updateUser(관리자 계정) — 엿보기에서 숨김 */
                  <button onClick={() => setShowPwModal(true)} className="text-xs text-gray-600 hover:text-primary px-3 py-1 rounded-full border border-gray-200">
                    🔐 비밀번호
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 🧩 step360: 맞춤법 퀴즈 진입 카드 (링크만, 로직 없음) */}
          <Link href={withImpersonation('/student/quiz')} className="block bg-white rounded-2xl p-4 shadow-sm hover:shadow transition">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-gray-800">🧩 맞춤법 퀴즈</div>
                <div className="text-xs text-gray-500 mt-0.5">내가 틀렸던 맞춤법으로 퀴즈를 풀어요</div>
              </div>
              <span className="text-gray-400">→</span>
            </div>
          </Link>

          {/* 🆕 선생님 코멘트 도착 알림 (미확인 코멘트가 있을 때) */}
          {unreadComments.length > 0 && (
            <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4">
              <h3 className="font-bold text-yellow-900 text-sm mb-1">
                💛 선생님이 내 글에 코멘트를 남겼어요! ({unreadComments.length}개)
              </h3>
              <div className="space-y-2 mt-2">
                {unreadComments.map(c => (
                  <Link key={c.id} href={withImpersonation('/student/history')}
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
              {/* step492: 챌린지가 있는 날은 "주제 없어요" 대신 챌린지 카드 — 빈 상태 판정은 학급 주제 기준 */}
              {challengeTopics.length === 0 && (
                <div className="bg-white rounded-2xl p-8 shadow-sm text-center">
                  <div className="text-5xl mb-3">📝</div>
                  <h2 className="text-lg font-bold mb-1">오늘은 글쓰기 주제가 없어요</h2>
                  <p className="text-sm text-gray-600">선생님께서 곧 등록해주실 거예요!</p>
                  {/* step651: 주제가 없어도 저장된 글은 열어 볼 수 있어요(복사하기) */}
                  {!isImpersonating && (
                    <button type="button" onClick={openSlots}
                      className="mt-4 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-full" title="자동으로 저장된 글을 열어요">
                      📂 저장된 글 ({slots.length})
                    </button>
                  )}
                  <Link href={withImpersonation('/student/history')} className="mt-6 inline-block text-primary text-sm hover:underline">
                    내 글 기록 보기 →
                  </Link>
                </div>
              )}

              {renderChallengeCards()}

              {/* 지난 주제 중 안 쓴 글 안내 */}
              {pendingTopics.length > 0 && (
                <div className="bg-white rounded-2xl p-5 shadow-sm">
                  <h3 className="font-bold mb-1 text-base">📚 안 쓴 글이 있어요 ({pendingTopics.length}개)</h3>
                  <p className="text-xs text-gray-600 mb-3">결석했거나 못 쓴 지난 주제예요. 지금 써도 돼요!</p>
                  <div className="space-y-2">
                    {renderPendingList()}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
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
                          onClick={() => switchTopic(t.id)}
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
                    {(() => {
                      // step481: 갈래 줄→📝 배지 승격, 글쓰기 안내→구분선 아래 박스(패턴 없으면 기존과 동일)
                      const { genreLabel, body, guide } = parseTopicDescription(todayTopic.description)
                      return (<>
                        <div className="text-xs text-primary-dark font-semibold mb-1">
                          📅 {todayTopic.date}
                          {todayTopic.date !== todayStr() && (
                            <span className="ml-2 bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">지난 주제</span>
                          )}
                          {todayTopic.source_supply_id && (
                            <span className="ml-2 bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full whitespace-nowrap">🌏 전국 글쓰기 챌린지</span>
                          )}
                          {genreLabel && (
                            <span className="ml-2 bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">📝 {genreLabel}</span>
                          )}
                        </div>
                        <h2 className="text-lg font-bold text-primary-dark mb-1">{todayTopic.title}</h2>
                        {todayTopic.source_supply_id && todayTopic.date === todayStr() && (
                          <div className="mb-1">
                            <p className="text-xs text-sky-700">🌏 전국 글쓰기 챌린지 — 잘 쓴 글은 닉네임으로 소개될 수 있어요</p>
                            <button onClick={() => openShowcase(todayTopic.source_supply_id)}
                              className="mt-0.5 text-xs text-sky-800 font-semibold underline underline-offset-2">
                              🏆 상위 글 보기
                            </button>
                          </div>
                        )}
                        {body && <p className="text-sm text-primary-dark/80 whitespace-pre-wrap">{body}</p>}
                        {guide && (
                          <div className="mt-2 pt-2 border-t border-primary/20">
                            <div className="bg-gray-50 rounded-lg p-2.5 text-sm text-gray-700 whitespace-pre-wrap">✍️ 글쓰기 안내: {guide}</div>
                          </div>
                        )}
                      </>)
                    })()}
                  </div>
                  {todayTopic.date !== todayStr() && (
                    <button onClick={() => switchTopic(null)}
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

              {/* step492: 전국 글쓰기 챌린지 카드 — 학급 주제 카드 아래 */}
              {renderChallengeCards()}

              {/* 지난 주제 글쓰기 안내 배너 — step496: 챌린지 카드 아래로 이동(학급 주제 → 챌린지 → 안 쓴 글) */}
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
                    {renderPendingList()}
                  </div>
                </div>
              )}

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
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-bold">✏️ 글쓰기</h3>
                    {/* step651: 저장 슬롯 열기 — 항상 보임(N = 이 학생의 전체 슬롯 수) */}
                    <button type="button" onClick={openSlots} disabled={isImpersonating}
                      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full" title="자동으로 저장된 글을 불러와요">
                      📂 저장된 글 ({slots.length})
                    </button>
                  </div>
                  <div className="text-xs bg-blue-50 border border-blue-200 rounded-lg p-2 text-blue-800 flex items-start gap-1.5">
                    <span>💡</span>
                    <span>본명, 주소, 전화번호, 가족 이름 같은 <strong>개인정보는 쓰지 말아주세요</strong>. AI 학습에 활용될 수 있어요.</span>
                  </div>
                  <textarea
                    value={essay}
                    onChange={e => setEssay(e.target.value)}
                    onPaste={(e) => handlePaste(e, 'essay')}
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
                  <button onClick={submitEssay} disabled={submitting || isImpersonating}
                    className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50">
                    {submitting
                      ? (gradingStage === 'spell' ? '🔍 맞춤법을 꼼꼼히 확인하고 있어요…'
                        : gradingStage === 'queue' ? '⏳ 친구들 글이 함께 줄 서 있어요. 조금만 기다려 주세요'
                        : '📝 글을 평가하고 있어요…')
                      : '제출하고 피드백 받기 →'}
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
                    <div ref={resultTopRef} className="bg-green-50 border border-green-300 rounded-2xl p-4 text-center scroll-mt-16">
                      <div className="text-3xl mb-1">🎉</div>
                      <div className="font-bold text-green-900">수정본 제출 완료!</div>
                      {feedbackBlocked ? (
                        <div className="text-sm text-green-800 mt-1">선생님께서 직접 봐주실 거예요.</div>
                      ) : (
                        <div className="text-sm text-green-800 mt-1">최종 점수: {feedbackResult.total}/{currentSub?.max_score}점</div>
                      )}
                    </div>
                  )}

                  {/* 피드백 결과 */}
                  <div ref={step === 'feedback' ? resultTopRef : null}
                    className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm space-y-4 overflow-hidden scroll-mt-16">
                    {/* 🟣 step606: AI 안전 필터 차단 글 — 점수·피드백 대신 안내 카드 1개 + 내 글(밑줄 없음). 재시도 유도 없음 */}
                    {feedbackBlocked ? (
                      <div className="space-y-3">
                        <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4">
                          <h3 className="text-sm font-bold text-purple-900 mb-1.5 flex items-center gap-1.5">
                            <span>🟣</span> AI가 이 글을 평가하지 못했어요
                          </h3>
                          <p className="text-sm text-purple-900 break-keep leading-relaxed">{STUDENT_BLOCKED_MESSAGE}</p>
                          <p className="text-xs text-purple-700 mt-2 break-keep">내 글은 잘 저장됐어요. 점수는 없지만 글이 사라진 건 아니에요.</p>
                        </div>
                        <details className="group" open>
                          <CollapseSummary title={<h4 className="text-sm font-bold flex-shrink-0">📝 내 글 보기</h4>} />
                          <div className="mt-2 bg-gray-50 rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap break-keep">{essay}</div>
                        </details>
                      </div>
                    ) : (
                    <>
                    <div className="flex justify-between items-center gap-2">
                      <h3 className="font-bold text-base">📊 피드백 결과</h3>
                      <span className="text-base sm:text-lg font-bold flex-shrink-0">{feedbackResult.total}/{currentSub?.max_score || todayTopic.rubrics.reduce((s,r)=>s+r.score,0)}점</span>
                    </div>

                    {/* 🆕 이번엔 이것 하나만 기억해요 — 발전점 첫 항목 1개 (history.js step374와 동일 카드, 두 화면 문법 통일) */}
                    {(() => {
                      const oneThing = splitFeedbackItems(feedbackResult.improve)[0]
                      if (!oneThing) return null
                      return (
                        <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
                          <h3 className="text-sm font-bold text-amber-900 mb-1.5 flex items-center gap-1.5">
                            <span>🌟</span> 이번엔 이것 하나만 기억해요
                          </h3>
                          <p className="text-lg text-amber-900 font-semibold break-keep leading-relaxed">{oneThing}</p>
                        </div>
                      )
                    })()}

                    {/* ②③④ 의견들 - 시각적으로 분리 (step365: 핵심 먼저 읽도록 상단 이동) */}
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
                    </div>

                    {/* ⑤ 내가 쓴 글 (맞춤법 표시) — step365: 기본 접힘 */}
                    <details className="group">
                      <CollapseSummary
                        title={<h4 className="text-sm font-bold flex-shrink-0">📝 내 글 보기</h4>}
                        badge={feedbackResult.corrections?.length > 0 && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full flex-shrink-0">
                            맞춤법/띄어쓰기 {feedbackResult.corrections.length}개
                          </span>
                        )}
                      />
                      <div className="mt-2">
                        {/* step601: 피크로 전용 맞춤법 검사가 보류된 글 — 배지 + 30초 폴링, done이면 밑줄 갱신·배지 제거 */}
                        {step === 'feedback' && currentSub?.id && (
                          <StrictPendingBadge
                            submissionId={currentSub.id}
                            status={currentSub.strict_status}
                            className="mb-2"
                            disabled={isImpersonating}
                            onUpdated={(corrs, status) => {
                              setCurrentSub(prev => prev ? { ...prev, strict_status: status, ...(corrs ? { corrections: corrs } : {}) } : prev)
                              if (corrs) setFeedbackResult(prev => prev ? { ...prev, corrections: corrs } : prev)
                            }}
                          />
                        )}
                        <div className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed"
                          dangerouslySetInnerHTML={{__html: applyGrammarHighlights(essay, feedbackResult.corrections)}} />
                        {feedbackResult.corrections?.length > 0 && (
                          <p className="text-xs text-gray-500 mt-2">💡 빨간 밑줄을 탭하거나 클릭하면 올바른 표기를 볼 수 있어요</p>
                        )}
                        <p className="text-[11px] text-gray-400 mt-1 leading-snug">{GRAMMAR_NOTICE_STUDENT}</p>
                      </div>
                    </details>

                    {/* ⑥ 점수 막대 + 점수 근거 — step365: 한 줄 컴팩트, 이유는 탭하면 펼침 */}
                    {Array.isArray(feedbackResult.scores) && (
                      <div className="space-y-2 overflow-hidden">
                        {feedbackResult.scores.map((s, i) => {
                          const r = todayTopic.rubrics[i] || { name: `기준 ${i+1}`, score: 25 }
                          const pct = Math.round((s / r.score) * 100)
                          const isFull = s >= r.score
                          const reason = Array.isArray(feedbackResult.rubric_reasons) ? feedbackResult.rubric_reasons[i] : null
                          const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
                          // 펼칠 내용(힌트·이유·근거 없음 안내)이 있을 때만 접힘 행
                          const hasDetail = !!(reason || r.hint || !isFull)
                          const row = (
                            <>
                              <span className={`flex-shrink-0 transition-transform group-open:rotate-90 ${hasDetail ? 'text-gray-400' : 'invisible'}`}>▶</span>
                              <span className="text-gray-800 text-sm font-semibold break-keep flex-shrink-0">
                                {r.name}
                                {isFull && <span className="ml-1 text-green-600">✓</span>}
                              </span>
                              <span className="flex-1 min-w-[40px] bg-gray-200 rounded-full h-2 overflow-hidden">
                                <span className={`${barColor} block h-full transition-all`} style={{width: pct + '%'}} />
                              </span>
                              <span className={`text-sm font-bold flex-shrink-0 ${isFull ? 'text-green-700' : 'text-gray-700'}`}>
                                {s}/{r.score}점
                              </span>
                            </>
                          )
                          if (!hasDetail) {
                            return (
                              <div key={i} className="min-w-0 bg-gray-50 rounded-lg p-3 border border-gray-100 flex items-center gap-2">
                                {row}
                              </div>
                            )
                          }
                          return (
                            <details key={i} className="group min-w-0 bg-gray-50 rounded-lg p-3 border border-gray-100">
                              <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer flex items-center gap-2 min-w-0 -mx-1 px-1 py-0.5 rounded-lg hover:bg-gray-100">
                                {row}
                              </summary>
                              <div className="mt-2 space-y-1.5">
                                {r.hint && <div className="text-xs text-gray-500 break-keep">📌 {r.hint}</div>}
                                {/* 🆕 점수 근거 (와이프 피드백: 왜 감점됐는지) */}
                                {reason ? (
                                  <p className="text-xs text-gray-700 leading-relaxed break-keep bg-white rounded p-2 border border-gray-200">
                                    <span className="font-semibold text-gray-800">💡 이유: </span>
                                    {reason}
                                  </p>
                                ) : !isFull ? (
                                  <p className="text-xs text-amber-700 leading-relaxed bg-amber-50 rounded p-2 border border-amber-200">
                                    ⚠️ 이번에는 점수 근거가 나오지 않았어요. 위의 발전점을 참고해주세요.
                                  </p>
                                ) : null}
                              </div>
                            </details>
                          )
                        })}
                      </div>
                    )}

                    {/* ⑦ 발전점 구체 예시 (와이프 피드백: 어떻게 고치면 좋을지) — 현행 유지, 위치만 이동 */}
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

                    {/* 피드백 신고 버튼 - 카드 하단에 작게 */}
                    <div className="pt-2 border-t border-gray-100 flex justify-end">
                      <button onClick={reportFeedback}
                        className={`text-xs px-3 py-1.5 rounded-full ${
                          currentSub?.reported
                            ? 'bg-amber-100 text-amber-800 cursor-default'
                            : 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                        }`}
                        disabled={currentSub?.reported || isImpersonating}   /* step633: 엿보기 차단 */
                        title="피드백이 이상하다고 느껴지면 선생님께 알릴 수 있어요"
                      >
                        {currentSub?.reported ? '🙏 신고 완료' : '🚨 이 피드백 이상해요'}
                      </button>
                    </div>
                    </>
                    )}
                  </div>

                  {/* ⑧ 예시 작품 (피드백/완료 단계 모두 표시) — step365: 기본 접힘 */}
                  {/* step627: 피크 보류(exampleDeferred)면 카드 안에 "📖 예시 작품 보기" 버튼 — 누르면 그때 생성(온디맨드) */}
                  {(exampleText || exampleLoading || exampleDeferred) && (step === 'feedback' || step === 'done') && (
                    <details className="group bg-purple-50 border border-purple-200 rounded-2xl p-5">
                      <CollapseSummary
                        tone="purple"
                        title={
                          <h3 className="font-bold text-purple-900 flex-shrink-0">
                            📖 AI 예시 작품
                            {step === 'done' && <span className="ml-2 text-xs font-normal text-purple-600">(수정본 기준)</span>}
                          </h3>
                        }
                      />
                      <div className="mt-2">
                        {exampleLoading ? (
                          <p className="text-sm text-purple-700">예시 작품을 만들고 있어요...</p>
                        ) : exampleText ? (
                          <p className="text-sm text-purple-900 whitespace-pre-wrap leading-relaxed">{exampleText}</p>
                        ) : exampleDeferred ? (
                          <div className="space-y-2">
                            <p className="text-sm text-purple-700">지금은 친구들 글이 많이 몰려서 예시 작품을 나중에 만들어요. 보고 싶으면 눌러 주세요.</p>
                            <button
                              onClick={showDeferredExample}
                              disabled={isImpersonating}
                              className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700">
                              📖 예시 작품 보기
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  )}

                  {/* 🆕 step487: 챌린지 상위 글 진입점 — 챌린지 제출 후 (step492: 내 순위 표시) */}
                  {todayTopic?.source_supply_id && (
                    <div className="space-y-1.5">
                      {challengeRankLine(challengeRanks[todayTopic.source_supply_id]) && (
                        <p className="text-center text-sm text-sky-800 font-semibold">
                          {challengeRankLine(challengeRanks[todayTopic.source_supply_id])}
                        </p>
                      )}
                      <button onClick={() => openShowcase(todayTopic.source_supply_id)}
                        className="w-full py-2.5 bg-sky-50 border border-sky-200 text-sky-800 rounded-xl text-sm font-semibold hover:bg-sky-100">
                        🏆 상위 글 보기
                      </button>
                    </div>
                  )}

                  {/* 📚 step621: 우리 반 친구들 글 — 반 주제·제출 후·0편 아님일 때만(제출 전엔 이 블록 자체가 없음) */}
                  {!todayTopic?.source_supply_id && peerShare?.topicId === todayTopic?.id && (
                    <PeerShareCard items={peerShare.items} showScore={peerShare.showScore}
                      onNotify={isImpersonating ? undefined : notifyTeacherPeer} notifiedKeys={peerNotified} />
                  )}

                  {/* 다시 쓰기 버튼 (feedback 단계에서만) — step516: 알림 직행 강조 대상. step606: 차단 글은 숨김(같은 글 재제출 유도 방지) */}
                  {step === 'feedback' && !feedbackBlocked && (
                    <button ref={rewriteBtnRef} onClick={startRewrite}
                      className={`w-full py-3 bg-white border-2 border-primary text-primary rounded-xl font-semibold hover:bg-primary-light transition-all ${
                        rewriteSpotlight ? 'ring-4 ring-amber-300 animate-pulse' : ''
                      }`}>
                      ✏️ 다시 쓰기
                    </button>
                  )}

                  {/* 🆕 step512: 수정 소진(done) 상태 — 선생님께 수정 기회 요청. 추후 알림 센터 범용 알림으로 통합 예정 */}
                  {step === 'done' && currentSub && !currentSub.extra_rewrite_allowed && (
                    currentSub.rewrite_requested_at ? (
                      <p className="w-full py-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-sm font-semibold text-center">
                        ✋ 선생님께 요청했어요. 확인해주시면 다시 쓸 수 있어요!
                      </p>
                    ) : (
                      <button onClick={requestRewriteChance} disabled={isImpersonating}
                        className="w-full py-3 bg-white border-2 border-amber-300 text-amber-800 rounded-xl font-semibold hover:bg-amber-50 disabled:opacity-50">
                        ✋ 선생님께 수정 기회 요청하기
                      </button>
                    )
                  )}
                </>
              )}

              {step === 'rewrite' && (
                <>
                  {/* 🆕 step378: 고칠 것 체크리스트 — 발전점을 체크박스로 (피드백 안 읽고 기계적으로 다시 쓰는 문제 대응).
                      체크는 화면 상태만(저장 안 함), 제출을 막지 않음. 발전점 없으면 기존 안내 배너로 폴백. */}
                  {(() => {
                    const improveText = feedbackResult?.improve || currentSub?.feedback_improve
                    const items = splitFeedbackItems(improveText)
                    if (!items.length) return (
                      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-4">
                        <h3 className="font-bold text-amber-900 mb-1">✏️ 이제 글을 더 좋게 다듬어 봐요!</h3>
                        <p className="text-sm text-amber-800 leading-relaxed break-keep">
                          아래 피드백을 잘 읽고, 특히 <strong className="text-amber-900">🌱 다음엔 이렇게 해봐요</strong>와
                          {' '}<strong className="text-amber-900">✏️ 이렇게 바꿔보면 어떨까요</strong> 부분을 참고해서 다시 써보세요.
                          <br />
                          <span className="text-xs text-amber-700 mt-1 inline-block">💡 똑같이 베끼지 말고, 자기 표현으로 바꿔서 써야 점수가 잘 나와요!</span>
                        </p>
                      </div>
                    )
                    return (
                      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-4">
                        <h3 className="font-bold text-amber-900 mb-0.5">🎯 이번에 고칠 것</h3>
                        <p className="text-xs text-amber-700 mb-2">하나씩 고치면서 체크해 보세요.</p>
                        <div className="space-y-1.5">
                          {items.map((item, i) => {
                            const done = !!rewriteChecks[i]
                            const m = item.match(/^[^.?!]*[.?!]/)
                            const first = m ? m[0].trim() : item
                            const rest = m ? item.slice(m[0].length).trim() : ''
                            return (
                              <label key={i} className="flex items-start gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-amber-100/60 transition">
                                <input type="checkbox" checked={done}
                                  onChange={() => setRewriteChecks(prev => ({ ...prev, [i]: !prev[i] }))}
                                  className="mt-0.5 w-4 h-4 accent-amber-600 flex-shrink-0" />
                                <span className="min-w-0">
                                  <span className={`text-sm font-semibold break-keep leading-relaxed transition ${done ? 'line-through text-amber-400' : 'text-amber-900'}`}>{first}</span>
                                  {rest && <span className={`block text-xs break-keep leading-relaxed transition ${done ? 'line-through text-amber-300' : 'text-amber-700'}`}>{rest}</span>}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                        <p className="text-xs text-amber-700 mt-2">💡 똑같이 베끼지 말고, 자기 표현으로 바꿔서 써야 점수가 잘 나와요!</p>
                      </div>
                    )
                  })()}

                  {/* 첫 글 피드백 카드 (전체 폭) — 🆕 기본 접힘: 첫 글 전문이 아래 "처음 쓴 글" 칼럼과 중복이라 상단은 접어둠 */}
                  <details className="group bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <CollapseSummary title={<h3 className="font-bold text-sm flex-shrink-0">📋 처음 쓴 글 피드백 다시 보기 (참고용)</h3>} />
                    <div className="mt-3">
                      <StudentFeedbackCard
                        sub={currentSub || { ...feedbackResult, essay_text: essay, total_score: feedbackResult?.total, max_score: todayTopic?.rubrics?.reduce((s,r)=>s+r.score,0) || 100, rubric_reasons: feedbackResult?.rubric_reasons, improve_examples: feedbackResult?.improve_examples, feedback_overall: feedbackResult?.overall, feedback_good: feedbackResult?.good, feedback_improve: feedbackResult?.improve, corrections: feedbackResult?.corrections, scores: feedbackResult?.scores }}
                        topic={todayTopic}
                        headerLabel={null}
                      />
                    </div>
                  </details>

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
                        {/* step651: 저장 슬롯 열기(수정본 화면) */}
                        <button type="button" onClick={openSlots} disabled={isImpersonating}
                          className="ml-auto text-xs font-normal bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded-full" title="자동으로 저장된 글을 불러와요">
                          📂 저장된 글 ({slots.length})
                        </button>
                      </h3>
                      <textarea
                        value={rewriteEssay}
                        onChange={e => setRewriteEssay(e.target.value)}
                        onPaste={(e) => handlePaste(e, 'rewrite')}
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
                        <button onClick={submitRewrite} disabled={rewriting || isImpersonating}
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
                  {/* step644: 피크로 보류된 예시(exampleDeferred)면 수정 중에도 "📖 예시 작품 보기"로 요청 가능 — 피드백 화면 온디맨드 핸들러 재사용 */}
                  {(exampleText || exampleLoading || exampleDeferred) && (
                    <div className="bg-purple-50 border border-purple-200 rounded-2xl p-5">
                      <h3 className="font-bold text-purple-900 mb-2 text-sm">📖 AI 예시 작품 (참고만)</h3>
                      <p className="text-xs text-purple-700 mb-2">⚠️ 베끼지 마세요! 어떻게 쓰는지만 참고하고 자기 글로 새로 써야 해요.</p>
                      {exampleLoading ? (
                        <p className="text-sm text-purple-700">예시 작품을 만들고 있어요...</p>
                      ) : exampleText ? (
                        <p className="text-sm text-purple-900 whitespace-pre-wrap leading-relaxed break-keep">{exampleText}</p>
                      ) : exampleDeferred ? (
                        <div className="space-y-2">
                          <p className="text-sm text-purple-700">지금은 친구들 글이 많이 몰려서 예시 작품을 나중에 만들어요. 보고 싶으면 눌러 주세요.</p>
                          <button
                            onClick={showDeferredExample}
                            disabled={isImpersonating}
                            className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold hover:bg-purple-700">
                            📖 예시 작품 보기
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* 내 글 기록 링크 */}
          <div className="text-center pt-4">
            <Link href={withImpersonation('/student/history')} className="text-sm text-gray-600 hover:text-primary">
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
        {/* 🆕 step487: 챌린지 상위 글 모달 — approved만 본문, pending·신고분은 소문구 */}
        {showcaseModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-5 max-w-md w-full shadow-xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold">🏆 오늘의 챌린지 상위 글</h3>
                <button onClick={() => setShowcaseModal(null)} aria-label="닫기"
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
              {showcaseModal.loading ? (
                <p className="text-sm text-gray-500 py-6 text-center">불러오는 중...</p>
              ) : (
                <>
                  {challengeRankLine({ rank: showcaseModal.myRank, total: showcaseModal.rankedPool }) && (
                    <p className="text-sm text-sky-800 font-semibold mb-3">
                      {challengeRankLine({ rank: showcaseModal.myRank, total: showcaseModal.rankedPool })}
                    </p>
                  )}
                  {(showcaseModal.winners || []).length === 0 ? (
                    <p className="text-sm text-gray-500 py-4 text-center">아직 소개할 글이 없어요. 조금 뒤에 다시 봐요!</p>
                  ) : (
                    <div className="space-y-3">
                      {showcaseModal.winners.map(w => {
                        const medal = w.rank === 1 ? '🥇' : w.rank === 2 ? '🥈' : '🥉'
                        const meta = [w.school, w.grade ? `${w.grade}학년` : '', w.className].filter(Boolean).join(' ')
                        return (
                          <div key={w.showcaseId} className="border border-gray-200 rounded-xl p-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xl">{medal}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-gray-900">{w.nickname}</p>
                                {meta && <p className="text-xs text-gray-500">{meta}</p>}
                              </div>
                              <span className="text-sm font-bold text-primary shrink-0">{w.score}점</span>
                            </div>
                            {w.essay ? (
                              <details className="mt-2">
                                <summary className="text-xs text-sky-700 font-semibold cursor-pointer select-none">📖 글 읽기</summary>
                                <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{w.essay}</p>
                                <button onClick={() => reportShowcase(w)} disabled={isImpersonating}
                                  className="mt-2 text-xs text-red-500 underline underline-offset-2 disabled:opacity-50">🚨 이 글 신고하기</button>
                              </details>
                            ) : (
                              <p className="mt-2 text-xs text-gray-400">
                                {w.reportedByMe ? '🙏 신고했어요. 확인 후 조치할게요.' : w.pending ? '🔍 아직 검토 중인 글이에요' : '확인을 거친 글만 보여요'}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-gray-400 mt-3">학부모 동의가 완료된 친구들의 글만 소개돼요. 잘 쓴 글은 확인을 거쳐 닉네임으로 나와요.</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* 📂 step651: 저장된 글(슬롯) 모달 — 목록(주제·시각·글자 수·첫 60자) → 미리보기 → 불러오기(같은 주제·단계) / 복사하기 */}
        {slotModal && (() => {
          const list = sortForList(slots)
          const sel = slotModal.selected ? list.find(s => s.id === slotModal.selected) || null : null
          const timeOf = (ms) => { try { return toKST(new Date(ms).toISOString()) } catch (e) { return '' } }
          return (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setSlotModal(null)}>
              <div className="bg-white rounded-2xl p-5 max-w-lg w-full shadow-xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-bold">📂 저장된 글 ({list.length})</h3>
                  <button type="button" onClick={() => setSlotModal(null)} className="text-gray-400 hover:text-gray-700 text-sm">✕ 닫기</button>
                </div>
                <p className="text-xs text-gray-500 mb-3">쓰는 동안 자동으로 저장된 글이에요. 글자 수가 많이 바뀌거나 3분이 지나면 새로 저장돼요.</p>
                {!sel ? (
                  list.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-400">아직 저장된 글이 없어요</div>
                  ) : (
                    <div className="space-y-2 overflow-auto">
                      {list.map(s => (
                        <button key={s.id} type="button" onClick={() => setSlotModal({ selected: s.id })}
                          className="w-full text-left p-3 rounded-xl border border-gray-200 hover:bg-gray-50">
                          <div className="text-sm font-semibold text-gray-900 truncate">{slotTitle(s.topicId)} <span className="text-xs font-normal text-gray-500">· {s.phase === 'rewrite' ? '수정본' : '첫 글'}</span></div>
                          <div className="text-[11px] text-gray-500">{timeOf(s.savedAt)} · {s.chars}자</div>
                          <div className="text-xs text-gray-700 mt-1 break-keep">{previewOf(s.text)}</div>
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="flex flex-col min-h-0">
                    <div className="text-sm font-semibold text-gray-900">{slotTitle(sel.topicId)} <span className="text-xs font-normal text-gray-500">· {sel.phase === 'rewrite' ? '수정본' : '첫 글'} · {timeOf(sel.savedAt)} · {sel.chars}자</span></div>
                    <div className="mt-2 p-3 border border-gray-200 rounded-xl bg-gray-50 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed overflow-auto max-h-[45vh]">{sel.text}</div>
                    {!canLoadSlot(sel) && (
                      <p className="text-xs text-gray-500 mt-2">{todayTopic && sel.topicId === todayTopic.id ? '지금 단계와 달라서 복사해서 붙여 넣어 주세요.' : '다른 주제의 글이라 복사해서 붙여 넣어 주세요.'}</p>
                    )}
                    <div className="flex gap-2 justify-end mt-3">
                      <button type="button" onClick={() => setSlotModal({ selected: null })} className="px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">← 목록</button>
                      <button type="button" onClick={() => copySlot(sel)} className="px-3 py-2 rounded-lg text-sm bg-gray-100 hover:bg-gray-200 text-gray-800">📋 복사하기</button>
                      {canLoadSlot(sel) && (
                        <button type="button" onClick={() => loadSlotIntoEditor(sel)} disabled={isImpersonating}
                          className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white hover:opacity-90 disabled:opacity-40">
                          ✍️ 이 글 불러오기
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}
        {/* 🚨 step649: 신고 사유 칩 모달 — 5개 중 1개 필수, 선택 입력 40자. 저장은 "[태그] 상세" 문자열(SQL 없음) */}
        {reportModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => !reportModal.busy && setReportModal(null)}>
            <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-1">🚨 이 피드백 이상해요</h3>
              <p className="text-sm text-gray-600 mb-3">어떤 점이 이상한지 하나만 골라 주세요. 선생님께서 확인하고 도와주실 거예요.</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {REPORT_TAGS.map(t => (
                  <button key={t.key} type="button" onClick={() => setReportModal(m => ({ ...m, tag: t.label }))}
                    className={`text-sm px-3 py-1.5 rounded-full border transition ${reportModal.tag === t.label
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-red-50'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={reportModal.detail}
                onChange={e => setReportModal(m => ({ ...m, detail: e.target.value.slice(0, REPORT_DETAIL_MAX) }))}
                maxLength={REPORT_DETAIL_MAX}
                placeholder="조금 더 적고 싶으면 여기에 (선택, 40자까지)"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 mb-1"
              />
              <div className="text-right text-[11px] text-gray-400 mb-3">{reportModal.detail.length}/{REPORT_DETAIL_MAX}</div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setReportModal(null)} disabled={reportModal.busy}
                  className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">취소</button>
                <button type="button" onClick={submitReport} disabled={!reportModal.tag || reportModal.busy || isImpersonating}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
                  {reportModal.busy ? '보내는 중...' : '신고하기'}
                </button>
              </div>
            </div>
          </div>
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
        {!isImpersonating && <StudentTutorial />}   {/* step633: 튜토리얼은 localStorage 기록 — 엿보기 미렌더 */}

        {/* 🆕 AI 글쓰기 도우미 (교사가 켰을 때 + 글쓰기 단계에서만) — step633: 엿보기 미렌더(AI 호출·tutor_chat_usage 쓰기) */}
        {!isImpersonating && classInfo?.tutor_chat_enabled && (step === 'write' || step === 'rewrite') && todayTopic && (
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
