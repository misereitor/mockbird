import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('skills synchronization contract is green', () => {
  const out = execFileSync(process.execPath, ['skills/sync-check.mjs'], { encoding: 'utf8' });
  assert.match(out, /5 schemas checked/);
  assert.match(out, /0 broken paths/);
  assert.match(out, /craft↔taste coherent/);
});
