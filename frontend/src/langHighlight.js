// Lightweight per-language syntax highlighters for the code editor.
// Each returns an array of lines; each line is an array of { text, kind } tokens.
// `kind` becomes the CSS class `java-<kind>` (shared with the Java highlighter).

function push(lines, text, kind) {
  text.split('\n').forEach((part, index) => {
    if (index) lines.push([])
    if (!part) return
    const line = lines.at(-1)
    if (line.at(-1)?.kind === kind) line.at(-1).text += part
    else line.push({ text: part, kind })
  })
}

function tokenize(source, pattern, classify) {
  const lines = [[]]
  let state = {}
  for (const match of source.matchAll(pattern)) {
    const kind = classify(match[0], match, source, state) || ''
    push(lines, match[0], kind)
  }
  return lines
}

const words = (s) => new Set(s.split(/\s+/).filter(Boolean))

/* ───────── XML / HTML / SVG ───────── */
export function xmlHighlight(source) {
  const lines = [[]]
  const pattern = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<!DOCTYPE[^>]*>?|<\/?[\w:.-]+|\/?>|&[#\w]+;|[^<&]+|[^]/gi
  let inTag = false
  for (const [token] of source.matchAll(pattern)) {
    if (token.startsWith('<!--')) { push(lines, token, 'comment'); continue }
    if (token.startsWith('<![CDATA[')) { push(lines, token, 'xml-cdata'); continue }
    if (token.startsWith('<?') || /^<!DOCTYPE/i.test(token)) { push(lines, token, 'xml-prolog'); continue }
    if (/^<\/?[\w:.-]+$/.test(token)) {
      const slash = token.startsWith('</') ? '</' : '<'
      push(lines, slash, 'xml-punct'); push(lines, token.slice(slash.length), 'xml-tag'); inTag = true; continue
    }
    if (token === '>' || token === '/>') { push(lines, token, 'xml-punct'); inTag = false; continue }
    if (token.startsWith('&') && token.endsWith(';')) { push(lines, token, 'xml-entity'); continue }
    if (inTag) {
      for (const [part] of token.matchAll(/"[^"]*"?|'[^']*'?|[\w:.-]+(?=\s*=)|=|[^"'=]+?(?=[\w:.-]+\s*=|["'=]|$)|[^]/g)) {
        const kind = /^["']/.test(part) ? 'xml-value' : part === '=' ? 'xml-punct' : /^[\w:.-]+$/.test(part) ? 'xml-attr' : ''
        push(lines, part, kind)
      }
      continue
    }
    push(lines, token, '')
  }
  return lines
}

