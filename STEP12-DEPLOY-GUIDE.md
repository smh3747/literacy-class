# 🚀 Step 12 배포 가이드 (5단계)

이번 업데이트로 5가지 기능이 한꺼번에 추가됐어요:
1. 📝 학생 번호 인라인 편집
2. ✅ 학부모 동의서 회신 체크
3. 🔒 수업 시간 락
4. 🚨 AI 피드백 신고 + 신고함
5. 📅 주제 미리 등록 (오늘/예정/지난 그룹화)

---

## 🥇 1단계: Supabase SQL 실행 (필수)

Supabase 대시보드 → **SQL Editor** → 새 쿼리 → 아래 전체 복붙 → **Run**

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS number TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS consent_received BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS consent_received_at TIMESTAMPTZ;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS lock_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS lock_start_time TEXT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS lock_end_time TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reported BOOLEAN DEFAULT FALSE;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS report_reason TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_submissions_reported ON submissions(reported) WHERE reported = TRUE;
```

"Success" 뜨면 OK. (중복 실행해도 안전)

---

## 🥈 2단계: 새 코드 배포

`literacy-class-step12-all-features.zip` 압축 풀고, GitHub에 push 또는 Vercel에 업로드.

---

## 🥉 3단계: 1분 빠른 검증

배포 완료 후 선생님 계정으로:

1. **학생 관리** 들어가서 학생 번호 칸 클릭 → 숫자 입력 → 엔터 → 저장되는지
2. **학생 관리**에서 동의서 ✓ 버튼 토글되는지
3. **주제 관리** 들어가서 "🔒 수업 시간에만 글쓰기 허용" 체크해서 주제 하나 만들어보기
4. 학생 계정으로 들어가서 그 시간대 밖에서 제출 시도 → 🔒 알림 뜨는지
5. 학생 페이지 피드백 화면 하단 "🚨 이 피드백 이상해요" 버튼 보이는지
6. 선생님 메인 → **피드백 신고함** 메뉴 보이는지

---

## 📋 사용 흐름 요약

### 학생 번호 입력 (Step 1)
- 선생님 메인 → 학생 관리 → 번호칸 직접 클릭해서 수정
- 한 명씩 자동 저장되며, 여러 명 동시 수정 시 상단 "💾 일괄 저장" 버튼 사용

### 동의서 회신 추적 (Step 2)
- 종이 동의서를 받으면 학생별 ✓ 버튼 클릭
- 학급 상단에 회신 진행률(예: "23/27") 표시

### 수업 시간 락 (Step 3)
- 주제 등록 시 체크박스 활성화 → 시작/종료 시간 설정
- 학생은 그 시간대 밖에서 제출/수정 불가 (조회는 항상 가능)
- 한국 시간(KST) 기준

### 피드백 신고 (Step 4)
- 학생 피드백 화면 하단의 🚨 버튼 → 사유 입력(선택) → 신고
- 선생님 메인의 "피드백 신고함" 카드에 빨간 배지로 개수 표시
- 신고함에서 학생 글 + AI 피드백 전체 확인 가능
- "✓ 확인 완료" 버튼으로 신고 해제

### 주제 미리 등록 (Step 5)
- 주제 관리에서 미래 날짜로 주제 등록만 하면 끝
- 학생 페이지는 매일 자동으로 그 날짜 주제를 노출
- 주제 목록이 "오늘 / 예정 / 지난" 3개 그룹으로 정리됨

---

## ⚠️ 알아두기

- **시간 락은 클라이언트 검증**: 학생이 시스템 시간을 조작하면 우회 가능. 추후 서버 검증 추가 가능
- **신고 기능은 학생당 글마다 1회**: 같은 글에 중복 신고 안 됨
- **동의서 체크는 수동**: 종이 동의서 받은 후 선생님이 직접 ✓ 표시
