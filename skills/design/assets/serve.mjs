#!/usr/bin/env node
/**
 * Tiny zero-dependency static server for the design folder (the folder that
 * contains this script). Serves files, rejects path traversal and renders a
 * plain directory listing at "/" so the viewer can discover canvases.
 *
 * Usage: node design/serve.mjs [port]   (default port 8765)
 */
import { createServer } from 'node:http'
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

const port = Number(process.argv[2] ?? 8765)
const root = resolve(import.meta.dirname)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

const server = createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const file = normalize(join(root, pathname))
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      return res.end('forbidden')
    }

    let st = null
    try {
      st = statSync(file)
    } catch {}

    if (st?.isFile()) {
      res.writeHead(200, {
        'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      if (req.method === 'HEAD') return res.end()
      return createReadStream(file).pipe(res)
    }

    if (st?.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { location: pathname + '/' })
        return res.end()
      }
      const entries = readdirSync(file, { withFileTypes: true })
        .filter((entry) => entry.name !== '.')
        .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
        .sort()
      const items = ['../', ...entries].map((name) => `<li><a href="${name}">${name}</a></li>`)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      if (req.method === 'HEAD') return res.end()
      return res.end(`<!doctype html><title>${pathname}</title><ul>${items.join('')}</ul>`)
    }

    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end(String(error?.message ?? error))
  }
})

server.listen(port, () => {
  console.log(`design viewer served at http://localhost:${port}/viewer.html`)
})
