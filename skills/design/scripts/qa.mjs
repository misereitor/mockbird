#!/usr/bin/env node
/* mockbird:config-driven:v2 */
/**
 * QA wrapper around the design validator (R1-R4, config-driven v2).
 *
 * Usage: node design/scripts/qa.mjs [--selftest] [--config <path>] [--target <path>]
 *   --selftest  run ONLY the R1 probe (mode of its own, like validate --mark-stale)
 *   --config    explicit validate.config.json path
 *   --target    validation target (default ./design, same as validate.mjs)
 *
 * Default mode (exit 0 = green):
 *   1. marker line (R4): stdout line 1 is `config: validate.config.json#<sha256-hex>`
 *      (sha256 of the RAW config bytes via node:crypto).
 *   2. R2 marker integrity: every toolchainScripts entry - resolved relative to
 *      the config file's directory - must exist and carry the config marker
 *      (mockbird:config-driven:v2). A missing entry or a restored pre-config
 *      script is rejected HERE, before anything runs.
 *   3. R1 selftest: the probe fixture is validated under config A vs config B
 *      (exemptDirs flip on ".history"); if both produce identical behavior the
 *      config does not drive behavior and the run fails.
 *   4. validate on the target (stdout passes through).
 *   5. R3 stability: validate runs 10x capturing stdout + exit code; any diff
 *      between runs (or a run that does not complete) is unstable.
 *
 * Config/target discovery = the validate.mjs chain, EXACTLY: explicit
 * --config/--target -> validate.config.json in the validated root -> the CWD.
 * A missing config is exit 3 with guided setup - NEVER a silent fallback.
 *
 * Exit codes: 0 = green, 1 = validate failure (its code is propagated), 2 =
 *   config integrity (pre-config/marker violation (R2), wrong-shape config key,
 *   missing probe fixture, or R1 identical behavior), 3 = missing/broken config
 *   (guided: run setup-design.mjs), 4 = unstable (R3). On conflict 4 wins over
 *   the propagated validate code: an unstable run certifies nothing.
 *
 * Output is deterministic (no timestamps, durations or temp paths): the whole
 * stdout stream must hash identically across runs. The selftest compares
 * behavior with the `config: <path>` echo line removed (A/B use different
 * config FILES; the echo is a path, not behavior).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const usage = 'usage: node design/scripts/qa.mjs [--selftest] [--config <path>] [--target <path>]'
const argv = process.argv.slice(2)
let selftestOnly = false
let configArg = null
let targetArg = './design'
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i]
  if (token === '--config' || token === '--target') {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      console.error(`${token} requires a path — ${usage}`)
      process.exit(2)
    }
    if (token === '--config') configArg = value
    else targetArg = value
    i += 1
    continue
  }
  if (token === '--selftest') {
    selftestOnly = true
    continue
  }
  console.error(`unknown argument "${token}" — ${usage}`)
  process.exit(2)
}

const CONFIG_NAME = 'validate.config.json'
const CONFIG_MARKER = '/* mockbird:config-driven:v2 */'
const CONFIG_SEED_HINT = `run setup-design.mjs to seed it (or copy skills/design/assets/${CONFIG_NAME} from the skill folder)`
const STABILITY_RUNS = 10
const RUN_TIMEOUT_MS = 60000 // bounded: a hung validate run is an R3 failure
const PROBE = fileURLToPath(new URL('./fixtures/ok/config-driven', import.meta.url))
const SELFTEST_ROOT = join(tmpdir(), 'opencode', 'run-task4', `selftest-${process.pid}`)

function configFatal(message, code) {
  console.error(message)
  process.exit(code)
}

function configStringArray(parsed, key) {
  const value = parsed[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    configFatal(`${CONFIG_NAME}: "${key}" must be a list of strings`, 2)
  }
  return value
}

