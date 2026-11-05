/* mockbird:config-driven:v2 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

export const id = 'slop'
export const flags = ['--gate']

const checks = {
  'ai-gradient': /(?:purple|violet|indigo|blue)[^\n;{}]*(?:gradient|glow)|(?:gradient|glow)[^\n;{}]*(?:purple|violet|indigo|blue)/i,
  'banned-font': /(?:font-family|fontFace|class|font)[^\n;{}]*(?:Inter|Fraunces|Instrument[_ -]?Serif)/i,
  'em-dash-copy': /—/,
  'decorative-emoji': /(?:aria-hidden|class\s*=\s*["'][^"']*(?:icon|emoji|decor|badge)|<span|<div)[^>\n]*>(?:[^<\n]*)(?:[\u{1F300}-\u{1FAFF}\u2600-\u27BF])/u,
  'generic-hero': /(?:text-align\s*:\s*center|items-center|justify-center)[\s\S]{0,500}(?:gradient|from-(?:blue|purple|violet)|linear-gradient)[\s\S]{0,500}(?:<button|<a\b)/i,
  'heavy-shadow': /(?:box-shadow|shadow-(?:2xl|inner|black)|drop-shadow)[^;\n]*(?:black|0\s+\d{2,}|rgba?\([^)]*\.([6-9]|1\)))/i,
  glassmorphism: /(?:backdrop-filter|backdrop-blur|glassmorphism|frosted-glass)/i,
  placeholder: /(?:lorem ipsum|placeholder|dummy text|your (?:name|email|content) here)/i,
}

const textExt = new Set(['.html', '.css', '.js', '.jsx', '.mjs', '.svg'])
function files(dir, root, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files(full, root, out)
    else if (textExt.has(extname(entry.name).toLowerCase())) out.push({ full, label: relative(root, full) })
  }
  return out
}

function copyLine(line, source) {
  return source === 'html' && !/<(?:script|style)\b/i.test(line)
}

export function run({ rootDir, config, flags: argvFlags, fail }) {
  const configured = config?.slop?.rules
  if (configured === false || (Array.isArray(configured) && configured.length === 0)) return
  const enabled = Array.isArray(configured) ? new Set(configured) : new Set(Object.keys(checks))
  const gate = argvFlags.includes('--gate')
  for (const { full, label } of files(rootDir, rootDir)) {
    const source = extname(full).toLowerCase() === '.html' ? 'html' : 'code'
    const lines = readFileSync(full, 'utf8').split('\n')
    lines.forEach((line, index) => {
      for (const [name, pattern] of Object.entries(checks)) {
        if (!enabled.has(name) || !pattern.test(line) || (name === 'em-dash-copy' && !copyLine(line, source))) continue
        const message = `${label}:${index + 1}: ${name}`
        if (gate) fail(`slop-${name}`, message)
        else console.warn(`- WARN slop-${name}: ${message}`)
      }
    })
  }
}
