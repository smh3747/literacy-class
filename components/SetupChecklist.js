// ============================================
// 선생님 첫 셋업 체크리스트 카드
// ============================================
// 신규 선생님이 첫 수업까지 가는 4단계 안내:
// 1. 학급 만들기 (가입 시 자동)
// 2. API 키 등록
// 3. 학생 등록
// 4. 첫 주제 만들기
//
// 모든 단계 완료되면 자동 숨김 (localStorage로 "다시 안 보기"도 가능)
// ============================================
import { useState } from 'react'
import Link from 'next/link'

const HIDE_KEY = 'lc-setup-checklist-hidden'

export default function SetupChecklist({ classInfo, hasApiKey, studentCount, topicCount, hasLoginHint, onScrollToApi, onScrollToLoginHint }) {
  const [hidden, setHidden] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false }
  })

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
      action: {
        type: 'scroll',
        text: hasApiKey ? '관리하기' : '🔑 지금 등록하기',
        onClick: onScrollToApi
      },
      help: { href: '/api-key-guide', text: '발급 방법 보기' }
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

  // 모든 단계 완료되면 작은 축하 카드만 + "닫기"
  if (allDone) {
    return (
      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-green-900 text-sm">🎉 첫 셋업 완료!</h3>
          <p className="text-xs text-green-700 mt-0.5">모든 준비가 끝났어요. 학생들이 글을 쓸 수 있어요.</p>
        </div>
        <button
          onClick={() => {
            setHidden(true)
            try { localStorage.setItem(HIDE_KEY, '1') } catch {}
          }}
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
            {doneCount} / {steps.length} 단계 완료 — 학생들이 글을 쓰려면 모든 단계가 필요해요
          </p>
        </div>
        <button
          onClick={() => {
            if (!confirm('이 안내를 다시 보지 않을까요?\n(설정에서 다시 켤 수 있어요)')) return
            setHidden(true)
            try { localStorage.setItem(HIDE_KEY, '1') } catch {}
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

      {/* 단계 목록 */}
      <div className="space-y-2">
        {steps.map((s, idx) => (
          <div
            key={s.id}
            className={`bg-white rounded-lg p-3 border ${s.done ? 'border-green-200' : 'border-gray-200'} flex items-center gap-3 flex-wrap`}>
            {/* 상태 표시 */}
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
              s.done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {s.done ? '✓' : idx + 1}
            </div>

            <div className="flex-1 min-w-0">
              <div className={`font-semibold text-sm ${s.done ? 'text-gray-600' : 'text-gray-900'}`}>
                {s.label}
              </div>
              {s.detail && (
                <div className={`text-xs ${s.done ? 'text-gray-500' : 'text-gray-600'} mt-0.5`}>
                  {s.detail}
                </div>
              )}
            </div>

            {/* 액션 버튼 */}
            {s.action && !s.done && (
              <div className="flex items-center gap-2">
                {s.help && (
                  <Link href={s.help.href} target="_blank" className="text-xs text-blue-600 hover:underline">
                    {s.help.text}
                  </Link>
                )}
                {s.action.type === 'link' ? (
                  <Link
                    href={s.action.href}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700">
                    {s.action.text}
                  </Link>
                ) : (
                  <button
                    onClick={s.action.onClick}
                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700">
                    {s.action.text}
                  </button>
                )}
              </div>
            )}
            {s.action && s.done && (
              <div className="flex items-center gap-2">
                {s.action.type === 'link' && (
                  <Link
                    href={s.action.href}
                    className="text-xs px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded hover:bg-gray-50">
                    {s.action.text}
                  </Link>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
