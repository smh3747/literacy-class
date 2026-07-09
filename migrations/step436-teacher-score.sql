-- step436: 교사 점수 조정(병기형) — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- 원칙: AI 점수(total_score)는 어떤 경우에도 수정 금지. 조정 점수는 별도 컬럼에 병기.
--   통계 계열(성장 그래프·랭킹·학년 참조선·관리자 통계)은 전부 total_score만 사용 — 이 컬럼은
--   학생·교사 화면의 "대표 표시"에만 쓰인다. 되돌리기 = 두 컬럼 null.
-- 저장 경로: 담임이 클라이언트에서 직접 update — RLS sub_update(step147, teacher+같은 학급)가 허용.

alter table submissions add column if not exists teacher_score integer;
alter table submissions add column if not exists teacher_score_at timestamptz;

-- 검증: select id, total_score, teacher_score, teacher_score_at from submissions where teacher_score is not null limit 5;
