// 동의서 양식 (공용) — 종이 인쇄(parent-consent.js)와 교사 뷰어(consent/submissions.js)가 함께 사용.
// props 없으면 빈칸(기존 종이 인쇄와 동일한 빈 양식). props가 있으면 그 값으로 칸을 채운다.
//   props: { school, className, student, parentName, signature, consentItems, consentedAt, status }
//   status: 'online' | 'paper' | 'none'(미동의) | undefined(빈 양식)
// 인쇄 CSS는 이 컴포넌트가 들고 다님 — 어느 페이지에서 써도 A4 한 장 압축 + "이 문서만" 인쇄.
import { displayStudentName } from '../lib/displayName'

export default function ConsentDocument({ school, className, student, parentName, signature, consentItems, consentedAt, status }) {
  const items = Array.isArray(consentItems) ? consentItems : []
  const has = (k) => items.includes(k)
  const studentName = student ? displayStudentName(student) : ''
  const gradeClassNum = [className, (student && student.number) ? `${student.number}번` : ''].filter(Boolean).join(' ')
  const d = consentedAt ? new Date(consentedAt) : null
  const dateText = d ? `날짜: ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일` : '날짜: 2026년 _____ 월 _____ 일'

  const Box = ({ on }) => (
    <span className="checkbox-sq inline-block w-4 h-4 border border-gray-700 flex-shrink-0 mt-0.5 text-center leading-[14px] text-[11px]">{on ? '✓' : ''}</span>
  )

  return (
    <>
      <style>{`
        /* 화면 표시용 */
        .consent-doc { font-size: 14px; line-height: 1.55; }
        .consent-doc h1 { font-size: 1.35rem; }
        .consent-doc h2 { font-size: 0.95rem; margin-bottom: 0.35rem; }
        .consent-doc section { margin-bottom: 0.7rem; }
        /* 서명·이름 칸: 비어 있어도 줄 높이를 고정해 행끼리 어긋나지 않게 */
        .consent-doc .sign-line { min-height: 1.6em; }

        /* 인쇄 시: 이 문서만, A4 한 장에 정확히 들어가도록 압축 */
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 portrait; margin: 10mm 12mm; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          /* ★ 빈 페이지 방지: 문서 외 래퍼가 차지하던 잔여 높이 제거
             (보이지 않는 page 래퍼의 min-h-screen=100vh가 뒤에 빈 2페이지를 만들던 문제) */
          html, body { height: auto !important; min-height: 0 !important; }
          .min-h-screen { min-height: 0 !important; }
          /* ★ 이 문서만 인쇄(주변 UI 숨김) */
          body * { visibility: hidden; }
          .consent-doc, .consent-doc * { visibility: visible; }
          .consent-doc { position: absolute; left: 0; top: 0; width: 100%; }
          .consent-doc {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
            font-size: 9.2pt !important;
            line-height: 1.35 !important;
            color: #000 !important;
            page-break-inside: avoid;
          }
          .consent-doc h1 { font-size: 13pt !important; margin: 0 0 4pt 0 !important; }
          .consent-doc h2 { font-size: 9.5pt !important; margin: 0 0 2pt 0 !important; }
          .consent-doc section { margin-bottom: 4pt !important; }
          .consent-doc p { margin: 0 0 2pt 0 !important; }
          .consent-doc ul { margin: 0 !important; padding-left: 14pt !important; }
          .consent-doc li { font-size: 8.8pt !important; line-height: 1.3 !important; margin-bottom: 1pt !important; }
          .doc-header { padding-bottom: 4pt !important; margin-bottom: 6pt !important; }
          .info-box { padding: 5pt 7pt !important; margin-bottom: 4pt !important; font-size: 8.8pt !important; }
          .consent-check { padding: 5pt 7pt !important; margin: 4pt 0 !important; }
          .consent-check label { font-size: 9pt !important; margin-bottom: 2pt !important; }
          .sign-row { margin-top: 6pt !important; }
          .sign-line { padding-top: 14pt !important; }
          .doc-footer { font-size: 8.5pt !important; margin-top: 6pt !important; padding-top: 4pt !important; }
          .checkbox-sq { width: 10pt !important; height: 10pt !important; }
        }
      `}</style>

      <div className="consent-doc bg-white rounded-2xl p-8 sm:p-10 shadow-sm">

        {/* 헤더 */}
        <div className="doc-header text-center mb-5 pb-3 border-b-2 border-gray-300">
          <h1 className="text-xl font-bold mb-1">AI 글쓰기 수업 참여 안내 및 동의서</h1>
          <p className="text-xs text-gray-600">「다온클래스」 학부모 안내</p>
          {(school || className) && <p className="text-xs text-gray-700 mt-1">{[school, className].filter(Boolean).join(' · ')}</p>}
        </div>

        {/* 인사말 */}
        <section className="mb-3">
          <p className="text-[13px] leading-relaxed">
            안녕하세요, 학부모님. 저희 학급은 학생들의 글쓰기 능력 향상을 위해 <strong>AI 기반 글쓰기 피드백 서비스</strong>를 활용한 수업을 운영합니다. 아래 내용을 확인하시고 동의 여부를 표시해 주시기 바랍니다.
          </p>
        </section>

        {/* 1. 수업 개요 + 활용 목적 통합 */}
        <section className="mb-3">
          <h2 className="font-bold text-gray-800">1. 수업 개요 및 활용 목적</h2>
          <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
            <li>매일 1개 주제로 글쓰기 → AI가 즉시 피드백 제공 (잘한 점·발전시킬 점)</li>
            <li>담임 교사가 검토 후 추가 지도, 학생은 자신의 글 누적 확인 가능</li>
            <li>활용 목적: 글쓰기 능력 향상, 자기 표현력 신장, 누적 기록을 통한 성장 확인</li>
          </ul>
        </section>

        {/* 2. 수집·처리 정보 + 보관 통합 */}
        <section className="mb-3">
          <div className="info-box bg-gray-50 border border-gray-200 rounded p-3">
            <h2 className="font-bold text-gray-800">2. 수집·처리 정보 및 보관</h2>
            <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
              <li><strong>수집 정보:</strong> 학교/학년/반/번호, 학생 성명(아이디), 학생이 작성한 글</li>
              <li><strong>이용 목적:</strong> AI 피드백 제공 및 교사 지도 자료로 활용 (그 외 용도 사용 안 함)</li>
              <li><strong>익명화:</strong> 학급 내 랭킹/통계 표시 시 자동 닉네임(예: "용감한 토끼")만 노출, 본명은 담임만 확인</li>
              <li><strong>보관 기간:</strong> 학생 글·피드백은 학기 종료 후 1년까지 보관 후 자동 삭제 (요청 시 즉시 삭제 가능)</li>
            </ul>
          </div>
        </section>

        {/* 3. 제3자 제공 */}
        <section className="mb-3">
          <h2 className="font-bold text-gray-800">3. AI 서비스 제공 업체</h2>
          <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
            <li>피드백 생성을 위해 학생 글이 <strong>Google(Gemini API)</strong>로 전송됨 (개인정보·신상정보 미포함)</li>
            <li>전송된 글의 보관·삭제는 Google의 데이터 정책에 따릅니다</li>
          </ul>
        </section>

        {/* 4. 글 공유 + 학생/학부모 권리 + 보안 통합 */}
        <section className="mb-3">
          <h2 className="font-bold text-gray-800">4. 글 공유 및 권리·보안</h2>
          <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
            <li><strong>글 공유:</strong> 학생·교사가 공유를 선택한 글에 한해, 작성자를 익명(닉네임)으로 하여 다른 학급·학교와 공유될 수 있습니다 (선택, 강제 아님)</li>
            <li>본인 정보 열람·수정·삭제 요청 가능 (담임 교사를 통해 처리), 거부 시 학습 불이익 없음</li>
            <li>HTTPS 암호화 통신, 로그인 비밀번호는 단방향 암호화 저장</li>
          </ul>
        </section>

        {/* 동의 확인 — props 있으면 체크 표시 */}
        <section className="mb-2">
          <div className="consent-check bg-blue-50 border border-blue-200 rounded p-3">
            <h2 className="font-bold text-gray-800 mb-1">📝 동의 확인</h2>
            <label className="flex items-start gap-2 mb-1 text-[13px]">
              <Box on={has('privacy')} />
              <span>위 안내 내용을 읽고 자녀의 「다온클래스」 이용에 <strong>동의합니다.</strong></span>
            </label>
            <label className="flex items-start gap-2 text-[13px]">
              <Box on={has('ai_processing')} />
              <span>자녀의 글이 AI 피드백을 위해 처리되는 것에 <strong>동의합니다.</strong></span>
            </label>
          </div>
        </section>

        {/* 서명란 — props 채움 / 빈칸 */}
        <section className="sign-row grid grid-cols-2 gap-x-8 gap-y-2 mt-4 text-[12px]">
          <div>
            <p className="text-gray-700">학년/반/번호</p>
            <div className="sign-line border-b border-gray-700 mt-3">{gradeClassNum}</div>
          </div>
          <div>
            <p className="text-gray-700">학생 성명</p>
            <div className="sign-line border-b border-gray-700 mt-3">{studentName}</div>
          </div>
          <div>
            <p className="text-gray-700">학부모 성명</p>
            <div className="sign-line border-b border-gray-700 mt-3">{parentName && parentName !== '(동의 철회)' ? parentName : ''}</div>
          </div>
          <div>
            <p className="text-gray-700">학부모 서명</p>
            {signature ? (
              <img src={signature} alt="보호자 서명" className="mt-2 border border-gray-300 rounded bg-white" style={{ maxHeight: 70, maxWidth: '100%' }} />
            ) : status === 'paper' ? (
              <div className="sign-line border-b border-gray-700 mt-3 text-[11px] text-gray-500">종이로 제출됨 (원본 보관)</div>
            ) : (
              <div className="sign-line border-b border-gray-700 mt-3 text-right pr-1 text-[11px] text-gray-600">(인)</div>
            )}
          </div>
        </section>

        {/* 푸터 */}
        <div className="doc-footer mt-4 pt-2 border-t border-gray-300 flex justify-between items-center text-[11px] text-gray-600">
          <span>본 동의서는 「개인정보 보호법」에 따라 작성. 문의: 담임 교사</span>
          <span>{dateText}</span>
        </div>

      </div>
    </>
  )
}
