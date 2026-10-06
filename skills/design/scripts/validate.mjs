#!/usr/bin/env node
/**
 * Design canvas validator (read-only). Checks design/<canvas>/canvas.json and
 * its screen files, printing one line per problem. Never throws: any internal
 * error becomes an `internal:` line.
 *
 * Usage (from the project root): node design/validate.mjs design/<canvas>
 * Exit codes: 0 = no issues, 1 = issues found, 2 = usage error.
 */
import { readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

const DEVICES = new Set(['mobile', 'tablet', 'desktop'])
const MIN_SIZE = 100
const MAX_SIZE = 10000

const problems = []
const fail = (code, message) => problems.push(`- ${code}: ${message}`)

const arg = process.argv[2]
if (!arg) {
  console.error('usage: node design/validate.mjs design/<canvas>')
  process.exit(2)
}

try {
  const root = process.cwd()
  const canvasArg = arg.replaceAll('\\', '/').replace(/\/+$/, '')
  const canvasDir = resolve(root, canvasArg)
  if (canvasDir !== root && !canvasDir.startsWith(root + sep)) {
    fail('outside-project', `${canvasArg} is outside the project`)
  } else {
    let st = null
    try {
      st = statSync(canvasDir)
    } catch {}
    if (!st?.isDirectory()) {
      fail('not-found', `${canvasArg} is not a folder`)
    } else {
      validateCanvas(canvasDir, canvasArg)
    }
  }
} catch (error) {
  fail('internal', String(error?.message ?? error))
}

function validateCanvas(canvasDir, canvasArg) {
  let raw
  try {
    raw = readFileSync(join(canvasDir, 'canvas.json'), 'utf8')
  } catch {
    return fail('missing-manifest', `${canvasArg}/canvas.json not found`)
  }

  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (error) {
    return fail('invalid-json', `canvas.json: ${jsonErrorWhere(error, raw)}${String(error.message)}`)
  }

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return fail('invalid-shape', 'canvas.json: the root must be an object')
  }
  if (manifest.title !== undefined && typeof manifest.title !== 'string') {
    fail('invalid-shape', 'canvas.json: "title" must be a string')
  }
  if (!Array.isArray(manifest.screens)) {
    return fail('invalid-shape', 'canvas.json: "screens" must be a list of screen objects')
  }

  const seenIds = new Map()
  for (const [index, screen] of manifest.screens.entries()) {
    validateScreen(screen, index, canvasDir, seenIds)
  }

  try {
    const dataRaw = readFileSync(join(canvasDir, 'data.json'), 'utf8')
    let data = null
    try {
      data = JSON.parse(dataRaw)
    } catch (error) {
      fail('invalid-data', `data.json: ${jsonErrorWhere(error, dataRaw)}${String(error.message)}`)
    }
    if (data && data.scenarios !== undefined && (typeof data.scenarios !== 'object' || data.scenarios === null || Array.isArray(data.scenarios))) {
      fail('invalid-data', 'data.json: "scenarios" must be an object of named overrides')
    }
  } catch { /* data.json is optional */ }

  console.log(`Design canvas ${canvasArg}: ${manifest.screens.length} screen(s).`)
}

function validateScreen(screen, index, canvasDir, seenIds) {
  const where = `screen #${index + 1}`
  if (typeof screen !== 'object' || screen === null || Array.isArray(screen)) {
    return fail('invalid-shape', `${where}: must be an object with "id", "name" and "file"`)
  }

  for (const key of ['id', 'name', 'file']) {
    if (typeof screen[key] !== 'string' || screen[key].length === 0) {
      fail('invalid-shape', `${where} (${screen.id ?? '?'}): "${key}" must be a non-empty string`)
    }
  }
  if (typeof screen.id !== 'string' || typeof screen.file !== 'string') return

  if (seenIds.has(screen.id)) {
    fail('duplicate-id', `screen "${screen.id}" is repeated (also #${seenIds.get(screen.id)})`)
  } else {
    seenIds.set(screen.id, index + 1)
  }

  const size = readSize(screen, where)
  if (
    typeof screen.device === 'string' &&
    screen.device.length > 0 &&
    !DEVICES.has(screen.device) &&
    !size.complete
  ) {
    fail(
      'unknown-device',
      `screen "${screen.id}": device "${screen.device}" is not mobile/tablet/desktop and no width+height override exists`,
    )
  }

  if (screen.file.startsWith('/') || screen.file.includes('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(screen.file) || screen.file.split('/').includes('..')) {
    return fail('file-outside', `screen "${screen.id}" → ${screen.file} escapes the canvas folder`)
  }

  let st = null
  try {
    st = statSync(join(canvasDir, screen.file))
  } catch {}
  if (!st?.isFile()) {
    fail('missing-file', `screen "${screen.id}" → ${screen.file} not found`)
  }
}

function readSize(screen, where) {
  const size = { complete: false }
  for (const key of ['width', 'height']) {
    const value = screen[key]
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < MIN_SIZE || value > MAX_SIZE) {
      fail('invalid-shape', `${where} (${screen.id ?? '?'}): "${key}" must be an integer from ${MIN_SIZE} to ${MAX_SIZE}`)
    } else {
      size[key] = value
    }
  }
  size.complete = size.width !== undefined && size.height !== undefined
  return size
}

/** Best-effort "line N" prefix for a JSON.parse SyntaxError. */
function jsonErrorWhere(error, raw) {
  const message = String(error.message)
  const lineMatch = /\(line (\d+)/.exec(message)
  if (lineMatch) return `line ${lineMatch[1]}: `
  const posMatch = /at position (\d+)/.exec(message)
  if (posMatch) return `line ${lineOf(raw, Number(posMatch[1]))}: `
  // Modern V8 embeds a quoted context snippet instead of a position.
  const context = /\.\.\.\s*"?(.*?)"?\s*is not valid JSON\s*$/s.exec(message)?.[1]
  if (!context) return ''
  const anchor = Math.max(0, raw.lastIndexOf(context))
  const token = /Unexpected token '(.*)'/.exec(message)?.[1]
  const offset = token && context.includes(token) ? context.indexOf(token) + 1 : context.length
  return `line ${lineOf(raw, anchor + offset)}: `
}

function lineOf(text, position) {
  return text.slice(0, position).split('\n').length
}

if (problems.length > 0) {
  console.log('Fix these issues:')
  for (const problem of problems) console.log(problem)
  process.exit(1)
}
process.exit(0)
