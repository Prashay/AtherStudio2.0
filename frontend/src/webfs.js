// Web File System Access API & Virtual Workspace Provider
// Allows opening and editing local projects directly in the browser with ZERO local backend dependencies.

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '__pycache__', '.venv', 'venv', '.turbo', '.idea', '.vscode'
])

export function isNativeFSSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export async function pickNativeDirectory() {
  if (!isNativeFSSupported()) {
    throw new Error('Native File System Access API not supported in this browser.')
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  return handle
}

export async function buildTreeFromHandle(dirHandle, relPath = '', depth = 0, maxDepth = 12) {
  if (depth === 0 && relPath) {
    for (const part of relPath.split('/').filter(Boolean)) {
      dirHandle = await dirHandle.getDirectoryHandle(part)
    }
  }
  const children = []
  if (depth < maxDepth) {
    const entries = []
    try {
      for await (const entry of dirHandle.values()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        entries.push(entry)
      }
    } catch (error) {
      if (depth === 0) throw error
      return { name: dirHandle.name, path: relPath, type: 'dir', children: [] }
    }

    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        const sub = await buildTreeFromHandle(entry, childRel, depth + 1, maxDepth)
        children.push(sub)
      } else {
        children.push({ name: entry.name, path: childRel, type: 'file' })
      }
    }
  }

  return {
    name: relPath === '' ? dirHandle.name : dirHandle.name,
    path: relPath,
    type: 'dir',
    children
  }
}

async function resolveFileHandle(dirHandle, relPath, create = false) {
  const parts = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '').split('/')
  const fileName = parts.pop()
  let curr = dirHandle

  for (const part of parts) {
    if (!part) continue
    curr = await curr.getDirectoryHandle(part, { create })
  }

  return await curr.getFileHandle(fileName, { create })
}

export async function readFileFromHandle(dirHandle, relPath) {
  const fileHandle = await resolveFileHandle(dirHandle, relPath, false)
  const file = await fileHandle.getFile()
  const content = await file.text()
  return { content, size: file.size, type: 'file' }
}

export async function writeFileToHandle(dirHandle, relPath, content) {
  const fileHandle = await resolveFileHandle(dirHandle, relPath, true)
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
  return { ok: true, path: relPath }
}

export async function searchInHandle(dirHandle, query, maxHits = 40) {
  const needle = query.toLowerCase()
  const hits = []

  async function walk(handle, relPath) {
    if (hits.length >= maxHits) return
    for await (const entry of handle.values()) {
      if (hits.length >= maxHits) break
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        await walk(entry, childRel)
      } else if (entry.kind === 'file') {
        try {
          const file = await entry.getFile()
          if (file.size > 500000) continue
          const text = await file.text()
          const lines = text.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(needle)) {
              hits.push({
                path: childRel,
                line: i + 1,
                preview: lines[i].trim().slice(0, 160)
              })
              if (hits.length >= maxHits) break
            }
          }
        } catch {}
      }
    }
  }

  await walk(dirHandle, '')
  return hits
}

// Fallback Virtual Workspace for browsers without File System Access API
export function buildVirtualTreeFromFiles(files) {
  const name = files[0]?.webkitRelativePath?.split('/')[0] || 'Imported files'
  const root = { name, path: '', type: 'dir', children: [] }
  const fileMap = new Map()
  const directories = new Map([['', root]])

  for (const file of files) {
    const parts = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1) : [file.name]
    if (parts.some((part) => SKIP_DIRS.has(part))) continue
    const path = parts.join('/')
    if (fileMap.has(path)) continue
    let parent = root
    let directoryPath = ''
    for (const part of parts.slice(0, -1)) {
      directoryPath = directoryPath ? `${directoryPath}/${part}` : part
      if (!directories.has(directoryPath)) {
        const node = { name: part, path: directoryPath, type: 'dir', children: [] }
        parent.children.push(node)
        directories.set(directoryPath, node)
      }
      parent = directories.get(directoryPath)
    }
    parent.children.push({ name: file.name, path, type: 'file' })
    fileMap.set(path, file)
  }

  for (const directory of directories.values()) {
    directory.children.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)
  }
  return { root, fileMap }
}
