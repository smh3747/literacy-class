import Head from 'next/head'
import { useState } from 'react'

export default function Home() {
  const [showFeedback, setShowFeedback] = useState(false)

  return (
    <>
      <Head>
        <title>문해력 수업</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="초등학생을 위한 AI 글쓰기 피드백 시스템" />
      </Head>

      <div className="min-h-screen flex flex-col">
        {/* 헤더 */}
        <header className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📝</span>
              <h1 className="text-lg font-bold text-primary-dark">문해력 수업</h1>
            </div>
            <button
              onClick={() => setShowFeedback(true)}
              className="text-sm text-gray-600 hover:text-primary px-3 py-1 rounded-full border border-gray-200 hover:border-primary transition"
            >
              💬 의견 보내기
            </button>
          </div>
        </header>

        {/* 메인 */}
        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="max-w-md w-full text-center">
            <div className="text-6xl mb-4">✏️</div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">문해력 수업</h2>
            <p className="text-gray-600 mb-12">
              선생님과 함께하는<br />
              스마트한 글쓰기 학습
            </p>

            <div className="space-y-3">
              <a
                href="/student/login"
                className="block w-full py-4 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition shadow-sm"
              >
                🎒 학생이에요
              </a>
              <a
                href="/teacher/login"
                className="block w-full py-4 bg-white text-primary border-2 border-primary rounded-xl font-semibold hover:bg-primary-light transition"
              >
                👩‍🏫 선생님이에요
              </a>
            </div>

            <div className="mt-12 text-xs text-gray-400">
              <a href="/terms" className="hover:text-gray-600">이용약관</a>
              <span className="mx-2">·</span>
              <a href="/privacy" className="hover:text-gray-600">개인정보처리방침</a>
              <span className="mx-2">·</span>
              <a href="/api-key-guide" className="hover:text-gray-600">API 키 안내</a>
            </div>
          </div>
        </main>

        {/* 피드백 모달 */}
        {showFeedback && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={() => setShowFeedback(false)}>
            <div className="bg-white rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-2">의견 보내기</h3>
              <p className="text-sm text-gray-600 mb-4">
                불편한 점, 개선 제안 등을 자유롭게 보내주세요.
              </p>
              <textarea
                className="w-full p-3 border border-gray-200 rounded-lg text-sm"
                rows="4"
                placeholder="여기에 내용을 입력해주세요..."
              />
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setShowFeedback(false)}
                  className="flex-1 py-2 border border-gray-200 rounded-lg text-sm"
                >
                  취소
                </button>
                <button
                  onClick={() => { alert('의견 전달! (작동은 다음 단계)'); setShowFeedback(false); }}
                  className="flex-1 py-2 bg-primary text-white rounded-lg text-sm"
                >
                  보내기
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
