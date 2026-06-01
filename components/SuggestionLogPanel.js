// ============================================
// AI 추천 로그 사이드 패널
// ============================================
// 와이프 피드백:
// - 오른쪽에 항상 보이게 (큰 화면)
// - 작은 화면에서는 토글 버튼으로 슬라이드인
// - 추천 받은 주제들의 사용일 표시
// - 클릭하면 다시 받지 않고 바로 폼에 채워넣기
// ============================================
import { useState } from 'react'

const STORAGE_KEY = 'lc-side-log-panel'

export default function SuggestionLogPanel({
  logs,
  loading,
  onSelect,        // (suggestion) => void  - 카드 클릭 시 폼에 채우기
  onRefresh,       // () => void
  disabled,        // 임퍼소네이션 중일 때
}) {
  // 큰 화면(>=1280): 열림 가능, 작은 화면: 기본 닫힘
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) return saved === '1'
      // 첫 방문: 큰 화면이면 열린 채로
      return window.innerWidth >= 1280
    } catch (e) { return false }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch(e) {}
    }
  }

  // 모든 추천 로그에서 suggestion을 평탄화해서 "고르기 좋은 목록" 만들기
  // 각 항목에 사용일(resulting_topic.date) 포함
  const flatItems = []
  for (const log of logs || []) {
    const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
    sugs.forEach((s, idx) => {
      const isSelected = log.selected_index === idx
      const usedDate = isSelected && log.resulting_topic?.date
      flatItems.push({
        key: `${log.id}-${idx}`,
        title: s.title,
        description: s.description,
        category: s.category,
        createdAt: log.created_at,
        usedDate,                    // "2026-06-01" 또는 null
        wasSelected: isSelected,     // 선택은 했는데 등록 안 한 경우도 표시
      })
    })
  }

  return (
    <>
      {/* 떠다니는 토글 버튼 (작은 화면에서만 보임 — 큰 화면에선 패널 자체에 토글 있음) */}
      {!open && (
        <button
          onClick={toggle}
          className="fixed right-4 bottom-20 lg:bottom-4 z-30 bg-purple-600 text-white px-3 py-2 rounded-full shadow-lg hover:bg-purple-700 text-sm flex items-center gap-1"
          title="AI 추천 기록 열기">
          📚 추천 기록
          {flatItems.length > 0 && (
            <span className="bg-white text-purple-700 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {flatItems.length}
            </span>
          )}
        </button>
      )}

      {/* 사이드 패널 */}
      {open && (
        <>
          {/* 작은 화면에서 뒷배경 어둡게 (클릭하면 닫힘) */}
          <div
            onClick={toggle}
            className="lg:hidden fixed inset-0 bg-black/30 z-30"
          />
          <aside className="fixed top-0 right-0 h-screen w-80 max-w-[90vw] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-purple-50">
              <div>
                <h3 className="font-bold text-purple-900 text-sm">📚 AI 추천 기록</h3>
                <p className="text-[11px] text-purple-700/80 mt-0.5">
                  카드 클릭하면 바로 주제·평가기준에 사용
                </p>
              </div>
              <div className="flex items-center gap-1">
                {onRefresh && (
                  <button onClick={onRefresh}
                    title="새로고침"
                    className="text-purple-700 hover:bg-purple-100 rounded p-1 text-sm">🔄</button>
                )}
                <button onClick={toggle}
                  title="닫기"
                  className="text-gray-500 hover:bg-gray-100 rounded p-1 text-sm">✖</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading ? (
                <p className="text-sm text-gray-500 py-6 text-center">불러오는 중...</p>
              ) : flatItems.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500 mb-2">아직 추천받은 주제가 없어요</p>
                  <p className="text-xs text-gray-400">
                    "✨ AI 주제 추천" 버튼을 누르면<br />
                    여기에 모이고 나중에 재사용할 수 있어요
                  </p>
                </div>
              ) : (
                flatItems.map(item => {
                  const dateLabel = (() => {
                    if (!item.createdAt) return ''
                    const d = new Date(item.createdAt)
                    return `${d.getMonth() + 1}/${d.getDate()}`
                  })()
                  const usedLabel = item.usedDate
                    ? (() => {
                        // YYYY-MM-DD → M/D
                        const parts = String(item.usedDate).split('-')
                        return parts.length === 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : item.usedDate
                      })()
                    : null
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        if (disabled) return
                        onSelect?.({
                          title: item.title,
                          description: item.description,
                          category: item.category
                        })
                      }}
                      disabled={disabled}
                      className="w-full text-left bg-white border border-gray-200 hover:border-purple-300 hover:bg-purple-50 rounded-lg p-2.5 transition disabled:opacity-50 disabled:cursor-not-allowed">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="text-xs text-gray-400">{dateLabel} 추천</div>
                        {usedLabel ? (
                          <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                            ✓ {usedLabel} 사용
                          </span>
                        ) : item.wasSelected ? (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                            👆 선택만
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm font-semibold text-gray-900 leading-tight">
                        {item.title}
                      </div>
                      {item.description && (
                        <div className="text-[11px] text-gray-600 mt-1 leading-snug line-clamp-3">
                          {item.description}
                        </div>
                      )}
                      {item.category && (
                        <div className="text-[10px] text-purple-600 mt-1">#{item.category}</div>
                      )}
                    </button>
                  )
                })
              )}
            </div>

            {flatItems.length > 0 && (
              <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400 text-center">
                총 {flatItems.length}개 · 최근 50건만 표시
              </div>
            )}
          </aside>
        </>
      )}
    </>
  )
}
