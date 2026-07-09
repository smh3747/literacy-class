// ============================================
// AI 추천 로그 사이드 패널 (탭: 내 추천 / 공유)
// ============================================
// 와이프 피드백:
// - 본인 추천 + 다른 선생님이 학급에 실제로 등록한 추천 둘 다 보기
// - 카드 클릭 시 바로 폼에 사용
// - 모바일·태블릿은 토글, 데스크탑은 사이드 고정
// ============================================
import { useState } from 'react'

const STORAGE_KEY = 'lc-side-log-panel'
const STORAGE_TAB_KEY = 'lc-side-log-panel-tab'

export default function SuggestionLogPanel({
  logs,           // 본인 추천 로그
  sharedLogs,     // 🆕 다른 선생님 공유 추천 로그
  loading,
  onSelect,
  onRefresh,
  onToggleShare,  // 🆕 (logId, isShared) => void - 본인 로그 공유 토글
  onCancelShare,  // 🆕 step279 (resultingTopicId) => void - 등록 주제 공유 취소
  disabled,
  copyCounts,     // 🆕 인기 배지·정렬용 (source_log_id-source_index → 교사수)
  myCopiedSet,    // 🆕 step426: 내가 이미 가져간 공유 주제 Set('log_id-index') — '가져옴' 배지용
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved !== null) return saved === '1'
      return window.innerWidth >= 1280
    } catch (e) { return false }
  })

  const [tab, setTab] = useState(() => {
    if (typeof window === 'undefined') return 'mine'
    try {
      return localStorage.getItem(STORAGE_TAB_KEY) || 'mine'
    } catch (e) { return 'mine' }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch(e) {}
    }
  }

  const setTabAndSave = (t) => {
    setTab(t)
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(STORAGE_TAB_KEY, t) } catch(e) {}
    }
  }

  // 평탄화 (본인 로그)
  const flatMine = []
  for (const log of logs || []) {
    const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
    const sharedIdxs = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
    sugs.forEach((s, idx) => {
      const isSelected = log.selected_index === idx
      flatMine.push({
        key: `${log.id}-${idx}`,
        logId: log.id,           // 🆕 공유 토글에 필요
        suggestionIdx: idx,
        title: s.title,
        description: s.description,
        category: s.category,
        createdAt: log.created_at,
        usedDate: isSelected && log.resulting_topic?.date,
        wasSelected: isSelected,
        isShared: sharedIdxs.includes(idx),                    // 🆕 이 카드만 공유 중인지
        isAutoShared: isSelected && !!log.resulting_topic_id,  // 🆕 등록된 카드만 자동 공유
        resultingTopicId: log.resulting_topic_id               // 🆕 step279 공유 취소용
      })
    })
  }

  // 평탄화 (공유 탭 — 다른 선생님)
  // 1) 등록된 주제 (selected_index + resulting_topic_id)
  // 2) 개별 공유된 카드 (shared_indexes에 포함)
  const flatShared = []
  for (const log of sharedLogs || []) {
    const sugs = Array.isArray(log.suggestions) ? log.suggestions : []
    const sharedIdxs = Array.isArray(log.shared_indexes) ? log.shared_indexes : []
    const seen = new Set()

    // 등록된 주제
    if (log.resulting_topic_id && log.selected_index !== null && log.selected_index !== undefined) {
      const picked = sugs[log.selected_index]
      if (picked && picked.title) {
        flatShared.push({
          key: `shared-${log.id}-${log.selected_index}`,
          title: picked.title,
          description: picked.description,
          category: picked.category,
          createdAt: log.created_at,
          usedDate: log.resulting_topic?.date,
          sourceLogId: log.id,                 // 🆕 가져오기 출처(집계용)
          sourceIndex: log.selected_index,
          n: Number(copyCounts?.[`${log.id}-${log.selected_index}`] ?? 0) || 0,
          copiedByMe: !!myCopiedSet?.has(`${log.id}-${log.selected_index}`),  // 🆕 step426
        })
        seen.add(log.selected_index)
      }
    }

    // 개별 공유된 카드 (등록된 것과 중복되지 않게)
    for (const idx of sharedIdxs) {
      if (seen.has(idx)) continue
      const s = sugs[idx]
      if (!s || !s.title) continue
      flatShared.push({
        key: `shared-${log.id}-${idx}`,
        title: s.title,
        description: s.description,
        category: s.category,
        createdAt: log.created_at,
        sourceLogId: log.id,                   // 🆕 가져오기 출처(집계용)
        sourceIndex: idx,
        n: Number(copyCounts?.[`${log.id}-${idx}`] ?? 0) || 0,
        copiedByMe: !!myCopiedSet?.has(`${log.id}-${idx}`),  // 🆕 step426
      })
      seen.add(idx)
    }
  }

  // 🆕 인기순 정렬 + 상위 3개(2명 이상)만 인기 배지 (왼쪽 탭과 동일 규칙)
  flatShared.sort((a, b) => (b.n || 0) - (a.n || 0))
  flatShared.forEach((item, i) => { item.isPopular = i < 3 && (item.n || 0) >= 2 })

  const currentList = tab === 'mine' ? flatMine : flatShared
  const totalCount = flatMine.length + flatShared.length

  return (
    <>
      {!open && (
        <button
          onClick={toggle}
          className="fixed right-4 bottom-20 lg:bottom-4 z-30 bg-purple-600 text-white px-3 py-2 rounded-full shadow-lg hover:bg-purple-700 text-sm flex items-center gap-1"
          title="AI 추천 기록 열기">
          📚 추천 기록
          {totalCount > 0 && (
            <span className="bg-white text-purple-700 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              {totalCount}
            </span>
          )}
        </button>
      )}

      {open && (
        <>
          <div
            onClick={toggle}
            className="lg:hidden fixed inset-0 bg-black/30 z-30"
          />
          <aside className="fixed top-0 right-0 h-screen w-80 max-w-[90vw] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 bg-purple-50">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-purple-900 text-sm">📚 AI 추천 기록</h3>
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
              {/* 🆕 탭 */}
              <div className="flex bg-white rounded-lg p-1 gap-1">
                <button
                  onClick={() => setTabAndSave('mine')}
                  className={`flex-1 text-xs py-1.5 rounded ${
                    tab === 'mine'
                      ? 'bg-purple-100 text-purple-900 font-semibold'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  내 추천 {flatMine.length > 0 && `(${flatMine.length})`}
                </button>
                <button
                  onClick={() => setTabAndSave('shared')}
                  className={`flex-1 text-xs py-1.5 rounded ${
                    tab === 'shared'
                      ? 'bg-purple-100 text-purple-900 font-semibold'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  다른 선생님 {flatShared.length > 0 && `(${flatShared.length})`}
                </button>
              </div>
              <p className="text-[11px] text-purple-700/80 mt-2">
                {tab === 'mine'
                  ? '카드 클릭하면 바로 폼에 사용'
                  : '다른 선생님이 학급에 등록한 주제예요'}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading ? (
                <p className="text-sm text-gray-500 py-6 text-center">불러오는 중...</p>
              ) : currentList.length === 0 ? (
                <div className="text-center py-8">
                  {tab === 'mine' ? (
                    <>
                      <p className="text-sm text-gray-500 mb-2">아직 내가 추천받은 주제가 없어요</p>
                      <p className="text-xs text-gray-400">
                        "✨ AI 주제 추천" 버튼을 눌러보세요
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-500 mb-2">다른 선생님이 등록한 추천이 아직 없어요</p>
                      <p className="text-xs text-gray-400">
                        선생님들이 학급에 주제를 등록하면<br />여기에서 같이 볼 수 있어요
                      </p>
                    </>
                  )}
                </div>
              ) : (
                currentList.map(item => {
                  const dateLabel = (() => {
                    if (!item.createdAt) return ''
                    const d = new Date(item.createdAt)
                    return `${d.getMonth() + 1}/${d.getDate()}`
                  })()
                  const usedLabel = item.usedDate
                    ? (() => {
                        const parts = String(item.usedDate).split('-')
                        return parts.length === 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : item.usedDate
                      })()
                    : null
                  return (
                    <div
                      key={item.key}
                      className="bg-white border border-gray-200 hover:border-purple-300 rounded-lg overflow-hidden transition">
                      <button
                        onClick={() => {
                          if (disabled) return
                          onSelect?.({
                            title: item.title,
                            description: item.description,
                            category: item.category,
                            sourceLogId: item.sourceLogId,   // 🆕 공유 카드일 때만 존재
                            sourceIndex: item.sourceIndex
                          })
                        }}
                        disabled={disabled}
                        className="w-full text-left p-2.5 hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="text-xs text-gray-400">{dateLabel} 추천</div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {item.isPopular && (
                              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full font-semibold">🔥 인기</span>
                            )}
                            {item.copiedByMe && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">✔ 가져옴</span>
                            )}
                            {usedLabel && (
                              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                                ✓ {usedLabel} 사용
                              </span>
                            )}
                            {!usedLabel && item.wasSelected && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                                👆 선택만
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-sm font-semibold text-gray-900 leading-tight">
                          {item.title}
                        </div>
                        {item.description && (
                          <div className="text-[11px] text-gray-600 mt-1 leading-snug line-clamp-3">
                            {item.description}
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 mt-1.5 flex-wrap">
                          {item.category && (
                            <span className="text-[10px] text-purple-600">#{item.category}</span>
                          )}
                          {/* 🆕 다른 선생님 카드: 익명 표시 (이름·학교 보호) */}
                          {tab === 'shared' && (
                            <span className="text-[10px] text-gray-400 ml-auto">
                              👤 다른 선생님
                            </span>
                          )}
                        </div>
                      </button>

                      {/* 🆕 본인 카드: 개별 공유 토글 (이 주제 하나만) */}
                      {tab === 'mine' && onToggleShare && (
                        <div className="border-t border-gray-100 px-2.5 py-1.5 flex items-center justify-between bg-gray-50">
                          {item.isAutoShared ? (
                            <>
                              <span className="text-[10px] text-green-700">🌐 등록되어 자동 공유 중</span>
                              {onCancelShare && item.resultingTopicId && (
                                <button
                                  onClick={() => onCancelShare(item.resultingTopicId)}
                                  disabled={disabled}
                                  className="text-[10px] text-gray-500 hover:text-gray-700 underline disabled:opacity-50">
                                  공유 취소
                                </button>
                              )}
                            </>
                          ) : item.isShared ? (
                            <>
                              <span className="text-[10px] text-purple-700">🔗 이 주제 공유 중</span>
                              <button
                                onClick={() => onToggleShare(item.logId, item.suggestionIdx, false)}
                                disabled={disabled}
                                className="text-[10px] text-gray-500 hover:text-gray-700 underline disabled:opacity-50">
                                공유 해제
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-[10px] text-gray-500">나만 보임</span>
                              <button
                                onClick={() => onToggleShare(item.logId, item.suggestionIdx, true)}
                                disabled={disabled}
                                className="text-[10px] text-purple-700 hover:bg-purple-100 px-2 py-0.5 rounded disabled:opacity-50">
                                🔗 이 주제만 공유
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {currentList.length > 0 && (
              <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400 text-center">
                {tab === 'mine' ? `총 ${flatMine.length}개 · 최근 50건` : `총 ${flatShared.length}개 · 최근 100건`}
              </div>
            )}
          </aside>
        </>
      )}
    </>
  )
}
