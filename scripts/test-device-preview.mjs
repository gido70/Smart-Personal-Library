import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = fs.readFileSync('public/device-preview.html', 'utf8');
function element(dataset = {}) {
  return {dataset, style:{}, attributes:{}, handlers:{}, clientWidth:1000, clientHeight:800,
    setAttribute(k,v){this.attributes[k]=v;}, addEventListener(k,v){this.handlers[k]=v;},
    querySelector(){return this;}};
}
for (const search of ['', '?lang=en']) {
  const ids=Object.fromEntries(['heading','back','rotate','actual','notice','devices','library','stage','frame','status'].map(id=>[id,element()]));
  let navigations=0;
  Object.defineProperty(ids.library,'src',{set(){navigations++;}});
  const buttons=['phone','tablet','desktop'].map(device=>element({device}));
  const document={documentElement:{},getElementById:id=>ids[id],querySelectorAll:()=>buttons};
  const window={addEventListener(){}};
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],{document,window,location:{search},URLSearchParams});
  assert.equal(ids.library.style.width,'390px');
  buttons[1].handlers.click();assert.equal(ids.library.style.width,'820px');
  ids.rotate.handlers.click();assert.equal(ids.library.style.width,'1180px');
  buttons[2].handlers.click();assert.equal(ids.library.style.width,'1440px');
  ids.actual.handlers.click();assert.equal(ids.library.style.transform,'scale(1)');
  assert.equal(navigations,0,'device controls must not reload the embedded app');
  assert.equal(buttons[2].attributes['aria-pressed'],'true');
}
console.log('Device preview: sizes, rotation, actual size, selection and no iframe reload passed (Arabic/English).');
