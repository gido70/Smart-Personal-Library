import assert from 'node:assert/strict';
import { readerPagePlan, readerNetworkOptions } from '../src/lib/readerLoading.ts';
assert.equal(readerNetworkOptions.disableStream, true);
assert.equal(readerNetworkOptions.disableAutoFetch, true);
assert.equal(readerNetworkOptions.rangeChunkSize, 262144);
assert.deepEqual(readerPagePlan(1,244,true,false), {visible:[1],nearby:[2]});
assert.deepEqual(readerPagePlan(10,244,true,false), {visible:[10],nearby:[11,9]});
assert.deepEqual(readerPagePlan(10,244,false,false), {visible:[10],nearby:[11,9]});
assert.deepEqual(readerPagePlan(1,244,true,true), {visible:[1,2],nearby:[4,3]});
for(const count of [1,2,3,244,245]) for(const reverse of [false,true]) for(const spread of [false,true]) {
  for(let page=1;page<=count;page++) {
    const {visible,nearby}=readerPagePlan(page,count,reverse,spread);
    assert.equal(visible[0],page);
    const all=[...visible,...nearby];
    assert.equal(new Set(all).size,all.length);
    assert.ok(all.length<=(spread?6:3));
    assert.ok(all.every(n=>n>=1 && n<=count));
    if(page<count)assert.ok(all.includes(page+1));
    if(page>1)assert.ok(all.includes(page-1));
  }
}
console.log('PASS: requested sheet first; adjacent pages only; RTL/LTR, odd/even spreads and boundaries; range-only reader configuration.');
