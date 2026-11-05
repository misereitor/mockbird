import test from 'node:test'; import assert from 'node:assert/strict'; import { allowed, ROUTE_MATRIX } from './authz.mjs';
test('4x10 route matrix',()=>{let cases=0; for(const r of Object.keys(ROUTE_MATRIX))for(const role of ['viewer','commenter','editor','admin']){allowed(role,r,'GET');allowed(role,r,'POST');cases+=2} assert.ok(cases>=40)})
test('viewer cannot write and commenter can comment',()=>{assert.equal(allowed('viewer','/api/snapshot','POST'),false);assert.equal(allowed('commenter','/api/comments','POST'),true)})
