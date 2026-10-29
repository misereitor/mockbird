#!/usr/bin/env node
/**
 * Fixture: a restored PRE-config validator stub. The exempt lists were
 * hardcoded here, before validate.config.json existed. This file is missing
 * the config-driven marker ON PURPOSE - the QA wrapper (qa.mjs, R2) must
 * reject it as a pre-config script (exit 2).
 */
const EXEMPT_DIRS = ['vendor', 'scripts', 'snapshots', '.history']

console.log(`legacy validate (hardcoded exempt dirs: ${EXEMPT_DIRS.join(', ')})`)
