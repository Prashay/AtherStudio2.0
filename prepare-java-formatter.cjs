const { createHash } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const version = '1.24.0'
const filename = `google-java-format-${version}-all-deps.jar`
const directory = path.resolve(__dirname, 'backend/tools')
const destination = path.join(directory, filename)
const checksum = '812f805f58112460edf01bf202a8e61d0fd1f35c0d4fabd54220640776ec57a1'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function prepare() {
  const local = await fs.readFile(destination).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
  if (local && digest(local) === checksum) return
  const url = `https://repo.maven.apache.org/maven2/com/google/googlejavaformat/google-java-format/${version}/${filename}`
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Google Java Format download returned HTTP ${response.status}.`)
  const jar = Buffer.from(await response.arrayBuffer())
  if (digest(jar) !== checksum) throw new Error('Google Java Format checksum mismatch.')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(destination, jar)
}

prepare().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

