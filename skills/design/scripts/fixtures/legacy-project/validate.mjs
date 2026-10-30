#!/usr/bin/env node
/**
 * Fixture: a restored PRE-config validator (the R2 threat, §13.2). The exempt
 * dirs are HARDCODED here - this file predates validate.config.json and the
 * config-driven marker is missing ON PURPOSE. setup-design.mjs --update must
 * replace it with the config-driven copy and list the replacement on stdout.
 */
const EXEMPT_DIRS = ['vendor', 'scripts', 'snapshots']

console.log(`legacy validate (hardcoded exempt dirs: ${EXEMPT_DIRS.join(', ')})`)
