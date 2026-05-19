/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
            value: 'public, max-age=0, must-revalidate'
          }
        ]
      }
    ]
  }
}
module.exports = nextConfig
