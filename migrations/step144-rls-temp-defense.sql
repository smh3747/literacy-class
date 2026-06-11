-- ============================================
-- step144: 임시 RLS 방어 (쓰기/수정/삭제 보호)
-- ============================================
-- 현재 정책 qual=true, with_check=true 라 비로그인도 모든 작업 가능.
--
-- ⚠️ 주의: 회원가입(로그인 전)에 학급코드·닉네임 중복을 비로그인
-- 상태로 SELECT 하므로, SELECT를 전면 차단하면 가입이 깨진다.
-- 따라서 이번 임시 방어는:
--   - INSERT/UPDATE/DELETE → 로그인 필수 (남의 데이터 조작·삭제 차단)
--   - SELECT → 일단 유지 (정밀 학급별 격리는 이후 Claude Code 작업)
--
-- 효과: 비로그인자가 데이터를 "수정·삭제·위조"하는 최악의 공격을 차단.
-- 안전성: 정상 사용자는 모두 로그인 상태라 앱 작동에 영향 없음.
--         가입 시의 비로그인 SELECT는 그대로 허용되어 가입도 정상.

-- 공통 패턴: 기존 전체허용(ALL) 정책 제거 후,
--   SELECT는 전체 허용 유지 / 쓰기 계열은 로그인 필수로 분리

-- ---------- classes ----------
drop policy if exists "classes_all" on classes;
create policy "classes_select" on classes for select using (true);
create policy "classes_write"  on classes for insert with check (auth.uid() is not null);
create policy "classes_update" on classes for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "classes_delete" on classes for delete using (auth.uid() is not null);

-- ---------- profiles ----------
drop policy if exists "profiles_all" on profiles;
create policy "profiles_select" on profiles for select using (true);
create policy "profiles_write"  on profiles for insert with check (auth.uid() is not null);
create policy "profiles_update" on profiles for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "profiles_delete" on profiles for delete using (auth.uid() is not null);

-- ---------- submissions ----------
drop policy if exists "submissions_all" on submissions;
create policy "submissions_select" on submissions for select using (true);
create policy "submissions_write"  on submissions for insert with check (auth.uid() is not null);
create policy "submissions_update" on submissions for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "submissions_delete" on submissions for delete using (auth.uid() is not null);

-- ---------- topics ----------
drop policy if exists "topics_all" on topics;
create policy "topics_select" on topics for select using (true);
create policy "topics_write"  on topics for insert with check (auth.uid() is not null);
create policy "topics_update" on topics for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "topics_delete" on topics for delete using (auth.uid() is not null);
