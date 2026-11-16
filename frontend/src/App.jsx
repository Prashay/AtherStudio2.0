import TreeIcon from './TreeIcon.jsx'
import { fileOutline } from './fileOutline.js'
import MavenPanel, { MavenLifecycle } from './MavenPanel.jsx'
import SearchEverywhere from './SearchEverywhere.jsx'
import CodeEditor from './CodeEditor.jsx'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG, downloadQRCodePNG } from './qrcode.jsx'
import {
  isNativeFSSupported,
  pickNativeDirectory,
  buildTreeFromHandle,
  readFileFromHandle,
  writeFileToHandle,
  searchInHandle,
  buildVirtualTreeFromFiles
} from './webfs.js'
import { executeChat } from './aiClient.js'
import { MarkdownViewer } from './MarkdownViewer.jsx'
import { SettingsModal, loadSettings, saveSettings } from './SettingsModal.jsx'
import { TaskHistoryModal, loadTaskHistory, saveTaskHistory } from './TaskHistoryModal.jsx'

const iconPaths = {
  save: 'M5 3h12l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8',
  download: 'M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5',
  chat: 'M4 4h16v12H9l-5 4z M8 9h8m-8 3h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M12 10v7m-3-3 3 3 3-3',
  files: 'M7 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9m-3 4h5l4 4v8a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z M16 7v4h4',
  server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01M8 17h.01M12 7h4m-4 10h4',
  search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M14.5 14.5 21 21',
  robot: 'M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M12 8V4m-2 0h4M8 13h.01m8 0h.01m-7 4h6',
  key: 'M14 10a5 5 0 1 0-3 3L4 20h4v-3h3l3-3m3-7h.01',
  token: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0z M12 7v10m2-8h-3a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-3'
}

function WorkbenchIcon({ name }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d={iconPaths[name]} />
    </svg>
  )
}

const STORE_KEY = 'aether.vault'
const MODEL_KEY = 'aether.model'
const USER_KEY = 'aether.username'
const WELCOME_SEEN_KEY = 'aether.welcome_seen'

function lastFileKey(root) {
  const normalized = /^[a-z]:[\\/]|^\\\\/i.test(root) ? root.replace(/\\/g, '/').toLowerCase() : root
  return 'aether.lastFile:' + normalized
}

async function restoreLastFile(root, signal) {
  try {
    const path = localStorage.getItem(lastFileKey(root)) || localStorage.getItem('aether.lastFile:' + root)
    if (!path) return null
    const response = await fetch('/api/file?path=' + encodeURIComponent(path), { signal, cache: 'no-store' })
    if (!response.ok) return null
    const file = await response.json()
    return file.type === 'file' && typeof file.content === 'string' ? { path, content: file.content } : null
  } catch {
    return null
  }
}

function loadVault() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveVault(c) {
  localStorage.setItem(STORE_KEY, JSON.stringify(c))
}

const DEFAULT_MODELS = {
  free: [
    {
      id: 'aether-spark',
      label: 'Aether Spark',
      blurb: 'Fast replies',
      tier: 'free',
      provider: 'pollinations',
      remote: 'openai/gpt-4o-mini',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: false,
        structuredOutput: true,
        longContext: false,
        reasoning: false
      }
    },
    {
      id: 'aether-loom',
      label: 'Aether Loom',
      blurb: 'Balanced chat',
      tier: 'free',
      provider: 'pollinations',
      remote: 'openai/gpt-5-nano',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: false,
        structuredOutput: true,
        longContext: false,
        reasoning: false
      }
    },
    {
      id: 'aether-forge',
      label: 'Aether Forge',
      blurb: 'Code-focused',
      tier: 'free',
      provider: 'pollinations',
      remote: 'qwen/qwen3-coder-30b-a3b-instruct',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: false,
        structuredOutput: true,
        longContext: false,
        reasoning: false
      }
    }
  ],
  premium: [
    // --- Google Gemini ---
    {
      id: 'gemini-3.5-flash-lite',
      label: '3.5 Flash-Lite',
      blurb: 'Fastest answers',
      tier: 'premium',
      provider: 'gemini',
      remote: 'gemini-3.5-flash-lite',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        structuredOutput: true,
        longContext: true,
        reasoning: false
      }
    },
    {
      id: 'gemini-3.8-flash',
      label: '3.8 Flash',
      blurb: 'All-around help',
      tier: 'premium',
      provider: 'gemini',
      remote: 'gemini-3.8-flash',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        structuredOutput: true,
        longContext: true,
        reasoning: false
      }
    },
    {
      id: 'gemini-3.1-pro',
      label: '3.1 Pro',
      blurb: 'Advanced reasoning',
      tier: 'premium',
      provider: 'gemini',
      remote: 'gemini-3.1-pro-preview',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        structuredOutput: true,
        longContext: true,
        reasoning: false
      }
    },
    {
      id: 'gemini-thinking',
      label: 'Extended thinking',
      blurb: 'Complex problem solving',
      tier: 'premium',
      provider: 'gemini',
      remote: 'gemini-3.8-flash',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        structuredOutput: true,
        longContext: true,
        reasoning: true
      }
    },

    // --- OpenAI / ChatGPT ---
    {
      id: 'gpt-4o-mini',
      label: 'GPT-4o mini',
      blurb: 'ChatGPT speed',
      tier: 'premium',
      provider: 'openai',
      remote: 'gpt-4o-mini',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        structuredOutput: true,
        longContext: true,
        reasoning: false
      }
    },
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      blurb: 'ChatGPT flagship',
      tier: 'premium',
      provider: 'openai',
      remote: 'gpt-4o',
      capabilities: {
        streaming: true,
        toolCalling: true,
        vision: true,
        structuredOutput: true,
        longContext: true,
        reasoning: false
      }
    },
    {
      id: 'gpt-think',
      label: 'Think (o3-mini)',
      blurb: 'Think: Get a smarter answer',
      tier: 'premium',
      provider: 'openai',
      remote: 'o3-mini',
      capabilities: {
        streaming: true,
        toolCalling: false,
        vision: false,
        structuredOutput: true,
        longContext: true,
        reasoning: true
      }
    }
  ]
}

function AppleAiOrb({ size = 150 }) {
  const canvasRef = useRef(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animationId
    let t = 0

    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    // 16 3D Orbiting Quantum Stardust Particles
    const particles = Array.from({ length: 16 }, (_, i) => ({
      angle: (i / 16) * Math.PI * 2,
      speed: 0.012 + (i % 4) * 0.006,
      radiusX: (size * 0.40) + (i % 3) * 6,
      radiusY: (size * 0.24) + ((i + 2) % 3) * 5,
      tilt: -0.32 + ((i % 5) * 0.14),
      size: 1.4 + (i % 3) * 0.8,
      color: ['#00f0ff', '#ff2d55', '#a855f7', '#ffd60a', '#ffffff', '#38bdf8'][i % 6]
    }))

    const render = () => {
      ctx.clearRect(0, 0, size, size)
      const cx = size / 2
      const cy = size / 2
      const r = size * 0.40

      t += hovered ? 0.042 : 0.026

      // 1. Core Sphere Clipping & Cosmic Atmosphere
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()

      // Deep dark cosmic background
      const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      bgGrad.addColorStop(0, '#160a30')
      bgGrad.addColorStop(0.68, '#090317')
      bgGrad.addColorStop(1, '#030109')
      ctx.fillStyle = bgGrad
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2)

      // Dynamic swirling fluid plasma blooms
      const blooms = [
        { x: cx + Math.cos(t * 0.7) * (r * 0.32), y: cy + Math.sin(t * 0.5) * (r * 0.28), rad: r * 0.82, col: 'rgba(0, 240, 255, 0.46)' },
        { x: cx + Math.sin(t * 0.8) * (r * 0.35), y: cy + Math.cos(t * 0.85) * (r * 0.3), rad: r * 0.85, col: 'rgba(244, 63, 94, 0.46)' },
        { x: cx - Math.cos(t * 0.45) * (r * 0.3), y: cy - Math.sin(t * 0.65) * (r * 0.3), rad: r * 0.78, col: 'rgba(168, 85, 247, 0.52)' },
        { x: cx + Math.cos(t * 1.05) * (r * 0.2), y: cy + Math.sin(t * 1.05) * (r * 0.2), rad: r * 0.55, col: 'rgba(255, 214, 10, 0.32)' }
      ]

      blooms.forEach(b => {
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.rad)
        g.addColorStop(0, b.col)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
      })

      // 2. 60fps Harmonic Siri Wave Ribbons (Lighter additive blending)
      ctx.globalCompositeOperation = 'lighter'

      const waveConfigs = [
        { color: '#00f0ff', f1: 0.045, s1: 2.2, a1: 15, f2: 0.09, s2: -1.6, a2: 7, width: 2.8, blur: 12 },
        { color: '#ff2d55', f1: 0.038, s1: -1.9, a1: 17, f2: 0.08, s2: 2.1, a2: 8, width: 2.4, blur: 12 },
        { color: '#a855f7', f1: 0.052, s1: 1.6, a1: 13, f2: 0.07, s2: -2.2, a2: 6, width: 2.2, blur: 9 },
        { color: '#ffffff', f1: 0.062, s1: 2.7, a1: 10, f2: 0.11, s2: 1.8, a2: 5, width: 1.8, blur: 14 }
      ]

      const ampMult = hovered ? 1.35 : 1.0
      const startX = cx - r
      const endX = cx + r

      waveConfigs.forEach((wc) => {
        ctx.beginPath()
        ctx.strokeStyle = wc.color
        ctx.lineWidth = wc.width
        ctx.shadowColor = wc.color
        ctx.shadowBlur = wc.blur

        for (let x = startX; x <= endX; x += 2) {
          const norm = (x - startX) / (r * 2)
          const envelope = Math.sin(norm * Math.PI)
          const waveY = cy + (
            Math.sin(x * wc.f1 + t * wc.s1) * (wc.a1 * ampMult) +
            Math.cos(x * wc.f2 + t * wc.s2) * (wc.a2 * ampMult)
          ) * envelope

          if (x === startX) {
            ctx.moveTo(x, waveY)
          } else {
            ctx.lineTo(x, waveY)
          }
        }
        ctx.stroke()
      })

      // Pulsing Singularity Energy Core
      const corePulse = 1 + Math.sin(t * 3.2) * 0.15
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 20 * corePulse)
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
      coreGrad.addColorStop(0.25, 'rgba(0, 240, 255, 0.65)')
      coreGrad.addColorStop(0.65, 'rgba(168, 85, 247, 0.25)')
      coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = coreGrad
      ctx.beginPath()
      ctx.arc(cx, cy, 20 * corePulse, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()

      // 3. 3D Orbiting Quantum Stardust Particles (around & over the sphere)
      ctx.save()
      particles.forEach((p) => {
        p.angle += p.speed * (hovered ? 1.45 : 1.0)
        const cosT = Math.cos(p.tilt)
        const sinT = Math.sin(p.tilt)
        const rawX = Math.cos(p.angle) * p.radiusX
        const rawY = Math.sin(p.angle) * p.radiusY

        const px = cx + rawX * cosT - rawY * sinT
        const py = cy + rawX * sinT + rawY * cosT

        const depth = Math.sin(p.angle)
        const pScale = 0.65 + 0.45 * (depth + 1) * 0.5
        const pAlpha = 0.25 + 0.75 * (depth + 1) * 0.5

        ctx.beginPath()
        ctx.arc(px, py, p.size * pScale, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.globalAlpha = pAlpha
        ctx.shadowColor = p.color
        ctx.shadowBlur = 10
        ctx.fill()
      })
      ctx.restore()

      animationId = requestAnimationFrame(render)
    }

    render()
    return () => cancelAnimationFrame(animationId)
  }, [size, hovered])

  return (
    <div
      className="siri-stage"
      style={{ width: size, height: size }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="siri-aurora" />

      {/* 3D Holographic Orbit Gyro Rings */}
      <div className="siri-gyro ring-x">
        <span className="siri-satellite sat-1" />
      </div>
      <div className="siri-gyro ring-y">
        <span className="siri-satellite sat-2" />
      </div>
      <div className="siri-gyro ring-z" />

      {/* Real-time 60fps Harmonic Siri Neural Canvas */}
      <canvas
        ref={canvasRef}
        className="siri-canvas"
        style={{ width: size, height: size }}
      />

      {/* Crystal Glass Specular Lens & Edge Refraction */}
      <div className="siri-lens-glass" />

      {/* Floating Starlight Sparkles */}
      <div className="siri-star star-1">✦</div>
      <div className="siri-star star-2">✦</div>
      <div className="siri-star star-3">✦</div>
      <div className="siri-star star-4">✦</div>
    </div>
  )
}

function TreeNode({ node, depth, active, onOpen, openDirs, toggleDir, loadDirectory, onProjectMenu, compactPackages, foldersFirst }) {
  const isDir = node.type === 'dir'
  let displayNode = node
  let label = node.name.endsWith('.java') && !isDir ? node.name.slice(0, -5) : node.name
  if (compactPackages && isDir && /(?:^|\/)src\/(?:main|test)\/java\/.+/.test(node.path)) {
    while (displayNode.children?.length === 1 && displayNode.children[0].type === 'dir') {
      displayNode = displayNode.children[0]
      label += '.' + displayNode.name
    }
  }
  const packageFolder = isDir && /(?:^|\/)src\/(?:main|test)\/java\//.test(node.path)
  const icon = isDir ? (packageFolder ? 'package' : 'folder')
    : node.name === 'pom.xml' ? 'maven' : node.name.endsWith('.java') ? 'java' : 'file'
  const open = openDirs.has(node.path)
  const needsLoad = isDir && open && !displayNode.children?.length && !displayNode.directoryLoaded
  const directoryPath = displayNode.path
  const [loadError, setLoadError] = useState(false)
  useEffect(() => {
    if (!needsLoad || !loadDirectory) return
    const controller = new AbortController()
    setLoadError(false)
    loadDirectory(directoryPath, controller.signal).catch(() => {
      if (!controller.signal.aborted) setLoadError(true)
    })
    return () => controller.abort()
  }, [needsLoad, directoryPath, loadDirectory])

  return (
    <div>
      <button
        type="button"
        aria-expanded={isDir ? open : undefined}
        aria-current={!isDir && active === node.path ? "true" : undefined}
        data-project-path={node.path}
        className={`tree-item ${active === node.path ? 'on' : ''}`}
        style={{ paddingLeft: 7 + depth * 14 }}
        onClick={() => (isDir ? toggleDir(node.path) : onOpen(node.path))}
        onContextMenu={(event) => onProjectMenu(event, displayNode)}
      >
        <span aria-hidden="true" className={`project-tree-chevron ${isDir ? '' : 'placeholder'} ${open ? 'expanded' : ''}`} />
        <span className={`project-tree-icon ${icon}`}><TreeIcon name={icon} /></span>
        <span title={displayNode.path}>{label}</span>
      </button>
      {needsLoad && loadDirectory && <div className="hint" style={{ paddingLeft: 21 + depth * 14 }} role="status">
        {loadError ? 'Could not load folder. Collapse and reopen to retry.' : 'Loading folder…'}
      </div>}
      {isDir && open && (foldersFirst ? displayNode.children : displayNode.children?.slice().sort((a, b) => a.name.localeCompare(b.name)))?.map((child) => (
        <TreeNode
          key={child.path || child.name}
          node={child}
          depth={depth + 1}
          active={active}
          onOpen={onOpen}
          openDirs={openDirs}
          toggleDir={toggleDir}
          loadDirectory={loadDirectory}
          onProjectMenu={onProjectMenu}
          compactPackages={compactPackages}
          foldersFirst={foldersFirst}
        />
      ))}
    </div>
  )
}

