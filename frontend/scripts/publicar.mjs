// Publica la versión actual del APK para que el móvil se actualice solo.
//
//   cd frontend && npm run publicar
//
// Compila la app móvil, genera el APK y lo sube, con un version.json al lado, a la rama
// `gh-pages` del repositorio, que GitHub Pages sirve en `updateUrl` (package.json). La app,
// al abrirse, lee ese version.json y, si trae un versionCode mayor que el instalado, descarga
// el APK y ofrece instalarlo (src/lib/app-update.js, AppUpdatePlugin.java).
//
// Antes de publicar hay que subir la versión en DOS sitios, que deben coincidir:
//   - frontend/package.json                → "version"
//   - frontend/android/app/build.gradle    → versionName (igual) y versionCode (+1)
// Android solo acepta como actualización un versionCode mayor.
//
// El APK se firma con la clave de depuración de este equipo (~/.android/debug.keystore), la
// misma con la que se instaló el que hay en el móvil: Android rechaza una actualización
// firmada con otra clave. Si cambias de equipo, copia ese archivo o tendrás que desinstalar.
//
// La rama `gh-pages` solo contiene la última versión: se reescribe entera en cada publicación.
import { execFileSync, execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ANDROID = path.join(FRONT, 'android')
const RAMA = 'gh-pages'
const APK = 'HipertroFit.apk'
const LIMITE_MB = 95 // GitHub rechaza archivos de más de 100 MB
const WIN = process.platform === 'win32'

const git = (args, cwd = FRONT) => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()
const fallar = mensaje => {
  console.error(`\n✖ ${mensaje}\n`)
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync(path.join(FRONT, 'package.json'), 'utf-8'))
const gradle = fs.readFileSync(path.join(ANDROID, 'app', 'build.gradle'), 'utf-8')
const versionCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1])
const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1]
const manifiesto = pkg.updateUrl
if (!manifiesto) fallar('Falta "updateUrl" en frontend/package.json.')
const direccion = manifiesto.replace(/[^/]*$/, '')

// 1 — Versiones coherentes y mayores que la publicada.
if (!versionCode || !versionName) fallar('No encuentro versionCode/versionName en android/app/build.gradle.')
if (versionName !== pkg.version) {
  fallar(`La versión de package.json (${pkg.version}) y el versionName de build.gradle (${versionName}) no coinciden.`)
}
let publicada = null
try {
  const res = await fetch(manifiesto + '?t=' + Date.now(), { cache: 'no-store' })
  if (res.ok) publicada = await res.json()
} catch { /* sin conexión o primera publicación */ }
if (publicada && Number(publicada.versionCode) >= versionCode) {
  fallar(`Ya está publicado el versionCode ${publicada.versionCode} (${publicada.versionName}). ` +
    `Sube versionCode en android/app/build.gradle (y la versión) antes de publicar.`)
}

