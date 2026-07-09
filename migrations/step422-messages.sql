-- step422: 쪽지(교사↔관리자) 테이블 — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- 쪽지식(비동기+알림) 문의 채널. 스레드 키 = teacher_id(교사당 1스레드), sender_id로 방향 구분.

-- messages (적용 완료)
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,  -- 스레드 주인(교사)
  sender_id  uuid not null references profiles(id) on delete cascade,  -- 실제 발신자(교사 또는 admin)
  body text not null,
  read_at timestamptz,          -- 수신측 읽음 시각
  created_at timestamptz default now()
);
create index if not exists idx_messages_thread on messages(teacher_id, created_at desc);
-- RLS: msg_select(admin 전체 or teacher_id=본인) /
--      msg_insert(sender_id=본인 AND (admin or teacher_id=본인)) /
--      msg_update(당사자만) / DELETE 정책 없음(의도적)

-- message_thread_status (적용 완료) — 관리자 '처리됨' 마커
create table if not exists message_thread_status (
  teacher_id uuid primary key references profiles(id) on delete cascade,
  resolved_at timestamptz,
  updated_at timestamptz default now()
);
-- RLS: mts_all(admin 전용, for all)

-- notifications_type_check (적용 완료):
-- type in ('grammar_done','report','admin_reply','stamp','teacher_comment','briefing','message')
-- ⚠️ 'message' 누락 시 쪽지 알림이 조용히 실패(step402 briefing 사고와 동일 패턴) — 이미 추가됨.

-- 검증: select count(*) from messages; select * from message_thread_status limit 1;
