#!/usr/bin/env node
/**
 * Fixture: a restored PRE-config sync-components stub (no config-driven
 * marker - hardcoded exempt dirs again). setup-design.mjs --update must
 * replace it with the config-driven copy and list it on stdout.
 */
const EXEMPT_DIRS = ['vendor', 'scripts', 'snapshots', '.history']

console.log(`legacy sync-components (hardcoded exempt dirs: ${EXEMPT_DIRS.join(', ')})`)
