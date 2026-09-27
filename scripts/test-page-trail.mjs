import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
let slots=[], index=0, effects=[], restored, callbacks=[];
const listeners={};
globalThis.window={scrollY:0,scrollTo({top}){this.scrollY=top;},addEventListener(type,fn){listeners[type]=fn;},removeEventListener(){}};
globalThis.requestAnimationFrame=fn=>callbacks.push(fn);
globalThis.__trailHooks={
 useRef(value){const i=index++;return slots[i]??(slots[i]={current:value});},
 useState(value){const i=index++;if(slots[i]===undefined)slots[i]=value;return [slots[i],v=>{slots[i]=v;}];},
 useLayoutEffect(fn,deps){const i=index++;const before=slots[i];if(!before||deps.some((v,j)=>v!==before[j]))effects.push(fn);slots[i]=deps;}
};
const source=fs.readFileSync('src/lib/usePageTrail.ts','utf8').replace("import { useLayoutEffect, useRef, useState } from 'react';","const { useLayoutEffect, useRef, useState } = globalThis.__trailHooks;");
const {usePageTrail}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64'));
function render(key,scope='owner-a'){index=0;effects=[];const trail=usePageTrail(key,{key},v=>{restored=v;},scope);effects.forEach(fn=>fn());return trail;}
const scroll=top=>{window.scrollY=top;listeners.scroll();};
const flush=()=>{while(callbacks.length)callbacks.shift()();};
render('home');scroll(120);render('library');scroll(630);render('pilot:A');scroll(200);render('indexes');
let trail=render('indexes');trail.back();assert.equal(restored.key,'pilot:A');render(restored.key);flush();assert.equal(window.scrollY,200);
trail=render('pilot:A');trail.back();assert.equal(restored.key,'library');render(restored.key);flush();assert.equal(window.scrollY,630);
trail=render('library');trail.back();assert.equal(restored.key,'home');render(restored.key);flush();assert.equal(window.scrollY,120);
assert.equal(render('home').canBack,false);
render('pilot:B');render('home','owner-b');assert.equal(render('home','owner-b').canBack,false);
render('library','owner-b');render('home',null);assert.equal(render('home',null).canBack,false);
console.log('Page trail: repeated back, book context, scroll restoration, account change and sign-out reset passed.');
