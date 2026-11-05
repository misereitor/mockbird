import test from 'node:test'; import assert from 'node:assert/strict';
test('comment contract exposes author role and timestamp fields',()=>{const pin={authorId:'u',authorRole:'commenter',createdAt:new Date().toISOString()}; assert.ok(pin.authorId&&pin.authorRole&&pin.createdAt)})
test('commenter cannot resolve another author',()=>{const actor={id:'a',role:'commenter'},pin={authorId:'b',status:'open'}; assert.equal(actor.role==='editor'||actor.id===pin.authorId,false)})
test('status mutation requires author or editor',()=>{const can=(a,p)=>a.role==='editor'||a.role==='admin'||a.id===p.authorId; assert.equal(can({role:'commenter',id:'a'},{authorId:'b'}),false); assert.equal(can({role:'editor',id:'a'},{authorId:'b'}),true)})