function pathExists(target) {
  try {
    statSync(target)
    return true
  } catch {
    return false
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// External config - same file and same discovery chain as validate.mjs.
// File problems (missing, unreadable, invalid JSON) = exit 3 guided; content
// problems (shape, toolchain marker integrity) = exit 2. The R4 marker line is
// printed as soon as the raw bytes exist - it is stdout line 1 in every mode.
// ---------------------------------------------------------------------------
function loadConfig() {
  let configPath = null
  if (configArg !== null) {
    if (!pathExists(configArg)) {
      configFatal(`${configArg}: ${CONFIG_NAME} not found — ${CONFIG_SEED_HINT}`, 3)
    }
    configPath = configArg
  } else {
    const targetDir = resolve(process.cwd(), targetArg.replaceAll('\\', '/').replace(/\/+$/, ''))
    const candidates = [join(targetDir, CONFIG_NAME), join(process.cwd(), CONFIG_NAME)]
    configPath = candidates.find((candidate) => pathExists(candidate)) ?? null
    if (configPath === null) {
      configFatal(`${CONFIG_NAME} not found (checked ${candidates[0]} and ${candidates[1]}) — ${CONFIG_SEED_HINT}`, 3)
    }
  }
  let raw = null
  try {
    raw = readFileSync(configPath)
  } catch {
    configFatal(`${configPath}: cannot read ${CONFIG_NAME} — ${CONFIG_SEED_HINT}`, 3)
  }
  // R4: sha256 over the raw config BYTES.
  console.log(`config: ${CONFIG_NAME}#${createHash('sha256').update(raw).digest('hex')}`)
  let parsed = null
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    configFatal(`${configPath}: ${CONFIG_NAME} is not valid JSON — ${CONFIG_SEED_HINT}`, 3)
  }
  if (!isPlainObject(parsed)) {
    configFatal(`${configPath}: ${CONFIG_NAME} must have a JSON object at its root`, 2)
  }
  return {
    configPath,
    configDir: dirname(resolve(configPath)),
    exemptFiles: configStringArray(parsed, 'exemptFiles'),
    exemptDirs: configStringArray(parsed, 'exemptDirs'),
    variantKeys: configStringArray(parsed, 'componentVariantKeys'),
    toolchain: configStringArray(parsed, 'toolchainScripts'),
  }
}

// ---------------------------------------------------------------------------
// R2: pre-config scripts are rejected here. Same rule and same messages as
// validate.mjs: entries resolve relative to the config file's directory and
// every entry must carry the config marker.
// ---------------------------------------------------------------------------
function checkToolchain(config) {
  for (const entry of config.toolchain) {
    const full = resolve(config.configDir, entry)
    let content = null
    try {
      content = readFileSync(full, 'utf8')
    } catch {
      configFatal(`toolchainScripts: ${full} not found (entries resolve relative to ${config.configDir})`, 2)
    }
    if (!content.includes(CONFIG_MARKER)) {
      configFatal(`toolchainScripts: ${full} lacks the ${CONFIG_MARKER} marker (pre-config script?)`, 2)
    }
  }
}

/** The validate script that qa drives: the toolchainScripts entry named
 * validate.mjs (the config names the toolchain), with the two-layout fallback
 * used by validate.mjs itself (side-by-side pack / scripts/ install). */
function findValidateScript(config) {
  for (const entry of config.toolchain) {
    if (basename(entry) === 'validate.mjs') return resolve(config.configDir, entry)
  }
  for (const rel of ['./validate.mjs', '../validate.mjs']) {
    const full = fileURLToPath(new URL(rel, import.meta.url))
    if (existsSync(full)) return full
  }
  configFatal(`validate.mjs not found (checked ${CONFIG_NAME} toolchainScripts, ./validate.mjs and ../validate.mjs)`, 2)
}

/** One bounded validate invocation. A run that errors, times out or dies on a
 * signal never certifies anything (R3). */
function runValidate(validateScript, configPathArg, targetArgStr, cwdDir) {
  return spawnSync(process.execPath, [validateScript, '--config', configPathArg, targetArgStr], {
    cwd: cwdDir,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  })
}

function runIncomplete(run) {
  return run.error !== undefined || run.signal !== null || run.status === null
}

/** Behavior signature: exit code + stdout minus the `config: <path>` echo +
 * stderr. The echo line names the config FILE path; A and B are different files
 * by construction, so leaving it in would mask "identical behavior". */
function behaviorSignature(run) {
  const stripped = String(run.stdout)
    .split('\n')
    .filter((line) => !line.startsWith('config: '))
    .join('\n')
  return JSON.stringify([run.status, stripped, String(run.stderr)])
}

// ---------------------------------------------------------------------------
// R1 selftest: probe fixture under config A vs config B (exemptDirs flip on
// ".history"). A hides the probe's .history/01-s.html (exempt), B walks it and
// must flag its remote URL. Identical behavior = the config does not drive
// behavior = exit 2. Temp rig lives under /tmp/opencode/run-task4 and is
// removed before returning (pid subdir: concurrent runs never clobber it).
// ---------------------------------------------------------------------------
function runSelftest(config, validateScript) {
  if (!pathExists(PROBE)) {
    configFatal(`selftest: probe fixture ${PROBE} not found — the QA rig is incomplete`, 2)
  }
  rmSync(SELFTEST_ROOT, { recursive: true, force: true })
  mkdirSync(join(SELFTEST_ROOT, 'r1'), { recursive: true })
  cpSync(PROBE, join(SELFTEST_ROOT, 'r1', 'config-driven'), { recursive: true })
  const base = {
    exemptFiles: config.exemptFiles,
    componentVariantKeys: config.variantKeys,
    toolchainScripts: config.toolchain.map((entry) => resolve(config.configDir, entry)),
  }
  const configA = { ...base, exemptDirs: [...new Set([...config.exemptDirs, '.history'])] }
  const configB = { ...base, exemptDirs: config.exemptDirs.filter((dir) => dir !== '.history') }
  const pathA = join(SELFTEST_ROOT, 'configA.json')
  const pathB = join(SELFTEST_ROOT, 'configB.json')
  writeFileSync(pathA, `${JSON.stringify(configA, null, 2)}\n`, 'utf8')
  writeFileSync(pathB, `${JSON.stringify(configB, null, 2)}\n`, 'utf8')
  const runA = runValidate(validateScript, pathA, 'config-driven', join(SELFTEST_ROOT, 'r1'))
  const runB = runValidate(validateScript, pathB, 'config-driven', join(SELFTEST_ROOT, 'r1'))
  const incomplete = [runA, runB].findIndex(runIncomplete)
  const identical = behaviorSignature(runA) === behaviorSignature(runB)
  rmSync(SELFTEST_ROOT, { recursive: true, force: true })
  if (incomplete >= 0) {
    configFatal(`selftest: probe run ${incomplete === 0 ? 'A' : 'B'} did not complete — bounded runs required`, 4)
  }
  if (identical) {
    configFatal(
      `selftest: config A vs config B produced identical behavior — the config does not drive behavior (R1)\n` +
        `--- run A (exit ${runA.status}) ---\n${runA.stdout}${runA.stderr}` +
        `--- run B (exit ${runB.status}) ---\n${runB.stdout}${runB.stderr}`,
      2,
    )
  }
  console.log('selftest: config A vs config B produce different behavior — ok')
}

const config = loadConfig()
checkToolchain(config)
const validateScript = findValidateScript(config)
runSelftest(config, validateScript)
if (selftestOnly) process.exit(0)

// Default mode: validate on the target (displayed) + R3 stability over 10 runs.
const configForward = configArg ?? config.configPath
const runs = []
for (let i = 0; i < STABILITY_RUNS; i += 1) {
  const run = runValidate(validateScript, configForward, targetArg, process.cwd())
  if (runIncomplete(run)) {
    configFatal(
      `stability: validate run #${i + 1} did not complete (${run.error?.message ?? run.signal}) — bounded runs required (R3)`,
      4,
    )
  }
  runs.push(run)
}
const first = runs[0]
process.stdout.write(first.stdout)
if (first.stderr) process.stderr.write(first.stderr)
const signature = behaviorSignature(first)
const divergent = runs
  .map((run, index) => (behaviorSignature(run) === signature ? null : index + 1))
  .filter((index) => index !== null)
if (divergent.length > 0) {
  configFatal(
    `stability: run(s) #${divergent.join(', #')} differ from run #1 of ${STABILITY_RUNS} — unstable (R3)`,
    4,
  )
}
console.log(`stability: ${STABILITY_RUNS}/${STABILITY_RUNS} identical validate runs — ok`)
if (first.status !== 0) process.exit(first.status)
