import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || '.')
const tag = process.argv[3] || process.env.GITHUB_REF_NAME
const readJson = file => JSON.parse(readFileSync(join(root, file), 'utf8'))
const fail = message => { console.error(`VERSION CHECK FAILED: ${message}`); process.exitCode = 1 }

const manifest = readJson('package.json')
const lock = readJson('package-lock.json')
const plugin = readJson('plugin/package.json')
const pluginLock = readJson('plugin/package-lock.json')
const viewer = readFileSync(join(root, 'skills/design/assets/viewer.html'), 'utf8')
const core = readFileSync(join(root, 'plugin/core.mjs'), 'utf8')

if (lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) fail('root package-lock metadata does not match package.json')
if (pluginLock.version !== plugin.version || pluginLock.packages?.['']?.version !== plugin.version) fail('plugin lock metadata does not match plugin/package.json')
if (plugin.version === manifest.version) fail('plugin version must remain independent of root version')
if (!viewer.includes(`id="versionTag">v${manifest.version}</div>`)) fail('viewer footer version does not match root')
if (!core.includes("JSON.parse(readFileSync(join(PACK_ROOT, \"package.json\"), \"utf8\")).version")) fail('sync stamp does not read root version')
if (tag !== undefined && tag !== `v${manifest.version}`) fail(`release tag ${tag} does not equal v${manifest.version}`)
if (!process.exitCode) console.log(`VERSION CHECK OK: root=${manifest.version} plugin=${plugin.version}${tag ? ` tag=${tag}` : ''}`)
