const { execFile } = require('node:child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/
const GROUP_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/
const ARTIFACT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const GENERATORS = new Set(['java', 'kotlin', 'empty'])
const BUILD_SYSTEMS = new Set(['base', 'maven', 'gradle'])

const GITIGNORE = `target/
build/
out/
.gradle/
.idea/
*.iml
*.class
.DS_Store
`

const javaMain = (pkg) => `${pkg ? `package ${pkg};\n\n` : ''}public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
`

const kotlinMain = (pkg) => `${pkg ? `package ${pkg}\n\n` : ''}fun main() {
    println("Hello, World!")
}
`

const KOTLIN_VERSION = '2.0.21'

function pomXml({ groupId, artifactId, javaVersion, kotlin, mainClass }) {
  const kotlinBits = kotlin ? {
    props: `\n        <kotlin.version>${KOTLIN_VERSION}</kotlin.version>`,
    deps: `
    <dependencies>
        <dependency>
            <groupId>org.jetbrains.kotlin</groupId>
            <artifactId>kotlin-stdlib</artifactId>
            <version>\${kotlin.version}</version>
        </dependency>
    </dependencies>
`,
    build: `
    <build>
        <sourceDirectory>src/main/kotlin</sourceDirectory>
        <testSourceDirectory>src/test/kotlin</testSourceDirectory>
        <plugins>
            <plugin>
                <groupId>org.jetbrains.kotlin</groupId>
                <artifactId>kotlin-maven-plugin</artifactId>
                <version>\${kotlin.version}</version>
                <executions>
                    <execution>
                        <id>compile</id>
                        <goals><goal>compile</goal></goals>
                    </execution>
                </executions>
                <configuration>
                    <jvmTarget>${javaVersion}</jvmTarget>
                </configuration>
            </plugin>
        </plugins>
    </build>
`
  } : { props: '', deps: '', build: '' }
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>${groupId}</groupId>
    <artifactId>${artifactId}</artifactId>
    <version>1.0-SNAPSHOT</version>

    <properties>
        <maven.compiler.source>${javaVersion}</maven.compiler.source>
        <maven.compiler.target>${javaVersion}</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <exec.mainClass>${mainClass}</exec.mainClass>${kotlinBits.props}
    </properties>
${kotlinBits.deps}${kotlinBits.build}
</project>
`
}

function gradleBuild({ groupId, javaVersion, kotlin, mainClass }) {
  if (kotlin) {
    return `plugins {
    kotlin("jvm") version "${KOTLIN_VERSION}"
    application
}

group = "${groupId}"
version = "1.0-SNAPSHOT"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(kotlin("test"))
}

kotlin {
    jvmToolchain(${javaVersion})
}

application {
    mainClass.set("${mainClass}")
}

tasks.test {
    useJUnitPlatform()
}
`
  }
  return `plugins {
    id("java")
    application
}

group = "${groupId}"
version = "1.0-SNAPSHOT"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.10.0"))
    testImplementation("org.junit.jupiter:junit-jupiter")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(${javaVersion}))
    }
}

application {
    mainClass.set("${mainClass}")
}