export default function App() {
  const [pulseMode, setPulseMode] = useState(null)
  const topbarRef = useRef(null)
  const pulseFrameRef = useRef(null)
  const [pulseFrameTop, setPulseFrameTop] = useState(0)
  const pulseBridge = window.electronAPI?.pulse
  const webPulse = !pulseBridge && import.meta.env.MODE === 'pages'
  const selectPulseView = (next) => {
    if (pulseBridge) pulseBridge.select(next)
    else if (webPulse) setPulseMode(next)
  }

  useEffect(() => {
    if (!webPulse) return
    const onMessage = (event) => {
      const frame = pulseFrameRef.current?.contentWindow
      if (event.origin !== window.location.origin || event.source !== frame) return
      if (event.data?.type === 'pulse:ready' && pulseMode) {
        frame.postMessage({ type: 'pulse:select-view', mode: pulseMode }, window.location.origin)
      } else if (event.data?.type === 'pulse:view-mode' && pulseMode &&
        (event.data.mode === 'studio' || event.data.mode === 'dashboard')) {
        setPulseMode(event.data.mode)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [webPulse, pulseMode])

  useEffect(() => {
    if (!webPulse || !pulseMode) return
    pulseFrameRef.current?.contentWindow?.postMessage(
      { type: 'pulse:select-view', mode: pulseMode }, window.location.origin
    )
  }, [webPulse, pulseMode])

  useEffect(() => pulseBridge?.onMode(setPulseMode), [pulseBridge])

  useEffect(() => {
    if ((!pulseBridge && !webPulse) || !topbarRef.current) return
    const topbar = topbarRef.current
    const updateBounds = () => {
      const bottom = topbar.getBoundingClientRect().bottom
      if (pulseBridge) pulseBridge.setTop(bottom)
      else setPulseFrameTop(bottom)
    }
    const observer = new ResizeObserver(updateBounds)
    observer.observe(topbar)
    updateBounds()
    return () => observer.disconnect()
  }, [pulseBridge, webPulse])

  const [mode, setMode] = useState(() => {
    if (pulseBridge) return 'editor'
    try {
      const param = new URLSearchParams(window.location.search).get('mode')
      if (param === 'agent' || param === 'editor') return param
    } catch {}
    return 'editor'
  })
  const [tree, setTree] = useState(null)
  const [openDirs, setOpenDirs] = useState(() => new Set(['']))
  const [tabs, setTabs] = useState([])
  const [active, setActive] = useState('')
  const [dirty, setDirty] = useState({})
  const [recentProjects, setRecentProjects] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('aether.recentProjects') || '[]')
      return Array.isArray(stored) ? stored.filter((item) => typeof item?.root === 'string' && typeof item.name === 'string') : []
    } catch { return [] }
  })
  const [revealPath, setRevealPath] = useState(null)
  const [launchTarget, setLaunchTarget] = useState('')
  const [launchCatalog, setLaunchCatalog] = useState({ applications: [], jdks: [] })
  const [launchCatalogError, setLaunchCatalogError] = useState('')
  const [runLaunch, setRunLaunch] = useState(0)
  const [javaBreakpoints, setJavaBreakpoints] = useState({})
  const [menuOpen, setMenuOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [activeMenu, setActiveMenu] = useState(null)
  const [projectMenu, setProjectMenu] = useState(null)
  const [closedEditorFiles, setClosedEditorFiles] = useState([])
  const editorTabStrip = useRef(null)
  const [tabStripWidth, setTabStripWidth] = useState(0)
  const [tabPopup, setTabPopup] = useState(null)
  const tabPopupRef = useRef(null)
  const tabPopupTrigger = useRef(null)
  useEffect(() => {
    const strip = editorTabStrip.current
    if (!strip) return
    const sync = () => setTabStripWidth(strip.clientWidth)
    const observer = new ResizeObserver(sync)
    observer.observe(strip)
    sync()
    return () => observer.disconnect()
  })
  useEffect(() => {
    if (!tabPopup) return
    const dismiss = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return
      if (event.type === 'pointerdown' && (tabPopupRef.current?.contains(event.target) || tabPopupTrigger.current?.contains(event.target))) return
      setTabPopup(null)
      if (event.type === 'keydown') tabPopupTrigger.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [tabPopup])
  const [pendingDelete, setPendingDelete] = useState(null)
  const deleteDialog = useRef(null)
  const [projectViewPosition, setProjectViewPosition] = useState(null)
  const projectViewButton = useRef(null)
  const [compactPackages, setCompactPackages] = useState(true)
  const [foldersFirst, setFoldersFirst] = useState(true)
  const expandingProject = useRef(null)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [mavenSideOpen, setMavenSideOpen] = useState(false)
  const [launchRequest, setLaunchRequest] = useState(null)
  const [mavenOptions, setMavenOptions] = useState({ offline: false, skipTests: false })
  const [structureOpen, setStructureOpen] = useState(false)
  const [editorJump, setEditorJump] = useState(null)
  const [mavenOpen, setMavenOpen] = useState(false)
  const [searchEverywhere, setSearchEverywhere] = useState(false)
  const lastShift = useRef(0)
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState([])
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [editorNotice, setEditorNotice] = useState('')
  const savingRef = useRef(false)
  const requestRef = useRef(null)
  const workspaceRef = useRef(null)
  const workspaceRestore = useRef(null)

  const [vaultOpen, setVaultOpen] = useState(false)
  const [vaultTab, setVaultTab] = useState('openai')
  const [catalog, setCatalog] = useState(DEFAULT_MODELS)
  const [modelId, setModelId] = useState(() => {
    const saved = localStorage.getItem(MODEL_KEY)
    if (saved === 'gemini-3.6-flash' || saved === 'gemini-2.0-flash') return 'gemini-3.8-flash'
    if (saved === 'gemini-3.8-flash-lite' || saved === 'gemini-2.0-flash-lite') return 'gemini-3.5-flash-lite'
    return saved || 'aether-spark'
  })
  const allModels = useMemo(() => [...(catalog?.free || []), ...(catalog?.premium || [])], [catalog])
  const selected = useMemo(() => allModels.find((m) => m.id === modelId) || allModels[0] || DEFAULT_MODELS.free[0], [allModels, modelId])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [vault, setVault] = useState(() => ({
    openai: '',
    gemini: '',
    proxyUrl: '',
    ...loadVault()
  }))
  const [workspace, setWorkspace] = useState({ name: null, root: null })
  const [webDirHandle, setWebDirHandle] = useState(null)
  const [virtualFiles, setVirtualFiles] = useState(null)
  const folderInputRef = useRef(null)
  const filesInputRef = useRef(null)
  const [importNotice, setImportNotice] = useState('')
  const [folderOpen, setFolderOpen] = useState(false)
  const [browse, setBrowse] = useState(null)
  const [browseErr, setBrowseErr] = useState('')
  const [folderPath, setFolderPath] = useState('')
  const [openingFolder, setOpeningFolder] = useState(false)
  const browseRequest = useRef(0)
  const [pane, setPane] = useState(new URLSearchParams(window.location.search).get('mode') === 'chat' ? 'chat' : mode === 'agent' ? 'chat' : 'editor')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(pane === 'chat')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [appModalOpen, setAppModalOpen] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      return p.get('download') === '1' || p.get('install') === '1' || p.get('app') === '1'
    } catch {
      return false
    }
  })
  const [guideTab, setGuideTab] = useState('phone')
  const [qrMode, setQrMode] = useState('auto') // 'auto' | 'local' | 'cloud'
  const [qrDownloaded, setQrDownloaded] = useState(false)
  const [networkInfo, setNetworkInfo] = useState({ addresses: [], port: 4576 })
  const [copied, setCopied] = useState(false)

  const isMobileClient = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768
  }, [])

  const isIOSClient = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  }, [])

  const isAndroidClient = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /Android/i.test(navigator.userAgent)
  }, [])

  const targetQrUrl = useMemo(() => {
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    if (!isLocalHost) {
      const origin = window.location.origin
      const cleanPath = window.location.pathname.replace(/\/+$/, '')
      return `${origin}${cleanPath}/?download=1`
    }
    if (qrMode === 'cloud') {
      return 'https://prashay.github.io/AtherStudio/?download=1'
    }
    const host = networkInfo.addresses?.[0]?.ip || window.location.hostname
    const port = window.location.port || networkInfo.port || '4576'
    return `${window.location.protocol}//${host}:${port}/?download=1`
  }, [networkInfo, qrMode])

  const handleDownloadQR = () => {
    const ok = downloadQRCodePNG(targetQrUrl, 'aether-studio-qr.png')
    if (ok) {
      setQrDownloaded(true)
      setTimeout(() => setQrDownloaded(false), 2500)
    }
  }

  const handleDownloadShortcut = () => {
    try {
      const content = `[InternetShortcut]\nURL=${targetQrUrl}\n`
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'AetherStudio.url'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (e) {
      console.error(e)
    }
  }

  const feedRef = useRef(null)
  const chatInputRef = useRef(null)
  const [tokenGuideOpen, setTokenGuideOpen] = useState(false)
  const [tokenGuideTab, setTokenGuideTab] = useState('gemini') // 'gemini' | 'openai'
  const openTokenHelper = (provider = 'gemini') => {
    setTokenGuideTab(provider === 'openai' ? 'openai' : 'gemini')
    setTokenGuideOpen(true)
  }
  const [userName, setUserName] = useState(() => localStorage.getItem(USER_KEY) || '')
  const [welcomeModalOpen, setWelcomeModalOpen] = useState(() => {
    try {
      if (new URLSearchParams(window.location.search).get('welcome') === 'true') return true
      if (pulseBridge) return localStorage.getItem(WELCOME_SEEN_KEY) !== '1'
    } catch {}
    return false
  })
  const dismissWelcome = () => {
    try { localStorage.setItem(WELCOME_SEEN_KEY, '1') } catch {}
    setWelcomeModalOpen(false)
  }
  const [nameDraft, setNameDraft] = useState(() => localStorage.getItem(USER_KEY) || '')
  const [listening, setListening] = useState(false)
  const [msgMenuIdx, setMsgMenuIdx] = useState(null)
  const [msgFeedback, setMsgFeedback] = useState({})
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null)
  const [speakingIdx, setSpeakingIdx] = useState(null)
  const [settings, setSettings] = useState(() => loadSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mdMode, setMdMode] = useState(() => {
    const s = loadSettings()
    return s.mdDefaultMode || 'reader'
  })
  const [taskHistory, setTaskHistory] = useState(() => loadTaskHistory())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [isTempChat, setIsTempChat] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState(() => 'sess_' + Date.now())

  // Automatically sync current conversation into Task History if not in Temp Chat
  useEffect(() => {
    if (isTempChat || !messages.length) return
    const firstUserMsg = messages.find((m) => m.role === 'user')?.text || ''
    const title = firstUserMsg ? firstUserMsg.slice(0, 52).replace(/\n/g, ' ') : `Task Session`

    setTaskHistory((prev) => {
      const existingIdx = prev.findIndex((s) => s.id === currentSessionId)
      const sessionObj = {
        id: currentSessionId,
        title,
        mode,
        modelId: selected.id,
        modelLabel: selected.label,
        updatedAt: Date.now(),
        createdAt: existingIdx >= 0 ? prev[existingIdx].createdAt : Date.now(),
        messages: messages.filter((message) => message.role !== 'proposal')
      }
      let next
      if (existingIdx >= 0) {
        next = [sessionObj, ...prev.filter((s) => s.id !== currentSessionId)]
      } else {
        next = [sessionObj, ...prev]
      }
      next = next.slice(0, 60)
      saveTaskHistory(next)
      return next
    })
  }, [messages, isTempChat, currentSessionId, mode, selected])

  const startNewChat = (asTemp = false) => {
    if (requestRef.current) return
    const newId = 'sess_' + Date.now()
    setCurrentSessionId(newId)
    setIsTempChat(asTemp)
    setMessages([])
    setDraft('')
    setTimeout(() => chatInputRef.current?.focus(), 60)
  }

  const toggleTempChat = () => {
    if (isTempChat) {
      setIsTempChat(false)
    } else {
      startNewChat(true)
    }
  }

  const handleSelectSession = (session) => {
    if (requestRef.current) return
    setCurrentSessionId(session.id)
    setIsTempChat(false)
    setMessages(session.messages || [])
    if (session.mode) switchMode(session.mode)
    if (session.modelId) pickModel(session.modelId)
    setDraft('')
  }

  const handleDeleteSession = (sessionId) => {
    setTaskHistory((prev) => {
      const next = prev.filter((s) => s.id !== sessionId)
      saveTaskHistory(next)
      return next
    })
    if (currentSessionId === sessionId) {
      startNewChat(false)
    }
  }

  const handleClearAllHistory = () => {
    setTaskHistory([])
    saveTaskHistory([])
  }

  const handleExportSession = (session, format = 'markdown') => {
    const msgs = session.messages || []
    if (!msgs.length) return
    let text = ''
    let filename = `aether-session-${session.title?.replace(/[^a-z0-9_-]/gi, '_') || session.id}`
    let mimeType = 'text/markdown'

    if (format === 'json') {
      text = JSON.stringify(session, null, 2)
      filename += '.json'
      mimeType = 'application/json'
    } else {
      text = `# ${session.title || 'Aether Studio Task'}\n**Date:** ${new Date(session.updatedAt || session.createdAt).toLocaleString()}\n**Mode:** ${session.mode}\n**Model:** ${session.modelLabel}\n\n---\n\n`
      msgs.forEach((m) => {
        if (m.role === 'user') text += `### 👤 User\n\n${m.text}\n\n`
        else if (m.role === 'ai') text += `### ✨ ${session.modelLabel || 'AI'}\n\n${m.text}\n\n`
        else if (m.role === 'error') text += `### ⚠️ Notice\n\n${m.text}\n\n`
        else if (m.role === 'tool') text += `> 🔧 Tool: **${m.name}** (${m.status})\n\n`
      })
      filename += '.md'
    }

    const blob = new Blob([text], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (settings.theme) {
      document.documentElement.setAttribute('data-theme', settings.theme)
    }
    document.documentElement.setAttribute('data-workbench-theme', settings.workbenchTheme || 'frenky-orange')
  }, [settings.theme, settings.workbenchTheme])

  const exportErrorLog = (errorText, index, format = 'markdown') => {
    const lastUserPrompt = [...messages.slice(0, index + 1)].reverse().find((m) => m.role === 'user')?.text || ''
    const timestamp = new Date().toISOString()

    if (format === 'json') {
      const data = {
        timestamp,
        error: errorText,
        model: selected,
        userPrompt: lastUserPrompt,
        mode,
        appVersion: '1.0.0',
        userAgent: navigator.userAgent
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `aether-error-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return
    }

    const mdReport = `# Aether Studio Error Diagnostic Report
**Date:** ${new Date().toLocaleString()}
**Model:** ${selected.label} (${selected.id}) [${selected.tier}]
**Provider:** ${selected.provider}
**Studio Mode:** ${mode}

---

## ⚠️ Error Details
\`\`\`
${errorText}
\`\`\`

## 💬 Context Prompt
${lastUserPrompt ? `> ${lastUserPrompt}` : '*(No prior prompt in thread)*'}

## 🛠️ Diagnostic Environment
- App Version: Aether Studio v1.0.0
- Web FS Active: ${Boolean(webDirHandle)}
- User Agent: ${navigator.userAgent}
`
    const blob = new Blob([mdReport], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aether-error-${Date.now()}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const exportChatSession = (format = 'markdown') => {
    if (!messages.length) return
    let text = ''
    let filename = `aether-chat-${new Date().toISOString().slice(0, 10)}`
    let mimeType = 'text/markdown'

    if (format === 'json') {
      text = JSON.stringify({
        exportedAt: new Date().toISOString(),
        model: selected,
        messages
      }, null, 2)
      filename += '.json'
      mimeType = 'application/json'
    } else {
      text = `# Aether Studio Chat Transcript\n**Date:** ${new Date().toLocaleString()}\n**Active Model:** ${selected.label}\n\n---\n\n`
      messages.forEach((m) => {
        if (m.role === 'user') {
          text += `### 👤 User\n\n${m.text}\n\n`
        } else if (m.role === 'ai') {
          text += `### ✨ ${selected.label}\n\n${m.text}\n\n`
        } else if (m.role === 'error') {
          text += `### ⚠️ AI Error Notice\n\n${m.text}\n\n`
        } else if (m.role === 'tool') {
          text += `> 🔧 Tool: **${m.name}** (${m.status})\n\n`
        }
      })
      filename += '.md'
    }

    const blob = new Blob([text], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const createNewFile = (defaultName = 'notes.md') => {
    const existing = tabs.find((t) => t.path === defaultName)
    if (!existing) {
      setDirty((prev) => ({ ...prev, [defaultName]: true }))
      setTabs((prev) => [...prev, { path: defaultName, content: '# Notes\n\nStart writing markdown or code here...\n' }])
    }
    setActive(defaultName)
    setMdMode('edit')
    switchMode('editor')
  }

  useEffect(() => {
    const handleDocClick = () => setMsgMenuIdx(null)
    if (msgMenuIdx !== null) {
      window.addEventListener('click', handleDocClick)
      return () => window.removeEventListener('click', handleDocClick)
    }
  }, [msgMenuIdx])

  const handleListen = useCallback((text, idx) => {
    if (!('speechSynthesis' in window)) {
      alert('Speech synthesis is not supported on this browser.')
      return
    }
    if (speakingIdx === idx) {
      window.speechSynthesis.cancel()
      setSpeakingIdx(null)
      return
    }
    window.speechSynthesis.cancel()
    const cleanText = text.replace(/```[\s\S]*?```/g, 'Code block omitted.')
    const utter = new SpeechSynthesisUtterance(cleanText)
    utter.onend = () => setSpeakingIdx(null)
    utter.onerror = () => setSpeakingIdx(null)
    setSpeakingIdx(idx)
    window.speechSynthesis.speak(utter)
  }, [speakingIdx])

  const [leftWidth, setLeftWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('aether.left_width')
      return saved ? Math.max(160, Math.min(700, parseInt(saved, 10))) : 260
    } catch {
      return 260
    }
  })

  const [rightWidth, setRightWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('aether.right_width')
      return saved ? Math.max(240, Math.min(850, parseInt(saved, 10))) : 360
    } catch {
      return 360
    }
  })

  const [isResizing, setIsResizing] = useState(null)

  const startResizeLeft = useCallback((e) => {
    e.preventDefault()
    setIsResizing('left')
    document.body.classList.add('resizing-col')

    const onMouseMove = (moveEvent) => {
      const minW = 160
      const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.45))
      const newWidth = Math.max(minW, Math.min(moveEvent.clientX, maxW))
      setLeftWidth(newWidth)
    }

    const onMouseUp = () => {
      document.body.classList.remove('resizing-col')
      setIsResizing(null)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      setLeftWidth((w) => {
        try { localStorage.setItem('aether.left_width', String(w)) } catch {}
        return w
      })
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  const startResizeRight = useCallback((e) => {
    e.preventDefault()
    setIsResizing('right')
    document.body.classList.add('resizing-col')

    const onMouseMove = (moveEvent) => {
      const minW = 240
      const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.55))
      const newWidth = Math.max(minW, Math.min(window.innerWidth - moveEvent.clientX, maxW))
      setRightWidth(newWidth)
    }

    const onMouseUp = () => {
      document.body.classList.remove('resizing-col')
      setIsResizing(null)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      setRightWidth((w) => {
        try { localStorage.setItem('aether.right_width', String(w)) } catch {}
        return w
      })
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])

  const handleTouchLeft = useCallback((e) => {
    const touch = e.touches[0]
    if (!touch) return
    setIsResizing('left')

    const onTouchMove = (moveEvent) => {
      const t = moveEvent.touches[0]
      if (!t) return
      const minW = 160
      const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.45))
      const newWidth = Math.max(minW, Math.min(t.clientX, maxW))
      setLeftWidth(newWidth)
    }

    const onTouchEnd = () => {
      setIsResizing(null)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      setLeftWidth((w) => {
        try { localStorage.setItem('aether.left_width', String(w)) } catch {}
        return w
      })
    }

    window.addEventListener('touchmove', onTouchMove)
    window.addEventListener('touchend', onTouchEnd)
  }, [])

  const handleTouchRight = useCallback((e) => {
    const touch = e.touches[0]
    if (!touch) return
    setIsResizing('right')

    const onTouchMove = (moveEvent) => {
      const t = moveEvent.touches[0]
      if (!t) return
      const minW = 240
      const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.55))
      const newWidth = Math.max(minW, Math.min(window.innerWidth - t.clientX, maxW))
      setRightWidth(newWidth)
    }

    const onTouchEnd = () => {
      setIsResizing(null)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      setRightWidth((w) => {
        try { localStorage.setItem('aether.right_width', String(w)) } catch {}
        return w
      })
    }

    window.addEventListener('touchmove', onTouchMove)
    window.addEventListener('touchend', onTouchEnd)
  }, [])

  const modelShortName = useMemo(() => {
    if (!selected) return 'Spark'
    let name = selected.name || selected.label || ''
    name = name.replace(' (Free)', '').replace('Aether ', '')
    return name
  }, [selected])

  const toggleListening = () => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRec) {
      alert('Speech recognition is not supported in this browser. Please type your prompt.')
      return
    }
    if (listening) {
      setListening(false)
      return
    }
    try {
      const recognition = new SpeechRec()
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = 'en-US'
      recognition.onstart = () => setListening(true)
      recognition.onresult = (e) => {
        const transcript = e.results[0]?.[0]?.transcript || ''
        if (transcript) {
          setDraft((prev) => (prev ? `${prev} ${transcript}` : transcript))
        }
        setListening(false)
      }
      recognition.onerror = () => setListening(false)
      recognition.onend = () => setListening(false)
      recognition.start()
    } catch {
      setListening(false)
    }
  }

  const current = tabs.find((t) => t.path === active)
  workspaceRef.current = workspace

  const switchMode = (next) => {
    setMode(next === 'agent' ? 'agent' : 'editor')
    setPane(next === 'agent' || next === 'chat' ? 'chat' : 'editor')
    setRightOpen(next === 'agent' || next === 'chat')
  }

  const canLeaveWorkspace = () => !requestRef.current && !savingRef.current && (
    !tabs.some(isDirty) || window.confirm('Discard unsaved files and switch workspace?')
  )

  const loadWorkspace = useCallback(async (signal) => {
    try {
      const remembered = localStorage.getItem('aether.lastProject')
      if (remembered === '') return
      const response = await fetch('/api/workspace', { signal })
      if (!response.ok) return
      let project = await response.json()
      if (remembered && remembered !== project.root) {
        const reopened = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: remembered, includeTree: true }),
          signal
        })
        if (!reopened.ok) {
          if (!signal.aborted) setImportNotice('The last project could not be reopened. Choose a folder to continue.')
          return
        }
        project = await reopened.json()
      }
      if (!project.root || signal.aborted || workspaceRef.current?.root) return
      const treeResponse = project.tree ? null : await fetch('/api/tree', { signal })
      const restoredTree = project.tree || (treeResponse.ok ? await treeResponse.json() : null)
      const file = await restoreLastFile(project.root, signal)
      if (!signal.aborted && !workspaceRef.current?.root) {
        setWorkspace({ name: project.name || 'workspace', root: project.root })
        setTree(restoredTree)
        if (file) {
          setTabs([file])
          setActive(file.path)
          if (new URLSearchParams(window.location.search).get('mode') !== 'chat') setPane('editor')
        }
      }
    } catch {
      if (!signal.aborted && !workspaceRef.current?.root) setImportNotice('The workspace server could not be reached.')
    }
  }, [])

  useEffect(() => {
    if (!workspace.root || webDirHandle || virtualFiles || !current) return
    try { localStorage.setItem(lastFileKey(workspace.root), current.path) } catch {}
  }, [workspace.root, webDirHandle, virtualFiles, current?.path])

  useEffect(() => {
    const restore = new AbortController()
    workspaceRestore.current = restore
    if (!webPulse) void loadWorkspace(restore.signal)
    fetch('/api/models').then((r) => r.json()).then((d) => {
      if (d.free && d.premium) setCatalog(d)
    }).catch(() => {})
    fetch('/api/network').then((r) => r.json()).then((d) => {
      if (d?.addresses) setNetworkInfo(d)
    }).catch(() => {})

    const onBeforeInstall = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setInstalled(true)
    }
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    return () => restore.abort()
  }, [loadWorkspace])

  useEffect(() => {
    const handleKeyDown = (e) => {
      // 1. Double Shift detection for Search Everywhere
      if (mode !== 'chat' && e.key === 'Shift') {
        if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now()
          if (now - lastShift.current < 500 && now - lastShift.current > 40) {
            e.preventDefault()
            setSearchEverywhere(true)
            lastShift.current = 0
            return
          } else {
            lastShift.current = now
          }
        }
      } else if (e.key !== 'Shift') {
        lastShift.current = 0
      }

      // 2. Global Search Everywhere shortcuts (Ctrl+Shift+F / Cmd+Shift+F or Ctrl+P / Cmd+P)
      if ((e.ctrlKey || e.metaKey) && (
        (e.shiftKey && e.key.toLowerCase() === 'f') ||
        (!e.shiftKey && e.key.toLowerCase() === 'p')
      )) {
        if (mode !== 'chat') {
          e.preventDefault()
          setSearchEverywhere(true)
          return
        }
      }

      // 3. In-File Search (Ctrl+F / Cmd+F without Shift)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
        // Prevent default browser find dialog so the editor's find widget activates
        e.preventDefault()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setLeftOpen((v) => !v)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        if (mode === 'chat') return
        setPane(rightOpen ? 'editor' : 'chat')
        setRightOpen(!rightOpen)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o' && mode !== 'chat') {
        e.preventDefault()
        setLeftOpen(true)
        if (window.innerWidth <= 860) setPane('files')
        importFiles(filesInputRef)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const triggerInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const res = await installPrompt.userChoice
    if (res?.outcome === 'accepted') {
      setInstalled(true)
      setInstallPrompt(null)
      setAppModalOpen(false)
    }
  }

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [messages, streamText, mode])

  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const t = setTimeout(async () => {
      if (webDirHandle) {
        try {
          const results = await searchInHandle(webDirHandle, q)
          setHits(results)
        } catch {
          setHits([])
        }
      } else if (virtualFiles) {
        const results = []
        for (const [path, file] of virtualFiles) {
          if (path.toLowerCase().includes(q.toLowerCase())) results.push({ path, line: 1, preview: file.name })
          if (results.length >= 40) break
        }
        setHits(results)
      } else {
        fetch(`/api/search?q=${encodeURIComponent(q)}`)
          .then((r) => r.json())
          .then((d) => setHits(d.results || []))
          .catch(() => setHits([]))
      }
    }, 220)
    return () => clearTimeout(t)
  }, [search, webDirHandle, virtualFiles])

  const toggleDir = useCallback((p) => {
    expandingProject.current = null
    setOpenDirs((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }, [])

  const loadProjectDirectory = useCallback(async (path, signal) => {
    const openedWorkspace = workspaceRef.current
    let children
    if (webDirHandle) {
      const directory = await buildTreeFromHandle(webDirHandle, path, 0, 1)
      children = directory.children
    } else {
      const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`, { signal })
      if (!response.ok) throw new Error('Could not load folder')
      const directory = await response.json()
      if (directory.type !== 'dir' || directory.path !== path || !Array.isArray(directory.entries)) {
        throw new Error('Unexpected folder response')
      }
      children = directory.entries.sort((a, b) =>
        a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
      )
    }
    if (signal.aborted || workspaceRef.current !== openedWorkspace) return

    function updateFolder(node) {
      if (!node || node.type !== 'dir') return node
      if (node.path === path) {
        return { ...node, children: node.children?.length ? node.children : children, directoryLoaded: true }
      }
      if (!node.path || path.startsWith(node.path + '/')) {
        return { ...node, children: node.children?.map(updateFolder) }
      }
      return node
    }

    setTree(updateFolder)
    if (expandingProject.current === openedWorkspace) {
      setOpenDirs((previous) => new Set([...previous, ...children.filter((child) => child.type === 'dir').map((child) => child.path)]))
    }
  }, [webDirHandle])

  const openFile = useCallback(async (p) => {
    const openedWorkspace = workspaceRef.current
    if (tabs.some((tab) => tab.path === p)) {
      setActive(p)
      setEditorNotice('')
      setPane('editor')
      return
    }
    try {
      let content = ''
      if (webDirHandle) {
        const res = await readFileFromHandle(webDirHandle, p)
        content = res.content
      } else if (virtualFiles && virtualFiles.has(p)) {
        content = await virtualFiles.get(p).text()
      } else {
        const res = await fetch(`/api/file?path=${encodeURIComponent(p)}`)
        const data = await res.json()
        if (data.type !== 'file') return
        content = data.content
      }
      if (workspaceRef.current !== openedWorkspace) return
      setTabs((prev) => {
        if (prev.some((t) => t.path === p)) return prev
        return [...prev, { path: p, content }]
      })
      setActive(p)
      setEditorNotice('')
      setPane('editor')
    } catch (err) {
      alert('Could not open file: ' + err.message)
    }
  }, [webDirHandle, virtualFiles, tabs])

  const updateContent = (value) => {
    setTabs((prev) => prev.map((t) => (t.path === active ? { ...t, content: value } : t)))
    setDirty((d) => ({ ...d, [active]: d[active] ?? current.content }))
    setEditorNotice('')
  }

  const saveFile = async () => {
    if (!current || savingRef.current) return false
    savingRef.current = true
    const savingWorkspace = workspaceRef.current
    setEditorNotice('Saving…')
    try {
      if (!workspace.root || virtualFiles) {
        const url = URL.createObjectURL(new Blob([current.content], { type: 'text/plain' }))
        const link = document.createElement('a')
        link.href = url
        link.download = current.path.split('/').pop()
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } else if (webDirHandle) {
        await writeFileToHandle(webDirHandle, current.path, current.content)
      } else {
        const response = await fetch('/api/file', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: current.path, content: current.content })
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${response.status}`)
        }
      }
      if (workspaceRef.current !== savingWorkspace) return false
      setDirty((prev) => ({ ...prev, [current.path]: current.content }))
      setEditorNotice(!workspace.root || virtualFiles ? 'Downloaded' : 'Saved')
      if (webDirHandle) {
        await buildTreeFromHandle(webDirHandle).then(setTree).catch(() => {})
      } else if (workspace.root && !virtualFiles) {
        await fetch('/api/tree').then((response) => response.ok ? response.json() : null)
          .then((tree) => { if (tree) setTree(tree) }).catch(() => {})
      }
      return true
    } catch (error) {
      setEditorNotice(`Save failed · ${error.message}`)
      return false
    } finally {
      savingRef.current = false
    }
  }

  const isDirty = (tab) => dirty[tab.path] === true || (
    typeof dirty[tab.path] === 'string' && dirty[tab.path] !== tab.content
  )

  useEffect(() => {
    const handleSave = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || mode === 'chat' || !current) return
      event.preventDefault()
      saveFile()
    }
    window.addEventListener('keydown', handleSave)
    return () => window.removeEventListener('keydown', handleSave)
  })

  const closeEditorTabs = (path, closeOthers = false, scope = 'single') => {
    const index = tabs.findIndex((tab) => tab.path === path)
    if (savingRef.current || index < 0) return
    const closing = tabs.filter((tab, position) => {
      if (scope === 'all') return true
      if (scope === 'right') return position > index
      return closeOthers ? tab.path !== path : tab.path === path
    })
    if (!closing.length) return

    const unsaved = closing.filter(isDirty)
    if (unsaved.length && !window.confirm(
      `Discard unsaved changes to the following files?\n\n${unsaved.map((tab) => tab.path).join('\n')}`
    )) return

    const closedPaths = new Set(closing.map((tab) => tab.path))
    const remaining = tabs.filter((tab) => !closedPaths.has(tab.path))
    if (!webDirHandle && !virtualFiles && workspace.root) {
      setClosedEditorFiles((previous) => [
        ...closing.map((tab) => ({ root: workspace.root, path: tab.path })),
        ...previous.filter((item) => item.root !== workspace.root || !closedPaths.has(item.path))
      ].slice(0, 30))
    }
    setTabs(remaining)
    if (closeOthers || closedPaths.has(active)) {
      setActive(closeOthers ? path : remaining[Math.min(index, remaining.length - 1)]?.path || '')
      setEditorNotice('')
    }
    setDirty((previous) => Object.fromEntries(Object.entries(previous).filter(([file]) => !closedPaths.has(file))))
  }

  useEffect(() => {
    const handleClose = (event) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.key !== 'F4' || mode === 'chat' || !current) return
      event.preventDefault()
      closeEditorTabs(current.path)
    }
    window.addEventListener('keydown', handleClose)
    return () => window.removeEventListener('keydown', handleClose)
  })

  const persistVault = (next) => {
    setVault(next)
    saveVault(next)
  }

  const openProject = ({ project, tree, handle = null, files = null, restoredFile = null }) => {
    workspaceRestore.current?.abort()
    try { localStorage.setItem('aether.lastProject', handle || files ? '' : project.root) } catch {}
    setMessages((prev) => prev.filter((message) => message.role !== 'proposal'))
    setWebDirHandle(handle)
    setVirtualFiles(files)
    setWorkspace(project)
    setTree(tree)
    setTabs(restoredFile ? [restoredFile] : [])
    setActive(restoredFile?.path || '')
    setDirty({})
    setHits([])
    setSearch('')
    setOpenDirs(new Set(['']))
    setLeftOpen(true)
    setEditorNotice('')
    setImportNotice('')
    setPane(!restoredFile && window.innerWidth <= 860 ? 'files' : 'editor')
  }

  const importFiles = (input) => {
    if (!canLeaveWorkspace()) return
    setImportNotice('')
    input.current?.click()
  }

  const openLocalFolder = async () => {
    if (window.electronAPI?.openFolderDialog) {
      await openFolderPicker()
      return
    }
    if (!isNativeFSSupported()) {
      importFiles(folderInputRef)
      return
    }
    if (!canLeaveWorkspace()) return
    setImportNotice('')
    try {
      const handle = await pickNativeDirectory()
      const tree = await buildTreeFromHandle(handle)
      openProject({ project: { name: handle.name, root: 'local:' + handle.name }, tree, handle })
      setFolderOpen(false)
    } catch (error) {
      if (error.name !== 'AbortError') {
        if (webPulse) setImportNotice('The browser could not open that folder directly. Use Import Folder to open a copy.')
        else setBrowseErr('The browser could not access that folder. Enter its path or import a copy.')
        setLeftOpen(true)
        if (window.innerWidth <= 860) setPane('files')
      }
    }
  }

  const handleVirtualInput = (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    const { root: tree, fileMap } = buildVirtualTreeFromFiles(files)
    if (!fileMap.size) {
      setImportNotice('No project files were found in that selection.')
      return
    }
    openProject({ project: { name: tree.name, root: 'virtual:' + tree.name }, tree, files: fileMap })
    setFolderOpen(false)
  }

  const forgetRecentProject = (root) => {
    const next = recentProjects.filter((item) => item.root !== root)
    setRecentProjects(next)
    try {
      localStorage.setItem('aether.recentProjects', JSON.stringify(next))
      if (localStorage.getItem('aether.lastProject') === root) localStorage.setItem('aether.lastProject', '')
      localStorage.removeItem('aether.lastFile:' + root)
      localStorage.removeItem(lastFileKey(root))
    } catch {}
  }

  const closeProject = async (forget = false) => {
    if (!canLeaveWorkspace()) return
    workspaceRestore.current?.abort()
    if (forget) forgetRecentProject(workspace.root)
    try { localStorage.setItem('aether.lastProject', '') } catch {}
    setMessages((prev) => prev.filter((message) => message.role !== 'proposal'))
    setWebDirHandle(null)
    setVirtualFiles(null)
    setWorkspace({ name: null, root: null })
    setTree(null)
    setTabs([])
    setActive('')
    setDirty({})
    setHits([])
    setSearch('')
    if (!webPulse) fetch('/api/workspace', { method: 'DELETE' }).catch(() => {})
  }

  const loadBrowse = async (dir) => {
    const request = ++browseRequest.current
    setBrowseErr('')
    try {
      const url = dir ? `/api/browse?path=${encodeURIComponent(dir)}` : '/api/browse'
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      const data = await res.json()
      if (request !== browseRequest.current) return
      if (!res.ok) {
        setBrowseErr(data.error || 'Could not browse that folder.')
        return
      }
      setBrowse(data)
      setFolderPath(data.path)
    } catch {
      if (request === browseRequest.current) {
        setBrowseErr('The workspace server could not be reached. Restart Aether, then use the project’s absolute path to enable Java Run and Debug.')
      }
    }
  }

  const openFolderPicker = async () => {
    if (webPulse) return openLocalFolder()
    if (window.electronAPI?.openFolderDialog) {
      try {
        const res = await window.electronAPI.openFolderDialog()
        if (!res.canceled && res.filePaths?.[0]) {
          await selectFolder(res.filePaths[0])
          return
        }
        if (res.canceled) return
      } catch (err) {
        console.warn('Native open folder dialog failed, falling back to browser modal:', err)
      }
    }
    const root = workspace.root && !webDirHandle && !virtualFiles ? workspace.root : ''
    setBrowse(null)
    setFolderPath(root)
    setFolderOpen(true)
    void loadBrowse(root)
  }

  const selectFolder = async (requested = folderPath) => {
    if (webPulse) return openLocalFolder()
    const path = requested.trim()
    if (!path || openingFolder || !canLeaveWorkspace()) return
    workspaceRestore.current?.abort()
    browseRequest.current++
    setOpeningFolder(true)
    setBrowseErr('')
    try {
      const res = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, includeTree: true }),
        signal: AbortSignal.timeout(10000)
      })
      const data = await res.json()
      if (!res.ok) {
        const message = data.error || 'Could not open that folder.'
        setBrowseErr(message)
        setImportNotice(message)
        return
      }
      const restoredFile = await restoreLastFile(data.root, AbortSignal.timeout(5000))
      openProject({ project: { name: data.name, root: data.root }, tree: data.tree, restoredFile })
      const next = [{ name: data.name, root: data.root }, ...recentProjects.filter((item) => item.root !== data.root)].slice(0, 8)
      setRecentProjects(next)
      try {
        localStorage.setItem('aether.recentProjects', JSON.stringify(next))
      } catch {}
      setFolderOpen(false)
    } catch {
      setBrowseErr('The workspace server could not open this folder. Try Choose Folder or Import Folder.')
      setImportNotice('The workspace server could not open this folder.')
    } finally {
      setOpeningFolder(false)
    }
  }

  const premiumToken = (model) => {
    if (!model || model.tier !== 'premium') return ''
    return model.provider === 'gemini' ? vault.gemini : vault.openai
  }

  const pickModel = (id) => {
    const next = allModels.find((m) => m.id === id) || allModels[0]
    setModelId(next.id)
    localStorage.setItem(MODEL_KEY, next.id)
    setPickerOpen(false)
    if (next.tier === 'premium' && !premiumToken(next)) {
      setVaultTab(next.provider === 'gemini' ? 'gemini' : 'openai')
      setVaultOpen(true)
    }
  }

  const openChat = useCallback(() => {
    setRightOpen(true)
    setPane('chat')
    setTimeout(() => {
      chatInputRef.current?.focus()
    }, 100)
  }, [])

  const handleQuickChip = (promptText) => {
    setDraft((prev) => (prev ? `${prev} ${promptText}` : promptText))
    setRightOpen(true)
    setPane('chat')
    setTimeout(() => {
      chatInputRef.current?.focus()
    }, 80)
  }

  const send = async (explicitText) => {
    const text = (typeof explicitText === 'string' ? explicitText : draft).trim()
    if (!text || requestRef.current) return
    const token = premiumToken(selected)
    if (selected.tier === 'premium' && !token) {
      setVaultTab(selected.provider === 'gemini' ? 'gemini' : 'openai')
      setVaultOpen(true)
      return
    }
    const controller = new AbortController()
    requestRef.current = controller
    const timeout = setTimeout(() => controller.abort('timeout'), 120000)
    const serverWorkspace = Boolean(workspace.root && !webDirHandle && !virtualFiles)
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'ai')
      .slice(-20)
      .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text.slice(0, 8000) }))
    const context = [
      settings.customInstructions,
      mode !== 'chat' && current ? `Active file: ${current.path}\n\n${current.content.slice(0, 8000)}` : ''
    ].filter(Boolean).join('\n\n')
    setDraft('')
    if (mode !== 'chat') {
      setRightOpen(true)
      setPane('chat')
    }
    setMessages((prev) => [...prev, { role: 'user', text }])
    setBusy(true)
    try {
      await executeChat({
        message: text, history, mode, context, model: selected, token,
        dirHandle: webDirHandle, serverWorkspace, proxyUrl: vault.proxyUrl,
        signal: controller.signal,
        onEvent: (event, data) => {
          if (controller.signal.aborted) return
          if (event === 'message.delta') {
            setStreamText(data.fullText)
          } else if (event === 'proposal') {
            setMessages((prev) => [...prev, { role: 'proposal', path: data.path, text: data.content, workspaceRoot: workspace.root }])
          } else if (event === 'tool' && data.status === 'done') {
            setStreamText('')
            setMessages((prev) => [...prev, { role: 'tool', name: data.name, status: data.status, output: data.output }])
          } else if (event === 'message' || event === 'error') {
            setStreamText('')
            setMessages((prev) => [...prev, { role: event === 'message' ? 'ai' : 'error', text: data.text || data.error }])
          }
        }
      })
    } catch (error) {
      const text = controller.signal.reason === 'timeout' ? 'The request timed out.'
        : controller.signal.aborted ? 'Request stopped.' : error.message
      setMessages((prev) => [...prev, { role: 'error', text }])
    } finally {
      clearTimeout(timeout)
      requestRef.current = null
      setStreamText('')
      setBusy(false)
    }
  }

  const reviewProposal = (proposal) => {
    if (!workspace.root || virtualFiles || proposal.workspaceRoot !== workspace.root) return
    const existing = tabs.find((tab) => tab.path === proposal.path)
    if (existing && isDirty(existing) && !window.confirm(`Replace your unsaved draft for ${proposal.path}?`)) return
    const draftTab = { path: proposal.path, content: proposal.text }
    setTabs((prev) => existing ? prev.map((tab) => tab.path === proposal.path ? draftTab : tab) : [...prev, draftTab])
    setDirty((prev) => ({ ...prev, [proposal.path]: true }))
    setActive(proposal.path)
    setPane('editor')
    if (mode === 'chat') switchMode('agent')
    setMdMode('edit')
    setEditorNotice('Agent proposal · Review and save')
  }

  useEffect(() => {
    setLaunchTarget('')
    setLaunchRequest(null)
    setLaunchCatalog({ applications: [], jdks: [] })
    setLaunchCatalogError('')
  }, [workspace.root])

  useEffect(() => {
    if (!workspace.root || webDirHandle || virtualFiles || !tree) return
    const controller = new AbortController()
    fetch('/api/maven/applications?project=' + encodeURIComponent(workspace.root), { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load Java main classes.')
        return data
      })
      .then((data) => { if (data && !controller.signal.aborted) setLaunchCatalog(data) })
      .then(() => { if (!controller.signal.aborted) setLaunchCatalogError('') })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLaunchCatalog({ applications: [], jdks: [] })
          setLaunchCatalogError(error instanceof SyntaxError ? 'Java discovery API unavailable. Restart Aether.' : error.message)
        }
      })
    return () => controller.abort()
  }, [workspace.root, webDirHandle, virtualFiles, tree])

  const selectedLaunch = launchCatalog.applications.find(({ path }) => path === launchTarget)
    || launchCatalog.applications.find(({ path }) => path === active)
    || launchCatalog.applications[0]

  const showRun = () => {
    if (webPulse) {
      setImportNotice('Java Run and Debug require the Ather Studio desktop app.')
      return
    }
    setRunLaunch((previous) => previous + 1)
  }

  const linked = Boolean(premiumToken(selected))
  const keyStatus = linked ? 'API key ready' : selected.provider === 'pollinations' ? 'Server key' : 'Needs API key'
  const stopRequest = () => requestRef.current?.abort()

  useEffect(() => {
    if (!menuOpen) return
    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return
      if (event.type === 'pointerdown' && event.target.closest('.workbench-menu')) return
      setActiveMenu(null)
      setMenuOpen(false)
    }
    window.addEventListener('keydown', close)
    window.addEventListener('pointerdown', close)
    return () => {
      window.removeEventListener('keydown', close)
      window.removeEventListener('pointerdown', close)
    }
  }, [menuOpen])

  const toggleProject = () => {
    if (!leftOpen) setPane('editor')
    setLeftOpen(!leftOpen)
  }
  const toggleAssistant = () => {
    setMavenSideOpen(false)
    switchMode(rightOpen && mode === 'editor' ? 'editor' : 'chat')
  }
  const toggleMaven = () => {
    setMavenSideOpen(!mavenSideOpen)
    if (!mavenSideOpen) {
      setRightOpen(false)
      setPane('editor')
    }
  }
  const executeApplication = async (debug, target = selectedLaunch) => {
    if (webPulse || !target) {
      showRun()
      return
    }
    if (current?.path === target.path && isDirty(current) && !(await saveFile())) return
    setTerminalOpen(false)
    setMavenOpen(true)
    setLaunchTarget(target.path)
    setLaunchRequest({ goal: 'application', debug, application: target.path })
  }
  const toggleTerminal = () => {
    const next = !mavenOpen || !terminalOpen
    setMavenOpen(next)
    setTerminalOpen(next)
  }
  const outline = useMemo(() => fileOutline(current?.path, current?.content), [current])
  const [editorFolds, setEditorFolds] = useState(new Set())
  const [structureFilter, setStructureFilter] = useState('')

  useEffect(() => {
    setEditorFolds(new Set())
    setStructureFilter('')
  }, [current?.path])

  const toggleEditorFold = useCallback((startLine) => {
    setEditorFolds((prev) => {
      const next = new Set(prev)
      if (next.has(startLine)) next.delete(startLine)
      else next.add(startLine)
      return next
    })
  }, [])

  const foldAllMethods = useCallback(() => {
    const next = new Set()
    for (const item of outline) {
      if (item.canFold && item.endLine > item.startLine) {
        next.add(item.startLine)
      }
    }
    setEditorFolds(next)
  }, [outline])

  const expandAllMethods = useCallback(() => {
    setEditorFolds(new Set())
  }, [])
  const activeMain = launchCatalog.applications.find((item) => item.path === active)
  const breakpointWorkspace = workspace.root || workspace.name || ''
  const projectBreakpoints = javaBreakpoints[breakpointWorkspace] || {}
  const toggleBreakpoint = (line) => {
    setJavaBreakpoints((previous) => {
      const files = previous[breakpointWorkspace] || {}
      const lines = files[active] || []
      const next = lines.includes(line) ? lines.filter((item) => item !== line) : [...lines, line].sort((a, b) => a - b)
      return { ...previous, [breakpointWorkspace]: { ...files, [active]: next } }
    })
  }
  const toggleStructure = () => {
    setStructureOpen((previous) => !previous)
    setLeftOpen(true)
    if (window.innerWidth <= 860) setPane('files')
  }

  const reloadMavenTree = async () => {
    if (!workspace.root || webDirHandle || virtualFiles) throw new Error('Use a server workspace')
    const openedWorkspace = workspaceRef.current
    const response = await fetch('/api/tree')
    if (!response.ok) throw new Error('Workspace unavailable')
    const next = await response.json()
    if (workspaceRef.current === openedWorkspace) setTree(next)
  }

  const revealCurrentFile = () => revealFile(active)
  const revealFile = (path) => {
    if (!path) return
    setSearch('')
    setLeftOpen(true)
    if (window.innerWidth <= 860) setPane('files')
    const parts = path.split('/')
    setOpenDirs((previous) => new Set([...previous, '', ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))]))
    setRevealPath({ path })
  }

  useEffect(() => {
    if (!revealPath) return
    document.querySelector(`[data-project-path="${CSS.escape(revealPath.path)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [revealPath, tree])

  const expandProject = () => {
    expandingProject.current = workspaceRef.current
    const paths = new Set()
    const visit = (node) => {
      if (node?.type !== 'dir') return
      paths.add(node.path)
      node.children?.forEach(visit)
    }
    visit(tree)
    setSearch('')
    setOpenDirs(paths)
  }
  const collapseProject = () => {
    expandingProject.current = null
    setSearch('')
    setOpenDirs(new Set())
  }

  const canCreateInProject = Boolean(workspace.root && !webDirHandle && !virtualFiles)
  const parentFolder = (file = '') => file.split('/').slice(0, -1).join('/')
  const createProjectItem = async (kind, directory, extension = '', template = () => '') => {
    const openedWorkspace = workspaceRef.current
    let input = null
    if (window.electronAPI?.prompt) {
      input = await window.electronAPI.prompt({
        title: `New ${kind}`,
        message: `Enter name for new ${kind}:`,
        defaultValue: kind === 'Java Class' ? 'MyClass' : ''
      })
    } else {
      input = window.prompt(`New ${kind} name`)
    }
    if (input === null || input === undefined || workspaceRef.current !== openedWorkspace) return
    let name = input.trim()
    if (!name || /[<>:"/\\|?*]/.test(name) || /[. ]$/.test(name) ||
      (kind === 'Java Class' && !/^[A-Za-z_$][\w$]*(?:\.java)?$/.test(name))) {
      setImportNotice('Enter a valid name without path separators.')
      return
    }
    if (extension && !name.toLowerCase().endsWith(extension)) name += extension
    const path = [directory, name].filter(Boolean).join('/')
    const folder = kind === 'Directory'
    try {
      const response = await fetch(folder ? '/api/mkdir' : '/api/file', {
        method: folder ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, createOnly: true, content: template(name, directory) })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(response.status === 409 ? 'That name already exists.' : data.error)
      if (workspaceRef.current !== openedWorkspace) return
      await reloadMavenTree()
      if (workspaceRef.current !== openedWorkspace) return
      const parts = directory ? directory.split('/') : []
      setOpenDirs((previous) => new Set([...previous, '', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))]))
      setImportNotice('')
      if (!folder) await openFile(path)
    } catch (error) {
      if (workspaceRef.current === openedWorkspace) setImportNotice(error.message || 'Could not create the item.')
    }
  }
  const newItems = (directory, fromFileMenu = false) => [
    ...(fromFileMenu ? [['Project from Existing Sources…', openFolderPicker]] : []),
    ['File…', canCreateInProject ? () => createProjectItem('File', directory) : null],
    ['Directory…', canCreateInProject ? () => createProjectItem('Directory', directory) : null],
    ['Java Class…', canCreateInProject ? () => createProjectItem('Java Class', directory, '.java', (name, folder) => {
      const pkg = /(?:^|\/)src\/(?:main|test)\/java\/(.+)$/.exec(folder)?.[1]?.replaceAll('/', '.')
      return (pkg ? `package ${pkg};\n\n` : '') + `public class ${name.slice(0, -5)} {\n}\n`
    }) : null],
    ['HTML File…', canCreateInProject ? () => createProjectItem('HTML File', directory, '.html', () => '<!doctype html>\n<html lang="en">\n<head><title>New page</title></head>\n<body></body>\n</html>\n') : null],
    ['Kotlin Class/File…', canCreateInProject ? () => createProjectItem('Kotlin File', directory, '.kt') : null],
    ['HTTP Request…', canCreateInProject ? () => createProjectItem('HTTP Request', directory, '.http') : null],
    ['Resource Bundle…', canCreateInProject ? () => createProjectItem('Resource Bundle', directory, '.properties') : null],
    ['Markdown Scratch File', () => createNewFile()]
  ]

  useEffect(() => {
    if (!window.electronAPI?.onMenuAction) return
    const cleanup = window.electronAPI.onMenuAction((action) => {
      if (action === 'new-file') {
        if (canCreateInProject) createProjectItem('File', '')
        else createNewFile()
      } else if (action === 'new-java') {
        if (canCreateInProject) {
          createProjectItem('Java Class', '', '.java', (name, folder) => {
            const pkg = /(?:^|\/)src\/(?:main|test)\/java\/(.+)$/.exec(folder)?.[1]?.replaceAll('/', '.')
            return (pkg ? `package ${pkg};\n\n` : '') + `public class ${name.slice(0, -5)} {\n}\n`
          })
        }
      } else if (action === 'new-directory') {
        if (canCreateInProject) createProjectItem('Directory', '')
      } else if (action === 'open-folder') {
        openFolderPicker()
      } else if (action === 'save') {
        if (current) saveFile()
      } else if (action === 'run-java' || action === 'debug-java') {
        const target = launchCatalog.applications.find((item) => item.path === active)
        if (target) void executeApplication(action === 'debug-java', target)
        else setEditorNotice('Open a runnable Java file first.')
      } else if (action === 'search-everywhere') {
        setSearchEverywhere(true)
      } else if (action === 'find-file') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
      }
    })
    return cleanup
  }, [current, saveFile, canCreateInProject, active, launchCatalog, executeApplication])

  // Multi-platform desktop & web window controls (macOS left traffic lights vs Windows right buttons)
  const isElectron = Boolean(window.electronAPI?.isElectron)
  const platform = window.electronAPI?.platform || (typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent) ? 'darwin' : 'win32')
  const isMac = platform === 'darwin'
  const isWindows = !isMac
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (window.electronAPI?.isMaximized) {
      window.electronAPI.isMaximized().then(setIsMaximized).catch(() => {})
    }
    if (window.electronAPI?.onMaximizedChange) {
      return window.electronAPI.onMaximizedChange(setIsMaximized)
    }
  }, [])

  const handleWindowMinimize = () => {
    window.electronAPI?.minimize?.()
  }

  const handleWindowMaximize = () => {
    if (window.electronAPI?.maximize) {
      window.electronAPI.maximize()
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  const handleWindowClose = () => {
    if (window.electronAPI?.close) {
      window.electronAPI.close()
    } else {
      window.close()
    }
  }
  const openProjectMenu = (event, node) => {
    event.preventDefault()
    setMenuOpen(false)
    setActiveMenu(null)
    setNewMenuOpen(false)
    const width = node.type === 'file' ? 322 : 230
    const height = node.type === 'file' ? 370 : 220
    setProjectMenu({ node, x: Math.max(4, Math.min(event.clientX, window.innerWidth - width)),
      y: Math.max(4, Math.min(event.clientY, window.innerHeight - height)) })
  }
  useEffect(() => {
    if (!projectMenu) return
    const dismiss = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !event.target.closest('.project-context-menu')) setProjectMenu(null)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
    }
  }, [projectMenu])
  const renderNewMenu = (directory, context = false) => <div className="ide-new-menu">
    <button type="button" aria-expanded={newMenuOpen} onClick={() => setNewMenuOpen(!newMenuOpen)}>New <span aria-hidden="true">›</span></button>
    {newMenuOpen && <div className="ide-new-items">
      {newItems(directory, !context).map(([label, action]) => <button type="button" key={label} disabled={!action} onClick={() => {
        setProjectMenu(null)
        setMenuOpen(false)
        setActiveMenu(null)
        setNewMenuOpen(false)
        action()
      }}>{label}</button>)}
    </div>}
  </div>
  const contextNode = projectMenu?.node
  const tabContext = projectMenu?.tab === true
  const reopenCandidate = closedEditorFiles.find((item) => item.root === workspace.root && !tabs.some((tab) => tab.path === item.path))
  const tabsOverflow = tabs.length * 154 - 4 > tabStripWidth
  const visibleTabCount = tabsOverflow ? Math.max(1, Math.floor((tabStripWidth - 58) / 154)) : tabs.length
  const visibleTabs = tabs.slice(0, visibleTabCount)
  if (current && !visibleTabs.includes(current)) visibleTabs[visibleTabs.length - 1] = current
  const hiddenTabs = tabs.filter((tab) => !visibleTabs.includes(tab))
  const openTabPopup = (event, kind) => {
    const anchor = event.currentTarget.getBoundingClientRect()
    tabPopupTrigger.current = event.currentTarget
    setTabPopup(tabPopup?.kind === kind ? null : {
      kind,
      left: Math.max(4, Math.min(anchor.right - 244, window.innerWidth - 248)),
      top: anchor.bottom + 4,
      maxHeight: Math.max(48, window.innerHeight - anchor.bottom - 8)
    })
  }
  const selectPopupFile = (path) => {
    setTabPopup(null)
    void openFile(path)
  }
  useEffect(() => {
    if (!projectViewPosition) return
    const dismiss = (event) => {
      if (event.type === 'pointerdown' && (projectViewButton.current?.contains(event.target) || event.target.closest('.project-view-popup'))) return
      if (event.type === 'keydown' && event.key !== 'Escape') return
      setProjectViewPosition(null)
      if (event.type === 'keydown') projectViewButton.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [projectViewPosition])
  const confirmProjectFileDelete = (path) => {
    const tab = tabs.find((item) => item.path === path)
    setPendingDelete({ path, workspace: workspaceRef.current, unsaved: Boolean(tab && isDirty(tab)) })
  }
  useEffect(() => {
    if (pendingDelete && !deleteDialog.current?.open) deleteDialog.current?.showModal()
  }, [pendingDelete])
  const deleteProjectFile = async ({ path, workspace: openedWorkspace }) => {
    setPendingDelete(null)
    if (workspaceRef.current !== openedWorkspace) return
    try {
      const response = await fetch('/api/file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, project: openedWorkspace.root })
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || data?.ok !== true) {
        throw new Error(data?.error || (response.status === 404 ? 'Delete is unavailable. Restart the Aether backend.' : 'Could not delete the file.'))
      }
      if (workspaceRef.current !== openedWorkspace) return
      const removeFile = (node) => {
        if (!node?.children || (node.path && !path.startsWith(node.path + '/'))) return node
        return { ...node, children: node.children.filter((child) => child.path !== path).map(removeFile) }
      }
      setTree(removeFile)
      setTabs((previous) => previous.filter((item) => item.path !== path))
      setActive((previous) => previous === path ? '' : previous)
      setDirty((previous) => {
        const next = { ...previous }
        delete next[path]
        return next
      })
      setHits((previous) => previous.filter((item) => item.path !== path))
      try {
        for (const key of [lastFileKey(openedWorkspace.root), 'aether.lastFile:' + openedWorkspace.root]) {
          if (localStorage.getItem(key) === path) localStorage.removeItem(key)
        }
      } catch {}
      setImportNotice('')
    } catch (error) {
      if (workspaceRef.current === openedWorkspace) setImportNotice(error.message)
    }
  }
  const reloadProjectFile = async (path) => {
    const tab = tabs.find((item) => item.path === path)
    if (tab && isDirty(tab) && !window.confirm('Discard unsaved edits and reload this file from disk?')) return
    const openedWorkspace = workspaceRef.current
    try {
      const response = await fetch('/api/file?path=' + encodeURIComponent(path), { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || data.type !== 'file') throw new Error(data.error || 'Could not reload the file.')
      if (workspaceRef.current !== openedWorkspace) return
      setTabs((previous) => previous.some((item) => item.path === path)
        ? previous.map((item) => item.path === path ? { ...item, content: data.content } : item)
        : [...previous, { path, content: data.content }])
      setDirty((previous) => ({ ...previous, [path]: data.content }))
      setActive(path)
      setEditorNotice('')
      setPane('editor')
    } catch (error) {
      if (workspaceRef.current === openedWorkspace) setImportNotice(error.message)
    }
  }
  const contextMain = launchCatalog.applications.find((item) => item.path === contextNode?.path)
  const tabActionGroups = tabContext ? [
    [
      ['Close', () => closeEditorTabs(contextNode.path)],
      ['Close Other Tabs', tabs.length > 1 ? () => closeEditorTabs(contextNode.path, true) : null],
      ['Close All Tabs', () => closeEditorTabs(contextNode.path, false, 'all')],
      ['Close Tabs to the Right', tabs.at(-1)?.path !== contextNode.path ? () => closeEditorTabs(contextNode.path, false, 'right') : null]
    ],
    [
      ['Copy Path/Reference…', () => navigator.clipboard.writeText(contextNode.path).catch(() => setEditorNotice('Could not copy the path.')), 'file'],
      ['Reveal in Project', workspace.root ? () => { setActive(contextNode.path); revealFile(contextNode.path) } : null, 'folder'],
      ['Reopen Closed Tab', reopenCandidate ? () => openFile(reopenCandidate.path) : null, 'reload']
    ],
    ...(contextMain ? [[
      [`Run '${contextMain.className.split('.').at(-1)}.main()'`, () => executeApplication(false, contextMain), 'play'],
      [`Debug '${contextMain.className.split('.').at(-1)}.main()'`, () => executeApplication(true, contextMain), 'debug'],
      ['Edit Run/Debug Configuration…', () => { setLaunchTarget(contextMain.path); showRun() }, 'execute']
    ]] : [])
  ] : []
  const fileContext = contextNode?.type === 'file'
  const fileActionGroups = fileContext ? [
    [
      ['Open File', () => openFile(contextNode.path), 'file'],
      ['Copy Path/Reference…', () => navigator.clipboard.writeText(contextNode.path).catch(() => setImportNotice('Could not copy the path.')), 'file']
    ],
    [['Delete…', canCreateInProject ? () => confirmProjectFileDelete(contextNode.path) : null, 'trash']],
    ...(contextMain ? [[
      [`Run '${contextMain.className.split('.').at(-1)}.main()'`, () => executeApplication(false, contextMain), 'play'],
      [`Debug '${contextMain.className.split('.').at(-1)}.main()'`, () => executeApplication(true, contextMain), 'debug'],
      ['Edit Run/Debug Configuration…', () => { setLaunchTarget(contextMain.path); showRun() }, 'execute']
    ]] : []),
    [['Reload from Disk', canCreateInProject ? () => reloadProjectFile(contextNode.path) : null, 'reload']]
  ] : []
  const contextActions = contextNode ? [
    [contextNode.type === 'dir' ? 'Find in Files…' : 'Open File', contextNode.type === 'dir' ? () => setSearchEverywhere(true) : () => openFile(contextNode.path)],
    ['Copy Path', () => navigator.clipboard.writeText(contextNode.path || workspace.root).catch(() => setImportNotice('Could not copy the path.'))],
    ['Reload from Disk', canCreateInProject ? () => reloadMavenTree().catch(() => setImportNotice('Could not reload the project.')) : null],
    ...(contextNode.path ? [] : [['Maven', canCreateInProject ? toggleMaven : null], ['Close Project', () => closeProject()]])
  ] : []

  const menus = {
    File: [
      ['New File…', canCreateInProject ? () => createProjectItem('File', '') : () => createNewFile()],
      ['New Java Class…', canCreateInProject ? () => createProjectItem('Java Class', '', '.java', (name) => `public class ${name.slice(0, -5)} {\n}\n`) : null],
      ['New Directory…', canCreateInProject ? () => createProjectItem('Directory', '') : null],
      ['Open Project…', openFolderPicker],
      ['Browse Server Workspace…', openFolderPicker],
      ['Save', current ? saveFile : null],
      ['Run Java File', activeMain ? () => executeApplication(false, activeMain) : null],
      ['Debug Java File', activeMain ? () => executeApplication(true, activeMain) : null],
      ['Close Project', workspace.root ? () => closeProject() : null],
      ['Settings…', () => setSettingsOpen(true)]
    ],
    Edit: [['Edit Markdown', current?.path.match(/\.m(?:d|arkdown)$/i) ? () => setMdMode('edit') : null]],
    View: [['Project', toggleProject], ['Structure', toggleStructure], ['AI Chat', toggleAssistant], ['Maven Console', toggleMaven]],
    Navigate: [['Search Everywhere', () => setSearchEverywhere(true)]],
    Code: [['Reformat Code', null]],
    Refactor: [['Rename Symbol', null]],
    Build: [['Maven Lifecycle', toggleMaven]],
    Run: [['Run Application…', () => executeApplication(false)], ['Run / Debug Configurations…', showRun]],
    Tools: [['Maven Terminal', toggleTerminal], ['Agent', () => switchMode('agent')], ['Provider Keys…', () => setVaultOpen(true)]],
    VCS: [['Commit', null]],
    Window: [['Toggle Project', toggleProject], ['Toggle Assistant', toggleAssistant]],
    Help: [['Install Aether…', () => setAppModalOpen(true)]]
  }

  return (
    <div className={`app intellij-workbench mode-${mode} ${mavenOpen && mode !== 'chat' ? 'has-maven-panel' : ''}`}>
      {pendingDelete && createPortal(
        <dialog ref={deleteDialog} className="java-config-dialog delete-file-dialog" aria-labelledby="delete-file-title" aria-describedby="delete-file-description"
          onCancel={(event) => { event.preventDefault(); setPendingDelete(null) }}>
          <header>
            <span className="delete-file-emblem" aria-hidden="true">
              <span className="delete-art-sheet"><TreeIcon name="file" /></span>
              <span className="delete-art-bin"><TreeIcon name="trash" /></span>
            </span>
            <div>
              <strong id="delete-file-title">Delete file?</strong>
              <p id="delete-file-description">This will permanently remove the file from disk.</p>
            </div>
            <details className="delete-file-help">
              <summary aria-label="About permanent deletion" title="About permanent deletion">?</summary>
              <div>Deleting here skips the Recycle Bin. Choose Cancel to keep the file.</div>
            </details>
          </header>
          <div className="delete-file-message">
            <div className="delete-file-preview">
              <TreeIcon name="file" />
              <div>
                <strong>{pendingDelete.path.split('/').at(-1)}</strong>
                {pendingDelete.path.includes('/') && <small>{pendingDelete.path.split('/').slice(0, -1).join('/')}</small>}
              </div>
            </div>
            {pendingDelete.unsaved && <p className="delete-file-warning">Unsaved changes to this file will be lost.</p>}
          </div>
          <footer>
            <button type="button" autoFocus title="Cancel" aria-label="Cancel" onClick={() => setPendingDelete(null)}><span aria-hidden="true">×</span></button>
            <button type="button" className="delete-file-confirm" title="Delete file" aria-label="Delete file" onClick={() => void deleteProjectFile(pendingDelete)}><TreeIcon name="trash" /></button>
          </footer>
        </dialog>, document.body
      )}
      {contextNode && <div className={`project-context-menu ${fileContext ? 'file-context-menu' : ''}`} style={{ left: projectMenu.x, top: projectMenu.y }} aria-label={tabContext ? 'Editor tab actions' : fileContext ? 'File actions' : 'Project actions'}>
        {!tabContext && renderNewMenu(contextNode.type === 'dir' ? contextNode.path : parentFolder(contextNode.path), true)}
        {(tabContext ? tabActionGroups : fileContext ? fileActionGroups : [contextActions]).map((group, index) => <div className="context-action-group" key={index}>
          {group.map(([label, action, icon]) => <button type="button" key={label} disabled={!action} onClick={() => { setProjectMenu(null); action() }}>
            {icon && <TreeIcon name={icon} />}{label}
          </button>)}
        </div>)}
      </div>}
      <header
        ref={topbarRef}
        onClickCapture={(event) => {
          if (pulseMode && !event.target.closest('.modes, .window-controls-win, .window-controls-mac')) selectPulseView(null)
        }}
        className={`topbar ${isMac ? 'platform-mac' : 'platform-win'} ${isElectron ? 'is-electron' : 'is-web'}`}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget || e.target.classList.contains('topbar')) {
            handleWindowMaximize()
          }
        }}
      >
        {/* On macOS in Web mode: render sleek Mac traffic lights on the TOP-LEFT */}
        {isMac && !isElectron && (
          <div className="window-controls-mac" aria-label="macOS Window Controls">
            <button
              type="button"
              className="mac-traffic-light mac-close"
              onClick={handleWindowClose}
              title="Close"
              aria-label="Close"
            />
            <button
              type="button"
              className="mac-traffic-light mac-minimize"
              onClick={handleWindowMinimize}
              title="Minimize"
              aria-label="Minimize"
            />
            <button
              type="button"
              className="mac-traffic-light mac-maximize"
              onClick={handleWindowMaximize}
              title={isMaximized ? "Exit Full Screen" : "Full Screen"}
              aria-label={isMaximized ? "Exit Full Screen" : "Full Screen"}
            />
          </div>
        )}
        <div className="mark">
          <div className="mark-orb" />
          <div>
            <h1>Aether</h1>
            <span>AI Studio</span>
          </div>
        </div>
        <nav className="workbench-menu" aria-label="IDE menu">
        <button type="button" className="workbench-menu-toggle" aria-label="Menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen(!menuOpen); setActiveMenu(null); setNewMenuOpen(false) }}>☰</button>
          {menuOpen && <div className="workbench-menu-bar">{Object.entries(menus).map(([name, items]) => (
            <div className="workbench-menu-group" key={name}>
              <button type="button" aria-expanded={activeMenu === name} onClick={() => { setNewMenuOpen(false); setActiveMenu(activeMenu === name ? null : name) }}>{name}</button>
              {activeMenu === name && (
                <div className="workbench-menu-items">
                  {name === 'File' && renderNewMenu(parentFolder(active))}
                  {items.map(([label, action]) => (
                    <button type="button" key={label} disabled={!action} onClick={() => { setActiveMenu(null); setMenuOpen(false); action?.() }}>{label}</button>
                  ))}
                </div>
              )}
            </div>
          ))}</div>}
        </nav>
        <details className="toolbar-popover project-switcher">
          <summary title={workspace.root || 'Switch project'}><span>{workspace.name || 'Open Project'}</span><span className="project-switcher-chevron" aria-hidden="true" /></summary>
          <div>
            <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; openFolderPicker() }}>Open Project…</button>
            {webPulse && <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; importFiles(folderInputRef) }}>Import Folder…</button>}
            {!webPulse && recentProjects.length > 0 && <strong>Recent Projects</strong>}
            {!webPulse && recentProjects.map((item) => (
              <button type="button" key={item.root} onClick={(event) => {
                event.currentTarget.closest('details').open = false
                setFolderPath(item.root)
                setBrowse(null)
                setFolderOpen(true)
                void selectFolder(item.root)
              }}><span>{item.name}</span><small>{item.root}</small></button>
            ))}
          </div>
        </details>
        <div className="modes" role="group" aria-label="Workspace views">
          <button aria-pressed={!pulseMode && mode === 'editor'} className={!pulseMode && mode === 'editor' ? 'on' : ''} onClick={() => { selectPulseView(null); switchMode('editor') }}>IDE</button>
          <button aria-pressed={!pulseMode && mode === 'agent'} className={!pulseMode && mode === 'agent' ? 'on' : ''} onClick={() => { selectPulseView(null); switchMode('agent') }}>Agent</button>
          {(pulseBridge || webPulse) && (
            <>
              <button aria-pressed={pulseMode === 'studio'} className={pulseMode === 'studio' ? 'on' : ''} onClick={() => selectPulseView('studio')}>Studio</button>
              <button aria-pressed={pulseMode === 'dashboard'} className={pulseMode === 'dashboard' ? 'on' : ''} onClick={() => selectPulseView('dashboard')}>Dashboard</button>
            </>
          )}
        </div>
        <div className="top-actions">
          {mode !== 'chat' && <><button className="ghost maven-toggle" aria-pressed={mavenOpen} onClick={toggleMaven}>Maven</button><div className="launch-selector">
            <select aria-label="Run configuration" title={webPulse ? 'Java Run and Debug require the Ather Studio desktop app.' : launchCatalogError || (webDirHandle || virtualFiles ? 'Use Open Project with the absolute folder path to enable Java Run and Debug.' : undefined)} value={selectedLaunch?.path || ''} onChange={(event) => {
              if (event.target.value === ':configure') showRun()
              else setLaunchTarget(event.target.value)
            }}>
              {!selectedLaunch && <option value="">{webDirHandle || virtualFiles ? 'Open workspace to run Java' : launchCatalogError ? 'Java discovery unavailable' : 'No main class found'}</option>}
              {launchCatalog.applications.map((item) => <option key={item.path} value={item.path}>{item.className.split('.').at(-1)}</option>)}
              <option value=":configure">Edit Configurations…</option>
            </select>
            <button className="ghost run-toggle" onClick={() => executeApplication(false)} aria-label="Run application" title="Run">▶</button>
            <button className="ghost run-toggle" onClick={() => executeApplication(true)} disabled={!selectedLaunch} aria-label="Debug application" title="Debug">♧</button>
            <button type="button" className="ghost run-toggle" onClick={showRun} aria-label="Edit Run/Debug configurations" title="Edit Run/Debug configurations">⋮</button>
          </div></>}
          {mode !== 'chat' && <button className="ghost workbench-icon-button" title="Search Everywhere (Double Shift)" aria-label="Search Everywhere" onClick={() => setSearchEverywhere(true)}><WorkbenchIcon name="search" /></button>}
          <div className="picker-wrap">
            <button
              className="model-btn workbench-icon-button"
              title={`AI model: ${selected.label}`}
              aria-label={`Choose AI model, currently ${selected.label}`}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            >
              <WorkbenchIcon name="robot" />
            </button>
            {pickerOpen && (
              <>
                <div className="picker-overlay" onClick={() => setPickerOpen(false)} />
                <div className="picker" onClick={(e) => e.stopPropagation()}>
                  <div className="picker-label">Pollinations (Server Key)</div>
                  {catalog.free.map((m) => (
                    <button key={m.id} className={m.id === selected.id ? 'on' : ''} onClick={() => pickModel(m.id)}>
                      <strong>{m.label}</strong>
                      <span>{m.blurb}</span>
                    </button>
                  ))}
                  <div className="picker-section-head">
                    <span className="picker-label">Google Gemini</span>
                    <button
                      type="button"
                      className="picker-info-tag"
                      title="How to get free Gemini API key"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPickerOpen(false)
                        openTokenHelper('gemini')
                      }}
                    >
                      <span className="info-i">ℹ</span>
                      <span>How to get key</span>
                    </button>
                  </div>
                  {catalog.premium.filter((m) => m.provider === 'gemini').map((m) => (
                    <div key={m.id} className={`picker-row ${m.id === selected.id ? 'on' : ''}`}>
                      <button
                        type="button"
                        className="picker-model-btn"
                        onClick={() => pickModel(m.id)}
                      >
                        <strong>{m.label}</strong>
                        <span>{m.blurb}{vault.gemini ? ' · ready' : ' · token required'}</span>
                      </button>
                      <button
                        type="button"
                        className="picker-row-info-btn"
                        title="View step-by-step instructions to get Gemini token"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPickerOpen(false)
                          openTokenHelper('gemini')
                        }}
                      >
                        ℹ
                      </button>
                    </div>
                  ))}

                  <div className="picker-section-head">
                    <span className="picker-label">ChatGPT / OpenAI</span>
                    <button
                      type="button"
                      className="picker-info-tag"
                      title="How to get OpenAI API key"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPickerOpen(false)
                        openTokenHelper('openai')
                      }}
                    >
                      <span className="info-i">ℹ</span>
                      <span>How to get key</span>
                    </button>
                  </div>
                  {catalog.premium.filter((m) => m.provider === 'openai').map((m) => (
                    <div key={m.id} className={`picker-row ${m.id === selected.id ? 'on' : ''}`}>
                      <button
                        type="button"
                        className="picker-model-btn"
                        onClick={() => pickModel(m.id)}
                      >
                        <strong>{m.label}</strong>
                        <span>{m.blurb}{vault.openai ? ' · ready' : ' · token required'}</span>
                      </button>
                      <button
                        type="button"
                        className="picker-row-info-btn"
                        title="View step-by-step instructions to get OpenAI token"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPickerOpen(false)
                          openTokenHelper('openai')
                        }}
                      >
                        ℹ
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="chip workbench-icon-button" role="img" aria-label={keyStatus} title={keyStatus}><WorkbenchIcon name="key" /></span>
          <button
            className={`${leftOpen ? 'ghost' : 'primary'} panel-toggle-btn ${leftOpen ? 'on' : ''}`}
            onClick={() => setLeftOpen((v) => !v)}
            title={leftOpen ? "Hide File Tree (Ctrl+B)" : "Open File Tree (Ctrl+B)"}
          >
            <span className="panel-ico">{leftOpen ? '◧' : '📂'}</span>
            <span className="panel-btn-label">{leftOpen ? 'Files' : 'Open Files'}</span>
          </button>
          <button
            className={`${rightOpen ? 'ghost' : 'primary'} panel-toggle-btn ${rightOpen ? 'on' : ''}`}
            onClick={() => { if (rightOpen && mode !== 'agent') switchMode('editor'); else switchMode('chat') }}
            hidden={mode === 'chat'}
            title={rightOpen ? 'Hide Assistant (Ctrl+J)' : 'Open Assistant (Ctrl+J)'}
          >
            <span className="panel-ico">{rightOpen ? '◨' : '💬'}</span>
            <span className="panel-btn-label">AI Chat</span>
          </button>
          <button className="ghost pane-btn" onClick={() => pane === 'chat' ? setPane('editor') : openChat()}>
            {pane === 'chat' ? 'Work' : 'Chat'}
          </button>
          <button
            className="ghost user-pill"
            onClick={() => { setNameDraft(userName); setWelcomeModalOpen(true) }}
            title="Personalize your name"
          >
            <span className="user-pill-sparkle">✦</span>
            <span>{userName ? `Hi, ${userName}` : 'Set Name'}</span>
          </button>
          <button className="ghost tokens-btn workbench-icon-button" aria-label="Tokens" title="Tokens" onClick={() => setVaultOpen(true)}><WorkbenchIcon name="token" /></button>
          <details className="toolbar-popover settings-overflow">
            <summary aria-label="IDE settings menu" title="Settings">⚙</summary>
            <div>
              <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; setSettingsOpen(true) }}>Settings…</button>
              <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; toggleProject() }}>Toggle Project Panel</button>
              <button type="button" onClick={(event) => { event.currentTarget.closest('details').open = false; toggleMaven() }}>Toggle Maven Panel</button>
            </div>
          </details>
          <button
            className={`ghost history-btn ${historyOpen ? 'on' : ''}`}
            onClick={() => setHistoryOpen(true)}
            title="Task & Chat History"
            aria-label="Task & Chat History"
          >
            <span className="history-btn-icon" aria-hidden="true">↶</span>
          </button>
          <button className="ghost app-btn" onClick={() => setAppModalOpen(true)} title="Use as app on Windows, Mac & Phone">
            <span className="app-dot" />
            {installed ? 'App Active' : 'Get App'}
          </button>
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(true)}
            title="Menu & Settings"
            aria-label="Open Menu"
          >
            ☰
          </button>
        </div>

        {/* On Windows: render window controls on the TOP-RIGHT corner */}
        {isWindows && (
          <div className="window-controls-win" aria-label="Windows Window Controls">
            <button
              type="button"
              className="win-control-btn win-min"
              onClick={handleWindowMinimize}
              title="Minimize"
              aria-label="Minimize"
            >
              <svg width="10" height="1" viewBox="0 0 10 1">
                <rect width="10" height="1" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className="win-control-btn win-max"
              onClick={handleWindowMaximize}
              title={isMaximized ? "Restore Down" : "Maximize"}
              aria-label={isMaximized ? "Restore Down" : "Maximize"}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path d="M2.5 1h6.5a1 1 0 0 1 1 1v6.5h-1V2H2.5V1z M1 2.5h6.5a1 1 0 0 1 1 1V10H1V2.5zm1 1V9h5V3.5H2z" fill="currentColor" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path d="M0 0v10h10V0H0zm1 1h8v8H1V1z" fill="currentColor" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="win-control-btn win-close"
              onClick={handleWindowClose}
              title="Close"
              aria-label="Close"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M0.7 0L5 4.3 9.3 0 10 0.7 5.7 5 10 9.3 9.3 10 5 5.7 0.7 10 0 9.3 4.3 5 0 0.7z" fill="currentColor" />
              </svg>
            </button>
          </div>
        )}
      </header>
      {webPulse && (
        <iframe
          ref={pulseFrameRef}
          title="Pulse API Studio"
          src="./pulse/index.html"
          hidden={!pulseMode}
          style={{ position: 'fixed', inset: `${pulseFrameTop}px 0 0`, width: '100%', height: `calc(100% - ${pulseFrameTop}px)`, border: 0, zIndex: 99 }}
        />
      )}

      <input
        type="file"
        ref={folderInputRef}
        webkitdirectory="true"
        multiple
        directory="true"
        style={{ display: 'none' }}
        onChange={handleVirtualInput}
      />
      <input type="file" ref={filesInputRef} multiple hidden onChange={handleVirtualInput} />

      <div
        className={`shell pane-${pane} mode-${mode} ${leftOpen ? '' : 'hide-left'} ${rightOpen || mavenSideOpen ? '' : 'hide-right'} ${mavenSideOpen && !rightOpen ? 'show-maven-side' : ''} ${isResizing ? 'resizing' : ''}`}
        style={{
          '--left-w': `${leftWidth}px`,
          '--right-w': `${rightWidth}px`
        }}
      >
        <nav className="workbench-strip project-strip" aria-label="Project tools">
          <button type="button" aria-label="Structure" title="Structure" aria-pressed={structureOpen} onClick={toggleStructure}>▥</button>
          <button type="button" aria-label="Toggle Project" title="Project (Ctrl+B)" aria-pressed={leftOpen} onClick={toggleProject}>▤</button>
          <button type="button" aria-label="Search Everywhere" title="Search Everywhere" onClick={() => setSearchEverywhere(true)}>⌕</button>
          <button type="button" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>⚙</button>
        </nav>
        <nav className="workbench-strip tools-strip" aria-label="Workspace tools">
          <button type="button" aria-label="Toggle AI Chat" title="AI Chat" aria-pressed={rightOpen && mode === 'editor'} onClick={toggleAssistant}>◫</button>
          <button type="button" aria-label="Toggle Maven" title="Maven" aria-pressed={mavenSideOpen && !rightOpen} onClick={toggleMaven}>m</button>
          </nav>
        <nav className="workbench-strip bottom-tools-strip" aria-label="Bottom tools">
          <button type="button" aria-label="Build" title="Build Output" onClick={() => { setTerminalOpen(false); setMavenOpen(true) }}>⚒</button>
          <button type="button" aria-label="Maven Terminal" title="Maven Terminal" aria-pressed={mavenOpen && terminalOpen} onClick={toggleTerminal}>›_</button>
          <button type="button" aria-label="Run Application" title="Run Application" onClick={showRun}>▷</button>
        </nav>
        {!leftOpen && (
          <button
            className="edge-reopen-tab left"
            onClick={() => setLeftOpen(true)}
            title="Open Files Sidebar (Ctrl+B)"
          >
            <span>▶ 📂 Files</span>
          </button>
        )}
        {!rightOpen && (
          <button
            className="edge-reopen-tab right"
            onClick={openChat}
            title="Open AI Chat (Ctrl+J)"
          >
            <span>💬 Chat ◀</span>
          </button>
        )}
        <aside className="side">
          <div className="side-head">
            {workspace.root ? (
              <>
                <span title={workspace.root}>{workspace.name}</span>
                <div className="side-head-actions">
                  <button className="ghost tiny" onClick={(event) => {
                    const anchor = event.currentTarget.getBoundingClientRect()
                    openProjectMenu({ clientX: anchor.left, clientY: anchor.bottom, preventDefault() {} }, tree)
                    setNewMenuOpen(true)
                  }} disabled={!tree} aria-label="New project item" title="New project item">＋</button>
                  <button className="ghost tiny" onClick={revealCurrentFile} disabled={!active} aria-label="Reveal Open File" title="Reveal Open File">◎</button>
                  <button className="ghost tiny" onClick={expandProject} disabled={!tree} aria-label="Expand All" title="Expand All"><TreeIcon name="expand" /></button>
                  <button className="ghost tiny" onClick={collapseProject} disabled={!tree} aria-label="Collapse All" title="Collapse All"><TreeIcon name="collapse" /></button>
                  <button type="button" ref={projectViewButton} className="ghost tiny" aria-expanded={Boolean(projectViewPosition)} aria-controls="project-view-popup" aria-label="Project view options" title="Project view options" onClick={(event) => {
                    const anchor = event.currentTarget.getBoundingClientRect()
                    setProjectViewPosition(projectViewPosition ? null : {
                      left: Math.max(4, Math.min(anchor.left, window.innerWidth - 228)),
                      top: Math.max(4, Math.min(anchor.bottom + 4, window.innerHeight - 190))
                    })
                  }}>⋮</button>
                  {projectViewPosition && createPortal(
                    <div className="project-view-popup" id="project-view-popup" role="group" aria-label="Project view options" style={projectViewPosition}>
                      <button type="button" autoFocus onClick={() => { setProjectViewPosition(null); openFolderPicker() }}>Open Project…</button>
                      <label><input type="checkbox" checked={compactPackages} onChange={(event) => setCompactPackages(event.target.checked)} /> Compact Java packages</label>
                      <label><input type="checkbox" checked={foldersFirst} onChange={(event) => setFoldersFirst(event.target.checked)} /> Folders first</label>
                      <label><input type="checkbox" checked={structureOpen} onChange={toggleStructure} /> Show Structure</label>
                      <button type="button" onClick={() => { setProjectViewPosition(null); closeProject(true) }}>Remove Project from Sidebar</button>
                    </div>, document.body
                  )}
                  <button className="ghost tiny" onClick={() => setLeftOpen(false)} title="Hide Sidebar (Ctrl+B)">◀</button>
                </div>
              </>
            ) : (
              <>
                <span>No Project</span>
                <div className="side-head-actions">
                  <button className="primary tiny" onClick={openFolderPicker}>Open</button>
                  <button className="ghost tiny" onClick={() => setLeftOpen(false)} title="Hide Sidebar (Ctrl+B)">◀</button>
                </div>
              </>
            )}
          </div>
          {!workspace.root && recentProjects.length > 0 && <div className="sidebar-recent-projects">
            <strong>Recent Projects</strong>
            {recentProjects.map((item) => <div key={item.root}>
              <button className="ghost tiny" title={item.root} onClick={() => selectFolder(item.root)} disabled={openingFolder}>{item.name}</button>
              <button className="ghost tiny" aria-label={`Remove ${item.name} from recent projects`} title="Remove from recent projects" onClick={() => forgetRecentProject(item.root)}>×</button>
            </div>)}
          </div>}
          <div className="project-import-actions">
            <button className="ghost tiny workbench-icon-button" aria-label="Import Folder" title="Import Folder" onClick={() => window.electronAPI?.openFolderDialog ? openFolderPicker() : importFiles(folderInputRef)}><WorkbenchIcon name="folder" /></button>
            <button className="ghost tiny workbench-icon-button" aria-label="Import Files" title="Import Files" onClick={() => importFiles(filesInputRef)}><WorkbenchIcon name="files" /></button>
            <button className="ghost tiny workbench-icon-button" aria-label="Server Browser" title="Server Browser" onClick={openFolderPicker}><WorkbenchIcon name="server" /></button>
          </div>
          {importNotice && <div className="import-notice" role="status">{importNotice}</div>}
          <div className="search-box">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={workspace.root ? "Search files..." : "Open project to search"}
              disabled={!workspace.root}
            />
          </div>
          {search.trim().length >= 2 ? (
            <div className="hits">
              {hits.map((h, i) => {
                const fileName = h.path ? h.path.split(/[\\/]/).pop() : 'file'
                return (
                  <div key={`${h.path}:${h.line}:${i}`} className="hit" onClick={() => openFile(h.path)}>
                    <div className="p">{fileName}:{h.line}</div>
                    <div className="l">{h.preview}</div>
                  </div>
                )
              })}
              {!hits.length && <div className="empty"><p>No matches</p></div>}
            </div>
          ) : (
            <div className="tree">
              {workspace.root && tree ? (
                <TreeNode
                  node={tree}
                  depth={0}
                  active={active}
                  onOpen={openFile}
                  openDirs={openDirs}
                  toggleDir={toggleDir}
                  loadDirectory={virtualFiles ? null : loadProjectDirectory}
                  onProjectMenu={openProjectMenu}
                  compactPackages={compactPackages}
                  foldersFirst={foldersFirst}
                />
              ) : !workspace.root ? (
                <div className="no-project-box">
                  <p>No project folder opened.<br/>Open your local project to work on it.</p>
                  <button className="primary" onClick={openFolderPicker}>Open Project</button>
                </div>
              ) : (
                <div className="empty"><p>Loading tree</p></div>
              )}
            </div>
          )}
          {structureOpen && (
            <section className="structure-tool" aria-label="Structure">
              <header className="structure-header">
                <div className="structure-title-row">
                  <span className="structure-title">Structure</span>
                  {current?.path && (
                    <span className="structure-format-tag">
                      {(current.path.match(/\.([^.]+)$/)?.[1] || 'FILE').toUpperCase()}
                    </span>
                  )}
                  <span className="structure-count-pill">{outline.length}</span>
                </div>
                <div className="structure-header-actions">
                  {outline.some((i) => i.canFold) && (
                    <>
                      <button
                        type="button"
                        className="ghost tiny structure-action-btn"
                        onClick={foldAllMethods}
                        title="Collapse all methods & blocks in file"
                        aria-label="Collapse all methods"
                      >
                        [-]
                      </button>
                      <button
                        type="button"
                        className="ghost tiny structure-action-btn"
                        onClick={expandAllMethods}
                        title="Expand all methods & blocks in file"
                        aria-label="Expand all methods"
                      >
                        [+]
                      </button>
                    </>
                  )}
                  <button className="ghost tiny" onClick={toggleStructure} aria-label="Hide Structure">×</button>
                </div>
              </header>

              {outline.length > 3 && (
                <div className="structure-filter-bar">
                  <span className="structure-search-icon">🔍</span>
                  <input
                    type="text"
                    className="structure-filter-input"
                    placeholder="Filter methods & symbols..."
                    value={structureFilter}
                    onChange={(e) => setStructureFilter(e.target.value)}
                    spellCheck="false"
                  />
                  {structureFilter && (
                    <button
                      type="button"
                      className="structure-filter-clear"
                      onClick={() => setStructureFilter('')}
                      aria-label="Clear filter"
                    >
                      ×
                    </button>
                  )}
                </div>
              )}

              <div className="structure-items-list">
                {outline.length ? (
                  outline
                    .filter((item) => {
                      if (!structureFilter.trim()) return true
                      const q = structureFilter.toLowerCase()
                      return (
                        (item.name && item.name.toLowerCase().includes(q)) ||
                        (item.label && item.label.toLowerCase().includes(q)) ||
                        (item.detail && item.detail.toLowerCase().includes(q)) ||
                        (item.subKind && item.subKind.toLowerCase().includes(q))
                      )
                    })
                    .map((item, index) => {
                      const isFolded = editorFolds.has(item.startLine)
                      return (
                        <div
                          key={`${item.offset}-${index}`}
                          className={`structure-row ${item.kind} ${item.subKind || ''}`}
                          onClick={() => {
                            setPane('editor')
                            setEditorJump({ path: active, offset: item.offset })
                          }}
                          role="button"
                          tabIndex={0}
                          title={`${item.label} (Line ${item.line})`}
                        >
                          {/* Symbol Kind Badge with Color Combination */}
                          <span
                            className="structure-badge"
                            style={{
                              color: item.color || '#38bdf8',
                              borderColor: `${item.color || '#38bdf8'}55`,
                              backgroundColor: `${item.color || '#38bdf8'}18`
                            }}
                          >
                            {item.badge || (item.kind === 'type' ? 'C' : 'M')}
                          </span>

                          {/* Symbol Name & Detail with Syntax Colors */}
                          <div className="structure-content">
                            <span className="structure-symbol-name" style={{ color: item.color || 'var(--paper)' }}>
                              {item.name || item.label}
                            </span>
                            {item.detail && (
                              <span className="structure-symbol-detail">
                                {item.detail}
                              </span>
                            )}
                          </div>

                          {/* Method-Level Minimization Button */}
                          {item.canFold && (
                            <button
                              type="button"
                              className={`structure-item-fold-btn ${isFolded ? 'is-folded' : 'is-expanded'}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleEditorFold(item.startLine)
                              }}
                              title={isFolded ? `Expand ${item.name} in file` : `Minimize ${item.name} in file`}
                              aria-label={isFolded ? `Expand ${item.name}` : `Minimize ${item.name}`}
                            >
                              {isFolded ? '▸' : '▾'}
                            </button>
                          )}

                          {/* Line Number Chip */}
                          <span className="structure-line-chip" aria-hidden="true">
                            L{item.line}
                          </span>
                        </div>
                      )
                    })
                ) : (
                  <p className="structure-empty">Open a source or config file to see its structure.</p>
                )}
              </div>
            </section>
          )}
          {leftOpen && (
            <div
              className={`resizer-handle left ${isResizing === 'left' ? 'active' : ''}`}
              onMouseDown={startResizeLeft}
              onTouchStart={handleTouchLeft}
              onDoubleClick={() => {
                setLeftWidth(260)
                try { localStorage.setItem('aether.left_width', '260') } catch {}
              }}
              title="Drag to resize file tree (Double-click to reset)"
            />
          )}
        </aside>

        <main className="stage">
          {mode === 'chat' ? (
            <div className="chat-mode-shell">
              <div className="gemini-aura-container" aria-hidden="true">
                <div className="aura-glow aura-glow-outer" />
                <div className="aura-glow aura-glow-core" />
                <div className="aura-sparkle sparkle-1">✦</div>
                <div className="aura-sparkle sparkle-2">✦</div>
              </div>

              <div className="chat-mode-topbar">
                <div className="chat-mode-title-info">
                  <button
                    type="button"
                    className="chat-new-btn"
                    onClick={() => startNewChat(false)}
                    title="Start fresh conversation"
                  >
                    <span>+</span>
                    <span className="chat-btn-text">New Chat</span>
                  </button>

                  <button
                    type="button"
                    className={`temp-chat-toggle-btn ${isTempChat ? 'active' : ''}`}
                    onClick={toggleTempChat}
                    title={isTempChat ? "Temporary chat is ON (Messages are not saved to history)" : "Start a temporary chat (Won't be saved in history)"}
                  >
                    <span>{isTempChat ? '🕶️' : '🔒'}</span>
                    <span className="temp-btn-text">{isTempChat ? 'Temp Chat ON' : 'Temporary Chat'}</span>
                    {isTempChat && <span className="temp-dot" />}
                  </button>

                  <div className="chat-active-model-chip">
                    <span className={`dot ${selected.tier}`} />
                    <span>{selected.label}</span>
                  </div>
                </div>

                <div className="chat-mode-actions">
                  <button
                    type="button"
                    className="ghost tiny cm-action-btn cm-history-btn"
                    onClick={() => setHistoryOpen(true)}
                    title="Open Task & Chat History"
                    aria-label="Open Task & Chat History"
                  >
                    <span aria-hidden="true">↶</span>
                  </button>
                  <button
                    type="button"
                    className="ghost tiny cm-action-btn cm-export-btn"
                    onClick={() => exportChatSession('markdown')}
                    title="Export conversation as Markdown"
                    disabled={!messages.length}
                  >
                    <span>📥</span>
                    <span className="cm-btn-text">.md</span>
                  </button>
                  <button
                    type="button"
                    className="ghost tiny cm-action-btn cm-export-json-btn"
                    onClick={() => exportChatSession('json')}
                    title="Export conversation as JSON"
                    disabled={!messages.length}
                  >
                    <span>📥</span>
                    <span className="cm-btn-text">.json</span>
                  </button>
                  <button
                    type="button"
                    className="ghost tiny cm-action-btn cm-settings-btn"
                    onClick={() => setSettingsOpen(true)}
                    title="Chat & Model Settings"
                  >
                    <span>⚙️</span>
                    <span className="cm-btn-text">Settings</span>
                  </button>
                </div>
              </div>

              <div className="chat-mode-feed-wrap" ref={mode === 'chat' ? feedRef : null}>
                {isTempChat && (
                  <div className="temp-chat-banner">
                    <div className="temp-banner-info">
                      <span>🕶️</span>
                      <div>
                        <strong>Temporary Chat</strong> — Messages in this session will not be saved to task history.
                      </div>
                    </div>
                    <div className="temp-banner-actions">
                      <button
                        type="button"
                        className="temp-exit-btn"
                        onClick={() => setIsTempChat(false)}
                        title="Turn off Temporary Chat"
                      >
                        Save Future Chats
                      </button>
                    </div>
                  </div>
                )}
                {!messages.length ? (
                  <div className="chat-mode-greeting">
                    <div className="chat-greeting-sparkle">✨</div>
                    <h1 className="chat-greeting-h1">
                      {userName ? `Hello, ${userName}` : 'Hello, Creator'}
                    </h1>
                    <p className="chat-greeting-sub">How can Aether help you today?</p>

                    <div className="chat-starter-grid">
                      <button
                        type="button"
                        className="chat-starter-card"
                        onClick={() => send("Brainstorm modern product ideas and architecture patterns for a high-performance web app")}
                      >
                        <div className="chat-card-top">
                          <span>💡</span>
                          <span>Brainstorm Ideas</span>
                        </div>
                        <span className="chat-card-sub">Generate novel concepts, features &amp; architectural plans</span>
                      </button>

                      <button
                        type="button"
                        className="chat-starter-card"
                        onClick={() => send("Write a modern, responsive React component with smooth CSS animations and clean state management")}
                      >
                        <div className="chat-card-top">
                          <span>💻</span>
                          <span>Write Clean Code</span>
                        </div>
                        <span className="chat-card-sub">Generate production-ready components, styles &amp; algorithms</span>
                      </button>

                      <button
                        type="button"
                        className="chat-starter-card"
                        onClick={() => send("Find potential bugs, edge cases, and performance bottlenecks in code")}
                      >
                        <div className="chat-card-top">
                          <span>🔍</span>
                          <span>Debug &amp; Optimize</span>
                        </div>
                        <span className="chat-card-sub">Detect edge cases, memory leaks &amp; security vulnerabilities</span>
                      </button>

                      <button
                        type="button"
                        className="chat-starter-card"
                        onClick={() => send("Explain how modern web frameworks handle state hydration and reactivity")}
                      >
                        <div className="chat-card-top">
                          <span>⚡</span>
                          <span>Explain Concepts</span>
                        </div>
                        <span className="chat-card-sub">Break down complex technologies with clear illustrations</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="chat-mode-thread">
                    {messages.map((m, i) => {
                      if (m.role === 'proposal') return null
                      if (m.role === 'tool') {
                        return (
                          <div className="tool" key={i}>
                            <b>{m.name}</b> {m.status}
                            {m.output ? `\n${String(m.output).slice(0, 500)}` : ''}
                          </div>
                        )
                      }

                      if (m.role === 'error') {
                        return (
                          <div className="bubble err" key={i}>
                            <div className="err-title">
                              <span>⚠️</span>
                              <span>AI Service Notice</span>
                            </div>
                            <div className="err-msg">{m.text}</div>
                            <div className="err-actions">
                              <button
                                type="button"
                                className="err-btn primary-err"
                                onClick={() => {
                                  const lastUser = [...messages.slice(0, i + 1)].reverse().find((msg) => msg.role === 'user')
                                  if (lastUser?.text) {
                                    send(lastUser.text)
                                  } else {
                                    send(draft || 'Hello')
                                  }
                                }}
                              >
                                🔄 Retry Prompt
                              </button>
                              <button
                                type="button"
                                className="err-btn"
                                onClick={() => {
                                  const errSnippet = `[Aether AI Error]\nModel: ${selected.label}\nDetails: ${m.text}`
                                  navigator.clipboard.writeText(errSnippet).catch(() => {})
                                  setCopiedMsgIdx(i)
                                  setTimeout(() => setCopiedMsgIdx(null), 2000)
                                }}
                              >
                                {copiedMsgIdx === i ? '✓ Copied' : '📋 Copy Error'}
                              </button>
                              <button
                                type="button"
                                className="err-btn"
                                onClick={() => exportErrorLog(m.text, i, 'markdown')}
                              >
                                💾 Export .md
                              </button>
                              <button
                                type="button"
                                className="err-btn"
                                onClick={() => exportErrorLog(m.text, i, 'json')}
                              >
                                📄 Export .json
                              </button>
                              {selected.tier !== 'free' && (
                                <button
                                  type="button"
                                  className="err-btn"
                                  onClick={() => {
                                    pickModel('aether-spark')
                                    const lastUser = [...messages.slice(0, i + 1)].reverse().find((msg) => msg.role === 'user')
                                    if (lastUser?.text) {
                                      setTimeout(() => send(lastUser.text), 100)
                                    }
                                  }}
                                >
                                  ⚡ Use Free Model
                                </button>
                              )}
                              <button
                                type="button"
                                className="err-btn"
                                onClick={() => setSettingsOpen(true)}
                              >
                                ⚙️ Settings
                              </button>
                            </div>
                          </div>
                        )
                      }

                      if (m.role === 'user') {
                        return (
                          <div className="cm-row-user" key={i}>
                            <div className="cm-user-bubble">
                              {m.text}
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div className="cm-row-ai" key={i}>
                          <div className="cm-ai-avatar">✨</div>
                          <div className="cm-ai-body">
                            <div className="cm-ai-model-tag">{selected.label}</div>
                            <div className="cm-ai-content">
                              <MarkdownViewer content={m.text} />
                            </div>
                            {!busy && (
                              <div className="gemini-resp-toolbar" style={{ marginTop: 10 }}>
                                <button
                                  type="button"
                                  className={`resp-icon-btn ${msgFeedback[i] === 'up' ? 'active' : ''}`}
                                  title="Good response"
                                  onClick={() => setMsgFeedback((prev) => ({ ...prev, [i]: prev[i] === 'up' ? null : 'up' }))}
                                >
                                  👍
                                </button>
                                <button
                                  type="button"
                                  className={`resp-icon-btn ${msgFeedback[i] === 'down' ? 'active' : ''}`}
                                  title="Bad response"
                                  onClick={() => setMsgFeedback((prev) => ({ ...prev, [i]: prev[i] === 'down' ? null : 'down' }))}
                                >
                                  👎
                                </button>
                                <button
                                  type="button"
                                  className="resp-icon-btn"
                                  title="Regenerate response"
                                  onClick={() => {
                                    const prevUser = [...messages.slice(0, i)].reverse().find((msg) => msg.role === 'user')
                                    if (prevUser?.text) {
                                      setMessages((prev) => prev.slice(0, i))
                                      send(prevUser.text)
                                    }
                                  }}
                                >
                                  🔄
                                </button>
                                <button
                                  type="button"
                                  className="resp-icon-btn"
                                  title={copiedMsgIdx === i ? 'Copied!' : 'Copy response'}
                                  onClick={() => {
                                    navigator.clipboard.writeText(m.text).catch(() => {})
                                    setCopiedMsgIdx(i)
                                    setTimeout(() => setCopiedMsgIdx(null), 2000)
                                  }}
                                >
                                  {copiedMsgIdx === i ? '✓' : '📋'}
                                </button>
                                <button
                                  type="button"
                                  className="resp-icon-btn"
                                  title="Export this response as Markdown"
                                  onClick={() => {
                                    const blob = new Blob([m.text], { type: 'text/markdown' })
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement('a')
                                    a.href = url
                                    a.download = `response-${i + 1}.md`
                                    document.body.appendChild(a)
                                    a.click()
                                    document.body.removeChild(a)
                                    URL.revokeObjectURL(url)
                                  }}
                                >
                                  💾
                                </button>
                                <button
                                  type="button"
                                  className="resp-icon-btn"
                                  title="Read aloud"
                                  onClick={() => handleListen(m.text, i)}
                                >
                                  {speakingIdx === i ? '⏹️' : '🔊'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Chat Mode Bottom Input Capsule */}
              {busy && <div className="chat-stream" role="status">{streamText || 'Waiting for response…'}</div>}
              <div className="chat-mode-bottom-bar">
                <form
                  className="chat-mode-input-capsule"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (draft.trim() && !busy) {
                      send(draft.trim())
                    }
                  }}
                >
                  <textarea
                    ref={chatInputRef}
                    className="cm-textarea"
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (draft.trim() && !busy) {
                          send(draft.trim())
                        }
                      }
                    }}
                    placeholder={busy ? "AI is generating..." : "Message Gemini or GPT..."}
                    disabled={busy}
                  />

                  <div className="cm-actions-right">
                    <button
                      type="button"
                      className={`resp-icon-btn ${listening ? 'listening' : ''}`}
                      onClick={toggleListening}
                      title={listening ? "Listening... click to stop" : "Voice input"}
                    >
                      🎙️
                    </button>

                    <div className="capsule-model-wrap">
                      <button
                        type="button"
                        className="capsule-model-pill"
                        onClick={() => setPickerOpen((v) => !v)}
                        title="Select AI Model"
                      >
                        <span className="pill-name">{modelShortName}</span>
                        <span className="pill-arrow">⌵</span>
                      </button>
                    </div>

                    <button
                      type={busy ? "button" : "submit"}
                      className="cm-send-btn"
                      onClick={busy ? stopRequest : undefined}
                      disabled={!busy && !draft.trim()}
                      title={busy ? "Stop response" : "Send prompt (Enter)"}
                    >
                      {busy ? '■' : '↑'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <>
              <div className="stage-head">
                {!leftOpen && (
                  <button
                    className="primary tiny restore-panel-btn"
                    onClick={() => setLeftOpen(true)}
                    title="Show Files Sidebar (Ctrl+B)"
                  >
                    📂 Open Files (Ctrl+B)
                  </button>
                )}
                <div className="editor-tab-strip" ref={editorTabStrip}>
                <div className="tabs editor-visible-tabs">
                  {visibleTabs.map((tab) => {
                    const name = tab.path.split('/').pop()
                    const selected = tab.path === active
                    return (
                      <div key={tab.path} className={`tab editor-tab ${selected ? 'on' : ''}`} onContextMenu={(event) => {
                        openProjectMenu(event, { path: tab.path, type: 'file' })
                        setProjectMenu((previous) => ({ ...previous, tab: true }))
                      }}>
                        <button
                          type="button"
                          className="editor-tab-label"
                          title={tab.path}
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => { setActive(tab.path); setEditorNotice('') }}
                        >
                          {name}{isDirty(tab) ? ' ●' : ''}
                        </button>
                        <button
                          type="button"
                          className="editor-tab-close"
                          title="Close (Ctrl+F4). Alt+click to close other tabs."
                          aria-label={`Close ${tab.path}. Alt+click to close other tabs.`}
                          onClick={(event) => closeEditorTabs(tab.path, event.altKey)}
                        >×</button>
                      </div>
                    )
                  })}
                </div>
                  <div className="editor-tab-tools">
                    {hiddenTabs.length > 0 && <button type="button" className="editor-tab-tool" title="Show hidden open files" aria-label="Show hidden open files" aria-expanded={tabPopup?.kind === 'hidden'} onClick={(event) => openTabPopup(event, 'hidden')}><span aria-hidden="true" className="editor-tab-chevron" /></button>}
                    <button type="button" className="editor-tab-tool" title="Editor tab options" aria-label="Editor tab options" aria-expanded={Boolean(tabPopup && tabPopup.kind !== 'hidden')} onClick={(event) => openTabPopup(event, 'options')}><span aria-hidden="true" className="editor-tab-ellipsis" /></button>
                  </div>
                </div>
                {tabPopup && createPortal(<div ref={tabPopupRef} className="project-view-popup editor-tab-popup"
                  style={{ left: tabPopup.left, top: tabPopup.top, maxHeight: tabPopup.maxHeight }}
                  aria-label={tabPopup.kind === 'options' ? 'Editor tab options' : 'Open files'}>
                  {tabPopup.kind === 'options' ? <>
                    <button type="button" autoFocus onClick={() => setTabPopup({ ...tabPopup, kind: 'recent' })}>Recent Files</button>
                    <button type="button" onClick={() => { setTabPopup(null); setSearchEverywhere(true) }}>Go to File…</button>
                    <button type="button" disabled={!tabs.length} onClick={() => { setTabPopup(null); closeEditorTabs(tabs[0].path, false, 'all') }}>Close All Tabs</button>
                    <button type="button" disabled={!reopenCandidate} onClick={() => selectPopupFile(reopenCandidate.path)}>Reopen Closed Tab</button>
                    <button type="button" onClick={() => { setTabPopup(null); setSettingsOpen(true) }}>Editor Settings…</button>
                  </> : (tabPopup.kind === 'hidden' ? hiddenTabs.map((tab) => tab.path)
                    : [...new Set([active, ...tabs.map((tab) => tab.path), ...closedEditorFiles.filter((item) => item.root === workspace.root).map((item) => item.path)].filter(Boolean))]
                  ).map((path, index) => <button type="button" key={path} autoFocus={index === 0} title={path} onClick={() => selectPopupFile(path)}>
                    <TreeIcon name={path.endsWith('.java') ? 'java' : 'file'} />
                    <span>{path.split('/').at(-1)}</span>
                  </button>)}
                </div>, document.body)}
                {current && (current.path.toLowerCase().endsWith('.md') || current.path.toLowerCase().endsWith('.markdown')) && (
                  <div className="md-view-mode-pill">
                    <button
                      type="button"
                      className={`view-pill-btn ${mdMode === 'edit' ? 'active' : ''}`}
                      onClick={() => setMdMode('edit')}
                      title="Edit Markdown source"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      type="button"
                      className={`view-pill-btn ${mdMode === 'reader' ? 'active' : ''}`}
                      onClick={() => setMdMode('reader')}
                      title="Rendered Markdown Reader"
                    >
                      📖 Reader
                    </button>
                    <button
                      type="button"
                      className={`view-pill-btn ${mdMode === 'split' ? 'active' : ''}`}
                      onClick={() => setMdMode('split')}
                      title="Side-by-side Split View"
                    >
                      ◫ Split
                    </button>
                  </div>
                )}
                {!rightOpen && (
                  <button
                    className="primary tiny restore-panel-btn"
                    onClick={openChat}
                    title="Show AI Chat (Ctrl+J)"
                  >
                    💬 Open Chat (Ctrl+J)
                  </button>
                )}
              </div>
              {current ? (
                <div className="editor-wrap">
                  {(current.path.toLowerCase().endsWith('.md') || current.path.toLowerCase().endsWith('.markdown')) && mdMode === 'reader' ? (
                    <div className="editor-md-reader">
                      <MarkdownViewer content={current.content} />
                    </div>
                  ) : (current.path.toLowerCase().endsWith('.md') || current.path.toLowerCase().endsWith('.markdown')) && mdMode === 'split' ? (
                    <div className="editor-split-wrap">
                      <CodeEditor
                        jump={editorJump}
                        mainLine={activeMain ? outline.find((item) => item.runnable)?.line : undefined}
                        onRunMain={activeMain ? () => executeApplication(false, activeMain) : undefined}
                        onDebugMain={activeMain ? () => executeApplication(true, activeMain) : undefined}
                        key={current.path}
                        className="editor-split-left"
                        path={current.path}
                        value={current.content}
                        fontSize={settings.editorFontSize || 13}
                        wordWrap={settings.editorWordWrap}
                        onChange={updateContent}
                        outline={outline}
                        externalFoldedLines={editorFolds}
                        onExternalToggleFold={toggleEditorFold}
                      />
                      <div className="editor-split-divider" />
                      <div className="editor-md-reader editor-split-right">
                        <MarkdownViewer content={current.content} />
                      </div>
                    </div>
                  ) : (
                    <CodeEditor
                      breakpointLines={projectBreakpoints[current.path]}
                      onToggleBreakpoint={toggleBreakpoint}
                      jump={editorJump}
                      mainLine={activeMain ? outline.find((item) => item.runnable)?.line : undefined}
                      onRunMain={activeMain ? () => executeApplication(false, activeMain) : undefined}
                      onDebugMain={activeMain ? () => executeApplication(true, activeMain) : undefined}
                      key={current.path}
                      workspace={!webDirHandle && !virtualFiles ? workspace.root : null}
                      path={current.path}
                      value={current.content}
                      fontSize={settings.editorFontSize || 13}
                      wordWrap={settings.editorWordWrap}
                      onChange={updateContent}
                      outline={outline}
                      externalFoldedLines={editorFolds}
                      onExternalToggleFold={toggleEditorFold}
                    />
                  )}
                  <div className="editor-bar">
                    <span className="path" role="status">{editorNotice || current.path}</span>
                    <div className="editor-bar-actions">
                      {current.path.endsWith('.java') && /\bstatic\s+void\s+main\s*\(/.test(current.content) && (
                        <button className="ghost tiny run-toggle workbench-icon-button" onClick={() => executeApplication(false, activeMain)} aria-label="Run main" title="Run main"><TreeIcon name="play" /></button>
                      )}
                      <button
                        className="ghost tiny ask-ai-file-btn workbench-icon-button"
                        onClick={() => {
                          setDraft(`Analyze and explain ${current.path}: `)
                          openChat()
                        }}
                        title="Ask AI about this file"
                        aria-label="Ask AI about this file"
                      >
                        <WorkbenchIcon name="chat" />
                      </button>
                      <button className="primary workbench-icon-button" onClick={saveFile}
                        title={!workspace.root || virtualFiles ? 'Download file' : 'Save file'}
                        aria-label={!workspace.root || virtualFiles ? 'Download file' : 'Save file'}>
                        <WorkbenchIcon name={!workspace.root || virtualFiles ? 'download' : 'save'} />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="workbench-home">
                  <div className="workbench-symbol" aria-hidden="true">{mode === 'agent' ? '✦' : '⌘'}</div>
                  <h2>{mode === 'agent' ? 'Workspace agent' : workspace.name || 'Welcome to Ather Studio'}</h2>
                  <p>{mode === 'agent'
                    ? 'Describe a task in the Agent panel. Review proposed files here before saving.'
                    : workspace.root ? 'Choose a file in the explorer to start editing.' : 'Open a project folder to browse, search, and edit your files.'}</p>
                  <div className="workbench-actions">
                    <button className="primary" onClick={openFolderPicker}>Open project</button>
                    {webPulse && <button className="ghost" onClick={() => importFiles(folderInputRef)}>Import folder</button>}
                    <button className="ghost" onClick={() => mode === 'agent' ? openChat() : createNewFile()}>
                      {mode === 'agent' ? 'Focus agent' : 'New Markdown'}
                    </button>
                  </div>
                  <div className="editor-shortcuts-guide">
                    <span className="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>B</kbd> Files</span>
                    <span className="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>J</kbd> Assistant</span>
                    <span className="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</span>
                  </div>
                </div>
              )}
        </>
      )}
    </main>

        {mavenSideOpen && !rightOpen && (
          <aside className="maven-tool-window" aria-label="Maven">
            <header><strong>Maven</strong><button className="ghost tiny" onClick={toggleMaven} aria-label="Hide Maven">×</button></header>
            <MavenLifecycle key={workspace.root} onOpenPom={openFile} tree={webDirHandle || virtualFiles ? null : tree} project={workspace.name} onReload={reloadMavenTree} options={mavenOptions} setOptions={setMavenOptions} onRun={(pom, goal) => {
              setTerminalOpen(false)
              setMavenOpen(true)
              setLaunchRequest({ pom, goal })
            }} />
          </aside>
        )}

        <section className="chat" aria-label="Workspace assistant">
          {rightOpen && (
            <div
              className={`resizer-handle right ${isResizing === 'right' ? 'active' : ''}`}
              onMouseDown={startResizeRight}
              onTouchStart={handleTouchRight}
              onDoubleClick={() => {
                setRightWidth(360)
                try { localStorage.setItem('aether.right_width', '360') } catch {}
              }}
              title="Drag to resize AI chat (Double-click to reset)"
            />
          )}
          <div className="chat-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{mode === 'agent' ? 'Workspace Agent' : 'AI Chat'}</span>
              {isTempChat && <span className="history-mode-tag" style={{ background: 'rgba(168, 85, 247, 0.2)', color: '#d8b4fe', padding: '1px 5px', fontSize: 10 }}>🕶️ Temp</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                className="ghost tiny"
                onClick={() => startNewChat(false)}
                title="Start a new chat thread"
                style={{ fontSize: 11, padding: '2px 7px' }}
              >
                + New
              </button>
              <button
                type="button"
                className={`ghost tiny ${isTempChat ? 'active' : ''}`}
                onClick={toggleTempChat}
                title={isTempChat ? "Temporary chat is ON (Not saved)" : "Start temporary chat (Not saved in history)"}
                style={{ fontSize: 11, padding: '2px 7px' }}
              >
                {isTempChat ? '🕶️ Temp' : '🔒 Temp'}
              </button>
              <button
                type="button"
                className="ghost tiny"
                onClick={() => setHistoryOpen(true)}
                title="Task History & Past Sessions"
                style={{ fontSize: 11, padding: '2px 7px' }}
              >
                📜
              </button>
              <button
                className="ghost tiny"
                onClick={() => { setRightOpen(false); setPane('editor') }}
                title="Hide AI Chat (Ctrl+J)"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="feed" ref={mode !== 'chat' ? feedRef : null}>
            {isTempChat && (
              <div className="temp-chat-banner" style={{ margin: '8px 12px 12px 12px', padding: '6px 10px', fontSize: 11 }}>
                <div className="temp-banner-info">
                  <span>🕶️</span>
                  <span><strong>Temp Chat:</strong> Not saved in history</span>
                </div>
                <button
                  type="button"
                  className="temp-exit-btn"
                  onClick={() => setIsTempChat(false)}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  Save
                </button>
              </div>
            )}
            {!messages.length && (
              <div className="empty chat-empty-guide">
                <div className="chat-empty-icon">✨</div>
                <h4>How can Aether help?</h4>
                <p>Ask about your code, or choose a starter prompt.</p>
                <div className="chat-empty-presets">
                  <button
                    type="button"
                    className="chat-preset-btn"
                    onClick={() => {
                      setDraft('Can you explain what this project is and how it works?')
                      setTimeout(() => chatInputRef.current?.focus(), 50)
                    }}
                  >
                    📖 "Explain how this project works"
                  </button>
                  <button
                    type="button"
                    className="chat-preset-btn"
                    onClick={() => {
                      setDraft('Write a modern responsive HTML/CSS component with clean styling.')
                      setTimeout(() => chatInputRef.current?.focus(), 50)
                    }}
                  >
                    🎨 "Write a modern UI component"
                  </button>
                  <button
                    type="button"
                    className="chat-preset-btn"
                    onClick={() => {
                      setDraft('Write a robust JavaScript utility function with full error handling.')
                      setTimeout(() => chatInputRef.current?.focus(), 50)
                    }}
                  >
                    ⚡ "Write a clean JavaScript function"
                  </button>
                </div>
              </div>
            )}
            {messages.map((m, i) => {
              if (m.role === 'proposal') {
                return (
                  <div className="tool proposal" key={i}>
                    <b>{m.path}</b>
                    <button className="ghost tiny" onClick={() => reviewProposal(m)} disabled={!workspace.root || Boolean(virtualFiles) || m.workspaceRoot !== workspace.root}>
                      Review draft
                    </button>
                  </div>
                )
              }
              if (m.role === 'tool') {
                return (
                  <div className="tool" key={i}>
                    <b>{m.name}</b> {m.status}
                    {m.output ? `\n${String(m.output).slice(0, 500)}` : ''}
                  </div>
                )
              }
              if (m.role === 'error') {
                return (
                  <div className="bubble err" key={i}>
                    <div className="err-title">
                      <span>⚠️</span>
                      <span>AI Service Notice</span>
                    </div>
                    <div className="err-msg">{m.text}</div>
                    <div className="err-actions">
                      <button
                        type="button"
                        className="err-btn primary-err"
                        onClick={() => {
                          const lastUser = [...messages.slice(0, i + 1)].reverse().find((msg) => msg.role === 'user')
                          if (lastUser?.text) {
                            send(lastUser.text)
                          } else {
                            send(draft || 'Hello')
                          }
                        }}
                        title="Retry sending this prompt"
                      >
                        🔄 Retry
                      </button>
                      <button
                        type="button"
                        className="err-btn"
                        onClick={() => {
                          const errSnippet = `[Aether AI Error]\nModel: ${selected.label}\nDetails: ${m.text}`
                          navigator.clipboard.writeText(errSnippet).catch(() => {})
                          setCopiedMsgIdx(i)
                          setTimeout(() => setCopiedMsgIdx(null), 2000)
                        }}
                        title="Copy error details to clipboard"
                      >
                        {copiedMsgIdx === i ? '✓ Copied' : '📋 Copy Error'}
                      </button>
                      <button
                        type="button"
                        className="err-btn"
                        onClick={() => exportErrorLog(m.text, i, 'markdown')}
                        title="Export error diagnostic report as Markdown"
                      >
                        💾 Export .md
                      </button>
                      <button
                        type="button"
                        className="err-btn"
                        onClick={() => exportErrorLog(m.text, i, 'json')}
                        title="Export error log as JSON"
                      >
                        📄 Export .json
                      </button>
                      {selected.tier !== 'free' && (
                        <>
                          <button
                            type="button"
                            className="err-btn primary-err"
                            onClick={() => {
                              setVaultTab(selected.provider === 'gemini' ? 'gemini' : 'openai')
                              setVaultOpen(true)
                            }}
                            title={`Configure ${selected.provider === 'gemini' ? 'Gemini' : 'OpenAI'} API token`}
                          >
                            🔑 Configure {selected.provider === 'gemini' ? 'Gemini' : 'OpenAI'}
                          </button>
                          <button
                            type="button"
                            className="err-btn"
                            onClick={() => {
                              pickModel('aether-spark')
                              const lastUser = [...messages.slice(0, i + 1)].reverse().find((msg) => msg.role === 'user')
                              if (lastUser?.text) {
                                setTimeout(() => send(lastUser.text), 100)
                              }
                            }}
                            title="Switch to Aether Spark"
                          >
                            ⚡ Use Free Model
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="err-btn"
                        onClick={() => setSettingsOpen(true)}
                        title="Open Studio Settings"
                      >
                        ⚙️ Settings
                      </button>
                    </div>
                  </div>
                )
              }
              if (m.role === 'user') {
                return (
                  <div className="user-msg-row" key={i}>
                    <div className="bubble user">
                      <span className="user-msg-content">{m.text}</span>
                      {!busy && (
                        <button
                          type="button"
                          className="user-edit-btn"
                          title="Edit prompt"
                          onClick={() => {
                            setDraft(m.text)
                            setMessages((prev) => prev.slice(0, i))
                            setTimeout(() => chatInputRef.current?.focus(), 50)
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )
              }

              return (
                <div className="ai-msg-block" key={i}>
                  <div className="bubble ai">
                    <MarkdownViewer content={m.text} />
                  </div>
                  {!busy && (
                    <div className="gemini-resp-toolbar">
                      <button
                        type="button"
                        className={`resp-icon-btn ${msgFeedback[i] === 'up' ? 'active' : ''}`}
                        title="Good response"
                        onClick={() => setMsgFeedback((prev) => ({ ...prev, [i]: prev[i] === 'up' ? null : 'up' }))}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={`resp-icon-btn ${msgFeedback[i] === 'down' ? 'active' : ''}`}
                        title="Bad response"
                        onClick={() => setMsgFeedback((prev) => ({ ...prev, [i]: prev[i] === 'down' ? null : 'down' }))}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="resp-icon-btn"
                        title="Regenerate response"
                        onClick={() => {
                          const prevUser = [...messages.slice(0, i)].reverse().find((msg) => msg.role === 'user')
                          if (prevUser?.text) {
                            setMessages((prev) => prev.slice(0, i))
                            send(prevUser.text)
                          }
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="resp-icon-btn"
                        title={copiedMsgIdx === i ? 'Copied!' : 'Copy response'}
                        onClick={() => {
                          navigator.clipboard.writeText(m.text).catch(() => {})
                          setCopiedMsgIdx(i)
                          setTimeout(() => setCopiedMsgIdx(null), 2000)
                        }}
                      >
                        {copiedMsgIdx === i ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                      <div className="resp-menu-wrap">
                        <button
                          type="button"
                          className={`resp-icon-btn ${msgMenuIdx === i ? 'active' : ''}`}
                          title="More options"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMsgMenuIdx(msgMenuIdx === i ? null : i)
                          }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="19" cy="12" r="2" />
                            <circle cx="5" cy="12" r="2" />
                          </svg>
                        </button>
                        {msgMenuIdx === i && (
                          <div className="gemini-more-menu" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="gemini-menu-item"
                              onClick={() => {
                                // Branch in new chat from this reply!
                                setMessages((prev) => prev.slice(0, i + 1))
                                setDraft('')
                                setMsgMenuIdx(null)
                                setTimeout(() => chatInputRef.current?.focus(), 50)
                              }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="6" y1="3" x2="6" y2="15" />
                                <circle cx="18" cy="6" r="3" />
                                <circle cx="6" cy="18" r="3" />
                                <path d="M18 9a9 9 0 0 1-9 9" />
                              </svg>
                              <span>Branch in new chat</span>
                            </button>

                            <button
                              type="button"
                              className="gemini-menu-item"
                              onClick={() => {
                                setMessages([])
                                setDraft('')
                                setMsgMenuIdx(null)
                                setTimeout(() => chatInputRef.current?.focus(), 50)
                              }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                              <span>Start fresh chat</span>
                            </button>

                            <button
                              type="button"
                              className="gemini-menu-item"
                              onClick={() => {
                                handleListen(m.text, i)
                                setMsgMenuIdx(null)
                              }}
                            >
                              {speakingIdx === i ? (
                                <>
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="6" y="6" width="12" height="12" />
                                  </svg>
                                  <span>Stop listening</span>
                                </>
                              ) : (
                                <>
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                                  </svg>
                                  <span>Listen</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              className="gemini-menu-item"
                              onClick={() => {
                                const blob = new Blob([m.text], { type: 'text/markdown' })
                                const url = URL.createObjectURL(blob)
                                const a = document.createElement('a')
                                a.href = url
                                a.download = `response-${Date.now()}.md`
                                a.click()
                                URL.revokeObjectURL(url)
                                setMsgMenuIdx(null)
                              }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                              </svg>
                              <span>Export to Markdown</span>
                            </button>

                            <button
                              type="button"
                              className="gemini-menu-item"
                              onClick={() => {
                                alert(`Model: ${selected.label} (${selected.id})\nCharacters: ${m.text.length}\nWords: ${m.text.trim().split(/\s+/).length}`)
                                setMsgMenuIdx(null)
                              }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="16" x2="12" y2="12" />
                                <line x1="12" y1="8" x2="12.01" y2="8" />
                              </svg>
                              <span>See response details</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {busy && <div className="tool" role="status">{streamText || (mode === 'agent' ? 'Working on task…' : 'Waiting for response…')}</div>}
          </div>
          <div className="composer">
            <div className="quick-chips">
              <button type="button" className="quick-chip" onClick={() => handleQuickChip('Explain what this code does in detail')}>💡 Explain</button>
              <button type="button" className="quick-chip" onClick={() => handleQuickChip('Find any bugs or potential issues in this code')}>🐛 Find bugs</button>
              <button type="button" className="quick-chip" onClick={() => handleQuickChip('Optimize performance and readability')}>⚡ Optimize</button>
              <button type="button" className="quick-chip" onClick={() => handleQuickChip('Write comprehensive unit tests for this')}>🧪 Tests</button>
            </div>
            <textarea
              ref={chatInputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={mode === 'agent' ? 'Give Aether a workspace task...' : 'Ask about code, debug, or learn anything...'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.metaKey || e.ctrlKey) {
                    e.preventDefault()
                    send()
                  } else if (!e.shiftKey && window.innerWidth > 860) {
                    e.preventDefault()
                    send()
                  }
                }
              }}
            />
            <div className="composer-row">
              <span className="hint">Enter to send (Shift+Enter for newline)</span>
              <button className="primary send-btn" onClick={busy ? stopRequest : send} disabled={!busy && !draft.trim()}>
                {busy ? 'Stop' : 'Send ➔'}
              </button>
            </div>
          </div>
        </section>
      </div>

      <MavenPanel
        key={workspace.root || ''}
        project={webDirHandle || virtualFiles ? null : workspace.root}
        tree={tree}
        applications={launchCatalog.applications}
        jdks={launchCatalog.jdks}
        breakpointsByFile={projectBreakpoints}
        selectedApplication={selectedLaunch?.path}
        onSelectApplication={setLaunchTarget}
        launch={runLaunch}
        onStartDebug={() => { setTerminalOpen(false); setMavenOpen(true) }}
        launchRequest={launchRequest}
        onLaunchHandled={setLaunchRequest}
        options={mavenOptions}
        setOptions={setMavenOptions}
        terminal={terminalOpen}
        onToggleTerminal={toggleTerminal}
        visible={mavenOpen && mode !== 'chat'}
        onHide={() => setMavenOpen(false)}
      />

      <footer className="workbench-status">
        <span>{workspace.name || 'No project'}</span>
        {current && <span title={current.path}>{current.path}</span>}
        {current && <span className="workbench-encoding">UTF-8</span>}
      </footer>

      {/* Mobile Bottom Navigation Dock */}
      <nav className="dock" aria-label="Mobile Navigation">
        <button
          className={`dock-btn ${pane === 'files' && mode !== 'chat' ? 'on' : ''}`}
          onClick={() => {
            if (mode === 'chat') setMode('editor')
            setPane('files')
          }}
          aria-label="Files"
        >
          <span className="dock-ico">📂</span>
          <span className="dock-lbl">Files</span>
          {workspace.root && <span className="dock-dot" />}
        </button>
        <button
          className={`dock-btn ${pane === 'editor' && mode !== 'chat' ? 'on' : ''}`}
          onClick={() => {
            if (mode === 'chat') setMode('editor')
            setPane('editor')
          }}
          aria-label="Editor"
        >
          <span className="dock-ico">📝</span>
          <span className="dock-lbl">Editor</span>
          {tabs.length > 0 && <span className="dock-badge">{tabs.length}</span>}
        </button>
        <button
          className={`dock-btn ${mode === 'chat' || pane === 'chat' ? 'on' : ''}`}
          onClick={() => {
            switchMode('chat')
          }}
          aria-label="AI Chat"
        >
          <span className="dock-ico">✨</span>
          <span className="dock-lbl">AI Chat</span>
          {busy && <span className="dock-pulse" />}
        </button>
      </nav>

      {vaultOpen && (
        <div className="modal-back" onClick={() => setVaultOpen(false)}>
          <div className="modal vault" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="settings-close-btn vault-close-btn"
              onClick={() => setVaultOpen(false)}
              title="Close"
              style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}
            >
              ✕
            </button>
            <div className="sheet-handle" />
            <div className="vault-hero">
              <div className="vault-orb" />
              <div>
                <h3>Premium tokens</h3>
                <p>Free models need nothing. Drop a ChatGPT or Gemini key only if you pick a premium model.</p>
              </div>
            </div>
            <div className="seg">
              <button className={vaultTab === 'openai' ? 'on' : ''} onClick={() => setVaultTab('openai')}>
                OpenAI / ChatGPT {vault.openai ? '✓' : ''}
              </button>
              <button className={vaultTab === 'gemini' ? 'on' : ''} onClick={() => setVaultTab('gemini')}>
                Google Gemini {vault.gemini ? '✓' : ''}
              </button>
            </div>
            {vaultTab === 'openai' ? (
              <div className="field">
                <div className="field-label-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label>OpenAI API Key</label>
                    <span className={`vault-status-pill ${vault.openai ? 'configured' : 'empty'}`}>
                      {vault.openai ? 'Configured ✓' : 'Not configured'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="vault-helper-btn"
                    onClick={() => openTokenHelper('openai')}
                    title="View step-by-step instructions to get an OpenAI key"
                  >
                    <span className="info-i">ℹ</span>
                    <span>How to get key</span>
                  </button>
                </div>
                <input
                  type="password"
                  value={vault.openai}
                  onChange={(e) => persistVault({ ...vault, openai: e.target.value })}
                  placeholder="sk-proj-..."
                  autoComplete="off"
                  spellCheck="false"
                />
                <span className="hint">{vault.openai ? 'OpenAI key configured securely · unlocks GPT-4o mini, GPT-4o, and o3-mini' : 'Never logged or exposed · unlocks GPT-4o and o3-mini'}</span>
              </div>
            ) : (
              <div className="field">
                <div className="field-label-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label>Gemini API Key</label>
                    <span className={`vault-status-pill ${vault.gemini ? 'configured' : 'empty'}`}>
                      {vault.gemini ? 'Configured ✓' : 'Not configured'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="vault-helper-btn"
                    onClick={() => openTokenHelper('gemini')}
                    title="View step-by-step instructions to get a Gemini key"
                  >
                    <span className="info-i">ℹ</span>
                    <span>How to get key</span>
                  </button>
                </div>
                <input
                  type="password"
                  value={vault.gemini}
                  onChange={(e) => persistVault({ ...vault, gemini: e.target.value })}
                  placeholder="AIzaSy..."
                  autoComplete="off"
                  spellCheck="false"
                />
                <span className="hint">{vault.gemini ? 'Gemini key configured securely · unlocks Gemini 3.8 Flash, 3.5 Flash-Lite, and 3.1 Pro' : '100% free with no credit card required · unlocks Gemini Flash and Pro'}</span>
              </div>
            )}

            {/* Quick Helper Banner */}
            <div className="vault-quick-helper">
              <div className="quick-helper-text">
                <span className="helper-badge">{vaultTab === 'gemini' ? '100% FREE' : 'DIRECT KEY'}</span>
                <span>
                  {vaultTab === 'gemini'
                    ? 'Get your free key with 0 setup cost from Google AI Studio.'
                    : 'Create your developer API secret key in OpenAI platform.'}
                </span>
              </div>
              <div className="quick-helper-btns">
                <a
                  href={vaultTab === 'gemini' ? 'https://aistudio.google.com/apikey' : 'https://platform.openai.com/api-keys'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="quick-ext-link"
                >
                  <span>{vaultTab === 'gemini' ? 'Open Google AI Studio' : 'Open OpenAI Platform'}</span>
                  <span>↗</span>
                </a>
                <button
                  type="button"
                  className="quick-steps-btn"
                  onClick={() => openTokenHelper(vaultTab)}
                >
                  ℹ View Steps
                </button>
              </div>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label>Web / CORS Proxy URL (Optional)</label>
              <input
                type="text"
                value={vault.proxyUrl || ''}
                onChange={(e) => persistVault({ ...vault, proxyUrl: e.target.value })}
                placeholder="e.g. https://corsproxy.io/? or leave blank for direct"
              />
              <span className="hint">Allows web browser mode to proxy external AI requests if direct connection is blocked</span>
            </div>
            <div className="vault-actions">
              <button className="ghost" onClick={() => persistVault({ openai: '', gemini: '', proxyUrl: '' })}>Clear</button>
              <button className="primary" onClick={() => setVaultOpen(false)}>Save settings</button>
            </div>
          </div>
        </div>
      )}

      {searchEverywhere && mode !== 'chat' && (
        <SearchEverywhere
          tree={tree}
          tabs={tabs}
          onOpen={openFile}
          onClose={() => setSearchEverywhere(false)}
          actions={[
            { name: 'Open Project', run: openFolderPicker },
            { name: 'Maven Build Console', run: () => setMavenOpen(true) },
            { name: 'Run Application', run: showRun },
            { name: 'Browse Server Workspace', run: openFolderPicker },
            { name: 'New Markdown', run: () => createNewFile() },
            { name: 'Settings', run: () => setSettingsOpen(true) }
          ]}
        />
      )}

      {folderOpen && (
        <div className="modal-back" onClick={() => { if (!openingFolder) setFolderOpen(false) }}>
          <div className="modal vault" role="dialog" aria-modal="true" aria-label="Open project" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="vault-hero">
              <div className="vault-orb" />
              <div>
                <h3>Open project</h3>
                <p>Enter a folder path to open it as your workspace, or choose a folder from your device.</p>
              </div>
            </div>
            <div className="crumb">
              {browse?.parent && (
                <button className="ghost tiny" onClick={() => loadBrowse(browse.parent)}>Up</button>
              )}
              <input
                className="path-input"
                autoFocus
                aria-label="Project folder path"
                value={folderPath}
                disabled={openingFolder}
                onChange={(e) => {
                  browseRequest.current++
                  setFolderPath(e.target.value)
                  setBrowseErr('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void selectFolder()
                }}
                placeholder="/absolute/folder"
              />
            </div>
            <div className="folder-list">
              {(browse?.entries || []).map((e) => (
                <button key={e.path} className="folder-row" onClick={() => loadBrowse(e.path)}>
                  <span className="ico">/</span>
                  {e.name}
                </button>
              ))}
              {browse && !browse.entries.length && <div className="empty"><p>No subfolders</p></div>}
            </div>
            {browseErr && <div className="bubble err" role="alert">{browseErr}</div>}
            <div className="vault-actions project-folder-actions">
              <button className="ghost" onClick={() => { if (!openingFolder) setFolderOpen(false) }}>Cancel</button>
              <button className="ghost" onClick={openLocalFolder} disabled={openingFolder}>Choose Folder…</button>
              {isNativeFSSupported() && <button className="ghost" onClick={() => window.electronAPI?.openFolderDialog ? openFolderPicker() : importFiles(folderInputRef)} disabled={openingFolder}>Import Folder…</button>}
              <button className="primary" onClick={() => void selectFolder()} disabled={!folderPath.trim() || openingFolder}>
                {openingFolder ? 'Opening…' : 'Use this folder'}
              </button>
            </div>
          </div>
        </div>
      )}

      {appModalOpen && (
        <div className="modal-back" onClick={() => setAppModalOpen(false)}>
          <div className="modal app-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="vault-hero">
              <div className="vault-orb" />
              <div>
                <h3>Use on Windows, Mac &amp; Phone</h3>
                <p>Run Aether Studio as a native app on all your devices with instant sync.</p>
              </div>
            </div>

            {installPrompt && !installed && (
              <div className="install-banner">
                <span>Direct install available on this device</span>
                <button className="primary" onClick={triggerInstall}>Install Now</button>
              </div>
            )}

            <div className="guide-tabs">
              <button
                className={guideTab === 'phone' ? 'on' : ''}
                onClick={() => setGuideTab('phone')}
              >
                📱 Phone (iOS / Android)
              </button>
              <button
                className={guideTab === 'desktop' ? 'on' : ''}
                onClick={() => setGuideTab('desktop')}
              >
                💻 Windows &amp; Mac
              </button>
              <button
                className={guideTab === 'git' ? 'on' : ''}
                onClick={() => setGuideTab('git')}
              >
                🐙 Via Git
              </button>
            </div>

            {guideTab === 'phone' && (
              <div>
                {isMobileClient ? (
                  <div className="mobile-download-hub">
                    <div className="mobile-device-badge">
                      <span>{isIOSClient ? '🍎 iOS Device' : isAndroidClient ? '🤖 Android Device' : '📱 Mobile Device'}</span>
                      <span className="badge-highlight">Direct Download &amp; Install Hub</span>
                    </div>

                    {installPrompt && !installed ? (
                      <div className="mobile-direct-install-box">
                        <button className="primary mobile-install-big-btn" onClick={triggerInstall}>
                          ⬇️ Install Aether Studio App
                        </button>
                        <span className="hint">Direct 1-tap installation to your home screen</span>
                      </div>
                    ) : (
                      <div className="mobile-pwa-guide-box">
                        <h4>📱 Add Aether to Home Screen</h4>
                        <p className="hint">Run full-screen without browser address bars, with offline AI code editor!</p>
                      </div>
                    )}

                    <div className="step-item">
                      <div className="step-num">1</div>
                      <div>
                        <strong>{isIOSClient ? 'Safari Share Menu' : 'Browser Menu'}</strong>
                        <div className="hint">
                          {isIOSClient ? (
                            <>Tap the <b>Share button ⎋</b> (square with arrow up) at the bottom of Safari.</>
                          ) : (
                            <>Tap the <b>three dots menu ⋮</b> in the top right of Chrome.</>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="step-item">
                      <div className="step-num">2</div>
                      <div>
                        <strong>{isIOSClient ? 'Add to Home Screen' : 'Install App'}</strong>
                        <div className="hint">
                          {isIOSClient ? (
                            <>Scroll down and tap <b>Add to Home Screen ⊞</b>, then tap <b>Add</b> in the top right.</>
                          ) : (
                            <>Tap <b>Install app</b> or <b>Add to Home screen</b> and confirm <b>Install</b>.</>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="step-item">
                      <div className="step-num">3</div>
                      <div>
                        <strong>Instant Fullscreen Launch</strong>
                        <div className="hint">
                          Aether icon is now on your home screen! Tap it anytime for full-screen coding with touch editor and AI assistant.
                        </div>
                      </div>
                    </div>

                    <div className="mobile-actions-row">
                      <button className="primary" onClick={() => setAppModalOpen(false)}>
                        🚀 Launch Web Studio Now
                      </button>
                      <button className="ghost small" onClick={handleDownloadShortcut}>
                        ⬇️ Download Web Shortcut
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? (
                      <div className="qr-source-toggle">
                        <button
                          className={qrMode !== 'cloud' ? 'on' : ''}
                          onClick={() => setQrMode('local')}
                        >
                          📱 Local Wi-Fi (LAN)
                        </button>
                        <button
                          className={qrMode === 'cloud' ? 'on' : ''}
                          onClick={() => setQrMode('cloud')}
                        >
                          🌐 Cloud Web App
                        </button>
                      </div>
                    ) : null}

                    <div className="qr-container">
                      <QRCodeSVG text={targetQrUrl} size={170} />
                      <div className="url-pill">
                        <span title={targetQrUrl}>{targetQrUrl}</span>
                        <button
                          className="ghost tiny"
                          onClick={() => {
                            navigator.clipboard?.writeText(targetQrUrl)
                            setCopied(true)
                            setTimeout(() => setCopied(false), 2000)
                          }}
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>

                      <div className="qr-actions-row">
                        <button className="ghost tiny" onClick={handleDownloadQR}>
                          {qrDownloaded ? '✓ QR Saved!' : '⬇️ Download QR (PNG)'}
                        </button>
                        <button className="ghost tiny" onClick={handleDownloadShortcut}>
                          ⬇️ Download Shortcut
                        </button>
                        <button className="ghost tiny" onClick={() => window.open(targetQrUrl, '_blank')}>
                          🔗 Open Mobile Link
                        </button>
                      </div>

                      <span className="hint">
                        {window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
                          ? 'Scan with any phone camera (works anywhere worldwide on 4G/5G/Wi-Fi — opens instant download options)'
                          : qrMode === 'cloud'
                          ? 'Scan to open the public cloud app on any phone'
                          : 'Make sure phone and computer are on the same Wi-Fi'}
                      </span>
                    </div>

                    <div className="step-item">
                      <div className="step-num">1</div>
                      <div>
                        <strong>Scan QR or open download link</strong>
                        <div className="hint">Use your phone camera to scan the QR code above or open the link in mobile Safari/Chrome.</div>
                      </div>
                    </div>

                    <div className="step-item">
                      <div className="step-num">2</div>
                      <div>
                        <strong>Choose Download &amp; Add to Home Screen</strong>
                        <div className="hint">
                          • <b>iPhone (Safari)</b>: Tap Share button ⎋ → <b>Add to Home Screen</b>.<br />
                          • <b>Android (Chrome)</b>: Tap ⋮ menu → <b>Install app</b> or <b>Add to Home screen</b>.
                        </div>
                      </div>
                    </div>

                    <div className="step-item">
                      <div className="step-num">3</div>
                      <div>
                        <strong>Full Native Mobile Studio</strong>
                        <div className="hint">Aether launches full-screen without browser address bars, complete with mobile file drawer, touch code editor, and AI chat!</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {guideTab === 'desktop' && (
              <div>
                <div className="step-item" style={{ marginTop: 12 }}>
                  <div className="step-num">1</div>
                  <div>
                    <strong>Windows (Edge / Chrome / Brave)</strong>
                    <div className="hint">Click the <b>Install App</b> icon located on the right side of your browser address bar, or click "Install Now" above. It creates a desktop icon and taskbar app!</div>
                  </div>
                </div>

                <div className="step-item">
                  <div className="step-num">2</div>
                  <div>
                    <strong>macOS (Chrome / Edge / Safari)</strong>
                    <div className="hint">
                      • In Chrome/Edge: Click the <b>Install Aether</b> icon in the address bar.<br />
                      • In Safari (macOS Sonoma+): Choose <b>File → Add to Dock</b>. It turns Aether into a standalone Mac dock application!
                    </div>
                  </div>
                </div>

                <div className="step-item">
                  <div className="step-num">3</div>
                  <div>
                    <strong>Double-click Desktop Launcher</strong>
                    <div className="hint">You can also launch anytime by running <code>start.bat</code> on Windows or <code>./start.sh</code> on Mac/Linux.</div>
                  </div>
                </div>
              </div>
            )}

            {guideTab === 'git' && (
              <div>
                <div className="step-item" style={{ marginTop: 12 }}>
                  <div className="step-num">1</div>
                  <div>
                    <strong>Clone repository on any computer or server</strong>
                    <div className="hint" style={{ marginTop: 4 }}>
                      <pre style={{ background: '#0e141b', padding: '6px 8px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, border: '1px solid var(--line)' }}>
                        git clone &lt;your-repo-url&gt;{'\n'}cd workspace{'\n'}node start.js
                      </pre>
                    </div>
                  </div>
                </div>

                <div className="step-item">
                  <div className="step-num">2</div>
                  <div>
                    <strong>Host Online / Deploy via Git</strong>
                    <div className="hint">Push your repository to GitHub, and deploy to services like Render, Railway, or any VPS for 24/7 access from any phone and PC worldwide.</div>
                  </div>
                </div>

                <div className="step-item">
                  <div className="step-num">3</div>
                  <div>
                    <strong>Automatic Dependency Resolution</strong>
                    <div className="hint">Running <code>node start.js</code> automatically checks and installs all dependencies if missing.</div>
                  </div>
                </div>
              </div>
            )}

            <div className="vault-actions" style={{ marginTop: 16 }}>
              <button className="primary" onClick={() => setAppModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {welcomeModalOpen && (
        <div className="modal-back apple-welcome-back" onClick={dismissWelcome}>
          <div className="modal apple-welcome-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="settings-close-btn welcome-close-btn"
              onClick={dismissWelcome}
              title="Close"
              style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}
            >
              ✕
            </button>
            <div className="sheet-handle" />
            <div className="apple-badge">
              <span className="apple-badge-sparkle">✦</span>
              <span>Ather Studio</span>
            </div>

            <div className="welcome-orb-wrap">
              <AppleAiOrb size={130} />
            </div>

            <div className="apple-welcome-content">
              <h3>{userName ? `Hi, ${userName}` : 'Welcome to Ather Studio'}</h3>
              <p>
                Experience next-generation intelligent coding. Tell us what to call you, or jump right in.
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const trimmed = nameDraft.trim()
                  setUserName(trimmed)
                  if (trimmed) localStorage.setItem(USER_KEY, trimmed)
                  dismissWelcome()
                }}
              >
                <div className="apple-input-wrap">
                  <span className="apple-input-icon">👤</span>
                  <input
                    type="text"
                    className="apple-name-input"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder="Enter your name (optional)"
                  />
                  {nameDraft && (
                    <button
                      type="button"
                      className="apple-input-clear"
                      onClick={() => setNameDraft('')}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <span className="apple-input-hint">Optional · You can always change this anytime</span>

                <div className="apple-modal-actions">
                  <button
                    type="button"
                    className="ghost apple-skip-btn"
                    onClick={dismissWelcome}
                  >
                    Skip
                  </button>
                  <button type="submit" className="primary apple-continue-btn">
                    {nameDraft.trim() ? `Continue as ${nameDraft.trim()}` : 'Get Started'} →
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {mobileMenuOpen && (
        <div className="modal-back mobile-menu-back" onClick={() => setMobileMenuOpen(false)}>
          <div className="modal mobile-menu-card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="mobile-menu-head">
              <div className="mark">
                <div className="mark-orb" />
                <div>
                  <h1>Aether Studio</h1>
                  <span>Settings &amp; Tools</span>
                </div>
              </div>
              <button className="ghost tiny close-menu-btn" onClick={() => setMobileMenuOpen(false)}>✕</button>
            </div>

            <div className="mobile-menu-body">
              <div className="mobile-menu-section">
                <button
                  className="mobile-menu-item user-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    setNameDraft(userName)
                    setWelcomeModalOpen(true)
                  }}
                >
                  <div className="menu-item-icon">👤</div>
                  <div className="menu-item-text">
                    <strong>{userName ? `Hi, ${userName}` : 'Set Your Name'}</strong>
                    <span>Personalize your AI workspace</span>
                  </div>
                  <div className="menu-item-arrow">→</div>
                </button>
              </div>

              <div className="mobile-menu-section">
                <div className="menu-section-label">Studio Mode</div>
                <div className="mobile-modes-grid">
                  <button
                    className={`mobile-mode-btn ${rightOpen && mode === 'editor' ? 'on' : ''}`}
                    onClick={() => { switchMode('chat'); setMobileMenuOpen(false) }}
                  >
                    <strong>💬 AI Chat</strong>
                    <span>Gemini / GPT Mode</span>
                  </button>
                  <button
                    className={`mobile-mode-btn ${mode === 'agent' ? 'on' : ''}`}
                    onClick={() => { switchMode('agent'); setMobileMenuOpen(false) }}
                  >
                    <strong>🤖 AI Agent</strong>
                    <span>Multi-step task coding</span>
                  </button>
                  <button
                    className={`mobile-mode-btn ${mode === 'editor' ? 'on' : ''}`}
                    onClick={() => { switchMode('editor'); setMobileMenuOpen(false) }}
                  >
                    <strong>📝 Editor</strong>
                    <span>Direct editing &amp; assist</span>
                  </button>
                </div>
              </div>

              <div className="mobile-menu-section">
                <div className="menu-section-label">Preferences &amp; Tools</div>
                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    setSettingsOpen(true)
                  }}
                >
                  <div className="menu-item-icon">⚙️</div>
                  <div className="menu-item-text">
                    <strong>Studio Settings</strong>
                    <span>Themes, AI models, editor &amp; exports</span>
                  </div>
                  <div className="menu-item-arrow">→</div>
                </button>

                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    setHistoryOpen(true)
                  }}
                >
                  <div className="menu-item-icon">📜</div>
                  <div className="menu-item-text">
                    <strong>Task &amp; Chat History</strong>
                    <span>{taskHistory.length} saved sessions</span>
                  </div>
                  <div className="menu-item-arrow">→</div>
                </button>

                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    openChat()
                  }}
                >
                  <div className="menu-item-icon">✨</div>
                  <div className="menu-item-text">
                    <strong>AI Coding Assistant</strong>
                    <span>Chat, explain, optimize &amp; write code</span>
                  </div>
                  <div className="menu-item-arrow">→</div>
                </button>

                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    setVaultOpen(true)
                  }}
                >
                  <div className="menu-item-icon">🔑</div>
                  <div className="menu-item-text">
                    <strong>API Tokens &amp; Vault</strong>
                    <span>{vault.openai || vault.gemini ? 'Keys linked' : 'ChatGPT & Gemini keys'}</span>
                  </div>
                  <div className="menu-item-arrow">→</div>
                </button>

                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    openTokenHelper('gemini')
                  }}
                >
                  <div className="menu-item-icon">ℹ️</div>
                  <div className="menu-item-text">
                    <strong>Get API Tokens Guide</strong>
                    <span>Step-by-step helper for Gemini &amp; ChatGPT</span>
                  </div>
                  <div className="menu-item-arrow">→</div>
                </button>

                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    setAppModalOpen(true)
                  }}
                >
                  <div className="menu-item-icon">📱</div>
                  <div className="menu-item-text">
                    <strong>Install App / Multi-Platform</strong>
                    <span>Add to Home Screen on Phone or PC</span>
                  </div>
                  <div className="menu-item-arrow">→</div>
                </button>

                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    openFolderPicker()
                  }}
                >
                  <div className="menu-item-icon">📂</div>
                  <div className="menu-item-text">
                    <strong>Open Local Project</strong>
                    <span>{workspace.name ? `Current: ${workspace.name}` : 'Open folder or files'}</span>
                  </div>
                  <div className="menu-item-arrow">→</div>
                </button>

                <button
                  className="mobile-menu-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    openFolderPicker()
                  }}
                >
                  <div className="menu-item-icon">🌐</div>
                  <div className="menu-item-text">
                    <strong>Server Workspace Browser</strong>
                    <span>Browse host workspace</span>
                  </div>
                  <div className="menu-item-arrow">→</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsModal
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          allModels={allModels}
          settings={settings}
          onUpdateSettings={(newSettings) => {
            setSettings(newSettings)
            if (newSettings.userName) setUserName(newSettings.userName)
            if (newSettings.defaultModel && newSettings.defaultModel !== modelId) {
              pickModel(newSettings.defaultModel)
            }
          }}
          onExportAllChats={(fmt) => exportChatSession(fmt)}
          onClearAllChats={() => setMessages([])}
          vault={vault}
          onSaveVault={(v) => {
            const updated = { ...vault, ...v }
            persistVault(updated)
          }}
        />
      )}

      {historyOpen && (
        <TaskHistoryModal
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          history={taskHistory}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          onClearHistory={handleClearAllHistory}
          onExportSession={handleExportSession}
        />
      )}

      {tokenGuideOpen && (
        <div className="modal-back token-guide-back" onClick={() => setTokenGuideOpen(false)}>
          <div className="modal token-guide-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="settings-close-btn guide-close-btn"
              onClick={() => setTokenGuideOpen(false)}
              title="Close guide"
              style={{ position: 'absolute', top: 14, right: 14, zIndex: 10 }}
            >
              ✕
            </button>
            <div className="sheet-handle" />

            <div className="token-guide-hero">
              <div className="token-guide-badge">
                <span className="guide-sparkle">✦</span>
                <span>API Token Generator Helper</span>
              </div>
              <h3>How to Generate API Tokens</h3>
              <p>Quick steps to get your token and unlock Google Gemini and ChatGPT models.</p>
            </div>

            <div className="token-guide-seg">
              <button
                type="button"
                className={`guide-seg-btn ${tokenGuideTab === 'gemini' ? 'on' : ''}`}
                onClick={() => setTokenGuideTab('gemini')}
              >
                <span className="seg-ico">✨</span>
                <span>Google Gemini</span>
                <span className="seg-tag free">100% Free</span>
              </button>
              <button
                type="button"
                className={`guide-seg-btn ${tokenGuideTab === 'openai' ? 'on' : ''}`}
                onClick={() => setTokenGuideTab('openai')}
              >
                <span className="seg-ico">⚡</span>
                <span>ChatGPT / OpenAI</span>
                <span className="seg-tag">Direct API</span>
              </button>
            </div>

            <div className="token-guide-body">
              {tokenGuideTab === 'gemini' ? (
                <div className="guide-flow">
                  <div className="guide-banner gemini">
                    <span className="banner-ico">🎁</span>
                    <div className="banner-text">
                      <strong>Zero Cost / 100% Free Tier:</strong> Google AI Studio provides high free rate limits for Gemini 3.8 Flash &amp; Pro without requiring a credit card or billing setup!
                    </div>
                  </div>

                  <div className="guide-steps">
                    <div className="guide-step">
                      <div className="step-badge">1</div>
                      <div className="step-content">
                        <strong>Open Google AI Studio</strong>
                        <p>Go to the official Google AI Studio API key generator.</p>
                        <a
                          href="https://aistudio.google.com/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="guide-link-btn"
                        >
                          <span>Open Google AI Studio</span>
                          <span className="arrow">↗</span>
                        </a>
                      </div>
                    </div>

                    <div className="guide-step">
                      <div className="step-badge">2</div>
                      <div className="step-content">
                        <strong>Sign In with your Google Account</strong>
                        <p>Log in with any standard Gmail or Google Workspace account.</p>
                      </div>
                    </div>

                    <div className="guide-step">
                      <div className="step-badge">3</div>
                      <div className="step-content">
                        <strong>Click "Create API key"</strong>
                        <p>Click the blue <strong>"Create API key"</strong> button, then select <em>"Create key in new project"</em> (or pick an existing project).</p>
                      </div>
                    </div>

                    <div className="guide-step">
                      <div className="step-badge">4</div>
                      <div className="step-content">
                        <strong>Copy Your Generated Key</strong>
                        <p>Click the copy button. Gemini API keys always start with <code>AIzaSy...</code></p>
                      </div>
                    </div>

                    <div className="guide-step">
                      <div className="step-badge">5</div>
                      <div className="step-content">
                        <strong>Paste into Aether Studio &amp; Save</strong>
                        <p>Paste the copied key into the Gemini field in the Token Vault.</p>
                      </div>
                    </div>
                  </div>

                  <div className="guide-modal-actions">
                    <button
                      type="button"
                      className="primary guide-action-btn gemini"
                      onClick={() => {
                        setTokenGuideOpen(false)
                        setVaultTab('gemini')
                        setVaultOpen(true)
                      }}
                    >
                      Paste Key in Token Vault →
                    </button>
                  </div>
                </div>
              ) : (
                <div className="guide-flow">
                  <div className="guide-banner openai">
                    <span className="banner-ico">⚡</span>
                    <div className="banner-text">
                      <strong>Direct OpenAI Developer API:</strong> Use your OpenAI developer account to unlock GPT-4o, GPT-4o mini, and o3-mini reasoning models.
                    </div>
                  </div>

                  <div className="guide-steps">
                    <div className="guide-step">
                      <div className="step-badge">1</div>
                      <div className="step-content">
                        <strong>Visit OpenAI API Keys Dashboard</strong>
                        <p>Open the official API Key management page on OpenAI Platform.</p>
                        <a
                          href="https://platform.openai.com/api-keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="guide-link-btn openai"
                        >
                          <span>Open OpenAI Platform</span>
                          <span className="arrow">↗</span>
                        </a>
                      </div>
                    </div>

                    <div className="guide-step">
                      <div className="step-badge">2</div>
                      <div className="step-content">
                        <strong>Sign In or Register</strong>
                        <p>Log into your OpenAI account (the same credentials used for ChatGPT).</p>
                      </div>
                    </div>

                    <div className="guide-step">
                      <div className="step-badge">3</div>
                      <div className="step-content">
                        <strong>Click "Create new secret key"</strong>
                        <p>Click <strong>"+ Create new secret key"</strong>. Give it a name like <code>Aether Studio</code> and choose default permissions.</p>
                      </div>
                    </div>

                    <div className="guide-step">
                      <div className="step-badge">4</div>
                      <div className="step-content">
                        <strong>Copy the Secret Key Immediately</strong>
                        <p>Copy the secret key string (starts with <code>sk-proj-...</code> or <code>sk-...</code>). <em>OpenAI will never show it again.</em></p>
                      </div>
                    </div>

                    <div className="guide-step">
                      <div className="step-badge">5</div>
                      <div className="step-content">
                        <strong>Paste into Aether Studio &amp; Save</strong>
                        <p>Paste the copied key into the ChatGPT field in the Token Vault.</p>
                      </div>
                    </div>
                  </div>

                  <div className="guide-modal-actions">
                    <button
                      type="button"
                      className="primary guide-action-btn openai"
                      onClick={() => {
                        setTokenGuideOpen(false)
                        setVaultTab('openai')
                        setVaultOpen(true)
                      }}
                    >
                      Paste Key in Token Vault →
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
