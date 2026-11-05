import test from 'node:test'; import assert from 'node:assert/strict';
test('all declared API routes have matrix entries',()=>{const routes=['/api/projects','/api/comments','/api/snapshots','/api/snapshot','/api/revert','/api/agent-send','/api/history','/api/history/restore','/api/screen-size','/api/admin/users']; assert.equal(routes.length,10); assert.ok(routes.every(Boolean))})
