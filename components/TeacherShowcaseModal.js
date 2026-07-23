// step554: 교사용 전국 챌린지 랭킹 모달 — step544의 teacher/index.js 인라인 구현을 추출(공용화).
//   소비처: pages/teacher/index.js(챌린지 카드 당일 진입) · pages/teacher/ranking.js(전국 챌린지 목록 탭).
//   supplyId를 받으면 mount 시 /api/supply-ranking을 1회 조회한다. 학생 모달 축약판 —
//   내 순위 줄·신고·잠금 없음(교사 myRank null 정상). 표시명은 API가 닉네임만 반환(PII 원칙 자동 준수).
//   마감된 챌린지는 API가 동결본(supply_final_ranks)으로 응답 — 지나간 순위 열람이 랭킹 탭의 핵심 목적.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function TeacherShowcaseModal({ supplyId, onClose }) {
  const [data, setData] = useState({ loading: true })

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) throw new Error('로그인이 필요해요')
        const res = await fetch('/api/supply-ranking', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: session.access_token, supplyId }),
        })
        const d = await res.json()
        if (!res.ok || !d?.ok) throw new Error(d?.error || '불러오지 못했어요')
        if (alive) setData({ loading: false, winners: d.winners || [], participants: d.participants || 0 })
      } catch (e) {
        console.warn('교사 랭킹 조회 실패:', e?.message)
        if (alive) {
          alert('전국 랭킹을 불러오지 못했어요. 잠시 후 다시 해주세요.')
          onClose?.()
        }
      }
    }
    if (supplyId) load()
    return () => { alive = false }
  }, [supplyId])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!supplyId) return null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="relative bg-white rounded-2xl p-5 max-w-md w-full shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">🏆 전국 챌린지 랭킹</h3>
          <button onClick={onClose} aria-label="닫기"
            className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        {data.loading ? (
          <p className="text-sm text-gray-500 py-6 text-center">불러오는 중...</p>
        ) : (
          <>
            <p className="text-sm text-sky-800 font-semibold mb-3">지금까지 전국 {data.participants}명 참여</p>
            {(data.winners || []).length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">아직 소개할 글이 없어요. 조금 뒤에 다시 봐주세요.</p>
            ) : (
              <div className="space-y-3">
                {data.winners.map(w => {
                  const medal = w.rank === 1 ? '🥇' : w.rank === 2 ? '🥈' : '🥉'
                  const meta = [w.school, w.grade ? `${w.grade}학년` : '', w.className].filter(Boolean).join(' ')
                  return (
                    <div key={w.showcaseId} className="border border-gray-200 rounded-xl p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{medal}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900">{w.nickname}</p>
                          {meta && <p className="text-[11px] text-gray-500 truncate">{meta}</p>}
                        </div>
                        <span className="text-sm font-bold text-sky-700 flex-shrink-0">{w.score}점</span>
                      </div>
                      {w.essay ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-sky-700 font-semibold select-none">글 보기</summary>
                          <p className="mt-2 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-3">{w.essay}</p>
                        </details>
                      ) : (
                        <p className="mt-2 text-xs text-gray-400">
                          {w.pending ? '🔍 아직 검토 중인 글이에요' : '확인을 거친 글만 보여요'}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
