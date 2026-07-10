import useGrammarTooltip from '../lib/useGrammarTooltip'
import { toKST } from '../lib/timeFormat'
import { splitFeedbackItems } from '../lib/feedbackFormat'
import { findOriginalRange } from '../lib/koreanRules'
import { GRAMMAR_NOTICE_STUDENT } from '../lib/notices'
import { stampLabel } from '../lib/stamps'
import { pickStr } from '../lib/pickStr'
import { escapeHtml } from '../lib/escapeHtml'


// 🛡️ AI corrections 오탐 필터 + 중복 제거 + 실제 표시 가능한 것만
// 와이프 피드백: "맞춤법 2개 밑줄인데 카운트는 3개" 문제 해결
// 핵심: 카운트와 실제 밑줄 수가 항상 일치해야 함
// → 필터 통과 = 실제로 본문에 밑줄을 그릴 수 있는 것만
export function filterValidCorrections(essayText, corrections) {
  if (!essayText || !Array.isArray(corrections)) return []
  const seen = new Set()
  // 본문에서 이미 다른 correction이 차지한 구간을 추적 (start, end)
  const claimed = []
  const valid = []

  for (const c of corrections) {
    // step427: 비문자열 실데이터 방어(pickStr) — 깨진 항목은 아래 !original에서 조용히 제외
    const original = pickStr(c.original, c.error, c.wrong)
    const correction = pickStr(c.correction, c.fixed, c.suggestion)
    const reason = pickStr(c.reason, c.type, c.category).toLowerCase()

    if (!original) continue
    if (reason.includes('마침표') || reason.includes('문장 끝') || reason.includes('온점') || reason.includes('찍어')) {
      if (/[.!?。]$/.test(original)) continue
    }
    if (original === correction) continue

    // 중복 제거 키 (original + correction)
    const key = `${original}::${correction}`
    if (seen.has(key)) continue

    // 🆕 본문에서 다른 claimed 구간과 안 겹치는 자리를 찾을 수 있는지 검사
    // applyGrammarHighlights와 같은 로직: 정확 일치 우선(겹침 회피), 없으면 공백 허용 매칭
    let placedStart = -1
    let placedEnd = -1
    let from = 0
    while (true) {
      const idx = essayText.indexOf(original, from)
      if (idx === -1) break
      const end = idx + original.length
      const overlaps = claimed.some(([s, e]) => idx < e && end > s)
      if (!overlaps) {
        placedStart = idx
        placedEnd = end
        break
      }
      from = idx + 1
    }
    // 🆕 정확 일치로 못 잡으면 공백 허용 매칭 (공백 차이로 멀쩡한 교정이 개수에서 빠지던 것 복구)
    if (placedStart === -1) {
      const range = findOriginalRange(essayText, original)
      if (range && !range.exact) {
        const overlaps = claimed.some(([s, e]) => range.start < e && range.end > s)
        if (!overlaps) { placedStart = range.start; placedEnd = range.end }
      }
    }
    // 자리 못 찾으면 실제 화면에 밑줄 안 그려지므로 카운트에서도 제외
    if (placedStart === -1) continue

    claimed.push([placedStart, placedEnd])
    seen.add(key)
    valid.push(c)
  }
  return valid
}

