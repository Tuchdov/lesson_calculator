// Docstring (JSDoc) coverage for src/ and api/.
//
// Counted: every function declaration, at any depth, plus every function
// assigned to a module-level const (exported or not). Event handlers declared
// inside a component are not counted. A function is documented when a /** */
// block sits directly above it, its `export` or its `const`.
//
// Usage: node scripts/docstring-coverage.js [--min 80] [--list]
// Exits non-zero below --min (default 80), so it can gate CI.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import * as espree from 'espree'

const ROOTS = ['src', 'api']
const args = process.argv.slice(2)
const min = Number(args[args.indexOf('--min') + 1]) || 80
const list = args.includes('--list')

/**
 * Every .js/.jsx file under a directory.
 * @param {string} dir Directory to walk.
 * @returns {string[]} File paths.
 */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.jsx?$/.test(name) ? [path] : []
  })
}

/**
 * Whether a /** comment ends right above the node (blank lines aside).
 * @param {object} node The AST node the comment should precede.
 * @param {Array<object>} comments All comments in the file.
 * @param {string} code The file's source.
 * @returns {boolean} Whether the node is documented.
 */
function hasJsDoc(node, comments, code) {
  const before = comments.filter(c => c.type === 'Block' && c.value.startsWith('*') && c.end <= node.start)
  const last = before[before.length - 1]
  return !!last && code.slice(last.end, node.start).trim() === ''
}

/**
 * The functions counted in one file, each with whether it is documented.
 * @param {string} file Path of the file to scan.
 * @returns {Array<{name: string, line: number, documented: boolean}>} Counted functions.
 */
function scanFile(file) {
  const code = readFileSync(file, 'utf8')
  const ast = espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, comment: true, range: false, loc: true })
  const found = []
  const add = (name, node, docTarget) => found.push({ name, line: node.loc.start.line, documented: hasJsDoc(docTarget, ast.comments, code) })

  // Module level: declarations and function-valued consts, `export`ed or not.
  for (const statement of ast.body) {
    const inner = statement.type.startsWith('Export') && statement.declaration ? statement.declaration : statement
    if (inner.type === 'VariableDeclaration') {
      for (const d of inner.declarations) {
        if (/^(Arrow)?FunctionExpression$/.test(d.init?.type ?? '')) add(d.id.name, d, statement)
      }
    }
  }
  // Function declarations at any depth.
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'FunctionDeclaration') {
      const exported = parent?.type?.startsWith('Export')
      add(node.id?.name ?? 'default', node, exported ? parent : node)
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue
      for (const child of [].concat(value)) if (child && typeof child.type === 'string') visit(child, node)
    }
  }
  visit(ast, null)
  return found
}

const results = ROOTS.flatMap(sourceFiles).map(file => ({ file: relative('.', file), functions: scanFile(file) }))
const all = results.flatMap(r => r.functions)
const documented = all.filter(f => f.documented).length
const percent = all.length ? (documented / all.length) * 100 : 100

for (const { file, functions } of results) {
  if (!functions.length) continue
  const done = functions.filter(f => f.documented).length
  console.log(`${String(Math.round((done / functions.length) * 100)).padStart(3)}%  ${done}/${functions.length}  ${file}`)
  if (list) for (const f of functions.filter(f => !f.documented)) console.log(`        missing: ${f.name} (line ${f.line})`)
}
console.log(`\nDocstring coverage: ${percent.toFixed(1)}% (${documented}/${all.length}), minimum ${min}%`)
process.exit(percent >= min ? 0 : 1)
