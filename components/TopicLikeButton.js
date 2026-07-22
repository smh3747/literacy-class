// step547: 공유 주제 ❤️ 좋아요 토글 버튼 — topics.js(공유 카드·TOP 5)·SuggestionLogPanel 공용.
// 호스트 카드가 <button>인 곳에 중첩되므로 button이 아닌 span role=button을 쓰고,
// stopPropagation으로 카드 클릭(폼 자동 입력)과 분리한다. 표시·터치 영역만 담당 —
// 실제 토글 로직(낙관적 갱신·원복)은 topics.js의 toggleLike가 onToggle로 들어온다.
export default function TopicLikeButton({ item, onToggle, className = '' }) {
  const fire = (e) => { e.stopPropagation(); e.preventDefault(); onToggle?.(item) }
  return (
    <span role="button" tabIndex={0}
      onClick={fire}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fire(e) }}
      title={item.likedByMe ? '좋아요 취소' : '좋아요'}
      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg cursor-pointer select-none transition ${
        item.likedByMe ? 'bg-rose-100 text-rose-700 font-semibold' : 'bg-gray-100 text-gray-600 hover:bg-rose-50'
      } ${className}`}>
      {item.likedByMe ? '❤️' : '🤍'} {item.likes}
    </span>
  )
}
