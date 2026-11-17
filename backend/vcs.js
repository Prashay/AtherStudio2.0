const { execFile, execFileSync } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs')
const path = require('node:path')

const run = promisify(execFile)

let cachedGitBin = null

function resolveGitBin() {
  if (cachedGitBin) return cachedGitBin

  // 1. Check if git is available directly in PATH
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true })
    cachedGitBin = 'git'
    return cachedGitBin
  } catch {}

  // 2. On Windows, probe common installation paths
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || ''
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'

    const candidates = [
      path.join(progFiles, 'Git', 'cmd', 'git.exe'),
      path.join(progFiles, 'Git', 'bin', 'git.exe'),
      path.join(progFilesX86, 'Git', 'cmd', 'git.exe'),
      path.join(progFilesX86, 'Git', 'bin', 'git.exe'),
      path.join(localAppData, 'Programs', 'Git', 'cmd', 'git.exe'),
      path.join(localAppData, 'Programs', 'Git', 'bin', 'git.exe')
    ]

    // Probe GitHub Desktop bundled git installations
    const ghDesktopDir = path.join(localAppData, 'GitHubDesktop')
    if (fs.existsSync(ghDesktopDir)) {
      try {
        const appDirs = fs.readdirSync(ghDesktopDir)
          .filter((d) => d.startsWith('app-'))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        for (const ad of appDirs) {
          candidates.push(path.join(ghDesktopDir, ad, 'resources', 'app', 'git', 'cmd', 'git.exe'))
        }
      } catch {}
    }

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        cachedGitBin = c
        const gitDir = path.dirname(c)
        if (!process.env.PATH?.includes(gitDir)) {
          process.env.PATH = `${gitDir};${process.env.PATH || ''}`
        }
        return cachedGitBin
      }
    }
  }

  cachedGitBin = 'git'
  return cachedGitBin
}

