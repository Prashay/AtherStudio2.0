const typePackages = {
  'java.util': 'ArrayDeque ArrayList Arrays Collection Collections Comparator Deque EnumMap EnumSet HashMap HashSet Iterator LinkedHashMap LinkedHashSet LinkedList List ListIterator Map NavigableMap NavigableSet Objects Optional OptionalInt PriorityQueue Queue Random Scanner Set SortedMap SortedSet Spliterator StringJoiner TreeMap TreeSet UUID',
  'java.util.concurrent': 'Callable CompletableFuture ConcurrentHashMap CountDownLatch Executor ExecutorService Executors Future TimeUnit',
  'java.util.function': 'BiConsumer BiFunction Consumer Function Predicate Supplier UnaryOperator',
  'java.util.stream': 'Collectors IntStream Stream',
  'java.io': 'BufferedReader BufferedWriter File FileInputStream FileOutputStream IOException InputStream OutputStream PrintWriter',
  'java.math': 'BigDecimal BigInteger',
  'java.net': 'URI URL',
  'java.nio.file': 'Files Path Paths',
  'java.time': 'Duration Instant LocalDate LocalDateTime LocalTime Period ZoneId ZonedDateTime',
}

const importsByType = new Map(Object.entries(typePackages).flatMap(([pkg, types]) =>
  types.split(' ').map((type) => [type, pkg + '.' + type])
))

export function maskJavaNonCode(source) {
  return source.replace(/\/\*[\s\S]*?(?:\*\/|(?![\s\S]))|\/\/[^\r\n]*|"""[\s\S]*?(?:"""|(?![\s\S]))|"(?:\\.|[^"\\\r\n])*(?:"|(?=\r?$))|'(?:\\.|[^'\\\r\n])*(?:'|(?=\r?$))/gm,
    (token) => token.replace(/[^\r\n]/g, ' '))
}

export function javaImportSuggestions(source, lineNumber) {
  const code = maskJavaNonCode(source)
  const line = code.split('\n')[lineNumber - 1]
  if (!line || /^\s*(?:package|import)\b/.test(line)) return []

  const existing = [...code.matchAll(/^\s*import\s+(?:static\s+)?([\w.$]+(?:\.\*)?)\s*;/gm)].map((match) => match[1])
  const declared = new Set([...code.matchAll(/\b(?:class|interface|enum|record)\s+(\w+)/g)].map((match) => match[1]))
  const samePackage = code.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1]
  const suggestions = new Set()
  for (const match of line.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = match[0]
    const qualified = importsByType.get(name)
    if (!qualified || line.slice(0, match.index).trimEnd().endsWith('.') || declared.has(name)) continue
    const typePackage = qualified.slice(0, qualified.lastIndexOf('.'))
    if (samePackage === typePackage || existing.some((item) => item.endsWith('.' + name) || item === typePackage + '.*')) continue
    suggestions.add(qualified)
  }
  return [...suggestions]
}

export function insertJavaImport(source, qualified) {
  const code = maskJavaNonCode(source)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const statement = 'import ' + qualified + ';'
  const imports = [...code.matchAll(/^\s*import\s+(?!static\b)[\w.$*]+\s*;/gm)]
  const packageMatch = code.match(/^\s*package\s+[\w.]+\s*;/m)
  const anchor = imports.at(-1) || packageMatch
  let offset, text
  if (anchor) {
    offset = anchor.index + anchor[0].length
    // Keep a trailing comment with the declaration it describes.
    let lineEnd = source.indexOf('\n', offset)
    const trailing = source.slice(offset, lineEnd === -1 ? undefined : lineEnd)
    if (/^\s*\/\*/.test(trailing) && !trailing.includes('*/')) {
      const close = source.indexOf('*/', offset)
      if (close >= 0) lineEnd = source.indexOf('\n', close + 2)
    }
    if (lineEnd >= 0 && !code.slice(offset, lineEnd).trim()) {
      offset = lineEnd + 1
      text = (imports.length ? '' : newline) + statement + newline
      if (!imports.length && !/^\s*[\r\n]/.test(source.slice(offset))) text += newline
    } else {
      text = newline.repeat(imports.length ? 1 : 2) + statement + newline
    }
  } else {
    offset = code.search(/[^\s\uFEFF]/)
    if (offset < 0) offset = source.length
    const header = source.slice(0, offset)
    const declarationDoc = header.match(/\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*$/)
    if (declarationDoc) offset = declarationDoc.index
    text = statement + newline + newline
  }
  return { source: source.slice(0, offset) + text + source.slice(offset), offset, length: text.length }
}
