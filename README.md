# 문해력 수업 (literacy-class)

초등학생을 위한 AI 글쓰기 피드백 시스템

## 기능
- 학급별 분리된 운영
- 선생님이 주제 등록 → 학생이 글쓰기 → AI 피드백
- 맞춤법/띄어쓰기 자동 검사
- 성장 그래프 및 학생별 기록 관리
- 학급명렬표 엑셀 일괄 업로드

## 기술 스택
- **프론트엔드**: Next.js 14 + Tailwind CSS
- **백엔드**: Vercel Functions
- **데이터베이스**: Supabase
- **AI**: Google Gemini API (사용자 본인 API 키)

## 시작하기
1. `.env.local` 파일 생성 (`.env.local.example` 참고)
2. `npm install`
3. `npm run dev`
