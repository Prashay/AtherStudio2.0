import {
  Bell, Bug, ChevronDown, CircleAlert, Database, FolderClosed, GitBranch,
  Layers, MessageSquare, Minus, MoreHorizontal, Play, Search, Settings,
  Square, Terminal, X
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { menus } from './menus'

const tools = [
  { id: 'Project', side: 'left', icon: FolderClosed },
  { id: 'Structure', side: 'left', icon: Layers },
  { id: 'Notifications', side: 'right', icon: Bell },
  { id: 'AI Chat', side: 'right', icon: MessageSquare },
  { id: 'Database', side: 'right', icon: Database },
  { id: 'Maven', side: 'right', icon: Layers },
  { id: 'Run', side: 'bottom', icon: Play },
  { id: 'Terminal', side: 'bottom', icon: Terminal },
  { id: 'Problems', side: 'bottom', icon: CircleAlert },
  { id: 'Git', side: 'bottom', icon: GitBranch }
] as const

type Side = typeof tools[number]['side']
const defaults: Record<Side, string | null> = { left: 'Project', right: 'Maven', bottom: 'Terminal' }
const useLayout = create<Record<Side, string | null>>()(
  persist(() => defaults, { name: 'aether-desktop-tool-windows' })
)
const toggle = (side: Side, id: string) => useLayout.setState((layout) => ({ [side]: layout[side] === id ? null : id }))

function ToolButtons({ side }: { side: Side }) {
  const active = useLayout((state) => state[side])
  return tools.filter((tool) => tool.side === side).map(({ id, icon: Icon }) => (
    <button key={id} className="icon-button" aria-label={id} title={id} aria-pressed={active === id} onClick={() => toggle(side, id)}>
      <Icon size={17} />
    </button>
  ))
}

function ToolPanel({ side, title }: { side: Side, title: string }) {
  const [terminalTab, setTerminalTab] = useState(true)
  return (
    <section className="card tool-panel" aria-label={title}>
      <header>
        {side === 'bottom' ? tools.filter((tool) => tool.side === 'bottom').map(({ id }) => (
          <button key={id} aria-pressed={id === title} onClick={() => useLayout.setState({ bottom: id })}>{id}</button>
        )) : <strong>{title}</strong>}
        <button className="panel-close icon-button" aria-label={`Hide ${title}`} onClick={() => toggle(side, title)}><X size={14} /></button>
      </header>
      {title === 'Terminal' && terminalTab && <div className="terminal-tabs"><span>Local</span><button aria-label="Close Local tab" onClick={() => setTerminalTab(false)}><X size={12} /></button></div>}
      <div className="panel-content">
        {title === 'Project' ? 'No project open' : 'Not implemented yet'}
      </div>
    </section>
  )
}

function Workspace() {
  const { left, right, bottom } = useLayout()
  return (
    <div className="workspace">
      <aside className="tool-strip" aria-label="Project and bottom tools">
        <ToolButtons side="left" />
        <div className="strip-spacer" />
        <ToolButtons side="bottom" />
      </aside>
      <PanelGroup direction="vertical" autoSaveId={`aether-vertical-${Boolean(bottom)}`}>
        <Panel id="workbench" order={1} minSize={30}>
          <PanelGroup direction="horizontal" autoSaveId={`aether-horizontal-${Boolean(left)}-${Boolean(right)}`}>
            {left && <Panel id="left" order={1} defaultSize={22} minSize={12}><ToolPanel side="left" title={left} /></Panel>}
            {left && <PanelResizeHandle className="resize-handle" />}
            <Panel id="editor" order={2} minSize={25}>
              <section className="card editor-empty" aria-label="Editor">
                <div className="welcome-mark"><Layers size={27} /></div>
                <h1>Aether Studio</h1>
                <p>No file is open</p>
                <button disabled title="Not implemented yet">Open Project…</button>
              </section>
            </Panel>
            {right && <PanelResizeHandle className="resize-handle" />}
            {right && <Panel id="right" order={3} defaultSize={27} minSize={14}><ToolPanel side="right" title={right} /></Panel>}
          </PanelGroup>
        </Panel>
        {bottom && <PanelResizeHandle className="resize-handle" />}
        {bottom && <Panel id="bottom" order={2} defaultSize={28} minSize={12}><ToolPanel side="bottom" title={bottom} /></Panel>}
      </PanelGroup>
      <aside className="tool-strip" aria-label="Right tools"><ToolButtons side="right" /></aside>
    </div>
  )
}

export default function App() {
  const [menu, setMenu] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const [about, setAbout] = useState(false)
  const actions: Record<string, () => void> = {
    Exit: () => void window.ide.app.windowAction('close'),
    Terminal: () => toggle('bottom', 'Terminal'),
    About: () => setAbout(true),
    'Reset Layout': () => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('react-resizable-panels:aether-')) localStorage.removeItem(key)
      }
      useLayout.setState(defaults)
      setLayoutVersion((value) => value + 1)
    },
    'Hide All Windows': () => useLayout.setState({ left: null, right: null, bottom: null })
  }
  const [layoutVersion, setLayoutVersion] = useState(0)

  useEffect(() => {
    window.ide?.app.getInfo().then(({ version }) => setVersion(version), () => setVersion('Unavailable'))
    const dismiss = () => setMenu(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { dismiss(); setAbout(false) }
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const label = Object.keys(menus).find((item) => item[0].toLowerCase() === event.key.toLowerCase())
        if (label) { event.preventDefault(); setMenu(label) }
      }
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <main className="desktop">
      <header className="titlebar">
        <span className="app-icon" aria-label="Aether">A</span>
        <nav aria-label="Application menu" onPointerDown={(event) => event.stopPropagation()}>
          {Object.entries(menus).map(([label, items]) => (
            <div className="menu-anchor" key={label}>
              <button aria-expanded={menu === label} onClick={() => setMenu(menu === label ? null : label)}><u>{label[0]}</u>{label.slice(1)}</button>
              {menu === label && <div className="menu-dropdown">
                {items.map((item, index) => item === '—' ? <hr key={index} /> :
                  <button key={item} disabled={!actions[item]} title={actions[item] ? undefined : 'Not implemented yet'} onClick={() => { setMenu(null); actions[item]?.() }}>{item}</button>)}
              </div>}
            </div>
          ))}
        </nav>
        <div className="run-controls">
          <button disabled title="Not implemented yet">No run configuration <ChevronDown size={12} /></button>
          <button disabled title="Not implemented yet" aria-label="Run"><Play size={15} /></button>
          <button disabled title="Not implemented yet" aria-label="Debug"><Bug size={15} /></button>
          <button disabled title="Not implemented yet" aria-label="Run options"><MoreHorizontal size={16} /></button>
        </div>
        <div className="title-spacer" />
        <button className="icon-button" aria-label="AI Chat" title="AI Chat" onClick={() => toggle('right', 'AI Chat')}><MessageSquare size={16} /></button>
        <button className="icon-button" disabled title="Not implemented yet" aria-label="Search Everywhere"><Search size={16} /></button>
        <button className="icon-button" disabled title="Not implemented yet" aria-label="Settings"><Settings size={16} /></button>
        <div className="window-controls">
          <button aria-label="Minimize" onClick={() => void window.ide.app.windowAction('minimize')}><Minus size={15} /></button>
          <button aria-label="Maximize or restore" onClick={() => void window.ide.app.windowAction('maximize')}><Square size={12} /></button>
          <button aria-label="Close window" onClick={() => void window.ide.app.windowAction('close')}><X size={15} /></button>
        </div>
      </header>
      <Workspace key={layoutVersion} />
      <footer className="statusbar"><span>No project</span><span className="status-spacer" /><span>UTF-8</span><span>4 spaces</span></footer>
      {about && <div className="dialog-backdrop" onClick={() => setAbout(false)}><section role="dialog" aria-modal="true" aria-label="About Aether Studio" onClick={(event) => event.stopPropagation()}>
        <h2>Aether Studio</h2><p>Desktop version {version || 'Unknown'}</p><button onClick={() => setAbout(false)}>Close</button>
      </section></div>}
    </main>
  )
}

