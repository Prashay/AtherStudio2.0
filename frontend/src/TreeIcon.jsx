import React from 'react'

const paths = {
  folder: 'M3 19V5h7l2 3h9v11z',
  package: 'M3 19V5h7l2 3h9v11z M9 13h6v4H9z',
  file: 'M6 3h8l4 4v14H6z M14 3v5h4',
  java: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z M15 9a4 4 0 1 0 0 6',
  method: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z M8 15V9l4 4 4-4v6',
  reload: 'M19 9a8 8 0 1 0 1 7m-1-12v5h-5',
  execute: 'M3 5h18v14H3z M7 9l3 3-3 3m6 0h4',
  offline: 'm3 3 18 18M4 10a13 13 0 0 1 4-2m4-1a14 14 0 0 1 8 3m-13 4a8 8 0 0 1 5-2m-1 6h2',
  skip: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M6 18 18 6',
  expand: 'm8 9 4-4 4 4m-8 6 4 4 4-4',
  collapse: 'm8 5 4 4 4-4m-8 14 4-4 4 4',
  play: 'm8 5 12 7-12 7z',
  trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15m-8 4v7m4-7v7',
  debug: 'M8 9h8v7a4 4 0 0 1-8 0z M9 9V7a3 3 0 0 1 6 0v2M9 5 7 3m8 2 2-2M4 10l4 2m-4 5 4-2m8-3 4-2m-4 5 4 2m-8-8v11',
  stop: 'M6 6h12v12H6z',
  next: 'M4 15v-3a5 5 0 0 1 5-5h10m-4-4 4 4-4 4M5 19h14',
  into: 'M12 3v12m-5-5 5 5 5-5M5 20h14',
  out: 'M12 15V3m-5 5 5-5 5 5M5 20h14',
  breakpoint: 'M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  docker: 'M4 13h16c0 4-3.5 6-8 6s-8-2-8-6z M7 10h2v2H7z M10 10h2v2h-2z M13 10h2v2h-2z M10 7h2v2h-2z',
  yaml: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 13h6 M9 16h4',
  xml: 'M8 8l-4 4 4 4 M16 8l4 4-4 4 M13 7l-2 10',
  image: 'M4 5h16v14H4z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M4 16l4.5-4.5 3.5 3.5 3-3 5 4',
  text: 'M6 3h8l4 4v14H6z M14 3v5h4 M8 11h8 M8 14h8 M8 17h5'
}

export function fileIconName(name = '', isDir = false, isPackage = false) {
  if (isDir) {
    if (name === 'target' || name === 'build' || name === 'dist') return 'folder-target'
    return isPackage ? 'package' : 'folder'
  }
  const lower = name.toLowerCase()
  if (lower === 'pom.xml') return 'maven'
  if (lower.startsWith('dockerfile') || lower.includes('docker-compose')) return 'docker'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.json') || lower.endsWith('.webmanifest')) return 'json'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.xml') || lower.endsWith('.svg')) return 'xml'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js'
  if (lower.endsWith('.jsx') || lower.endsWith('. tsx') || lower.endsWith('.ts')) return 'ts'
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.ico') || lower.endsWith('.webp')) return 'image'
  if (lower.endsWith('.properties') || lower.endsWith('.env') || lower.endsWith('.conf') || lower.endsWith('.ini') || lower === 'cname' || lower === 'license') return 'text'
  return 'file'
}

export default function TreeIcon({ name }) {
  if (name === 'maven') return <i aria-hidden="true" className="tree-maven-mark">m</i>
  if (name === 'json') return <i aria-hidden="true" className="tree-badge-icon tree-json-mark">{'{}'}</i>
  if (name === 'html') return <i aria-hidden="true" className="tree-badge-icon tree-html-mark">{'<>'}</i>
  if (name === 'markdown') return <i aria-hidden="true" className="tree-badge-icon tree-md-mark">{'M↓'}</i>
  if (name === 'js') return <i aria-hidden="true" className="tree-badge-icon tree-js-mark">{'JS'}</i>
  if (name === 'ts') return <i aria-hidden="true" className="tree-badge-icon tree-ts-mark">{'TS'}</i>
  if (name === 'css') return <i aria-hidden="true" className="tree-badge-icon tree-css-mark">{'#'}</i>
  if (name === 'play') {
    return <svg aria-hidden="true" className="tree-svg-icon tree-svg-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="m7 5 13 7-13 7z" /></svg>
  }
  if (name === 'stop') {
    return <svg aria-hidden="true" className="tree-svg-icon tree-svg-stop" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="5.5" width="13" height="13" rx="2" /></svg>
  }
  if (name === 'ai' || name === 'sparkles' || name === 'assistant') {
    return (
      <svg aria-hidden="true" className="tree-svg-icon tree-svg-ai" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.5C12 7.5 8 11.5 3 11.5C8 11.5 12 15.5 12 20.5C12 15.5 16 11.5 21 11.5C16 11.5 12 7.5 12 2.5Z" fill="currentColor" fillOpacity="0.22" />
        <path d="M18.5 2.5C18.5 4.5 17 6 15 6C17 6 18.5 7.5 18.5 9.5C18.5 7.5 20 6 22 6C20 6 18.5 4.5 18.5 2.5Z" fill="currentColor" fillOpacity="0.3" />
      </svg>
    )
  }
  if (name === 'folder-target') {
    return <svg aria-hidden="true" className="tree-target-folder" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths.folder} /></svg>
  }
  const d = paths[name] || paths.file
  return <svg aria-hidden="true" className={`tree-svg-icon tree-svg-${name}`} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
}