async function execGit(cwd, args, timeout = 15000) {
  const bin = resolveGitBin()
  const { stdout, stderr } = await run(bin, args, {
    cwd,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
  return { stdout, stderr }
}

async function getGitState(workspace) {
  if (!workspace || !fs.existsSync(workspace)) {
    return { isRepo: false, branch: '', remote: '', ahead: 0, behind: 0, files: [], branches: [], remoteBranches: [], tags: [] }
  }
  try {
    await execGit(workspace, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    return { isRepo: false, branch: '', remote: '', ahead: 0, behind: 0, files: [], branches: [], remoteBranches: [], tags: [] }
  }

  let branch = 'HEAD'
  let remote = ''
  let ahead = 0
  let behind = 0
  const files = []

  try {
    const { stdout: statusOut } = await execGit(workspace, ['status', '--porcelain=v1', '-b'])
    const lines = statusOut.split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      if (line.startsWith('## ')) {
        const header = line.slice(3).trim()
        const abMatch = header.match(/\[(?:ahead\s+(\d+))?(?:,\s*)?(?:behind\s+(\d+))?\]/)
        if (abMatch) {
          ahead = parseInt(abMatch[1] || '0', 10)
          behind = parseInt(abMatch[2] || '0', 10)
        }
        const cleanHeader = header.replace(/\s*\[.*\]$/, '')
        if (cleanHeader.startsWith('No commits yet on ') || cleanHeader.startsWith('Initial commit on ')) {
          branch = cleanHeader.replace(/^(?:No commits yet on |Initial commit on )/, '').trim()
        } else if (cleanHeader.includes('...')) {
          const [localBr, remBr] = cleanHeader.split('...')
          branch = localBr.trim()
          remote = remBr.trim()
        } else {
          branch = cleanHeader.trim()
        }
        continue
      }
      const x = line[0]
      const y = line[1]
      let filePath = line.slice(3).trim()
      if (filePath.includes(' -> ')) {
        filePath = filePath.split(' -> ').pop().trim()
      }
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.slice(1, -1)
      }
      const untracked = x === '?' && y === '?'
      const staged = !untracked && x !== ' '
      const unstaged = untracked || y !== ' '
      const status = untracked ? 'U'
        : (x === 'A' || y === 'A') ? 'A'
        : (x === 'D' || y === 'D') ? 'D'
        : (x === 'R' || y === 'R') ? 'R'
        : 'M'
      files.push({
        path: filePath,
        x,
        y,
        status,
        staged,
        unstaged,
        untracked
      })
    }
  } catch {}

  let branches = []
  let remoteBranches = []
  try {
    const { stdout: brOut } = await execGit(workspace, [
      'branch',
      '-a',
      '--format=%(refname)|%(refname:short)|%(HEAD)|%(upstream:short)'
    ])
    for (const row of brOut.split(/\r?\n/).filter(Boolean)) {
      const [refname, shortName, head, upstream] = row.split('|')
      if (refname.startsWith('refs/heads/')) {
        branches.push({
          name: shortName.trim(),
          current: head === '*',
          upstream: (upstream || '').trim()
        })
      } else if (refname.startsWith('refs/remotes/') && !refname.endsWith('/HEAD')) {
        remoteBranches.push({
          name: shortName.trim(),
          ref: refname.trim()
        })
      }
    }
  } catch {}

  let tags = []
  try {
    const { stdout: tagOut } = await execGit(workspace, ['tag', '--list']).catch(() => ({ stdout: '' }))
    tags = tagOut.split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
  } catch {}

  let userName = ''
  let userEmail = ''
  try {
    const { stdout: uName } = await execGit(workspace, ['config', 'user.name']).catch(() => ({ stdout: '' }))
    const { stdout: uEmail } = await execGit(workspace, ['config', 'user.email']).catch(() => ({ stdout: '' }))
    userName = uName.trim()
    userEmail = uEmail.trim()
  } catch {}

  return { isRepo: true, branch, remote, ahead, behind, files, branches, remoteBranches, tags, userName, userEmail }
}

function mountVcs(app, { root }) {
  app.get('/api/vcs/status', async (req, res) => {
    try {
      const ws = root()
      const state = await getGitState(ws)
      res.json(state)
    } catch (error) {
      res.status(500).json({ error: error.message || 'Could not inspect Git status.' })
    }
  })

  app.get('/api/vcs/log', async (req, res) => {
    try {
      const ws = root()
      if (!ws) return res.json({ commits: [] })
      const limit = Math.max(10, Math.min(250, parseInt(req.query.limit || '100', 10)))
      const branchFilter = req.query.branch ? String(req.query.branch).trim() : '--all'
      const search = req.query.search ? String(req.query.search).trim() : ''
      const author = req.query.author ? String(req.query.author).trim() : ''
      const since = req.query.since ? String(req.query.since).trim() : ''

      const args = [
        'log',
        branchFilter === '--all' ? '--all' : branchFilter,
        `-n`, String(limit),
        '--date=iso',
        '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%P%x1f%s'
      ]
      if (search) args.push(`--grep=${search}`, '-i')
      if (author) args.push(`--author=${author}`)
      if (since) args.push(`--since=${since}`)

      let stdout = ''
      try {
        const out = await execGit(ws, args)
        stdout = out.stdout
      } catch {
        // Fallback to general log if specific branch or filter errored
        try {
          const fallback = ['log', '--all', `-n`, String(limit), '--date=iso', '--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%P%x1f%s']
          if (search) fallback.push(`--grep=${search}`, '-i')
          const out = await execGit(ws, fallback)
          stdout = out.stdout
        } catch {}
      }

      const commits = stdout.split(/\r?\n/).filter(Boolean).map((line) => {
        const [hash, shortHash, author, email, date, refs, parents, subject] = line.split('\x1f')
        return {
          hash,
          shortHash,
          author,
          email,
          date,
          refs: refs ? refs.split(',').map((r) => r.trim()).filter(Boolean) : [],
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          subject: subject || ''
        }
      })
      res.json({ commits })
    } catch (error) {
      res.status(500).json({ error: error.message || 'Could not load Git log.' })
    }
  })

  app.get('/api/vcs/commit-detail', async (req, res) => {
    try {
      const ws = root()
      const hash = String(req.query.hash || '').trim()
      if (!ws || !/^[0-9a-f]{4,40}$/i.test(hash)) return res.status(400).json({ error: 'Invalid commit hash.' })
      const { stdout } = await execGit(ws, ['show', '--stat', '--patch', '--format=fuller', hash])
      const { stdout: filesOut } = await execGit(ws, ['diff-tree', '--no-commit-id', '--name-status', '-r', hash]).catch(() => ({ stdout: '' }))
      const changedFiles = filesOut.split(/\r?\n/).filter(Boolean).map((row) => {
        const [status, ...rest] = row.split(/\t+/)
        return { status: status.trim(), path: rest.join(' -> ').trim() }
      })
      res.json({ detail: stdout, files: changedFiles })
    } catch (error) {
      res.status(500).json({ error: error.message || 'Could not load commit details.' })
    }
  })

  app.get('/api/vcs/commit-diff', async (req, res) => {
    try {
      const ws = root()
      const hash = String(req.query.hash || '').trim()
      const file = String(req.query.file || '').trim()
      if (!ws || !/^[0-9a-f]{4,40}$/i.test(hash)) return res.status(400).json({ error: 'Invalid commit hash.' })
      const args = ['show', '--patch', hash]
      if (file) args.push('--', file)
      const { stdout } = await execGit(ws, args)
      res.json({ diff: stdout, hash, file })
    } catch (error) {
      res.status(500).json({ error: error.message || 'Could not load commit diff.' })
    }
  })

  app.get('/api/vcs/diff', async (req, res) => {
    try {
      const ws = root()
      const file = String(req.query.file || '').trim()
      if (!ws || !file) return res.json({ diff: '' })
      const { stdout: unstagedDiff } = await execGit(ws, ['diff', '--', file]).catch(() => ({ stdout: '' }))
      const { stdout: stagedDiff } = await execGit(ws, ['diff', '--cached', '--', file]).catch(() => ({ stdout: '' }))
      let diff = [stagedDiff, unstagedDiff].filter(Boolean).join('\n')
      if (!diff) {
        // Untracked file preview
        const fullPath = path.resolve(ws, file)
        if (fullPath.startsWith(path.resolve(ws)) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const content = fs.readFileSync(fullPath, 'utf8').slice(0, 64000)
          diff = `--- /dev/null\n+++ b/${file}\n` + content.split(/\r?\n/).map((l) => `+${l}`).join('\n')
        }
      }
      res.json({ diff })
    } catch (error) {
      res.status(500).json({ error: error.message || 'Could not compute diff.' })
    }
  })

  app.post('/api/vcs/action', async (req, res) => {
    try {
      const ws = root()
      if (!ws) return res.status(400).json({ error: 'Open a project workspace first.' })
      const { action, files = [], message = '', amend = false, branch = '', create = false, oldName = '', newName = '' } = req.body || {}

      if (action === 'init') {
        await execGit(ws, ['init'])
        return res.json({ ok: true, output: 'Initialized empty Git repository.', state: await getGitState(ws) })
      }

      if (action === 'stage') {
        const targets = Array.isArray(files) && files.length ? files : ['.']
        await execGit(ws, ['add', '--', ...targets])
        return res.json({ ok: true, output: `Staged ${targets.length} item(s).`, state: await getGitState(ws) })
      }

      if (action === 'unstage') {
        const targets = Array.isArray(files) && files.length ? files : ['.']
        await execGit(ws, ['reset', 'HEAD', '--', ...targets]).catch(() => {})
        return res.json({ ok: true, output: `Unstaged ${targets.length} item(s).`, state: await getGitState(ws) })
      }

      if (action === 'discard') {
        if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'Select file(s) to rollback.' })
        for (const f of files) {
          await execGit(ws, ['checkout', '--', f]).catch(async () => {
            await execGit(ws, ['clean', '-f', '--', f]).catch(() => {})
          })
        }
        return res.json({ ok: true, output: `Rolled back ${files.length} file(s).`, state: await getGitState(ws) })
      }

      if (action === 'commit' || action === 'commitAndPush') {
        if (!message.trim() && !amend) return res.status(400).json({ error: 'Enter a commit message.' })
        if (Array.isArray(files) && files.length > 0) {
          await execGit(ws, ['add', '--', ...files])
        }
        const commitArgs = ['commit']
        if (amend) commitArgs.push('--amend')
        if (message.trim()) commitArgs.push('-m', message.trim())
        else if (amend) commitArgs.push('--no-edit')
        const { stdout: commitOut, stderr: commitErr } = await execGit(ws, commitArgs)
        let pushOut = ''
        if (action === 'commitAndPush') {
          const { stdout: pOut, stderr: pErr } = await execGit(ws, ['push'], 30000)
          pushOut = '\n' + (pOut || pErr || 'Pushed to remote.')
        }
        return res.json({
          ok: true,
          output: (commitOut || commitErr || 'Committed changes.') + pushOut,
          state: await getGitState(ws)
        })
      }

      if (action === 'pull') {
        const { stdout, stderr } = await execGit(ws, ['pull'], 30000)
        return res.json({ ok: true, output: (stdout || stderr || 'Pulled latest changes.').trim(), state: await getGitState(ws) })
      }

      if (action === 'push') {
        const { stdout, stderr } = await execGit(ws, ['push'], 30000)
        return res.json({ ok: true, output: (stdout || stderr || 'Pushed commits to remote.').trim(), state: await getGitState(ws) })
      }

      if (action === 'fetch') {
        const { stdout, stderr } = await execGit(ws, ['fetch', '--all', '--prune'], 30000)
        return res.json({ ok: true, output: (stdout || stderr || 'Fetched all remotes.').trim(), state: await getGitState(ws) })
      }

      if (action === 'checkout') {
        if (!branch.trim()) return res.status(400).json({ error: 'Specify a branch name.' })
        let args
        const target = branch.trim()
        if (create) {
          args = ['checkout', '-b', target]
        } else if (target.startsWith('origin/') || target.startsWith('remotes/')) {
          const localName = target.replace(/^remotes\/[^/]+\//, '').replace(/^[^/]+\//, '')
          args = ['checkout', '-B', localName, '--track', target]
        } else {
          args = ['checkout', target]
        }
        const { stdout, stderr } = await execGit(ws, args)
        return res.json({ ok: true, output: (stdout || stderr || `Switched to ${target}`).trim(), state: await getGitState(ws) })
      }

      if (action === 'deleteBranch') {
        if (!branch.trim()) return res.status(400).json({ error: 'Specify a branch to delete.' })
        const { stdout, stderr } = await execGit(ws, ['branch', '-D', branch.trim()])
        return res.json({ ok: true, output: (stdout || stderr || `Deleted branch ${branch.trim()}`).trim(), state: await getGitState(ws) })
      }

      if (action === 'renameBranch') {
        const oldB = (oldName || branch).trim()
        const newB = newName.trim()
        if (!oldB || !newB) return res.status(400).json({ error: 'Specify old and new branch names.' })
        const { stdout, stderr } = await execGit(ws, ['branch', '-m', oldB, newB])
        return res.json({ ok: true, output: (stdout || stderr || `Renamed ${oldB} to ${newB}`).trim(), state: await getGitState(ws) })
      }

      if (action === 'merge') {
        if (!branch.trim()) return res.status(400).json({ error: 'Specify a branch to merge.' })
        const { stdout, stderr } = await execGit(ws, ['merge', branch.trim()])
        return res.json({ ok: true, output: (stdout || stderr || `Merged ${branch.trim()}`).trim(), state: await getGitState(ws) })
      }

      if (action === 'stash') {
        const { stdout, stderr } = await execGit(ws, ['stash', 'push', '-u', ...(message ? ['-m', message] : [])])
        return res.json({ ok: true, output: (stdout || stderr || 'Stashed working tree changes.').trim(), state: await getGitState(ws) })
      }

      if (action === 'unstash') {
        const { stdout, stderr } = await execGit(ws, ['stash', 'pop'])
        return res.json({ ok: true, output: (stdout || stderr || 'Applied stashed changes.').trim(), state: await getGitState(ws) })
      }

      return res.status(400).json({ error: `Unsupported VCS action: ${action}` })
    } catch (error) {
      res.status(422).json({ error: error.stderr?.trim() || error.stdout?.trim() || error.message || 'Git operation failed.' })
    }
  })
}

module.exports = { mountVcs }
