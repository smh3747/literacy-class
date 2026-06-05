/** @type {import('next').NextConfig} */

// 🆕 빌드마다 고유 ID 생성 — 클라이언트 자동 최신화 감지용
const BUILD_ID = Date.now().toString(36)

const nextConfig = {
  reactStrictMode: true,

  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },

  // HTML 페이지는 항상 최신 코드를 가져오도록 (태블릿/모바일 캐시 문제 해결)
  // JS/CSS 정적 파일은 해시가 붙어있어서 자동 무효화됨
  async headers() {
    return [
      {
        // 모든 HTML 페이지: 캐시 절대 안 함 (브라우저는 매번 새 HTML 받음)
        source: '/((?!_next/static|_next/image|favicon).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate'
          },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' }
        ]
      }
    ]
  }
}
module.exports = nextConfig
