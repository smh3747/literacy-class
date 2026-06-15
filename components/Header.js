import { useState } from 'react'
import Link from 'next/link'
import FeedbackModal from './FeedbackModal'

export default function Header({ user, onLogout }) {
  const [showFeedback, setShowFeedback] = useState(false)

  return (
    <>
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">📝</span>
            <h1 className="text-base sm:text-lg font-bold text-primary-dark">다온클래스</h1>
          </Link>
          <div className="flex items-center gap-2">
            {user && (
              <>
                <span className="hidden sm:inline text-sm text-gray-600">{user.realname} ({user.role === 'teacher' ? '선생님' : user.role === 'admin' ? '관리자' : '학생'})</span>
                <button
                  onClick={onLogout}
                  className="text-xs sm:text-sm text-gray-600 hover:text-gray-900 px-2 sm:px-3 py-1 rounded-full border border-gray-200 transition"
                >
                  로그아웃
                </button>
              </>
            )}
            <button
              onClick={() => setShowFeedback(true)}
              className="text-xs sm:text-sm text-gray-600 hover:text-primary px-2 sm:px-3 py-1 rounded-full border border-gray-200 hover:border-primary transition"
            >
              💬 의견
            </button>
          </div>
        </div>
      </header>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </>
  )
}
