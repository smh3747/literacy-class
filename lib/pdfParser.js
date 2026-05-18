// PDF 파일에서 학생 명단 추출
// 나이스 명렬표 텍스트 PDF 대응
// 텍스트 추출 → 학년/반/번호/이름 패턴 인식

/**
 * PDF 파일을 읽어서 학생 목록을 추출
 * @param {File} file - PDF 파일 (브라우저 File 객체)
 * @returns {Promise<Array>} - [{ grade, classNum, number, name }, ...]
 */
export async function parsePdfStudentList(file) {
  // pdfjs-dist 동적 로드 (SSR 회피, 번들 크기 감소)
  const pdfjsLib = await import('pdfjs-dist/build/pdf')
  // worker 설정 - CDN으로 (Next.js와 호환성 위해)
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  // 모든 페이지에서 텍스트 + 위치 정보 추출
  const allItems = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    // 각 텍스트 조각의 x, y 좌표를 포함
    tc.items.forEach(it => {
      if (!it.str || !it.str.trim()) return
      allItems.push({
        text: it.str.trim(),
        x: it.transform[4],
        y: it.transform[5],
        page: p
      })
    })
  }

  if (allItems.length === 0) {
    throw new Error('PDF에서 텍스트를 추출할 수 없어요. 이미지로 된 PDF(스캔본)일 수 있어요. 엑셀 파일로 다시 시도해주세요.')
  }

  // y 좌표 기준으로 같은 줄(line) 묶기 (오차 ±3)
  // 정렬: 페이지 → y 내림차순 (PDF는 아래가 작은 y) → x 오름차순
  allItems.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page
    if (Math.abs(a.y - b.y) > 3) return b.y - a.y
    return a.x - b.x
  })

  const lines = []
  let current = null
  for (const it of allItems) {
    if (!current || current.page !== it.page || Math.abs(current.y - it.y) > 3) {
      current = { page: it.page, y: it.y, items: [it] }
      lines.push(current)
    } else {
      current.items.push(it)
    }
  }

  // 각 줄을 텍스트로 합치기 (x 정렬 후)
  const rows = lines.map(line => {
    line.items.sort((a, b) => a.x - b.x)
    return line.items.map(i => i.text).join(' ').trim()
  }).filter(r => r.length > 0)

  // 학생 행 패턴 찾기
  // 나이스 명렬표는 보통: "5  1  1  곽서윤" 또는 "5학년 1반 1번 곽서윤" 같은 형식
  const students = []

  for (const row of rows) {
    // 헤더 줄 스킵
    if (/^(학년|반|번호|성명|이름|비고|순번|학적|반편성)/.test(row)) continue
    if (/명렬표|출력일자|작성|페이지|page/i.test(row)) continue

    // 패턴 1: "학년숫자 반숫자 번호숫자 이름한글" (공백 또는 탭으로 구분)
    // 예: "5 1 1 곽서윤", "5  1  10  김지우"
    let m = row.match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+([가-힣]{2,5})(\s|$)/)
    if (m) {
      students.push({
        grade: m[1],
        classNum: m[2],
        number: m[3],
        name: m[4]
      })
      continue
    }

    // 패턴 2: "5학년 1반 1번 곽서윤"
    m = row.match(/(\d{1,2})학년\s*(\d{1,2})반\s*(\d{1,2})(?:번)?\s+([가-힣]{2,5})/)
    if (m) {
      students.push({
        grade: m[1],
        classNum: m[2],
        number: m[3],
        name: m[4]
      })
      continue
    }

    // 패턴 3: "01 곽서윤" 같이 번호와 이름만 (학년/반은 PDF 상단에서 추출해야 함)
    // → 일단 스킵, 추후 개선
  }

  return students
}

/**
 * PDF에서 학년/반 정보를 추출 (헤더 또는 첫 페이지에서)
 * 패턴 3 같은 경우에 보조적으로 사용
 */
export async function extractGradeClassFromPdf(file) {
  const pdfjsLib = await import('pdfjs-dist/build/pdf')
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1)
  const tc = await page.getTextContent()
  const text = tc.items.map(i => i.str).join(' ')

  const m = text.match(/(\d{1,2})학년\s*(\d{1,2})반/)
  if (m) return { grade: m[1], classNum: m[2] }
  return null
}
