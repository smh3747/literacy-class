/** @type {import('next').NextConfig} */
const { execSync } = require('child_process')

// 🆕 배포마다 고유 ID — Vercel 커밋 SHA 기반 (빌드 내내 고정)
// Date.now()를 쓰면 API 함수 cold start 때 재평가되어 항상 불일치 → 배너 무한 표시 버그
// 1순위: Vercel이 주입하는 커밋 SHA / 2순위: 빌드 시점 git HEAD (로컬·시스템변수 미노출 폴백)
function resolveBuildId() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().slice(0, 12)
  } catch (e) {
    return 'dev'
  }
}
const BUILD_ID = resolveBuildId()

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
