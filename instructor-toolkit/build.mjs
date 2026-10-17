// Builds the extension into dist/. Each entry is bundled as a self-contained
// IIFE because MV3 content scripts cannot be ES modules.
import { build, context } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const watch = process.argv.includes('--watch')
const zip = process.argv.includes('--zip')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

const manifest = JSON.parse(readFileSync('static/manifest.json', 'utf8'))
manifest.version = pkg.version
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2))
cpSync('static/managed_schema.json', 'dist/managed_schema.json')
cpSync('static/options.html', 'dist/options.html')
cpSync('static/icons', 'dist/icons', { recursive: true })

const options = {
  entryPoints: {
    content: 'src/content/main.tsx',
    background: 'src/background/serviceWorker.ts',
    options: 'src/options/main.tsx',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  logLevel: 'info',
}

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
} else {
  await build(options)
  if (zip) {
    execFileSync('zip', ['-qr', `../instructor-toolkit-${pkg.version}.zip`, '.'], { cwd: 'dist' })
    console.log(`Wrote instructor-toolkit-${pkg.version}.zip`)
  }
}
