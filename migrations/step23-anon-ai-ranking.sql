-- ============================================
-- step23 마이그레이션: 익명화 + AI 주제 개선 + 랭킹 준비
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run

-- ① 학급에 학년 정보 추가 (AI 주제 추천 학년별)
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS grade INTEGER; -- 1~6 (초등 학년)

-- ② 학생 닉네임 (자동 부여, 게시판 익명용)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS nickname TEXT;

-- ③ 학급 설정 (게시판 범위, 랭킹 공개 여부 등)
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS board_scope TEXT DEFAULT 'class' CHECK (board_scope IN ('class', 'national', 'off'));
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS ranking_enabled BOOLEAN DEFAULT TRUE;

-- ④ 닉네임 풀: 동물 이름 같은 형식 (자동 부여)
-- 별도 테이블 없이 클라이언트에서 처리하므로 컬럼만 두면 됨

-- 확인 쿼리:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'classes' AND column_name IN ('grade', 'board_scope', 'ranking_enabled');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'nickname';
