// 사이트 전역 푸터 - Copyright 표시
import Link from 'next/link'

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="mt-12 py-6 border-t border-gray-200 bg-white">
      <div className="max-w-4xl mx-auto px-4 text-center text-xs text-gray-500 space-y-1">
        <p>
          © {year} 문해력 수업. All rights reserved.
        </p>
        <p>
          본 서비스의 콘텐츠, UI, 시스템은 저작권법 및 지식재산권법에 의해 보호됩니다.
          무단 복제 및 재배포를 금지합니다.
        </p>
        <p className="flex justify-center gap-3 pt-1">
          <Link href="/terms" className="hover:text-primary">이용약관</Link>
          <span>·</span>
          <Link href="/privacy" className="hover:text-primary">개인정보처리방침</Link>
        </p>
      </div>
    </footer>
  )
}