tasks.test {
    useJUnitPlatform()
}
`
}

function projectFiles(opts) {
  const { name, generator, buildSystem, groupId, artifactId, javaVersion, sampleCode } = opts
  const files = { '.gitignore': GITIGNORE }
  const dirs = []
  if (generator === 'empty') {
    files['README.md'] = `# ${name}\n`
    return { files, dirs }
  }
  const kotlin = generator === 'kotlin'
  const lang = kotlin ? 'kotlin' : 'java'
  const ext = kotlin ? 'kt' : 'java'
  const usesPackage = buildSystem !== 'base'
  const pkg = usesPackage ? groupId : ''
  const mainClass = (pkg ? pkg + '.' : '') + (kotlin ? 'MainKt' : 'Main')
  const srcRoot = buildSystem === 'base' ? 'src' : `src/main/${lang}`
  const pkgDir = pkg ? pkg.split('.').join('/') : ''
  const mainDir = [srcRoot, pkgDir].filter(Boolean).join('/')

  dirs.push(mainDir)
  if (buildSystem !== 'base') {
    dirs.push('src/main/resources', `src/test/${lang}`)
  }
  if (sampleCode) files[`${mainDir}/Main.${ext}`] = kotlin ? kotlinMain(pkg) : javaMain(pkg)

  if (buildSystem === 'maven') {
    files['pom.xml'] = pomXml({ groupId, artifactId, javaVersion, kotlin, mainClass })
  } else if (buildSystem === 'gradle') {
    files['settings.gradle.kts'] = `rootProject.name = "${artifactId}"\n`
    files['build.gradle.kts'] = gradleBuild({ groupId, javaVersion, kotlin, mainClass })
  } else {
    files['README.md'] = `# ${name}\n\nSources live in \`src/\`. Run \`${kotlin ? 'Main.kt' : 'Main.java'}\` from the editor.\n`
  }
  return { files, dirs }
}

function gitInit(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['init'], { cwd, windowsHide: true, timeout: 10000 }, (err) => resolve(!err))
  })
}

function expandHome(p) {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

function mountNewProject(app, { assertBrowsable }) {
  app.get('/api/project/defaults', (_req, res) => {
    const home = os.homedir()
    const candidates = ['IdeaProjects', 'Projects', 'projects', 'Documents/GitHub', 'Documents']
    const found = candidates.map((c) => path.join(home, c)).find((p) => {
      try { return fs.statSync(p).isDirectory() } catch { return false }
    })
    res.json({ location: found || home, separator: path.sep })
  })

  app.post('/api/project/new', async (req, res) => {
    try {
      const body = req.body || {}
      const name = String(body.name || '').trim()
      const generator = String(body.generator || 'java')
      const buildSystem = String(body.buildSystem || 'base')
      const groupId = String(body.groupId || 'org.example').trim()
      const artifactId = String(body.artifactId || name).trim()
      const javaVersion = Number(body.javaVersion) || 17
      const location = String(body.location || '').trim()

      if (!NAME_RE.test(name)) return res.status(400).json({ error: 'Enter a valid project name (letters, digits, spaces, . _ -).' })
      if (!location) return res.status(400).json({ error: 'Choose a location for the project.' })
      if (!GENERATORS.has(generator)) return res.status(400).json({ error: 'Unknown project type.' })
      if (generator !== 'empty' && !BUILD_SYSTEMS.has(buildSystem)) return res.status(400).json({ error: 'Unknown build system.' })
      if (generator !== 'empty' && buildSystem !== 'base') {
        if (!GROUP_RE.test(groupId)) return res.status(400).json({ error: 'GroupId must look like a Java package, e.g. org.example.' })
        if (!ARTIFACT_RE.test(artifactId)) return res.status(400).json({ error: 'ArtifactId may contain letters, digits, . _ -' })
      }
      if (![8, 11, 17, 21, 25].includes(javaVersion)) return res.status(400).json({ error: 'Unsupported JDK version.' })

      const parent = assertBrowsable(expandHome(location))
      const target = path.join(parent, name)
      if (fs.existsSync(target)) {
        const stat = fs.statSync(target)
        if (!stat.isDirectory() || fs.readdirSync(target).length) {
          return res.status(409).json({ error: `"${target}" already exists and is not empty.` })
        }
      }

      const { files, dirs } = projectFiles({
        name, generator, buildSystem, groupId, artifactId, javaVersion,
        sampleCode: body.sampleCode !== false
      })
      fs.mkdirSync(target, { recursive: true })
      for (const dir of dirs) fs.mkdirSync(path.join(target, dir), { recursive: true })
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(target, rel)
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, content, { flag: 'wx' })
      }
      const git = body.git === true ? await gitInit(target) : false
      res.json({ ok: true, path: target, git })
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message || 'Could not create the project.' })
    }
  })
}

module.exports = { mountNewProject, projectFiles }
