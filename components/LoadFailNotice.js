// step676: 조회 실패 안내 — 빈 목록 문구("없어요") 자리에 대신 띄운다.
//   text를 주지 않으면 공용 문구(lib/loadRetry LOAD_FAIL_TEXT)를 쓴다.
import { LOAD_FAIL_TEXT } from '../lib/loadRetry'

export default function LoadFailNotice({ onRetry, text, className = '' }) {
  return (
    <div className={`py-6 px-4 text-center text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl ${className}`} role="alert">
      <span>{text || LOAD_FAIL_TEXT}</span>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="ml-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-red-300 text-red-700 hover:bg-red-100">
          다시 시도
        </button>
      )}
    </div>
  )
}