// 2 — Lo que se publica tiene que ser lo que está guardado en git.
const sinGuardar = git(['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean)
if (sinGuardar.length > 0) {
  fallar(`Hay cambios sin confirmar en git. Confírmalos antes de publicar:\n${sinGuardar.join('\n')}`)
}

// 3 — Tests, compilación web móvil y APK.
const env = { ...process.env }
// Las mismas variables que "build:mobile" (escritas allí al estilo POSIX, que npm en Windows
// no entiende), leídas de package.json para no repetirlas.
for (const [, k, v] of (pkg.scripts['build:mobile'] || '').matchAll(/\b(VITE_\w+)=(\S+)/g)) env[k] = v
if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && WIN) {
  env.ANDROID_HOME = path.join(env.LOCALAPPDATA || '', 'Android', 'Sdk')
}
if (!env.JAVA_HOME) {
  const jbr = WIN ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
  if (fs.existsSync(jbr)) env.JAVA_HOME = jbr
}
const run = (cmd, cwd = FRONT, conEnv = env) => execSync(cmd, { cwd, env: conEnv, stdio: 'inherit' })

console.log(`\n▶ Generando la versión ${versionName} (versionCode ${versionCode})…\n`)
// Los tests, con el entorno de siempre: las VITE_* de la compilación móvil cambian lo que
// esperan (rutas de imágenes, modo móvil).
run('npm test', FRONT, process.env)
run('npx vite build')
run('npx cap sync android')
// overridePathCheck: la ruta del proyecto lleva una «ú» (C:\Jesús\…) y el plugin de Android
// se niega a compilar con caracteres no ASCII si no se le dice que siga.
// Con ruta completa: cmd no siempre busca ejecutables en la carpeta actual.
run(`"${path.join(ANDROID, WIN ? 'gradlew.bat' : 'gradlew')}" assembleDebug -Pandroid.overridePathCheck=true`, ANDROID)

const salida = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
if (!fs.existsSync(salida)) fallar('No se ha generado android/app/build/outputs/apk/debug/app-debug.apk.')
const datos = fs.readFileSync(salida)
const mb = datos.length / 1024 / 1024
if (mb > LIMITE_MB) fallar(`El APK pesa ${mb.toFixed(1)} MB y el alojamiento admite 100 MB como máximo.`)
const version = {
  versionCode,
  versionName,
  apk: APK,
  sha256: crypto.createHash('sha256').update(datos).digest('hex'),
  size: datos.length,
  date: new Date().toISOString(),
  commit: git(['rev-parse', '--short', 'HEAD']),
}

// 4 — Confirmación: al publicar, el móvil se actualizará al abrir la app.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const respuesta = await rl.question(
  `\nSe va a publicar la versión ${versionName} (${mb.toFixed(1)} MB) en ${direccion}\n` +
    'El móvil la ofrecerá al abrir la app. ¿Continuar? (s/N) ',
)
rl.close()
if (!/^s(í|i)?$/i.test(respuesta.trim())) fallar('Publicación cancelada. No se ha subido nada.')

// 5 — Rama gh-pages nueva (un solo commit) en una carpeta temporal, y subida.
const origen = git(['remote', 'get-url', 'origin'])
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-publicar-'))
try {
  git(['init', '--quiet'], tmp)
  git(['config', 'core.autocrlf', 'false'], tmp)
  git(['config', 'user.name', git(['config', 'user.name'])], tmp)
  git(['config', 'user.email', git(['config', 'user.email'])], tmp)

  fs.writeFileSync(path.join(tmp, APK), datos)
  fs.writeFileSync(path.join(tmp, 'version.json'), JSON.stringify(version, null, 2) + '\n')
  fs.writeFileSync(path.join(tmp, '.nojekyll'), '')
  // Página mínima con el enlace fijo, para instalar la app en un móvil nuevo.
  fs.writeFileSync(path.join(tmp, 'index.html'),
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>HipertroFit ${versionName}</title>` +
    `<body style="font-family:system-ui;padding:24px;background:#0c0e12;color:#eee">` +
    `<h1>HipertroFit ${versionName}</h1><p><a style="color:#6cf" href="${APK}?v=${versionCode}">Descargar el APK</a> ` +
    `(${mb.toFixed(1)} MB)</p></body>\n`)

  git(['add', '-A'], tmp)
  git(['commit', '--quiet', '-m', `Versión ${versionName} (${versionCode})`], tmp)
  console.log('\n▶ Subiendo a GitHub…\n')
  execFileSync('git', ['push', '--force', origen, `HEAD:${RAMA}`], { cwd: tmp, stdio: 'inherit' })
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(
  `\n✔ Versión ${versionName} publicada.\n` +
    `  GitHub Pages tarda uno o dos minutos en servirla. Compruébalo en:\n  ${manifiesto}\n` +
    `  APK para instalar en un móvil nuevo (enlace fijo):\n  ${direccion}${APK}\n`,
)
