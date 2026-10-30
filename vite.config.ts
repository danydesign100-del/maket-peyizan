import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const publicFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? publicFiles(join(dir, entry.name)) : [join(dir, entry.name)])

/**
 * Writes dist/sw.js from sw/service-worker.js with the list of every built file,
 * so an installed app is fully available offline. Its version changes with the
 * build, which is how installed copies notice an update.
 */
function serviceWorker(): Plugin {
  return {
    name: 'maket-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((file) => file !== 'index.html' && !file.endsWith('.map'))
      const statics = publicFiles('public').map((file) => relative('public', file).split('\\').join('/')).filter((file) => !file.startsWith('_'))
      const precache = ['/', ...[...statics, ...built].sort().map((file) => `/${file}`)]
      const version = createHash('sha256').update(precache.join('\n')).update(JSON.stringify(Object.values(bundle).map((chunk) => 'code' in chunk ? chunk.code.length : 0))).digest('hex').slice(0, 12)
      const source = readFileSync('sw/service-worker.js', 'utf8').replace("'__VERSION__'", JSON.stringify(version)).replace('= __PRECACHE__', `= ${JSON.stringify(precache, null, 2)}`)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
})
