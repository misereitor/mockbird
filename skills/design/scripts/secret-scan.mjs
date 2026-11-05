#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
const text=execFileSync('git',['grep','-nE','sk-[A-Za-z0-9]+|AIza[A-Za-z0-9_-]+|api_key[=:]'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}); if(text){console.error(`secret-scan: ${text}`);process.exit(1)} console.log('secret-scan: clean')
