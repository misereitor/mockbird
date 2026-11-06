#!/usr/bin/env node
/** Validate the visual orchestrator report using parsed JSON, not text matching. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const reportPath = resolve(process.argv[2] ?? 'skills/design/assets/example/.visual/report.json')
const required = ['capture', 'diff', 'critic', 'score', 'a11y', 'i18n-stress', 'perf']

function fail(message) {
  console.error(`visual-report-schema: FAIL ${message}`)
  process.exit(1)
}

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (error) {
  fail(`${reportPath}: ${error.message}`)
}
if (!report || typeof report !== 'object' || !Array.isArray(report.screens)) fail(`${reportPath}: screens must be an array`)
if (report.screens.length === 0) fail(`${reportPath}: screens must not be empty`)
for (const [index, screen] of report.screens.entries()) {
  if (!screen || typeof screen !== 'object') fail(`${reportPath}: screens[${index}] must be an object`)
  for (const section of required) {
    if (!Object.prototype.hasOwnProperty.call(screen, section) || !screen[section] || typeof screen[section] !== 'object') {
      fail(`${reportPath}: screens[${index}] missing section ${section}`)
    }
  }
}
console.log(`visual-report-schema: pass ${reportPath} (${report.screens.length} screen(s), ${required.join(', ')})`)
