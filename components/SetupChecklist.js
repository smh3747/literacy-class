// ============================================
// 선생님 첫 셋업 체크리스트 카드
// ============================================
// 신규 선생님이 첫 수업까지 가는 4단계 안내:
// 1. 학급 만들기 (가입 시 자동)
// 2. API 키 등록
// 3. 학생 등록
// 4. 첫 주제 만들기
//
// 완료 판정은 전부 실데이터(props: 학급/API키/학생수/주제수/로그인안내)에서 도출 → 계정마다 자동으로 맞게 뜸.
// "숨김/닫기"만 데이터로 못 푸는 플래그라 localStorage에 저장하되, 키를 교사 user-id로 분리한다.
//   (전엔 브라우저 공용 키여서 한 계정이 닫으면 같은 브라우저의 다른 계정도 사라지던 버그 — school-banner와 동일 패턴으로 수정)
// ============================================
import { useState, useEffect } from 'react'
import Link from 'next/link'

// 교사별 숨김 키 — teacherId 없으면 null(저장/복원 안 함, 항상 표시)
const hideKeyFor = (teacherId) => teacherId ? `lc-setup-checklist-hidden:${teacherId}` : null

export default function SetupChecklist({ classInfo, teacherId, hasApiKey, studentCount, topicCount, hasLoginHint, onScrollToApi, onScrollToLoginHint }) {
  const [hidden, setHidden] = useState(false)

  // teacherId 준비되면 그 교사의 키로 숨김 여부를 읽는다(계정 섞임 방지)
  useEffect(() => {
    const key = hideKeyFor(teacherId)
    if (!key) { setHidden(false); return }
    try { setHidden(localStorage.getItem(key) === '1') } catch { setHidden(false) }
  }, [teacherId])

  // 숨김 처리 — 현재 교사의 키에만 기록
  const dismiss = () => {
    setHidden(true)
    const key = hideKeyFor(teacherId)
    if (key) { try { localStorage.setItem(key, '1') } catch {} }
  }

  if (hidden) return null

  // 학급이 없으면 아예 안 보임 (그건 더 큰 문제, 다른 안내가 필요)
  if (!classInfo) return null

  const steps = [
    {
      id: 'class',
      label: '학급 만들기',
      done: !!classInfo,
      detail: classInfo ? `${classInfo.name} (코드: ${classInfo.code})` : null,
      action: null
    },
    {
      id: 'api',
      label: 'Gemini API 키 등록',
      done: !!hasApiKey,
      detail: hasApiKey ? '등록 완료' : 'AI 채점·피드백을 받으려면 필요해요',
      // 미등록: 가이드 페이지(발급설명+임베드 입력칸 원스톱)로 보냄 (메인 버튼이 가이드라 help 중복 제거)
      // 등록 완료: 기존대로 대시보드 카드로 스크롤(관리) + help 유지
      action: hasApiKey
        ? { type: 'scroll', text: '관리하기', onClick: onScrollToApi }
        : { type: 'link', href: '/api-key-guide', text: '🔑 키 발급받고 등록하기 (5분)' },
      help: hasApiKey ? { href: '/api-key-guide', text: '발급 방법 보기' } : null
    },
    {
      id: 'students',
      label: '학생 등록',
      done: studentCount > 0,
      detail: studentCount > 0 ? `${studentCount}명 등록됨` : '나이스 명렬표 엑셀로 한 번에',
      action: {
        type: 'link',
        href: '/teacher/students',
        text: studentCount > 0 ? '학생 관리' : '👥 지금 등록하기'
      }
    },
    {
      id: 'login-hint',
      label: '학생 로그인 안내 설정',
      done: !!hasLoginHint,
      detail: hasLoginHint
        ? '학생 아이디 자동 안내 사용 중'
        : '학생들이 "내 아이디 뭐예요?" 안 묻게 만들기',
      action: {
        type: 'scroll',
        text: hasLoginHint ? '안내 확인' : '📋 지금 설정하기',
        onClick: onScrollToLoginHint
      }
    },
    {
      id: 'topic',
      label: '첫 주제 만들기',
      done: topicCount > 0,
      detail: topicCount > 0 ? `${topicCount}개 주제 생성됨` : 'AI 추천으로 빠르게 만들 수 있어요',
      action: {
        type: 'link',
        href: '/teacher/topics',
        text: topicCount > 0 ? '주제 관리' : '📝 지금 만들기'
      }
    }
  ]

  const doneCount = steps.filter(s => s.done).length
  const allDone = doneCount === steps.length
  // 🆕 다음 할 일 하나 = 미완료 중 순서상 첫 단계 (allDone이면 undefined)
  const nextStep = steps.find(s => !s.done)

  // 모든 단계 완료되면 작은 축하 카드만 + "닫기"
  if (allDone) {
    return (
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-green-900 text-sm">🎉 첫 셋업 완료!</h3>
          <p className="text-xs text-green-700 mt-0.5">모든 준비가 끝났어요. 학생들이 글을 쓸 수 있어요.</p>
        </div>
        <button
          onClick={dismiss}
          className="text-xs text-green-700 hover:bg-green-100 px-3 py-1.5 rounded">
          ✖ 이 안내 닫기
        </button>
      </div>
    )
  }

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-blue-900">🎯 첫 셋업 체크리스트</h3>
          <p className="text-xs text-blue-700 mt-1">
            {doneCount} / {steps.length} 단계 완료. 아래 &lsquo;지금 할 일&rsquo;부터 하나씩 하면 돼요.
          </p>
        </div>
        <button
          onClick={() => {
            if (!confirm('이 안내를 다시 보지 않을까요?\n(설정에서 다시 켤 수 있어요)')) return
            dismiss()
          }}
          className="text-xs text-blue-600 hover:bg-blue-100 px-2 py-1 rounded"
          title="이 안내 숨기기">
          ✖ 닫기
        </button>
      </div>

      {/* 진행률 막대 */}
      <div className="h-2 bg-white rounded-full overflow-hidden border border-blue-200">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
          style={{ width: `${(doneCount / steps.length) * 100}%` }}
        />
      </div>

      {/* ⭐ 다음 할 일 하나 — 크게 강조 */}
      {nextStep && (
        <div className="bg-white rounded-xl p-4 border-2 border-blue-400 shadow-sm">
          <div className="text-[11px] font-bold text-blue-600 tracking-wide">👉 지금 할 일</div>
          <div className="font-bold text-lg text-gray-900 mt-1">{nextStep.label}</div>
          {nextStep.detail && (
            <div className="text-sm text-gray-600 mt-1">{nextStep.detail}</div>
          )}
          {nextStep.action && (
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {nextStep.action.type === 'link' ? (
                <Link
                  href={nextStep.action.href}
                  className="inline-block px-4 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700">
                  {nextStep.action.text}
                </Link>
              ) : (
                <button
                  onClick={nextStep.action.onClick}
                  className="px-4 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700">
                  {nextStep.action.text}
                </button>
              )}
              {nextStep.help && (
                <Link href={nextStep.help.href} target="_blank" className="text-xs text-blue-600 hover:underline">
                  {nextStep.help.text}
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* 나머지 단계 — 완료 ✓(비클릭) / 미완료는 눌러서 바로 이동(A안). action은 기존 것 그대로 재사용 */}
      <div className="space-y-1.5">
        {steps.map((s, idx) => {
          if (s === nextStep) return null
          const badge = (
            <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
              s.done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {s.done ? '✓' : idx + 1}
            </span>
          )
          // 완료 줄 — 지금 그대로(비클릭)
          if (s.done) {
            return (
              <div key={s.id} className="flex items-center gap-2 text-sm px-1">
                {badge}
                <span className="flex-shrink-0 text-gray-500">{s.label}</span>
                {s.detail && (
                  <span className="text-xs text-gray-400 truncate hidden sm:inline">· {s.detail}</span>
                )}
              </div>
            )
          }
          // 미완료 줄 — 해당 step.action으로 바로 이동(클릭 가능). 강조는 위 큰 카드가 담당
          const rowClass = 'flex items-center gap-2 text-sm px-1 rounded cursor-pointer hover:bg-gray-50 transition'
          const inner = (
            <>
              {badge}
              <span className="text-gray-700">{s.label}</span>
              <span className="ml-auto text-gray-300 text-xs" aria-hidden="true">→</span>
            </>
          )
          if (s.action?.type === 'link') {
            return <Link key={s.id} href={s.action.href} className={rowClass}>{inner}</Link>
          }
          if (s.action?.type === 'scroll') {
            return <button key={s.id} type="button" onClick={s.action.onClick} className={`${rowClass} w-full text-left`}>{inner}</button>
          }
          // action 없으면(이론상 없음) 비클릭 표시
          return (
            <div key={s.id} className="flex items-center gap-2 text-sm px-1">
              {badge}
              <span className="text-gray-500">{s.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
