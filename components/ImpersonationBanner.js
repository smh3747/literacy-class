// 관리자 임퍼소네이션 중일 때 페이지 상단에 표시되는 빨간 배너
// 목적: 관리자가 "지금 누구 화면을 보는 중인지" 잊지 않게 + 실수로 글 쓰지 않게
// ⚠️ 이 배너는 임퍼소네이션 중인 관리자 본인만 봅니다 (담임은 안 봄)
import Link from 'next/link'

export default function ImpersonationBanner({ targetName, targetSchool }) {
  return (
    <div className="bg-red-600 text-white sticky top-0 z-50 shadow-md">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm flex items-center gap-2 flex-wrap">
          <span className="text-base">🔴</span>
          <span className="font-bold">엿보기 모드</span>
          <span className="opacity-90">
            <strong>{targetName || '?'}</strong> 선생님
            {targetSchool && <span className="opacity-80"> · {targetSchool}</span>}
            의 화면을 보는 중 (읽기 전용, 담임에게 알리지 않음)
          </span>
        </div>
        <Link href="/admin"
          className="text-xs bg-white text-red-700 px-3 py-1 rounded font-semibold hover:bg-red-50 whitespace-nowrap">
          ← 관리자 페이지로
        </Link>
      </div>
    </div>
  )
}
