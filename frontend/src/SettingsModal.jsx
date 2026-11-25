import React, { useState, useEffect } from 'react'
import PopIcon from './PopupIcons.jsx'

export const SETTINGS_KEY = 'aether.settings.v1'

export const DEFAULT_SETTINGS = {
  userName: '',
  theme: 'theme-default',
  workbenchTheme: 'frenky-orange',
  uiDensity: 'comfortable',
  defaultModel: 'aether-spark',
  customInstructions: '',
  temperature: 0.7,
  streamResponse: true,
  autoScrollChat: true,
  editorFontSize: 13,
  editorFontFamily: 'JetBrains Mono, Fira Code, monospace',
  editorTabSize: 2,
  editorWordWrap: true,
  mdDefaultMode: 'reader', // 'reader' | 'split' | 'edit'
  geminiToken: '',
  openaiToken: ''
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const saved = JSON.parse(raw)
    const loaded = { ...DEFAULT_SETTINGS, ...saved }
    if (loaded.workbenchTheme !== 'frenky-orange' && !saved.themeAccentCustomized) {
      loaded.theme = 'theme-default'
    }
    return loaded
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.error('Failed to save settings:', e)
  }
}

export function SettingsModal({
  isOpen,
  onClose,
  allModels = [],
  settings,
  onUpdateSettings,
  onExportAllChats,
  onClearAllChats,
  vault,
  onSaveVault,
  initialTab = null,
  pulseAvailable = false,
  pulseSettings = null,
  onUpdatePulseSettings
}) {
  const [activeTab, setActiveTab] = useState('general') // general | studio | ai | editor | keys | data
  useEffect(() => {
    if (isOpen && initialTab) setActiveTab(initialTab)
  }, [isOpen, initialTab])
  const [localSettings, setLocalSettings] = useState(settings || DEFAULT_SETTINGS)
  const [showGeminiKey, setShowGeminiKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [testStatus, setTestStatus] = useState(null) // null | testing | success | error
  const [testMessage, setTestMessage] = useState('')
  const [saveToast, setSaveToast] = useState(false)

  useEffect(() => {
    if (settings) {
      setLocalSettings(settings)
    }
  }, [settings, isOpen])

  if (!isOpen) return null

  const update = (key, val) => {
    setLocalSettings((prev) => {
      if (key === 'workbenchTheme' && prev.workbenchTheme !== val) {
        return { ...prev, workbenchTheme: val, theme: 'theme-default', themeAccentCustomized: false }
      }
      const next = { ...prev, [key]: val }
      if (key === 'theme') next.themeAccentCustomized = val !== 'theme-default'
      return next
    })
  }

  const handleSave = () => {
    saveSettings(localSettings)
    if (onUpdateSettings) {
      onUpdateSettings(localSettings)
    }
    // Sync vault tokens as well
    if (onSaveVault) {
      onSaveVault({
        gemini: localSettings.geminiToken || '',
        openai: localSettings.openaiToken || ''
      })
    }
    setSaveToast(true)
    setTimeout(() => {
      setSaveToast(false)
      onClose()
    }, 600)
  }

  const handleTestToken = async (provider) => {
    setTestStatus('testing')
    setTestMessage(`Validating ${provider} credentials...`)

    try {
      if (provider === 'gemini') {
        const key = localSettings.geminiToken?.trim()
        if (!key) throw new Error('Please enter a Gemini API Key first')
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`)
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error?.message || `HTTP ${res.status}: Invalid API Key`)
        }
        setTestStatus('success')
        setTestMessage('✓ Gemini API Key verified successfully!')
      } else if (provider === 'openai') {
        const key = localSettings.openaiToken?.trim()
        if (!key) throw new Error('Please enter an OpenAI API Key first')
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` }
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error?.message || `HTTP ${res.status}: Invalid API Key`)
        }
        setTestStatus('success')
        setTestMessage('✓ OpenAI API Key verified successfully!')
      }
    } catch (err) {
      setTestStatus('error')
      setTestMessage(`✕ ${err.message}`)
    }
  }

  return (
    <div className="modal-back settings-back" onClick={onClose}>
      <div className="settings-panel-card" onClick={(e) => e.stopPropagation()}>
        {/* Settings Header */}
        <div className="settings-head">
          <div className="settings-title-row">
            <span className="settings-icon"><PopIcon name="settings" size={20} /></span>
            <div>
              <h3>Studio Settings</h3>
              <p>Configure preferences, AI intelligence, editor, and API integrations</p>
            </div>
          </div>
          <button className="settings-close-btn" onClick={onClose} title="Close settings">
            <PopIcon name="close" size={14} />
          </button>
        </div>

        {/* Settings Body with Sidebar Tabs */}
        <div className="settings-layout">
          <aside className="settings-nav">
            <button
              className={`settings-nav-item ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              <span className="nav-ico"><PopIcon name="palette" size={16} /></span>
              <span>General &amp; Theme</span>
            </button>
            {pulseAvailable && (
              <button
                className={`settings-nav-item ${activeTab === 'studio' ? 'active' : ''}`}
                onClick={() => setActiveTab('studio')}
              >
                <span className="nav-ico"><PopIcon name="globe" size={16} /></span>
                <span>Studio &amp; Dashboard</span>
              </button>
            )}
            <button
              className={`settings-nav-item ${activeTab === 'ai' ? 'active' : ''}`}
              onClick={() => setActiveTab('ai')}
            >
              <span className="nav-ico"><PopIcon name="brain" size={16} /></span>
              <span>AI &amp; Chat Mode</span>
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'editor' ? 'active' : ''}`}
              onClick={() => setActiveTab('editor')}
            >
              <span className="nav-ico"><PopIcon name="code" size={16} /></span>
              <span>Editor &amp; Markdown</span>
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'keys' ? 'active' : ''}`}
              onClick={() => setActiveTab('keys')}
            >
              <span className="nav-ico"><PopIcon name="key" size={16} /></span>
              <span>API Keys &amp; Vault</span>
            </button>
            <button
              className={`settings-nav-item ${activeTab === 'data' ? 'active' : ''}`}
              onClick={() => setActiveTab('data')}
            >
              <span className="nav-ico"><PopIcon name="archive" size={16} /></span>
              <span>Data &amp; Export</span>
            </button>
          </aside>

          <main className="settings-content">
            {/* TAB 1: GENERAL & THEME */}
            {activeTab === 'general' && (
              <div className="settings-section">
                <div className="settings-field">
                  <label>Your Display Name</label>
                  <p className="field-desc">Used for personalized greetings and conversational contexts.</p>
                  <input
                    type="text"
                    className="settings-input"
                    value={localSettings.userName || ''}
                    onChange={(e) => update('userName', e.target.value)}
                    placeholder="e.g. Alex or Prashant"
                  />
                </div>

                <div className="settings-field">
                  <label>Workbench Theme</label>
                  <div className="theme-grid">
                    {[
                      ['frenky-orange', 'Frenky Orange', '#292523'],
                      ['graphite', 'Graphite Glass', '#424344'],
                      ['blue', 'Midnight Blue', '#141c30'],
                      ['dark', 'Deep Charcoal', '#151822'],
                      ['light', 'Apple Light', '#f5f5f7'],
                      ['glass', 'Frosted Glass', '#342d29'],
                      ['pearl', 'Pearl Glass', '#e4f0ff'],
                      ['liquid', 'Liquid Glass', 'linear-gradient(135deg, #3a3a3c, #1c1c1e 60%, #0a84ff)']
                    ].map(([id, label, color]) => {
                      const active = (localSettings.workbenchTheme || DEFAULT_SETTINGS.workbenchTheme) === id
                      return <button key={id} type="button" className={`theme-chip ${active ? 'active' : ''}`}
                        aria-pressed={active} onClick={() => update('workbenchTheme', id)}>
                        <span className="theme-swatch" style={{ background: color }} />
                        <span className="theme-name">{label}</span>
                      </button>
                    })}
                  </div>
                </div>

                <div className="settings-field">
                  <label>Color Accent &amp; Aura Theme</label>
                  <p className="field-desc">Use the theme’s colors or choose your own accent. The theme keeps its wallpaper and surface effects.</p>
                  <div className="theme-grid">
                    {[
                      { id: 'theme-default', label: 'Theme Default', color: 'conic-gradient(#d9ed52, #3b82f6, #ff7624, #d9ed52)' },
                      { id: 'warm-glass', label: 'Warm Glass', color: '#ff9a54' },
                      { id: 'cosmic', label: 'Cosmic Blue', color: '#3b82f6', bg: '#060913' },
                      { id: 'copper', label: 'Amber Copper', color: '#d97706', bg: '#100c08' },
                      { id: 'emerald', label: 'Neon Emerald', color: '#10b981', bg: '#04130d' },
                      { id: 'cyberpunk', label: 'Cyberpunk Violet', color: '#a855f7', bg: '#0f0817' },
                      { id: 'midnight', label: 'OLED Midnight', color: '#94a3b8', bg: '#020202' }
                    ].map((th) => (
                      <button
                        key={th.id}
                        type="button"
                        className={`theme-chip ${(localSettings.theme || DEFAULT_SETTINGS.theme) === th.id ? 'active' : ''}`}
                        onClick={() => update('theme', th.id)}
                        style={{ '--chip-accent': th.color }}
                      >
                        <span className="theme-swatch" style={{ background: th.color }} />
                        <span className="theme-name">{th.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-field">
                  <label>Interface Density</label>
                  <p className="field-desc">Control padding and spacing of buttons and sidebars.</p>
                  <div className="density-toggle">
                    <button
                      type="button"
                      className={`toggle-option ${localSettings.uiDensity === 'comfortable' ? 'active' : ''}`}
                      onClick={() => update('uiDensity', 'comfortable')}
                    >
                      Comfortable
                    </button>
                    <button
                      type="button"
                      className={`toggle-option ${localSettings.uiDensity === 'compact' ? 'active' : ''}`}
                      onClick={() => update('uiDensity', 'compact')}
                    >
                      Compact
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: AI & CHAT MODE */}
            {activeTab === 'ai' && (
              <div className="settings-section">
                <div className="settings-field">
                  <label>Default AI Model</label>
                  <p className="field-desc">The primary model selected when starting fresh chats.</p>
                  <select
                    className="settings-select"
                    value={localSettings.defaultModel || 'aether-spark'}
                    onChange={(e) => update('defaultModel', e.target.value)}
                  >
                    {allModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} ({m.tier.toUpperCase()}) - {m.blurb}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="settings-field">
                  <label>Custom System Instructions</label>
                  <p className="field-desc">
                    Tell the AI how you want it to act, your preferred languages, frameworks, or tone.
                  </p>
                  <textarea
                    className="settings-textarea"
                    rows={4}
                    value={localSettings.customInstructions || ''}
                    onChange={(e) => update('customInstructions', e.target.value)}
                    placeholder="e.g. Always write production-ready, clean TypeScript or React code. Keep explanations concise and emphasize practical examples."
                  />
                </div>

                <div className="settings-field">
                  <div className="field-header-row">
                    <label>Creativity / Temperature: {localSettings.temperature}</label>
                  </div>
                  <p className="field-desc">Lower is more precise and factual; higher is more creative and exploratory.</p>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    className="settings-slider"
                    value={localSettings.temperature}
                    onChange={(e) => update('temperature', parseFloat(e.target.value))}
                  />
                </div>

                <div className="settings-field">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={localSettings.streamResponse}
                      onChange={(e) => update('streamResponse', e.target.checked)}
                    />
                    <span>Stream responses in real-time</span>
                  </label>
                  <p className="field-desc">Displays AI text as it is generated for lower perceived latency.</p>
                </div>

                <div className="settings-field">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={localSettings.autoScrollChat}
                      onChange={(e) => update('autoScrollChat', e.target.checked)}
                    />
                    <span>Auto-scroll to latest message</span>
                  </label>
                </div>
              </div>
            )}

            {/* TAB 3: EDITOR & MARKDOWN */}
            {activeTab === 'editor' && (
              <div className="settings-section">
                <div className="settings-field">
                  <label>Default Markdown (.md) View Mode</label>
                  <p className="field-desc">How Markdown files (.md, .markdown) should render when opened.</p>
                  <div className="density-toggle">
                    <button
                      type="button"
                      className={`toggle-option ${localSettings.mdDefaultMode === 'reader' ? 'active' : ''}`}
                      onClick={() => update('mdDefaultMode', 'reader')}
                    >
                      <PopIcon name="book" size={14} /> Reader (Rendered)
                    </button>
                    <button
                      type="button"
                      className={`toggle-option ${localSettings.mdDefaultMode === 'split' ? 'active' : ''}`}
                      onClick={() => update('mdDefaultMode', 'split')}
                    >
                      <PopIcon name="columns" size={14} /> Split View
                    </button>
                    <button
                      type="button"
                      className={`toggle-option ${localSettings.mdDefaultMode === 'edit' ? 'active' : ''}`}
                      onClick={() => update('mdDefaultMode', 'edit')}
                    >
                      <PopIcon name="pencil" size={14} /> Code Editor
                    </button>
                  </div>
                </div>

                <div className="settings-field">
                  <label>Editor Font Size: {localSettings.editorFontSize}px</label>
                  <input
                    type="range"
                    min="11"
                    max="22"
                    step="1"
                    className="settings-slider"
                    value={localSettings.editorFontSize}
                    onChange={(e) => update('editorFontSize', parseInt(e.target.value, 10))}
                  />
                </div>

                <div className="settings-field">
                  <label>Tab Indentation Size</label>
                  <select
                    className="settings-select"
                    value={localSettings.editorTabSize}
                    onChange={(e) => update('editorTabSize', parseInt(e.target.value, 10))}
                  >
                    <option value={2}>2 Spaces (Modern Web Standard)</option>
                    <option value={4}>4 Spaces</option>
                  </select>
                </div>

                <div className="settings-field">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={localSettings.editorWordWrap}
                      onChange={(e) => update('editorWordWrap', e.target.checked)}
                    />
                    <span>Enable Word Wrap</span>
                  </label>
                  <p className="field-desc">Wrap long code and prose lines automatically instead of horizontal scroll.</p>
                </div>
              </div>
            )}

            {/* TAB 4: API KEYS & VAULT */}
            {activeTab === 'keys' && (
              <div className="settings-section">
                <div className="settings-field">
                  <div className="field-header-row">
                    <label>Google Gemini API Key</label>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="field-link"
                    >
                      Get Free Key from Google AI Studio <PopIcon name="external" size={14} />
                    </a>
                  </div>
                  <div className="key-input-wrap">
                    <input
                      type={showGeminiKey ? 'text' : 'password'}
                      className="settings-input"
                      value={localSettings.geminiToken || ''}
                      onChange={(e) => update('geminiToken', e.target.value)}
                      placeholder="AIzaSy..."
                    />
                    <button
                      type="button"
                      className="key-peek-btn"
                      onClick={() => setShowGeminiKey((v) => !v)}
                      title={showGeminiKey ? 'Hide key' : 'Show key'}
                    >
                      {showGeminiKey ? <PopIcon name="eyeOff" size={14} /> : <PopIcon name="eye" size={14} />}
                    </button>
                    <button
                      type="button"
                      className="key-test-btn"
                      onClick={() => handleTestToken('gemini')}
                      title="Validate Gemini Key"
                    >
                      Test
                    </button>
                  </div>
                  <span className="field-hint">Enables Gemini 3.8 Flash, Gemini 3.1 Pro, and advanced models.</span>
                </div>

                <div className="settings-field">
                  <div className="field-header-row">
                    <label>OpenAI / ChatGPT API Key</label>
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="field-link"
                    >
                      Get OpenAI API Key <PopIcon name="external" size={14} />
                    </a>
                  </div>
                  <div className="key-input-wrap">
                    <input
                      type={showOpenaiKey ? 'text' : 'password'}
                      className="settings-input"
                      value={localSettings.openaiToken || ''}
                      onChange={(e) => update('openaiToken', e.target.value)}
                      placeholder="sk-proj-..."
                    />
                    <button
                      type="button"
                      className="key-peek-btn"
                      onClick={() => setShowOpenaiKey((v) => !v)}
                      title={showOpenaiKey ? 'Hide key' : 'Show key'}
                    >
                      {showOpenaiKey ? <PopIcon name="eyeOff" size={14} /> : <PopIcon name="eye" size={14} />}
                    </button>
                    <button
                      type="button"
                      className="key-test-btn"
                      onClick={() => handleTestToken('openai')}
                      title="Validate OpenAI Key"
                    >
                      Test
                    </button>
                  </div>
                  <span className="field-hint">Enables GPT-4o, GPT-4o mini, and o3-mini models.</span>
                </div>

                {testMessage && (
                  <div className={`token-test-alert ${testStatus}`}>
                    {testMessage}
                  </div>
                )}
              </div>
            )}

            {/* STUDIO & DASHBOARD (Pulse) — applied instantly */}
            {activeTab === 'studio' && pulseAvailable && (
              <div className="settings-section">
                {!pulseSettings ? (
                  <div className="settings-field">
                    <label>Studio &amp; Dashboard</label>
                    <p className="field-desc">These settings load once Studio has started. Open Studio or Dashboard once, then come back here.</p>
                  </div>
                ) : (() => {
                  const ps = pulseSettings
                  const fonts = ps.fontSettings || {}
                  const limits = ps.limits || { ui: { min: 11, max: 22 }, code: { min: 10, max: 24 } }
                  const send = (patch) => onUpdatePulseSettings?.(patch)
                  const stepFont = (key, delta, range) => {
                    const value = Math.max(range.min, Math.min(range.max, (Number(fonts[key]) || 12) + delta))
                    send({ fontSettings: { [key]: value } })
                  }
                  return (
                    <>
                      <p className="field-desc studio-live-note"><PopIcon name="zap" size={13} /> Changes apply to Studio and Dashboard instantly.</p>

                      <div className="settings-field">
                        <label className="settings-switch-row">
                          <span>
                            <strong>Match IDE theme</strong>
                            <span className="field-desc">Studio and Dashboard use the IDE's look, accent and font.</span>
                          </span>
                          <input type="checkbox" className="settings-switch" checked={ps.followIde !== false}
                            onChange={(e) => send({ followIde: e.target.checked })} />
                        </label>
                      </div>

                      <div className="settings-field">
                        <label>Studio Theme</label>
                        <p className="field-desc">{ps.followIde !== false ? 'Used when "Match IDE theme" is off. Picking one turns matching off.' : 'Theme for Studio and Dashboard.'}</p>
                        <div className="theme-grid">
                          {(ps.themes || []).map((t) => {
                            const active = ps.followIde === false && ps.theme === t.id
                            return (
                              <button key={t.id} type="button" className={`theme-chip ${active ? 'active' : ''}`} aria-pressed={active}
                                onClick={() => send({ theme: t.id, followIde: false })}>
                                <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.cardBg || t.bg}, ${t.bg} 60%, ${t.accent})` }} />
                                <span className="theme-name">{t.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="settings-field">
                        <label>Interface Font</label>
                        <div className="studio-font-row">
                          <select className="settings-select" value={fonts.fontFamily || ''} onChange={(e) => send({ fontSettings: { fontFamily: e.target.value } })}>
                            {(ps.fonts || []).map((f) => <option key={f.id} value={f.value}>{f.name}</option>)}
                          </select>
                          <div className="studio-stepper" role="group" aria-label="Interface font size">
                            <button type="button" aria-label="Smaller" onClick={() => stepFont('fontSize', -1, limits.ui)}><PopIcon name="minus" size={13} /></button>
                            <span>{fonts.fontSize}px</span>
                            <button type="button" aria-label="Larger" onClick={() => stepFont('fontSize', 1, limits.ui)}><PopIcon name="plus" size={13} /></button>
                          </div>
                        </div>
                      </div>

                      <div className="settings-field">
                        <label>Code Font</label>
                        <div className="studio-font-row">
                          <select className="settings-select" value={fonts.codeFontFamily || ''} onChange={(e) => send({ fontSettings: { codeFontFamily: e.target.value } })}>
                            {(ps.codeFonts || []).map((f) => <option key={f.id} value={f.value}>{f.name}</option>)}
                          </select>
                          <div className="studio-stepper" role="group" aria-label="Code font size">
                            <button type="button" aria-label="Smaller" onClick={() => stepFont('codeFontSize', -1, limits.code)}><PopIcon name="minus" size={13} /></button>
                            <span>{fonts.codeFontSize}px</span>
                            <button type="button" aria-label="Larger" onClick={() => stepFont('codeFontSize', 1, limits.code)}><PopIcon name="plus" size={13} /></button>
                          </div>
                        </div>
                      </div>

                      <div className="settings-field">
                        <label>Response Panel</label>
                        <div className="theme-grid studio-layout-grid">
                          {[['response-bottom', 'Bottom', 'Response below the request'], ['response-right', 'Side by side', 'Response on the right']].map(([id, name, hint]) => (
                            <button key={id} type="button" className={`theme-chip ${ps.panelLayout === id ? 'active' : ''}`} aria-pressed={ps.panelLayout === id}
                              title={hint} onClick={() => send({ panelLayout: id })}>
                              <PopIcon name={id === 'response-bottom' ? 'columns' : 'sidebar'} size={14} />
                              <span className="theme-name">{name}</span>
                            </button>
                          ))}
                        </div>
                        <button type="button" className="ghost tiny studio-reset-btn" onClick={() => send({ action: 'resetPanelSizes' })}>
                          <PopIcon name="refresh" size={13} /> Reset panel sizes
                        </button>
                      </div>

                      <div className="settings-field">
                        <label>Request Timeout</label>
                        <p className="field-desc">Milliseconds before a request is cancelled. 0 means no timeout.</p>
                        <input type="number" min="0" step="500" className="settings-input studio-timeout"
                          value={ps.requestTimeout ?? 0}
                          onChange={(e) => send({ requestTimeout: Math.max(0, Number(e.target.value) || 0) })} />
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* TAB 5: DATA & EXPORT */}
            {activeTab === 'data' && (
              <div className="settings-section">
                <div className="settings-field">
                  <label>Export Conversation History</label>
                  <p className="field-desc">Download complete conversation transcript with all prompts and responses.</p>
                  <div className="export-btn-group">
                    <button
                      type="button"
                      className="ghost settings-action-btn"
                      onClick={() => onExportAllChats && onExportAllChats('markdown')}
                    >
                      <PopIcon name="download" size={14} /> Export as Markdown (.md)
                    </button>
                    <button
                      type="button"
                      className="ghost settings-action-btn"
                      onClick={() => onExportAllChats && onExportAllChats('json')}
                    >
                      <PopIcon name="download" size={14} /> Export as JSON (.json)
                    </button>
                  </div>
                </div>

                <div className="settings-field danger-zone">
                  <label>Clear Chat Conversation</label>
                  <p className="field-desc">Deletes all messages in the active thread.</p>
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => {
                      if (window.confirm('Are you sure you want to clear this entire conversation?')) {
                        onClearAllChats && onClearAllChats()
                        onClose()
                      }
                    }}
                  >
                    <PopIcon name="trash" size={14} /> Clear Active Thread
                  </button>
                </div>

                <div className="settings-field">
                  <label>Reset Settings to Defaults</label>
                  <p className="field-desc">Restores all studio visual and AI options to default values.</p>
                  <button
                    type="button"
                    className="ghost tiny"
                    onClick={() => {
                      if (window.confirm('Reset all settings to default configuration?')) {
                        setLocalSettings(DEFAULT_SETTINGS)
                      }
                    }}
                  >
                    Reset All Preferences
                  </button>
                </div>

                <div className="system-info-box">
                  <strong>Aether Studio v1.0.0</strong>
                  <span>Engine: WebFS + Dual Local/Direct AI Client</span>
                  <span>Port: 4576</span>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* Footer with Save / Cancel */}
        <div className="settings-foot">
          {saveToast && <span className="save-toast-tag"><PopIcon name="check" size={14} /> Preferences Saved!</span>}
          <div className="foot-actions">
            <button type="button" className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary save-settings-btn" onClick={handleSave}>
              Save Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
