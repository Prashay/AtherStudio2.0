import { javaImportSuggestions, maskJavaNonCode } from './javaImports.js'

const docsRoot = 'https://docs.oracle.com/en/java/javase/17/docs/api/java.base/'
const mapTypes = 'Map HashMap LinkedHashMap TreeMap SortedMap NavigableMap ConcurrentMap ConcurrentHashMap'.split(' ')
const mapMethods = {
  containsKey: ['boolean containsKey(Object key)', 'Checks whether the map has a mapping for the given key.', 'containsKey(java.lang.Object)'],
  containsValue: ['boolean containsValue(Object value)', 'Checks whether at least one entry has the given value.', 'containsValue(java.lang.Object)'],
  get: ['V get(Object key)', 'Looks up the value associated with a key.', 'get(java.lang.Object)'],
  put: ['V put(K key, V value)', 'Associates the key with a value and returns the previous value.', 'put(K,V)'],
}

export function getJavaHint(source, line, column, diagnostics) {
  const code = maskJavaNonCode(source)
  const lines = code.split('\n')
  const text = lines[line - 1] || ''
  const token = [...text.matchAll(/[\w$]+/g)].find((match) => column >= match.index && column <= match.index + match[0].length)
  const diagnostic = diagnostics.find((item) => item.column - 1 >= (token?.index ?? column) &&
    item.column - 1 <= (token ? token.index + token[0].length : column))
  if (!token) return diagnostic ? { diagnostic } : null
  const [name] = token
  const before = text.slice(0, token.index)
  const unqualified = !/\.\s*$/.test(before)
  const result = { diagnostic }
  if (name === 'HashMap' && unqualified &&
    !/\b(?:class|interface|record|enum)\s+HashMap\b/.test(code) &&
    !/\bimport\s+(?!java\.util\.HashMap\b)[\w.]+\.HashMap\s*;/.test(code)) {
    result.signature = 'class java.util.HashMap<K, V>'
    result.description = 'Stores key–value pairs in a hash table. Iteration order is unspecified.'
    result.url = docsRoot + 'java/util/HashMap.html'
    if (javaImportSuggestions(source, line).includes('java.util.HashMap')) result.importName = 'java.util.HashMap'
    const declaration = /^\s+(\w+)\s*=\s*new\s+HashMap\s*<>\s*\(\s*\)\s*;/.exec(text.slice(token.index + name.length))
    if (declaration && /\[rawtypes\]/.test(diagnostic?.message || '')) {
      const offset = lines.slice(0, line - 1).reduce((sum, part) => sum + part.length + 1, 0) + token.index + name.length
      result.fix = { offset, text: '<Object, Object>', label: `Change type of ${declaration[1]} to HashMap<Object, Object>` }
    }
  }
  const receiver = /([\w$]+)\s*\.\s*$/.exec(before)?.[1]
  const method = Object.hasOwn(mapMethods, name) ? mapMethods[name] : null
  if (receiver && method && /^\s*\(/.test(text.slice(token.index + name.length))) {
    const prefix = lines.slice(0, line - 1).join('\n') + '\n' + before
    const declarations = [...prefix.matchAll(/\b([\w.]+)(?:\s*<[^;={}]*>)?\s+([\w$]+)\s*(?:=\s*new\s+([\w.]+)|(?=[=;,)\[]))/g)]
    const last = declarations.findLast((entry) => entry[2] === receiver)
    if (last && mapTypes.includes((last[1] === 'var' ? last[3] : last[1])?.split('.').at(-1))) {
      const [signature, description, anchor] = method
      Object.assign(result, { signature, description, url: docsRoot + 'java/util/Map.html#' + anchor })
    }
  }
  return result.diagnostic || result.signature ? result : null
}
