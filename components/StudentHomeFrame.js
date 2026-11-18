// step683: 학생 홈 "틀 먼저" — 조회가 끝나기 전에 보이는 화면.
//   머리줄·인사 자리·주제 카드·글쓰기 칸 자리를 먼저 그린다. 입력 칸과 누를 수 있는 버튼은 없다.
//   topic(이 기기에 적어 둔 오늘 주제 카드, lib/homeCache.js)이 있으면 제목·설명을 먼저 보여 주고,
//   없으면 회색 줄로 둔다. 제출 여부·점수는 서버 응답이 와야 알 수 있으므로 여기서는 보여 주지 않는다.
import Head from 'next/head'

const Bar = ({ w = 'w-full', h = 'h-3' }) => <div className={`${h} ${w} bg-gray-200 rounded animate-pulse`} />

export default function StudentHomeFrame({ topic = null }) {
  return (
    <>
      <Head><title>글쓰기 - 다온클래스</title></Head>
      <div className="min-h-screen bg-gray-50" aria-busy="true">
        <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30">
          <div className="max-w-4xl mx-auto flex items-center gap-2">
            <span className="text-2xl">📝</span>
            <h1 className="text-base sm:text-lg font-bold text-primary-dark">다온클래스</h1>
          </div>
        </header>
        <main className="mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-3 sm:space-y-4 max-w-3xl">
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-2">
            <Bar w="w-40" h="h-4" />
            <Bar w="w-56" />
          </div>

          <div className="bg-primary-light border border-primary rounded-2xl p-4">
            <div className="text-xs text-primary-dark font-semibold mb-1">📅 오늘의 글쓰기</div>
            {topic ? (
              <>
                <h2 className="text-lg font-bold text-primary-dark mb-1">{topic.title}</h2>
                {topic.description && <p className="text-sm text-primary-dark/80 whitespace-pre-wrap line-clamp-4">{topic.description}</p>}
              </>
            ) : (
              <div className="space-y-2 py-1">
                <Bar w="w-2/3" h="h-5" />
                <Bar w="w-full" />
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="h-40 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center px-4 text-center">
              <p className="text-sm text-gray-500">글쓰기 칸을 준비하고 있어요. 잠깐만 기다려 주세요.</p>
            </div>
            <div className="mt-3 w-full py-3 bg-gray-200 text-gray-500 rounded-xl font-semibold text-center select-none">불러오는 중이에요...</div>
          </div>
        </main>
      </div>
    </>
  )
}
