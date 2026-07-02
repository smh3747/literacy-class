// 동의서 일괄 인쇄 (감사 증빙용) — 온라인/종이로 접수된 "동의 완료" 학생만 1인 1페이지로 출력.
//   데이터·권한은 제출된 동의서 보기(submissions.js)와 동일: 교사 RLS로 profiles·consents 직접 SELECT.
// ★PII 가드: 임퍼소네이션(admin 사칭) 중에는 로드/표시 차단(동의서 보기와 동일 규칙).
// ★단일 인쇄와 달리 학생 수만큼 렌더 → ConsentDocument에 bulk 전달(단일 인쇄 트릭 생략) + page-break로 페이지 분리.
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '../../../../lib/supabase'
import ConsentDocument from '../../../../components/ConsentDocument'
import { displayStudentName } from '../../../../lib/displayName'
import { getEffectiveProfile, withImpersonation } from '../../../../lib/impersonation'

export default function ConsentBulkPrintPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [classInfo, setClassInfo] = useState(null)
  const [isImpersonating, setIsImpersonating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])   // 동의 완료(valid 있는) 학생만

  useEffect(() => { checkAuth() }, [])

  const checkAuth = async () => {
    const { profile, isImpersonating: imp } = await getEffectiveProfile('*, classes:class_id(id, name, code, grade)')
    if (!profile) { router.push('/teacher/login'); return }
    if (profile.role !== 'teacher' && profile.role !== 'admin') {
      await supabase.auth.signOut(); router.push('/teacher/login'); return
    }
    setIsImpersonating(imp)
    setUser(profile)
    setClassInfo(profile.classes)
    // ★PII 보호: 임퍼소네이션 중에는 동의 데이터를 불러오지 않음
    if (!imp && profile.classes?.id) {
      await loadData(profile.classes.id)
    }
    setLoading(false)
  }

  const loadData = async (classId) => {
    // submissions.js loadData와 동일 소스 — 전체 학생 + 동의 이력
    const { data: studs } = await supabase.from('profiles').select('*')
      .eq('class_id', classId).eq('role', 'student')
    const { data: consents } = await supabase.from('consents')
      .select('id, student_id, parent_name, signature, consent_items, source, consented_at')
      .eq('class_id', classId)
      .order('consented_at', { ascending: false })
    const byStudent = {}
    for (const c of consents || []) {
      if (!byStudent[c.student_id]) byStudent[c.student_id] = []
      byStudent[c.student_id].push(c)
    }
    const list = (studs || [])
      .filter(s => !s.is_hidden)
      .map(s => ({
        student: s,
        // 유효 동의 = 철회 제외 최신 (감사 증빙 대상)
        valid: (byStudent[s.id] || []).find(c => c.parent_name !== '(동의 철회)') || null,
      }))
      .filter(r => r.valid)   // ★동의 완료(실제 동의 기록 있는) 학생만
      .sort((a, b) => {
        const na = parseInt(a.student.number) || 999, nb = parseInt(b.student.number) || 999
        if (na !== nb) return na - nb
        return displayStudentName(a.student).localeCompare(displayStudentName(b.student))
      })
    setRows(list)
  }

  const logout = async () => { await supabase.auth.signOut(); router.push('/') }
  const todayText = () => { try { return new Date().toLocaleDateString('ko-KR') } catch { return '' } }

  if (loading) return <div className="min-h-screen flex items-center justify-center">로딩 중...</div>

  return (
    <>
      <Head><title>동의서 일괄 인쇄 - 다온클래스</title></Head>
      <style>{`
        @media print {
          .bulk-doc-wrap { page-break-after: always; }
          .bulk-doc-wrap:last-child { page-break-after: auto; }
        }
      `}</style>
      <div className="min-h-screen bg-gray-50">
        {/* 툴바 (인쇄 제외) */}
        <div className="no-print max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href={withImpersonation('/teacher/students/consent/submissions')} className="text-gray-600">←</Link>
            <h1 className="text-lg font-bold">동의서 일괄 인쇄</h1>
            {classInfo && <span className="text-sm text-gray-500">· {classInfo.name}</span>}
          </div>
          {!isImpersonating && rows.length > 0 && (
            <button onClick={() => window.print()}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark">🖨️ 인쇄 / PDF 저장</button>
          )}
        </div>

        {isImpersonating ? (
          <div className="no-print max-w-3xl mx-auto px-4">
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-sm text-amber-900">
              📖 읽기 전용(관리자 열람) 중에는 보호자 성함·서명 등 개인정보가 담긴 동의서를 볼 수 없어요. 담임 선생님 본인 계정으로 로그인해 확인해주세요.
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="no-print max-w-3xl mx-auto px-4">
            <div className="bg-white rounded-2xl p-8 shadow-sm text-center text-sm text-gray-500">
              아직 온라인으로 접수된 동의 기록이 없어요. 동의가 접수되면 여기서 감사 증빙으로 일괄 인쇄할 수 있어요.
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 pb-10 space-y-6">
            {rows.map(({ student, valid }) => (
              <div key={student.id} className="bulk-doc-wrap">
                <ConsentDocument
                  bulk
                  school={user.school}
                  className={classInfo?.name}
                  grade={classInfo?.grade}
                  student={student}
                  parentName={valid.parent_name || ''}
                  signature={valid.signature || null}
                  consentItems={valid.consent_items || ['privacy', 'ai_processing']}
                  consentedAt={valid.consented_at || null}
                  status={valid.source || 'paper'}
                />
                <p className="bulk-stamp text-xs text-gray-500 mt-2">
                  본 문서는 {todayText()} 온라인으로 접수된 동의 기록의 출력본입니다.
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
