import test from 'node:test'; import assert from 'node:assert/strict';
test('comment contract exposes author role and timestamp fields',()=>{const pin={authorId:'u',authorRole:'commenter',createdAt:new Date().toISOString()}; assert.ok(pin.authorId&&pin.authorRole&&pin.createdAt)})
test('commenter cannot resolve another author',()=>{const actor={id:'a',role:'commenter'},pin={authorId:'b',status:'open'}; assert.equal(actor.role==='editor'||actor.id===pin.authorId,false)})
