import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { patchPageFlipLifecycle } from './pageFlipLifecyclePatch.ts';
const source=readFileSync('node_modules/page-flip/dist/js/page-flip.module.js','utf8');
const patched=patchPageFlipLifecycle(source);
assert.throws(()=>patchPageFlipLifecycle('changed upstream'),/Review/);
// Exercise the patched render loop with a fake animation-frame scheduler.
let next=1;const frames=new Map();
const requestAnimationFrame=fn=>{const id=next++;frames.set(id,fn);return id;};
const cancelAnimationFrame=id=>frames.delete(id);
const body=patched.slice(patched.indexOf('start(){'),patched.indexOf('startAnimation(',patched.indexOf('start(){')));
const Render=new Function('requestAnimationFrame','cancelAnimationFrame',`return class {update(){} render(){} ${body}}`)(requestAnimationFrame,cancelAnimationFrame);
const render=new Render(); render.start(); assert.equal(frames.size,1);
const [id,fn]=[...frames][0];frames.delete(id);fn(1);assert.equal(frames.size,1);
render.stop();assert.equal(frames.size,0);fn(2);assert.equal(frames.size,0);
console.log('PASS: pinned page-flip animation loop stops on cleanup; stale callback cannot restart it.');

// A left-corner button/drag must work on the single visible portrait sheet.
const cornerStart=patched.indexOf('isPointOnCorners(t){');
const cornerEnd=patched.indexOf('}}class',cornerStart)+1;
const Corners=new Function(`return class {${patched.slice(cornerStart,cornerEnd)}}`)();
const corners=new Corners();
corners.getBoundsRect=()=>({pageWidth:300,width:600,height:420});
corners.render={getOrientation:()=>"portrait",convertToBook:p=>({x:p.x+300,y:p.y})};
assert.equal(corners.isPointOnCorners({x:10,y:418}),true);
assert.equal(corners.isPointOnCorners({x:290,y:418}),true);
assert.equal(corners.isPointOnCorners({x:150,y:210}),false);
corners.render={getOrientation:()=>"landscape",convertToBook:p=>p};
assert.equal(corners.isPointOnCorners({x:10,y:418}),true);
assert.equal(corners.isPointOnCorners({x:300,y:418}),false);
console.log('PASS: visible left/right corners work in portrait; centre stays non-flipping.');
