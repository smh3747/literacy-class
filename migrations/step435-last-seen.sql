-- step435: 교사 접속 하트비트 — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- MessageBell 60초 폴링에 편승해 5분에 1회 본인 행 last_seen_at 갱신(교사·관리자만, 임퍼소네이션 제외).
-- RLS 변경 없음: prof_update(step148)의 id = auth.uid() 조건으로 본인 행 update가 이미 허용됨.
-- 관리자 선생님 탭에서 5분 이내면 "🟦 접속 중" 배지 표시.

alter table profiles add column if not exists last_seen_at timestamptz;

-- 검증: select realname, last_seen_at from profiles where last_seen_at is not null order by last_seen_at desc limit 5;
