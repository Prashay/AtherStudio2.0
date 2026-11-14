const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = __dirname
const BUILD_DIR = path.join(ROOT, 'build')
const ELECTRON_DIR = path.join(ROOT, 'electron')
const PUBLIC_DIR = path.join(ROOT, 'frontend', 'public')

if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR, { recursive: true })
if (!fs.existsSync(ELECTRON_DIR)) fs.mkdirSync(ELECTRON_DIR, { recursive: true })
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true })

// 1. High-Precision Apple-Style 3D Vector SVG
const apple3dSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Apple Space Gray / Dark Titanium Base Gradient -->
    <linearGradient id="appleBaseGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#242834"/>
      <stop offset="35%" stop-color="#181b24"/>
      <stop offset="100%" stop-color="#0e1017"/>
    </linearGradient>

    <!-- Top Specular Bezel Rim -->
    <linearGradient id="appleRimGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="25%" stop-color="#94a3b8" stop-opacity="0.14"/>
      <stop offset="80%" stop-color="#475569" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.35"/>
    </linearGradient>

    <!-- 3D Emblem Platinum Light Facet (Left) -->
    <linearGradient id="facetLight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="40%" stop-color="#e2e8f0"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </linearGradient>

    <!-- 3D Emblem Aluminum Shadow Facet (Right) -->
    <linearGradient id="facetShadow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#cbd5e1"/>
      <stop offset="50%" stop-color="#64748b"/>
      <stop offset="100%" stop-color="#334155"/>
    </linearGradient>

    <!-- 3D Emblem Bridge Gradient -->
    <linearGradient id="facetBridge" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#94a3b8"/>
    </linearGradient>

    <!-- 3D Drop Shadow on Base Plate -->
    <filter id="apple3dShadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#000000" flood-opacity="0.65"/>
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000000" flood-opacity="0.40"/>
    </filter>

    <!-- Outer Squircle Drop Shadow for macOS Dock / Desktop -->
    <filter id="macShadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#000000" flood-opacity="0.55"/>
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>

  <!-- Squircle Base with Mac Drop Shadow -->
  <g filter="url(#macShadow)">
    <rect x="36" y="36" width="440" height="440" rx="98" fill="url(#appleBaseGrad)" stroke="url(#appleRimGrad)" stroke-width="2.5"/>
  </g>

  <!-- Apple Top Glass Subtle Specular Glare -->
  <path d="M 36 134 C 36 78 78 36 134 36 L 378 36 C 434 36 476 78 476 134 L 476 210 C 340 230 172 210 36 280 Z" fill="#ffffff" opacity="0.035"/>

  <!-- 3D Emblem Group with Realistic Elevation Shadow -->
  <g filter="url(#apple3dShadow)">
    <!-- Central 3D "A" / Apex Studio Monogram -->
    <!-- Left Light-Reflecting Pillar -->
    <path d="M 256 122 L 256 184 L 174 358 L 128 358 Z" fill="url(#facetLight)"/>
    
    <!-- Right Ambient-Shadow Pillar -->
    <path d="M 256 122 L 384 358 L 338 358 L 256 184 Z" fill="url(#facetShadow)"/>
    
    <!-- Precision 3D Bevel Spine Ridge -->
    <line x1="256" y1="122" x2="256" y2="184" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
    
    <!-- Floating 3D Cross Bridge -->
    <path d="M 174 278 L 338 278 L 324 306 L 188 306 Z" fill="url(#facetBridge)"/>
    
    <!-- Top Apex Highlight -->
    <circle cx="256" cy="122" r="5" fill="#ffffff" opacity="0.9"/>
    
    <!-- Subtle Precision Center Notch / Core Spark -->
    <polygon points="256,198 270,224 256,250 242,224" fill="#ffffff" opacity="0.9"/>
  </g>
