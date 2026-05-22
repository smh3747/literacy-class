import useGrammarTooltip from '../lib/useGrammarTooltip'
import { toKST } from '../lib/timeFormat'
import { splitFeedbackItems } from '../lib/feedbackFormat'

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]))
}

// 🛡️ AI corrections 오탐 필터
export function filterValidCorrections(essayText, corrections) {
  if (!essayText || !Array.isArray(corrections)) return []
  return corrections.filter(c => {
    const original = c.original || c.error || c.wrong || ''
    const correction = c.correction || c.fixed || c.suggestion || ''
    const reason = (c.reason || c.type || c.category || '').toLowerCase()
    if (!original) return false
    if (!essayText.includes(original)) return false
    if (reason.includes('마침표') || reason.includes('문장 끝') || reason.includes('온점') || reason.includes('찍어')) {
      if (/[.!?。]$/.test(original)) return false
    }
    if (original === correction) return false
    return true
  })
}

// 글에 맞춤법 빨간 밑줄 적용
export function applyGrammarHighlights(essayText, corrections) {
  if (!essayText) return ''
  if (!corrections || corrections.length === 0) return escapeHtml(essayText).replace(/\n/g, '<br>')

  const filtered = filterValidCorrections(essayText, corrections)
  if (filtered.length === 0) return escapeHtml(essayText).replace(/\n/g, '<br>')

  const matches = []
  filtered.forEach(c => {
    const original = c.original || c.error || c.wrong || ''
    const correction = c.correction || c.fixed || c.suggestion || ''
    const reason = c.reason || c.type || c.category || ''
    if (!original) return

    let from = 0
    while (true) {
      const idx = essayText.indexOf(original, from)
      if (idx === -1) break
      const overlaps = matches.some(m => idx < m.end && idx + original.length > m.start)
      if (!overlaps) {
        matches.push({ start: idx, end: idx + original.length, original, correction, reason })
        break
      }
      from = idx + 1
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
 * 학생 피드백 카드 - 학생 화면과 동일하게 표시
 * @param {object} sub - submission 객체 (essay_text, corrections, total_score, max_score, feedback_overall, feedback_good, feedback_improve, rubric_scores, rubrics?)
 * @param {object} topic - 주제 정보 (rubrics, title 등) - 옵션
 * @param {string} headerLabel - "첫 글", "수정본 1회" 등
 */
export default function StudentFeedbackCard({ sub, topic, headerLabel }) {
  useGrammarTooltip()

  if (!sub) return null

  const rubrics = topic?.rubrics || sub.rubrics || []
  const scores = sub.rubric_scores || sub.scores || []
  const corrections = filterValidCorrections(sub.essay_text, sub.corrections || [])
  const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0) || sub.max_score || 100

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
      {headerLabel && (
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="font-bold text-primary">{headerLabel}</h3>
          <span className="text-xs text-gray-500">{toKST(sub.created_at)}</span>
        </div>
      )}

      {/* 점수 */}
      <div className="bg-primary-light rounded-xl p-3 text-center">
        <div className="text-2xl font-bold text-primary-dark">
          {sub.total_score ?? 0} <span className="text-base font-normal">/ {totalMax}점</span>
        </div>
        {/* 🆕 채점 시각 (재평가 우선, 없으면 최초 채점=제출 시각) */}
        <div className="text-[11px] text-gray-500 mt-1">
          {sub.re_graded_at ? (
            <>🔄 재평가 {toKST(sub.re_graded_at)}</>
          ) : (
            <>🤖 AI 채점 {toKST(sub.created_at)}</>
          )}
        </div>
      </div>

      {/* 항목별 점수 */}
      {rubrics.length > 0 && scores.length > 0 && (
        <div className="space-y-1.5">
          {rubrics.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg p-2">
              <span>{r.name}</span>
              <span className="font-semibold">{scores[i] ?? 0} / {r.score}점</span>
            </div>
          ))}
        </div>
      )}

      {/* 학생 글 (맞춤법 빨간 밑줄 적용) */}
      <div>
        <h4 className="text-sm font-semibold mb-2">📝 내 글{corrections.length > 0 ? ` (빨간 밑줄에 마우스 올리면 안내)` : ''}</h4>
        <div
          className="bg-gray-50 rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap"
          dangerouslySetInnerHTML={{ __html: applyGrammarHighlights(sub.essay_text, corrections) }}
        />
        {sub.paste_detected && (
          <p className="text-xs text-red-600 mt-1">
            ⚠️ 붙여넣기 {sub.paste_count || 1}회 감지됨
          </p>
        )}
      </div>

      {/* 맞춤법 오류 목록 */}
      {corrections.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-red-900 mb-2">
            🔍 맞춤법/띄어쓰기 ({corrections.length}개)
          </h4>
          <ul className="text-xs space-y-1">
            {corrections.map((c, i) => (
              <li key={i} className="text-red-800">
                <span className="line-through">{c.original}</span>
                {c.correction && <span className="text-green-700 font-semibold"> → {c.correction}</span>}
                {c.reason && <span className="text-gray-600"> ({c.reason})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* AI 피드백 */}
      {sub.feedback_overall && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-blue-900 mb-1">💬 종합</h4>
          <p className="text-sm text-blue-800 whitespace-pre-wrap">{sub.feedback_overall}</p>
        </div>
      )}

      {sub.feedback_good && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-green-900 mb-1">⭐ 잘한 점</h4>
          {(() => {
            const items = splitFeedbackItems(sub.feedback_good)
            if (items.length <= 1) return <p className="text-sm text-green-800 whitespace-pre-wrap">{items[0] || sub.feedback_good}</p>
            return (
              <ul className="space-y-1.5">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-green-800">
                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-600 mt-2"></span>
                    <span className="flex-1 break-keep leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>
      )}

      {sub.feedback_improve && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-amber-900 mb-1">🌱 발전시킬 점</h4>
          {(() => {
            const items = splitFeedbackItems(sub.feedback_improve)
            if (items.length <= 1) return <p className="text-sm text-amber-800 whitespace-pre-wrap">{items[0] || sub.feedback_improve}</p>
            return (
              <ul className="space-y-1.5">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-amber-800">
                    <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-amber-600 mt-2"></span>
                    <span className="flex-1 break-keep leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>
      )}

      {/* 예시 글 */}
      {sub.example_text && (
        <details className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <summary className="text-sm font-semibold text-purple-900 cursor-pointer">
            ✨ AI 예시 작품 보기
          </summary>
          <p className="text-sm text-purple-800 whitespace-pre-wrap mt-2">{sub.example_text}</p>
        </details>
      )}
    </div>
  )
}
