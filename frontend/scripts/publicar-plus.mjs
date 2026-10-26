// Flujo completo de publicación: commit → push → Obsidian → APK en gh-pages.
//
//   cd frontend && npm run "publicar+"
//
// 1. Si hay cambios sin confirmar, pide un mensaje y hace commit.
// 2. Empuja la rama al remoto (git push).
// 3. Sincroniza la documentación con Obsidian.
// 4. Construye y publica el APK (npm run publicar).
//
// El paso 4 lanza el script publicar.mjs, que ya exige un git clean antes de
// compilar, así que si el commit del paso 1 fallara no llegaríamos aquí.

import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(FRONT, '..')
// La ruta cambia de un equipo a otro: se puede fijar con la variable OBSIDIAN_SYNC.
const OBSIDIAN_SYNC = process.env.OBSIDIAN_SYNC ||
  'D:/Obsidian/obsidian-sync/skills/obsidian-sync/scripts/sync_to_obsidian.py'

const git = (args, cwd = ROOT) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim()

const step = label => console.log(`\n▶ ${label}\n`)
const fallar = msg => { console.error(`\n✖ ${msg}\n`); process.exit(1) }

// ── 1. Commit si hay cambios ─────────────────────────────────────────────────
const cambios = git(['status', '--porcelain']).split('\n').filter(Boolean)

if (cambios.length > 0) {
  console.log('Cambios sin confirmar:')
  cambios.forEach(l => console.log('  ' + l))

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const msg = (await rl.question('\nMensaje de commit (Enter para cancelar): ')).trim()
  rl.close()

  if (!msg) fallar('Publicación cancelada.')

  step('Commit')
  execFileSync('git', ['add', '-A'], { cwd: ROOT, stdio: 'inherit' })
  execFileSync('git', ['commit', '-m', msg,
    '--trailer', 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'],
    { cwd: ROOT, stdio: 'inherit' })
} else {
  console.log('ℹ  Sin cambios pendientes; se salta el commit.')
}

// ── 2. Push ──────────────────────────────────────────────────────────────────
step('Push a origin')
execFileSync('git', ['push'], { cwd: ROOT, stdio: 'inherit' })

// ── 3. Obsidian ──────────────────────────────────────────────────────────────
step('Sincronizando con Obsidian')
if (!fs.existsSync(OBSIDIAN_SYNC)) {
  console.warn(`⚠  No existe ${OBSIDIAN_SYNC}; se salta Obsidian (fija la ruta con OBSIDIAN_SYNC).`)
} else if (spawnSync('python', [OBSIDIAN_SYNC], { cwd: ROOT, stdio: 'inherit' }).status !== 0) {
  console.warn('⚠  La sincronización con Obsidian falló (se continúa con la publicación).')
}

// ── 4. Publicar APK ──────────────────────────────────────────────────────────
step('Publicando APK')
execSync('npm run publicar', { cwd: FRONT, stdio: 'inherit' })