</svg>`

fs.writeFileSync(path.join(PUBLIC_DIR, 'icon.svg'), apple3dSvg)
fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.svg'), apple3dSvg)
console.log('✓ Written high-res 3D Apple-style vector SVGs')

// 2. Pure Node.js high-resolution PNG generator (Zero external dependencies)
function createCRC32Table() {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c
  }
  return table
}

const crcTable = createCRC32Table()
function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function makeChunk(type, data) {
  const len = data.length
  const chunk = Buffer.alloc(12 + len)
  chunk.writeUInt32BE(len, 0)
  chunk.write(type, 4, 4, 'ascii')
  data.copy(chunk, 8)
  const toCrc = Buffer.alloc(4 + len)
  toCrc.write(type, 0, 4, 'ascii')
  data.copy(toCrc, 4)
  chunk.writeUInt32BE(crc32(toCrc), 8 + len)
  return chunk
}

// Distance from point (px, py) to line segment (x1, y1) -> (x2, y2)
function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)
  if (l2 === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1))
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2
  t = Math.max(0, Math.min(1, t))
  const projX = x1 + t * (x2 - x1)
  const projY = y1 + t * (y2 - y1)
  return Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY))
}

function generatePngBuffer(size = 512) {
  const width = size
  const height = size
  const cx = width / 2
  const cy = height / 2

  const raw = Buffer.alloc((width * 4 + 1) * height)

  // Emblem Coordinates
  const topX = cx, topY = cy - size * 0.25
  const leftX = cx - size * 0.23, leftY = cy + size * 0.22
  const rightX = cx + size * 0.23, rightY = cy + size * 0.22
  const strutW = size * 0.045
  const shadowDy = size * 0.035

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (width * 4 + 1)
    raw[rowOffset] = 0 // Filter: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4
      const dx = x - cx
      const dy = y - cy

      // 1. Apple Squircle Formula: (x/a)^4.2 + (y/b)^4.2 <= 1
      const sqRadius = size * 0.44
      const sqDist = Math.pow(Math.abs(dx) / sqRadius, 4.2) + Math.pow(Math.abs(dy) / sqRadius, 4.2)

      if (sqDist > 1.05) {
        // Transparent outside squircle
        raw[pxOffset + 0] = 0
        raw[pxOffset + 1] = 0
        raw[pxOffset + 2] = 0
        raw[pxOffset + 3] = 0
        continue
      }

      // Base Apple Dark Titanium Slate Gradient
      const normY = y / height
      let r = 36 - normY * 22
      let g = 40 - normY * 24
      let b = 52 - normY * 30
      let a = 255

      // Top Glass Subtle Reflection Glare
      if (y < cy && sqDist < 0.90) {
        const topGlow = (1 - (y / (cy * 0.9))) * 12
        r += topGlow
        g += topGlow
        b += topGlow
      }

      // Squircle Antialiasing Rim & Specular Bevel
      if (sqDist > 0.96) {
        const edgeAlpha = Math.max(0, Math.min(1, (1.05 - sqDist) / 0.09))
        a = Math.floor(255 * edgeAlpha)
        const rimHighlight = Math.max(0, 1 - (y / height)) * 55 * edgeAlpha
        r = Math.min(255, r + rimHighlight)
        g = Math.min(255, g + rimHighlight)
        b = Math.min(255, b + rimHighlight + 10)
      }

      // 2. 3D Elevation Drop Shadow on Base Plate
      const dShadowL = distToSegment(x, y - shadowDy, topX, topY, leftX, leftY)
      const dShadowR = distToSegment(x, y - shadowDy, topX, topY, rightX, rightY)
      const minShadowDist = Math.min(dShadowL, dShadowR)
      if (minShadowDist < strutW * 2.2) {
        const shadowFactor = Math.pow(1 - minShadowDist / (strutW * 2.2), 1.6) * 0.55
        r = Math.max(0, r * (1 - shadowFactor))
        g = Math.max(0, g * (1 - shadowFactor))
        b = Math.max(0, b * (1 - shadowFactor))
      }

      // 3. 3D Platinum / Aluminum Emblem (The "A" Apex Monogram)
      const dL = distToSegment(x, y, topX, topY, leftX, leftY)
      const dR = distToSegment(x, y, topX, topY, rightX, rightY)

      // Bridge Bar Coordinates
      const bY = cy + size * 0.06
      const bH = size * 0.035
      const inBridge = (y >= bY - bH && y <= bY + bH && x >= leftX + size * 0.06 && x <= rightX - size * 0.06)

      if (dL < strutW) {
        // Left Strut: High-reflection Platinum White/Silver (Light facing)
        const t = Math.max(0, Math.min(1, (y - topY) / (leftY - topY)))
        const innerRatio = 1 - (dL / strutW) * 0.25
        r = Math.round((245 - t * 45) * innerRatio)
        g = Math.round((248 - t * 42) * innerRatio)
        b = Math.round((255 - t * 38) * innerRatio)
      } else if (dR < strutW) {
        // Right Strut: Sleek Apple Space Gray / Aluminum Shadow facet
        const t = Math.max(0, Math.min(1, (y - topY) / (rightY - topY)))
        const innerRatio = 1 - (dR / strutW) * 0.35
        r = Math.round((180 - t * 75) * innerRatio)
        g = Math.round((190 - t * 78) * innerRatio)
        b = Math.round((205 - t * 80) * innerRatio)
      } else if (inBridge) {
        // Horizontal Bridge: Balanced Platinum
        r = 220
        g = 226
        b = 236
      }

      // Center Precision Specular Spark Notch
      const notchDx = Math.abs(x - cx)
      const notchDy = Math.abs(y - (cy - size * 0.03))
      if (notchDx + notchDy < size * 0.032) {
        r = 255
        g = 255
        b = 255
      }

      raw[pxOffset + 0] = Math.min(255, Math.round(r))
      raw[pxOffset + 1] = Math.min(255, Math.round(g))
      raw[pxOffset + 2] = Math.min(255, Math.round(b))
      raw[pxOffset + 3] = Math.min(255, Math.round(a))
    }
  }

  // PNG Assembly
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  const idat = zlib.deflateSync(raw, { level: 9 })
  const iend = Buffer.alloc(0)

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', iend)
  ])
}

// 3. Package 256x256 PNG inside Windows .ico structure
function generateIcoFromPng(pngBuf) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // Reserved
  header.writeUInt16LE(1, 2) // Type: ICO
  header.writeUInt16LE(1, 4) // 1 image

  const entry = Buffer.alloc(16)
  entry.writeUInt8(0, 0)       // Width: 256 (0 means 256)
  entry.writeUInt8(0, 1)       // Height: 256
  entry.writeUInt8(0, 2)       // Colors: No palette
  entry.writeUInt8(0, 3)       // Reserved
  entry.writeUInt16LE(1, 4)    // Planes
  entry.writeUInt16LE(32, 6)   // Bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8)  // Size of image data
  entry.writeUInt32LE(22, 12)  // Offset of image data (6 header + 16 entry = 22)

  return Buffer.concat([header, entry, pngBuf])
}

console.log('Generating high-resolution 512x512 3D Apple-style PNG icon...')
const png512 = generatePngBuffer(512)
fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png512)
fs.writeFileSync(path.join(ELECTRON_DIR, 'icon.png'), png512)
fs.writeFileSync(path.join(PUBLIC_DIR, 'icon.png'), png512)
fs.writeFileSync(path.join(PUBLIC_DIR, 'logo.png'), png512)
fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.png'), png512)
console.log('✓ Written build/icon.png, electron/icon.png, and frontend/public PNG icons')

console.log('Generating 192x192 mobile PWA icon...')
const png192 = generatePngBuffer(192)
fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-192.png'), png192)
console.log('✓ Written frontend/public/icon-192.png')

console.log('Generating 256x256 Windows .ico file for Electron...')
const png256 = generatePngBuffer(256)
const icoBuf = generateIcoFromPng(png256)
fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoBuf)
fs.writeFileSync(path.join(ELECTRON_DIR, 'icon.ico'), icoBuf)
fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.ico'), icoBuf)
console.log('✓ Written Windows .ico icons')

console.log('\nAll 3D Apple-style basic icons generated successfully!')
