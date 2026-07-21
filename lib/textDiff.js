// step537: 수정 전후 비교(초록 형광펜) 공용 헬퍼 — 교사 submissions.js 인라인(step474)에서 추출.
//   소비처: pages/teacher/submissions.js(applyGrammar) · components/StudentFeedbackCard.js(관리자 학생 글 탭).
//   .diff-added CSS는 styles/globals.css(전역) + submissions.js 인라인 <style> 양쪽에 존재.
import { diffWords } from 'diff'
import { escapeHtml } from './escapeHtml'

// step474: 직전 글 대비 새로 쓰거나 바뀐 구간 계산 (curr 기준 오프셋)
export function calcAddedRanges(prevText, currText) {
  if (!prevText || !currText) return []
  const ranges = []
  let offset = 0
  for (const p of diffWords(prevText, currText)) {
    if (p.removed) continue                       // curr에 없는 조각 → 오프셋 불변
    if (p.added) ranges.push({ start: offset, end: offset + p.value.length })
    offset += p.value.length                      // added·공통 모두 curr 오프셋 전진
  }
  return ranges                                    // 순회 순서상 start 오름차순
}

// step474: 텍스트 조각을 escapeHtml로 출력하되 addedRanges와 교차하는 부분만 초록 형광펜
// addedRanges 미전달(undefined/빈 배열)이면 escapeHtml(text)와 완전 동일 — 하위호환
export function emitWithAdded(text, absStart, addedRanges) {
  if (!addedRanges?.length) return escapeHtml(text)
  const absEnd = absStart + text.length
  let out = '', pos = absStart
  for (const r of addedRanges) {
    if (r.end <= pos) continue
    if (r.start >= absEnd) break
    const s = Math.max(r.start, pos), e = Math.min(r.end, absEnd)
    if (s > pos) out += escapeHtml(text.slice(pos - absStart, s - absStart))
    out += `<span class="diff-added">${escapeHtml(text.slice(s - absStart, e - absStart))}</span>`
    pos = e
  }
  if (pos < absEnd) out += escapeHtml(text.slice(pos - absStart))
  return out
}
