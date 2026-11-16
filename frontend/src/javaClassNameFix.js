import { maskJavaNonCode } from './javaImports.js'

export function javaClassNameFix(path, source, line, diagnostic) {
  if (!diagnostic || !/should be declared in a file named /.test(diagnostic.message)) return null
  const filename = path.split(/[\\/]/).at(-1)
  if (!filename?.endsWith('.java')) return null
  const name = filename.slice(0, -5)
  if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name) ||
    /^(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|module|native|new|package|permits|private|protected|public|record|return|sealed|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|var|void|volatile|while|yield|true|false|null|_)$/.test(name)) return null
  const code = maskJavaNonCode(source)
  const declaration = /\b(?:class|interface|enum|record)\s+([\p{L}_$][\p{L}\p{N}_$]*)/gu
  const types = [...code.matchAll(declaration)]
  const current = types.find((type) => code.slice(0, type.index).split('\n').length === line &&
    diagnostic.message.includes(type[1] + '.java'))
  if (!current || types.some((type) => type[1] === name)) return null
  const previousName = current[1]
  const nameOffset = current.index + current[0].lastIndexOf(previousName)
  const occurrences = [...code.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)]
    .filter((token) => token[0] === previousName && !code.slice(0, token.index).trimEnd().endsWith('.'))
  let renamed = ''
  let offset = 0
  for (const token of occurrences) {
    renamed += source.slice(offset, token.index) + name
    offset = token.index + previousName.length
  }
  return {
    offset: nameOffset - (code.lastIndexOf('\n', nameOffset - 1) + 1),
    label: 'Rename class to ' + name,
    preview: previousName + ' → ' + name,
    source: renamed + source.slice(offset),
    caret: nameOffset + occurrences.filter((token) => token.index < nameOffset).length * (name.length - previousName.length) + name.length,
    message: diagnostic.message,
  }
}
