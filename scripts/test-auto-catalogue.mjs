import assert from 'node:assert/strict';
import { buildIntakeCatalogue, suggestClassification } from '../src/lib/autoCatalogue.ts';
const cip='باهـمام ، أحمد سالم عمر\nعنوان الكتاب /\nباهـمام ، أحمد سالم عمر .- الرياض ، 1447\nردمك: 123';
const book=buildIntakeCatalogue('قصتي مع النوم',{},[{page:4,text:cip}]);
assert.equal(book.author,'باهـمام، أحمد سالم عمر'.replace('ـ',''));
assert.equal(book.dewey_branch,'610');
assert.equal(book.author_evidence.page,4);
assert.equal(buildIntakeCatalogue('Physics',{Author:'Jane Smith'}).author,'Jane Smith');
assert.equal(buildIntakeCatalogue('Novel',{Author:'Adobe InDesign'}).author,undefined);
assert.equal(buildIntakeCatalogue('Untitled',{},[{page:1,text:'Dedicated to John Smith'}]).author,undefined);
assert.equal(buildIntakeCatalogue('Book',{},[{page:2,text:'By\nJane Smith'}]).author,'Jane Smith');
assert.deepEqual(suggestClassification('الطبعة الأولى'),{});
assert.equal(suggestClassification('علم المكتبات').dewey_branch,'020');
assert.equal(suggestClassification('Physics').dewey_branch,'530');
assert.equal(buildIntakeCatalogue('Untitled',{}).catalogue_status,'needs-review');
console.log('PASS: provenance, CIP author, labelled author, unknown/creator rejection, category discrimination');

assert.equal(suggestClassification('‎⁨كتاب قصتي مع النوم- No.01⁩').dewey_branch, '610');
