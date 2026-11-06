#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const aliases = {
  command: [/\bcommand\b/i, /\bcommands?\b/i],
  'exit code': [/\bexit(?:\s+code|_code)?\b/i, /\bexit\b/i],
  'artifact path': [/\bartifact(?:\s+path)?\b/i, /\bartifact\b/i],
  'failure probe': [/\bfailure\s+probe(?:\/result)?\b/i, /\bprobe\b/i],
}

function usage() {
  console.error('Usage: node scripts/audit-ci-hardening-evidence.mjs --manifest <path>')
  process.exitCode = 2
}

function hasField(text, field) {
  return aliases[field].some((pattern) => pattern.test(text))
}

function audit(manifestPath) {
  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch (error) {
    console.error(`AUDIT FAILED: cannot read manifest ${manifestPath}: ${error.message}`)
    return false
  }
  if (!Array.isArray(manifest.rows)) {
    console.error(`AUDIT FAILED: manifest ${manifestPath} must contain a rows array`)
    return false
  }
  let approved = 0
  for (const row of manifest.rows) {
    const task = row?.task ?? '<unnamed task>'
    const evidencePath = row?.evidencePath
    const required = row?.requiredFields
    const failures = []
    if (typeof evidencePath !== 'string') failures.push('evidence path')
    if (!Array.isArray(required)) failures.push('required fields')
    const absolute = typeof evidencePath === 'string' ? resolve(dirname(manifestPath), evidencePath) : '<missing path>'
    if (typeof evidencePath === 'string' && !existsSync(absolute)) {
      failures.push(`evidence file (${evidencePath})`)
    } else if (typeof evidencePath === 'string') {
      const text = readFileSync(absolute, 'utf8')
      for (const field of required ?? []) {
        if (typeof field !== 'string' || !aliases[field]) failures.push(`unsupported field (${field})`)
        else if (!hasField(text, field)) failures.push(`missing field (${field})`)
      }
    }
    if (failures.length) {
      console.error(`FAIL ${task}: ${evidencePath ?? '<missing path>'} — ${failures.join('; ')}`)
    } else {
      console.log(`PASS ${task}: ${evidencePath}`)
      approved++
    }
  }
  const failed = manifest.rows.length - approved
  console.log(`Summary: ${approved} row(s) approved, ${failed} row(s) failed`)
  return failed === 0
}

const index = process.argv.indexOf('--manifest')
if (index < 0 || !process.argv[index + 1]) usage()
else process.exitCode = audit(resolve(process.argv[index + 1])) ? 0 : 1