/* ───────── Python ───────── */
const PY_KW = words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case')
const PY_LIT = words('True False None')
const PY_BUILTIN = words('print len range str int float bool list dict set tuple open type isinstance super enumerate zip map filter sorted min max sum abs any all input self cls object Exception ValueError TypeError KeyError')
export function pythonHighlight(source) {
  const pattern = /#[^\n]*|[rbuRBUfF]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|@[\w.]+|\b(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?j?)\b|[A-Za-z_]\w*|[^]/g
  let prev = ''
  return tokenize(source, pattern, (t, m, src) => {
    let kind = ''
    if (t.startsWith('#')) kind = 'comment'
    else if (/^[rbuRBUfF]{0,2}["']/.test(t)) kind = /^[rbuRBUfF]{0,2}("""|''')/.test(t) && /^\s*$/.test(src.slice(src.lastIndexOf('\n', m.index) + 1, m.index)) ? 'doc' : 'string'
    else if (t.startsWith('@')) kind = 'annotation'
    else if (/^\d/.test(t) || PY_LIT.has(t)) kind = 'literal'
    else if (PY_KW.has(t)) kind = 'keyword'
    else if (prev === 'def') kind = 'method'
    else if (prev === 'class') kind = 'type'
    else if (t === 'self' || t === 'cls') kind = 'self'
    else if (PY_BUILTIN.has(t)) kind = 'builtin'
    else if (/^[A-Za-z_]\w*$/.test(t) && /^\s*\(/.test(src.slice(m.index + t.length))) kind = 'method'
    else if (/^[A-Z][A-Za-z0-9]*$/.test(t) && /[a-z]/.test(t)) kind = 'type'
    if (/\S/.test(t)) prev = t
    return kind
  })
}

/* ───────── C-family: JS / TS / Kotlin / Go / Rust / C / C++ / C# / Swift / Dart / PHP / Groovy ───────── */
const C_LANGS = {
  js: 'async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield as',
  ts: 'async await break case catch class const continue debugger default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of return set static super switch this throw try typeof var void while with yield as type namespace declare readonly abstract private protected public keyof infer satisfies',
  kt: 'as break class continue do else for fun if in interface is object package return super this throw try typealias val var when while by catch constructor data enum finally get import init internal lateinit open override private protected public sealed set suspend companion inline reified',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  rs: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
  c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual override new delete this using try catch throw bool true false nullptr include define ifdef ifndef endif',
  cs: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sbyte sealed short sizeof static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await record get set init',
  swift: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch is rethrows super self Self throw throws try async await',
  dart: 'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory final finally for get if implements import in interface is late library mixin new on operator part required rethrow return set show static super switch sync this throw try typedef var void while with yield',
  php: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include instanceof insteadof interface isset list match namespace new or print private protected public readonly require return static switch throw trait try unset use var while yield',
  groovy: 'abstract as assert break case catch class const continue def default do else enum extends final finally for goto if implements import in instanceof interface new package private protected public return static super switch this throw throws trait try var void while plugins dependencies repositories implementation testImplementation'
}
const C_LIT = words('true false null undefined nil None NaN Infinity')
const C_TYPES = words('string number boolean any unknown never object symbol bigint int long float double char byte short bool void String Int Long Float Double Boolean Unit Any usize isize u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 str')
export function cLikeHighlight(source, lang) {
  const kw = words(C_LANGS[lang] || C_LANGS.js)
  const jsx = lang === 'js' || lang === 'ts'
  const pattern = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|#(?:include|define|if|ifdef|ifndef|endif|pragma|else)\b[^\n]*|`(?:\\[^]|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|@[\w.]+|<\/?[A-Za-z][\w.]*|\$[\w]+|\b(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?)[fFdDlLuUn]?\b|[A-Za-z_]\w*|[^]/g
  return tokenize(source, pattern, (t, m, src) => {
    if (t.startsWith('//') || t.startsWith('/*')) return 'comment'
    if (t.startsWith('#')) return 'annotation'
    if (/^[`"']/.test(t)) return lang === 'rs' && t.startsWith("'") && t.length <= 4 ? 'string' : 'string'
    if (t.startsWith('@')) return 'annotation'
    if (t.startsWith('$')) return lang === 'php' ? 'variable' : ''
    if (t.startsWith('<') && t.length > 1) return jsx ? 'xml-tag' : ''
    if (/^\d/.test(t) || C_LIT.has(t)) return 'literal'
    if (kw.has(t)) return 'keyword'
    if (C_TYPES.has(t)) return 'type'
    if (/^\s*\(/.test(src.slice(m.index + t.length)) && /^[A-Za-z_]\w*$/.test(t)) return 'method'
    if (/^[A-Z][A-Za-z0-9]*$/.test(t) && /[a-z]/.test(t)) return 'type'
    if (jsx && /^[A-Za-z_]\w*$/.test(t) && /^\s*:(?!:)/.test(src.slice(m.index + t.length)) && /[{,]\s*$/.test(src.slice(Math.max(0, m.index - 40), m.index))) return 'property'
    return ''
  })
}

/* ───────── CSS / SCSS / LESS ───────── */
export function cssHighlight(source) {
  const lines = [[]]
  const pattern = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|@[\w-]+|#[\da-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|em|rem|%|vh|vw|dvh|s|ms|deg|fr|ch|ex|pt)?\b|--[\w-]+|\$[\w-]+|[\w-]+(?=\s*\()|[\w-]+(?=\s*:)|[{};:,()]|[^\s{};:,()"'@#]+|\s+|[^]/g
  let depth = 0
  let inValue = false
  for (const [t] of source.matchAll(pattern)) {
    let kind = ''
    if (t.startsWith('/*') || t.startsWith('//')) kind = 'comment'
    else if (/^["']/.test(t)) kind = 'string'
    else if (t.startsWith('@')) kind = 'keyword'
    else if (t === '{') { depth++; inValue = false; kind = 'xml-punct' }
    else if (t === '}') { depth = Math.max(0, depth - 1); inValue = false; kind = 'xml-punct' }
    else if (t === ';') { inValue = false; kind = 'xml-punct' }
    else if (t === ':' && depth > 0 && !inValue) { inValue = true; kind = 'xml-punct' }
    else if (/^#[\da-fA-F]{3,8}$/.test(t) && (inValue || depth === 0 && false)) kind = 'literal'
    else if (/^-?\d*\.?\d/.test(t) && inValue) kind = 'literal'
    else if (t.startsWith('--') || t.startsWith('$')) kind = 'variable'
    else if (/^\s+$/.test(t)) kind = ''
    else if (depth > 0 && !inValue && /^[\w-]+$/.test(t)) kind = 'property'
    else if (inValue && /^[\w-]+$/.test(t)) kind = /^\s*\(/.test(t) ? 'method' : 'css-value'
    else if (!inValue) kind = 'css-selector'
    push(lines, t, kind)
  }
  return lines
}

/* ───────── Shell / Dockerfile ───────── */
const SH_KW = words('if then else elif fi for while until do done case esac in function return exit export local readonly source alias unset set echo cd sudo')
const DOCKER_KW = words('FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS')
export function shellHighlight(source, docker = false) {
  const pattern = /#[^\n]*|"(?:\\.|[^"\\])*"?|'[^']*'?|\$\{[^}]*\}?|\$[\w@#?*!$-]+|--?[\w-]+|\b\d+\b|[A-Za-z_][\w-]*|[^]/g
  return tokenize(source, pattern, (t, m, src) => {
    if (t.startsWith('#') && (m.index === 0 || /\s/.test(src[m.index - 1]))) return 'comment'
    if (/^["']/.test(t)) return 'string'
    if (t.startsWith('$')) return 'variable'
    if (/^--?[\w-]+$/.test(t) && t.length > 1 && /\s/.test(src[m.index - 1] || ' ')) return 'annotation'
    if (/^\d+$/.test(t)) return 'literal'
    if (docker && DOCKER_KW.has(t)) return 'keyword'
    if (SH_KW.has(t)) return 'keyword'
    const lineStart = src.lastIndexOf('\n', m.index - 1) + 1
    if (!docker && /^\s*$/.test(src.slice(lineStart, m.index))) return 'method'
    return ''
  })
}

/* ───────── properties / ini / toml / .env ───────── */
export function propertiesHighlight(source) {
  return source.split('\n').map((line) => {
    const tokens = []
    if (/^\s*[#;!]/.test(line)) return [{ text: line, kind: 'comment' }]
    const section = /^(\s*)(\[\[?[^\]]*\]\]?)(.*)$/.exec(line)
    if (section) {
      if (section[1]) tokens.push({ text: section[1], kind: '' })
      tokens.push({ text: section[2], kind: 'xml-tag' })
      if (section[3]) tokens.push({ text: section[3], kind: 'comment' })
      return tokens
    }
    const kv = /^(\s*)([^=:\s][^=:]*?)(\s*[=:]\s*)(.*)$/.exec(line)
    if (!kv) return line ? [{ text: line, kind: '' }] : []
    if (kv[1]) tokens.push({ text: kv[1], kind: '' })
    tokens.push({ text: kv[2], kind: 'property' })
    tokens.push({ text: kv[3], kind: 'xml-punct' })
    const value = kv[4]
    if (value) {
      const kind = /^["'].*["']?$/.test(value) ? 'string' : /^(true|false|yes|no|on|off|-?\d+(\.\d+)?)$/i.test(value.trim()) ? 'literal' : 'css-value'
      tokens.push({ text: value, kind })
    }
    return tokens
  })
}

/* ───────── SQL ───────── */
const SQL_KW = words('select from where and or not insert into values update set delete create table drop alter add column index primary key foreign references join left right inner outer full on as group by order having limit offset distinct union all case when then else end is null like in between exists view trigger procedure function begin commit rollback default unique constraint asc desc count sum avg min max')
export function sqlHighlight(source) {
  const pattern = /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:''|[^'])*'?|"[^"]*"?|`[^`]*`?|\b\d+(?:\.\d+)?\b|[A-Za-z_]\w*|[^]/g
  return tokenize(source, pattern, (t, m, src) => {
    if (t.startsWith('--') || t.startsWith('/*')) return 'comment'
    if (t.startsWith("'")) return 'string'
    if (/^["`]/.test(t)) return 'property'
    if (/^\d/.test(t)) return 'literal'
    if (SQL_KW.has(t.toLowerCase())) return 'keyword'
    if (/^\s*\(/.test(src.slice(m.index + t.length))) return 'method'
    return ''
  })
}

/* ───────── Markdown ───────── */
export function markdownHighlight(source) {
  let fence = false
  return source.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return [{ text: line, kind: 'md-fence' }] }
    if (fence) return line ? [{ text: line, kind: 'md-code' }] : []
    if (/^#{1,6}\s/.test(line)) return [{ text: line, kind: 'md-heading' }]
    if (/^\s*>/.test(line)) return [{ text: line, kind: 'comment' }]
    const tokens = []
    const pattern = /`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|\[[^\]]*\]\([^)]*\)|^\s*(?:[-*+]|\d+\.)\s|[^`*_[]+|[^]/g
    for (const [t] of line.matchAll(pattern)) {
      const kind = t.startsWith('`') ? 'md-code'
        : /^(\*\*|__)/.test(t) ? 'md-bold'
        : /^\*[^*]/.test(t) && t.length > 2 ? 'md-italic'
        : t.startsWith('[') ? 'md-link'
        : /^\s*(?:[-*+]|\d+\.)\s$/.test(t) ? 'md-list' : ''
      if (tokens.at(-1)?.kind === kind) tokens.at(-1).text += t
      else tokens.push({ text: t, kind })
    }
    return tokens
  })
}

const EXT = {
  xml: 'xml', html: 'xml', htm: 'xml', xhtml: 'xml', svg: 'xml', fxml: 'xml', xsd: 'xml', xsl: 'xml', vue: 'xml', plist: 'xml', iml: 'xml',
  py: 'py', pyw: 'py', pyi: 'py',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  kt: 'kt', kts: 'kt', go: 'go', rs: 'rs', c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c', cs: 'cs', swift: 'swift', dart: 'dart', php: 'php',
  groovy: 'groovy', gradle: 'groovy', scala: 'kt',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh', bat: 'sh', cmd: 'sh', ps1: 'sh',
  properties: 'props', ini: 'props', cfg: 'props', conf: 'props', toml: 'props', env: 'props', editorconfig: 'props', gitignore: 'sh',
  sql: 'sql', md: 'md', markdown: 'md', mdx: 'md'
}

export function langHighlight(path = '', source = '') {
  const name = path.split(/[\\/]/).pop().toLowerCase()
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) return shellHighlight(source, true)
  if (name === 'makefile') return shellHighlight(source)
  if (name.startsWith('.env')) return propertiesHighlight(source)
  const ext = name.includes('.') ? name.split('.').pop() : ''
  const lang = EXT[ext]
  if (!lang || source.length > 400000) return null
  switch (lang) {
    case 'xml': return xmlHighlight(source)
    case 'py': return pythonHighlight(source)
    case 'css': return cssHighlight(source)
    case 'sh': return shellHighlight(source)
    case 'props': return propertiesHighlight(source)
    case 'sql': return sqlHighlight(source)
    case 'md': return markdownHighlight(source)
    default: return cLikeHighlight(source, lang)
  }
}
