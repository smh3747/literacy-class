import Head from 'next/head'
import Link from 'next/link'
import { useState } from 'react'
import FeedbackModal from '../components/FeedbackModal'

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

        <main className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="max-w-md w-full text-center">
            <div className="text-6xl mb-4">✏️</div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">문해력 수업</h2>
            <p className="text-gray-600 mb-12">
              선생님과 함께하는<br />
              스마트한 글쓰기 학습
            </p>

            <div className="space-y-3">
              <Link
                href="/student/login"
                className="block w-full py-4 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition shadow-sm"
              >
                🎒 학생이에요
              </Link>
              <Link
                href="/teacher/login"
                className="block w-full py-4 bg-white text-primary border-2 border-primary rounded-xl font-semibold hover:bg-primary-light transition"
              >
                👩‍🏫 선생님이에요
              </Link>
            </div>

            <div className="mt-12 text-xs text-gray-400">
              <Link href="/terms" className="hover:text-gray-600">이용약관</Link>
              <span className="mx-2">·</span>
              <Link href="/privacy" className="hover:text-gray-600">개인정보처리방침</Link>
              <span className="mx-2">·</span>
              <Link href="/api-key-guide" className="hover:text-gray-600">API 키 안내</Link>
            </div>
          </div>
        </main>

        {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      </div>
    </>
  )
}
