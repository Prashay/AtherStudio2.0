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
  breakpoint: 'M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z'
}

export default function TreeIcon({ name }) {
  if (name === 'maven') return <i aria-hidden="true" className="tree-maven-mark">m</i>
  return <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}