// 글에 맞춤법 빨간 밑줄 적용
export function applyGrammarHighlights(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections || corrections.length === 0) return escapeHtml(essayText).replace(/\n/g, '<br>')

  const filtered = filterValidCorrections(essayText, corrections)
  if (filtered.length === 0) return escapeHtml(essayText).replace(/\n/g, '<br>')

  const matches = []
  filtered.forEach(c => {
    const original = pickStr(c.original, c.error, c.wrong)      // step427: 비문자열 방어
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
    // 🆕 정확 일치 실패 시 공백 허용 매칭 (위치 불확실하면 긋지 않음)
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

/**
 * 학생 피드백 카드
 * @param {object} sub - submission
 * @param {object} topic - 주제 정보
 * @param {string} headerLabel
 * @param {object} previousSub - 이전 시도(첫 글) 비교용 (선택, 수정본일 때)
 */
export default function StudentFeedbackCard({ sub, topic, headerLabel, previousSub }) {
  useGrammarTooltip()

  if (!sub) return null

  const rubrics = topic?.rubrics || sub.rubrics || []
  const scores = sub.rubric_scores || sub.scores || []
  const reasons = Array.isArray(sub.rubric_reasons) ? sub.rubric_reasons : []
  const improveExamples = Array.isArray(sub.improve_examples) ? sub.improve_examples : []
  const corrections = filterValidCorrections(sub.essay_text, sub.corrections || [])
  const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0) || sub.max_score || 100

  // 🆕 점수 향상 계산 (수정본일 때만)
  const scoreImproved = previousSub
    && typeof previousSub.total_score === 'number'
    && typeof sub.total_score === 'number'
    && sub.total_score > previousSub.total_score
  const scoreDelta = scoreImproved ? (sub.total_score - previousSub.total_score) : 0

  // 점수에 따른 색상 (낮을수록 빨강 계열)
  const scorePercent = totalMax > 0 ? (sub.total_score / totalMax) * 100 : 0
  const scoreColor = scorePercent >= 80 ? 'from-green-50 to-emerald-50 border-green-200'
                  : scorePercent >= 60 ? 'from-blue-50 to-indigo-50 border-blue-200'
                  : 'from-amber-50 to-orange-50 border-amber-200'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-5 h-full min-w-0 overflow-hidden">
      {headerLabel && (
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-primary">{headerLabel}</h3>
          <span className="text-xs text-gray-500">{toKST(sub.created_at)}</span>
        </div>
      )}

      {/* 점수 (색 강화 + 점수 향상 배지) */}
      {/* 🆕 step436: 선생님 조정 점수(teacher_score) 있으면 대표로, AI 점수는 작게 병기(병기형 — AI 점수 불변) */}
      <div className={`bg-gradient-to-br ${scoreColor} border-2 rounded-xl p-4 text-center`}>
        <div className="text-3xl font-bold text-gray-900">
          {sub.teacher_score ?? sub.total_score ?? 0} <span className="text-lg font-normal text-gray-600">/ {totalMax}점</span>
        </div>
        {sub.teacher_score != null && (
          <div className="mt-1.5">
            <span className="inline-flex items-center gap-1 bg-white text-blue-700 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-blue-200">
              ✔ 선생님이 확인한 점수
            </span>
            <div className="text-[11px] text-gray-400 mt-1">AI 채점 {sub.total_score ?? 0}점</div>
          </div>
        )}
        {scoreImproved && (
          <div className="mt-2 inline-flex items-center gap-1 bg-white text-green-700 px-3 py-1 rounded-full text-sm font-semibold border border-green-200">
            🎉 처음 글보다 +{scoreDelta}점 올랐어요!
          </div>
        )}
        <div className="text-[11px] text-gray-500 mt-1.5">
          {sub.re_graded_at ? (
            <>🔄 재평가 {toKST(sub.re_graded_at)}</>
          ) : (
            <>🤖 AI 채점 {toKST(sub.created_at)}</>
          )}
        </div>
      </div>

      {/* 📝 학생 글 — 맨 위로 (글을 먼저 보이게) */}
      <div>
        <h4 className="text-sm font-bold text-gray-800 mb-2">📝 내 글{corrections.length > 0 ? ` (빨간 밑줄에 마우스 올려보세요)` : ''}</h4>
        <div
          className="bg-gray-50 rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap border border-gray-200"
          style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
          dangerouslySetInnerHTML={{ __html: applyGrammarHighlights(sub.essay_text, corrections) }}
        />
        {sub.paste_detected && (
          <p className="text-xs text-red-600 mt-1">
            ⚠️ 붙여넣기 {sub.paste_count || 1}회 감지됨
          </p>
        )}
      </div>

      {/* 🆕 담임 선생님 코멘트 (글 다음 강조) */}
      {sub.teacher_comment && (
        <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-1 mb-2">
            <h4 className="text-sm font-bold text-yellow-900 flex items-center gap-1.5">
              💛 선생님이 직접 남긴 코멘트
            </h4>
            {sub.teacher_comment_at && (
              <span className="text-[11px] text-yellow-700">
                {new Date(sub.teacher_comment_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <p className="text-sm text-yellow-900 whitespace-pre-wrap leading-relaxed break-keep">
            {sub.teacher_comment}
          </p>
        </div>
      )}

      {/* 🆕 담임 확인 도장 (코멘트와 별개로 표시) */}
      {stampLabel(sub.teacher_stamp) && (
        <div className="text-sm">
          <span className="inline-flex items-center gap-1 bg-primary-light text-primary-dark font-semibold px-3 py-1.5 rounded-full">
            선생님 도장: {stampLabel(sub.teacher_stamp)}
          </span>
        </div>
      )}

      {/* 🤖 AI 점수·피드백 — 기본 접힘 (글·코멘트 먼저) */}
      <details className="group">
        <summary className="cursor-pointer text-sm font-semibold text-gray-700 hover:text-gray-900 flex items-center gap-1 py-2 px-2 bg-gray-50 rounded-lg select-none list-none">
          <span className="inline-block transition-transform group-open:rotate-90 motion-safe:animate-bounce group-open:animate-none">▶</span>
          🤖 AI 점수·피드백 보기
          <span className="group-open:hidden text-xs font-normal text-amber-600">👆 눌러서 펼쳐보세요</span>
          <span className="ml-auto font-bold text-gray-900">{sub.teacher_score ?? sub.total_score ?? 0}/{totalMax}점</span>
        </summary>
        <div className="space-y-4 mt-3">

      {/* 종합 의견 — AI 피드백 */}
      {sub.feedback_overall && (
        <div className="bg-blue-50 border-l-4 border-blue-400 rounded-r-lg p-4">
          <h4 className="text-sm font-bold text-blue-900 mb-2 flex items-center gap-1">
            💬 AI 종합 의견
          </h4>
          <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-wrap break-keep">
            {sub.feedback_overall}
          </p>
        </div>
      )}

      {/* 항목별 점수 + 점수 근거 (강화) */}
      {rubrics.length > 0 && scores.length > 0 && (
        <div>
          <h4 className="text-sm font-bold text-gray-800 mb-2">📊 항목별 점수와 이유</h4>
          <div className="space-y-2.5">
            {rubrics.map((r, i) => {
              const reason = reasons[i]
              const score = scores[i] ?? 0
              const max = r.score || 25
              const pct = max > 0 ? (score / max) * 100 : 0
              const isFull = score >= max
              const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-500'
              return (
                <div key={i} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <span className="font-semibold text-gray-800">
                      {r.name}
                      {isFull && <span className="ml-1 text-green-600">✓</span>}
                    </span>
                    <span className={`font-bold ${isFull ? 'text-green-700' : 'text-gray-700'}`}>
                      {score} / {max}점
                    </span>
                  </div>
                  {/* 점수 막대 */}
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                    <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }}></div>
                  </div>
                  {reason && (
                    <p className="text-xs text-gray-700 leading-relaxed break-keep bg-white rounded p-2 border border-gray-100">
                      <span className="font-semibold text-gray-800">💡 이유: </span>
                      {reason}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 잘한 점 */}
      {sub.feedback_good && (
        <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
          <h4 className="text-sm font-bold text-green-900 mb-2 flex items-center gap-1">
            ⭐ 잘한 점
          </h4>
          {(() => {
            const items = splitFeedbackItems(sub.feedback_good)
            if (items.length <= 1) return <p className="text-sm text-green-900 whitespace-pre-wrap leading-relaxed break-keep">{items[0] || sub.feedback_good}</p>
            return (
              <ul className="space-y-2.5">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-green-900">
                    <span className="flex-shrink-0 text-green-600 font-bold">★</span>
                    <span className="flex-1 break-keep leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>
      )}

      {/* 발전시킬 점 */}
      {sub.feedback_improve && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
          <h4 className="text-sm font-bold text-amber-900 mb-2 flex items-center gap-1">
            🌱 다음엔 이렇게 해봐요
          </h4>
          {(() => {
            const items = splitFeedbackItems(sub.feedback_improve)
            if (items.length <= 1) return <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed break-keep">{items[0] || sub.feedback_improve}</p>
            return (
              <ul className="space-y-2.5">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-amber-900">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-xs font-bold">{i + 1}</span>
                    <span className="flex-1 break-keep leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>
      )}

      {/* 🆕 발전점 구체 예시 — 학생이 어떻게 고치면 좋을지 직접 보여주기 */}
      {improveExamples.length > 0 && (
        <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4">
          <h4 className="text-sm font-bold text-purple-900 mb-2 flex items-center gap-1">
            ✏️ 이렇게 바꿔보면 어떨까요?
          </h4>
          <p className="text-xs text-purple-700 mb-3">아래는 예시예요. 똑같이 쓰지 말고 참고만 하세요!</p>
          <div className="space-y-3">
            {improveExamples.map((ex, i) => (
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
                    <p className="text-[11px] text-purple-700 break-keep">
                      💡 {ex.reason}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 맞춤법 오류 목록 */}
      {corrections.length > 0 && (
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-4">
          <h4 className="text-sm font-bold text-red-900 mb-2">
            🔍 맞춤법·띄어쓰기 ({corrections.length}개)
          </h4>
          <ul className="text-sm space-y-2">
            {corrections.map((c, i) => {
              // step427: 객체를 JSX로 직접 렌더하면 React가 죽음 — pickStr 파생값만 렌더
              const original = pickStr(c.original, c.error, c.wrong)
              const correction = pickStr(c.correction, c.fixed, c.suggestion)
              const reason = pickStr(c.reason, c.type, c.category)
              return (
                <li key={i} className="text-red-900 bg-white rounded p-2 border border-red-100">
                  <span className="line-through text-red-600">{original}</span>
                  {correction && <span className="mx-1.5 text-gray-400">→</span>}
                  {correction && <span className="text-green-700 font-bold">{correction}</span>}
                  {reason && <div className="text-xs text-gray-600 mt-1">💡 {reason}</div>}
                </li>
              )
            })}
          </ul>
          <p className="text-[11px] text-red-700/70 mt-2 leading-snug">{GRAMMAR_NOTICE_STUDENT}</p>
        </div>
      )}

      {/* 예시 글 */}
      {sub.example_text && (
        <details className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
          <summary className="text-sm font-semibold text-indigo-900 cursor-pointer">
            ✨ AI가 쓴 예시 작품 보기
          </summary>
          <p className="text-sm text-indigo-900 whitespace-pre-wrap mt-2 leading-relaxed break-keep">{sub.example_text}</p>
        </details>
      )}

        </div>
      </details>
    </div>
  )
}
