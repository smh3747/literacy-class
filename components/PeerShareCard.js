// 📚 step621: 우리 반 친구들 글 카드(학생 화면 공용 — 글쓰기 결과·글 기록)
//   items: /api/peer-share 학생 응답 [{ key, nickname, essay, score?, mine }] — 실명·student_id는 애초에 없다.
//   showScore: 학급 설정(peer_share_show_score)일 때만 점수 표시. onNotify(item): "🙋 선생님께 알리기"(본인 글 제외).
//   notifiedKeys: 이미 알린 key Set → 버튼을 "알렸어요"로 교체(세션 내 1회).
//   0편이면 호출부가 아예 렌더하지 않는다(제출 전에는 카드 존재 자체를 알리지 않음).

export default function PeerShareCard({ items, showScore = false, onNotify, notifiedKeys }) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return null
  const notified = notifiedKeys instanceof Set ? notifiedKeys : new Set()
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
      <div className="font-bold text-emerald-900 text-sm">📚 우리 반 친구들 글 ({list.length}편)</div>
      <p className="text-xs text-emerald-800/80 mt-0.5">친구들이 잘 쓴 글이에요. 읽어 보고 내 글에 보탤 점을 찾아보세요.</p>
      <div className="mt-3 space-y-2">
        {list.map(item => (
          <div key={item.key} className="bg-white border border-emerald-100 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-bold text-gray-900">
                {item.nickname}{item.mine && <span className="ml-1 text-xs text-emerald-700 font-normal">(나)</span>}
              </p>
              {showScore && item.score != null && (
                <span className="text-xs text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">{item.score}점</span>
              )}
            </div>
            {item.essay ? (
              <details className="mt-1">
                <summary className="text-xs text-emerald-700 font-semibold cursor-pointer select-none">📖 글 읽기</summary>
                <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{item.essay}</p>
                {!item.mine && onNotify && (
                  notified.has(item.key) ? (
                    <p className="mt-2 text-xs text-gray-400">🙋 선생님께 알렸어요</p>
                  ) : (
                    <button type="button" onClick={() => onNotify(item)}
                      className="mt-2 text-xs text-emerald-700 underline underline-offset-2">
                      🙋 선생님께 알리기
                    </button>
                  )
                )}
              </details>
            ) : (
              <p className="mt-1 text-xs text-gray-400">글을 불러오지 못했어요</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
