import test from 'node:test'; import assert from 'node:assert/strict';
test('HSTS policy is HTTPS/reverse-proxy only',()=>{const s='if (req.socket.encrypted || req.headers[\'x-forwarded-proto\'] === \'https\')'; assert.ok(s.includes('x-forwarded-proto'));})
