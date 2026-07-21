-- step536: 학생 붙여넣기 허용 토글 (학급 설정)
-- 기본값 false = 학생 글쓰기·다시쓰기 textarea에서 붙여넣기 차단.
-- 테스트나 특별한 수업 목적일 때만 학급 설정에서 켠다.
-- 켜도 paste_detected 감지·챌린지 랭킹 제외(기존)는 그대로 동작 — 토글은 입력 차단 여부만 제어.
-- Supabase SQL Editor에서 수동 실행. 멱등(IF NOT EXISTS).

ALTER TABLE classes ADD COLUMN IF NOT EXISTS allow_paste boolean DEFAULT false;
