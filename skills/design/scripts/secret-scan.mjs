#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
try { const text=execFileSync('git',['grep','-nE','sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|api_key[=:][[:space:]]*[A-Za-z0-9_-]{12,}','--',':!**/*.test.mjs',':!skills/design/assets/vendor/**'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}); if(text){console.error(`secret-scan: ${text}`);process.exit(1)} } catch(e) { if(e.status!==1) throw e } console.log('secret-scan: clean')
