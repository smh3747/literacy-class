// 소스 스냅샷 번들 생성 (읽기 전용 — 소스 파일을 마크다운으로 묶기만)
// 출력: _snapshot/SNAPSHOT-pages.md, -components.md, -lib.md, -migrations.md
const fs = require('fs')
const path = require('path')

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, '_snapshot')
fs.mkdirSync(OUT_DIR, { recursive: true })

// 그룹: [출력파일, 시작디렉터리, 확장자]
const GROUPS = [
  { name: 'pages',      dir: 'pages',      exts: ['.js', '.jsx', '.ts', '.tsx'] },
  { name: 'components', dir: 'components', exts: ['.js', '.jsx', '.ts', '.tsx'] },
  { name: 'lib',        dir: 'lib',        exts: ['.js', '.jsx', '.mjs', '.ts'] },
  { name: 'migrations', dir: 'migrations', exts: ['.sql'] },
]

function walk(dir, exts, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (['node_modules', '.next', '.git', '_snapshot'].includes(ent.name)) continue
      walk(full, exts, acc)
    } else if (exts.includes(path.extname(ent.name).toLowerCase())) {
      acc.push(full)
    }
  }
  return acc
}

function langOf(file) {
  const e = path.extname(file).toLowerCase()
  if (e === '.sql') return 'sql'
  if (e === '.ts' || e === '.tsx') return 'ts'
  return 'js'
}

// 파일 안에 백틱 펜스가 있어도 안 깨지게: 본문 최장 백틱런 + 1 (최소 3)
function fenceFor(content) {
  let max = 0, run = 0
  for (const ch of content) {
    if (ch === '`') { run++; if (run > max) max = run } else run = 0
  }
  return '`'.repeat(Math.max(3, max + 1))
}

const report = []
for (const g of GROUPS) {
  const files = walk(path.join(ROOT, g.dir), g.exts).sort()
  let md = `# SNAPSHOT — ${g.dir}/  (${files.length} files)\n\n`
  md += `> 다온클래스 소스 스냅샷. 생성 기준 디렉터리: \`${g.dir}/\`\n\n`
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/')
    const content = fs.readFileSync(f, 'utf8')
    const fence = fenceFor(content)
    md += `## ${rel}\n\n${fence}${langOf(f)}\n${content}\n${fence}\n\n`
  }
  const outPath = path.join(OUT_DIR, `SNAPSHOT-${g.name}.md`)
  fs.writeFileSync(outPath, md, 'utf8')
  report.push({ file: `_snapshot/SNAPSHOT-${g.name}.md`, files: files.length, bytes: Buffer.byteLength(md, 'utf8') })
}

console.log('=== 스냅샷 생성 완료 ===')
for (const r of report) {
  console.log(`${r.file}  |  ${r.files} files  |  ${(r.bytes / 1024).toFixed(1)} KB`)
}
