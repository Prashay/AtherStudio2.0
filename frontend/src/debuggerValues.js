import { maskJavaNonCode } from './javaImports.js'

function arrayValues(value) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

export function debuggerValues(variables = [], source = '', watches = []) {
  const values = new Map(variables.map(({ name, value }) => [name, value]))
  const line = maskJavaNonCode(source)
  const derived = new Map()
  const read = (expression) => {
    if (values.has(expression)) return values.get(expression)
    const match = /^([\w$]+)(?:\.length|\[([\w$]+)\])$/.exec(expression)
    if (!match || !values.has(match[1])) return null
    const raw = values.get(match[1])
    const array = arrayValues(raw)
    if (match[2] === undefined) {
      return array ? String(array.length) : /^instance of [^\[]+\[(\d+)\]/.exec(raw)?.[1] ?? null
    }
    const subscript = values.get(match[2]) ?? match[2]
    const index = /^\d+$/.test(subscript) ? Number(subscript) : NaN
    return array && index < array.length ? JSON.stringify(array[index]) : null
  }
  for (const [name, value] of values) {
    if (value.startsWith('[') || /^instance of [^\[]+\[\d+\]/.test(value)) {
      const length = read(name + '.length')
      if (length !== null) derived.set(name + '.length', length)
    }
  }
  for (const [expression] of line.matchAll(/\b[\w$]+\s*\[\s*[\w$]+\s*\]/g)) {
    const name = expression.replace(/\s/g, '')
    const value = read(name)
    if (value !== null) derived.set(name, value)
  }
  const comparison = line.match(/\bif\s*\(\s*([\w$]+(?:\s*\[\s*[\w$]+\s*\]|\.length)?)\s*(==|!=|<=|>=|<|>)\s*([\w$]+(?:\s*\[\s*[\w$]+\s*\]|\.length)?)\s*\)/)
  let condition
  if (comparison) {
    const numeric = (expression) => {
      const text = expression.replace(/\s/g, '')
      const value = read(text) ?? text
      return /^-?(?:\d+\.?\d*|\.\d+)$/.test(value) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER ? Number(value) : NaN
    }
    const left = numeric(comparison[1])
    const right = numeric(comparison[3])
    if (Number.isFinite(left) && Number.isFinite(right)) {
      condition = String({ '==': left === right, '!=': left !== right, '<': left < right,
        '>': left > right, '<=': left <= right, '>=': left >= right }[comparison[2]])
    }
  }
  return {
    condition,
    derived: [...derived].map(([name, value]) => ({ name, value })),
    watches: watches.map((name) => ({ name, value: read(name) ?? 'Unavailable in this frame' })),
  }
}
