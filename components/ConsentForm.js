import { useState } from 'react'
import Link from 'next/link'

export default function ConsentForm({ onComplete }) {
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [allChecked, setAllChecked] = useState(false)

  const toggleAll = () => {
    const next = !allChecked
    setAllChecked(next)
    setTerms(next)
    setPrivacy(next)
  }

  const proceed = () => {
    if (!terms || !privacy) return alert('모든 항목에 동의해주세요')
    onComplete()
  }

  return (
    <div className="space-y-3 mb-4">
      <label className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200 font-medium">
        <input type="checkbox" checked={allChecked} onChange={toggleAll} className="w-4 h-4" />
        <span>모두 동의합니다 (필수)</span>
      </label>
      <div className="space-y-2 px-1">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} className="w-4 h-4" />
          <span>(필수) <Link href="/terms" target="_blank" className="text-primary underline">이용약관</Link>에 동의합니다</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={privacy} onChange={e => setPrivacy(e.target.checked)} className="w-4 h-4" />
          <span>(필수) <Link href="/privacy" target="_blank" className="text-primary underline">개인정보처리방침</Link>에 동의합니다</span>
        </label>
      </div>
      <button
        onClick={proceed}
        disabled={!terms || !privacy}
        className="w-full py-3 bg-primary text-white rounded-xl font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
      >
        동의하고 계속하기
      </button>
    </div>
  )
}
