import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareUpload } from '../src/lib/uploadPreparation.ts';

const bytes = new TextEncoder().encode('%PDF-test');
const expected = createHash('sha256').update(bytes).digest('hex');
let reads = 0;
let destroyed = 0;
const stages = [];
const source = { arrayBuffer: async () => { reads++; return bytes.slice().buffer; } };
const result = await prepareUpload(source, (input) => {
  // Match the worker's transferable-buffer ownership, not a text assertion.
  structuredClone(input.buffer, { transfer: [input.buffer] });
  return { promise: Promise.resolve({ numPages: 700, getMetadata: async () => ({ info: { Title: 'Test' } }) }), destroy: async () => { destroyed++; } };
}, (stage) => stages.push(stage));
assert.equal(reads, 1);
assert.equal(result.contentHash, expected);
assert.equal(result.inspection.pageCount, 700);
assert.equal(destroyed, 1);
assert.deepEqual(stages, ['reading', 'hashing', 'inspecting']);

const hung = await prepareUpload(source, () => ({ promise: new Promise(() => {}), destroy: async () => { destroyed++; } }), () => {}, 10);
assert.equal(hung.inspection.pageCount, null);
assert.equal(hung.contentHash, expected);
assert.equal(destroyed, 2);
await assert.rejects(prepareUpload(source, () => ({ promise: Promise.reject(new Error('Invalid PDF')), destroy: async () => { destroyed++; } })), /Invalid PDF/);
assert.equal(destroyed, 3);
const metadataHang = await prepareUpload(source, () => ({ promise: Promise.resolve({ numPages: 1, getMetadata: () => new Promise(() => {}) }), destroy: async () => { destroyed++; } }), () => {}, 10);
assert.equal(metadataHang.inspection.pageCount, null);
assert.equal(destroyed, 4);
console.log('PASS: one read, hash before detachment, stage order, 700 pages, cleanup, timeout fallback, invalid PDF, metadata timeout');

// Real parser test: a valid 101 MB PDF with a single blank page. No network,
// credentials, rendering, user data, or paid API involved.
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const parts = [Buffer.from('%PDF-1.7\n'), Buffer.alloc(101_000_000, 32), Buffer.from('\n')];
const offsets = [0];
let length = parts.reduce((sum, part) => sum + part.length, 0);
for (const object of [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
]) {
  offsets.push(length);
  const chunk = Buffer.from(`${offsets.length - 1} 0 obj\n${object}\nendobj\n`);
  parts.push(chunk); length += chunk.length;
}
parts.push(Buffer.from(`xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
const file = new Blob(parts, { type: 'application/pdf' });
const expectedRealHash = createHash('sha256');
for (const part of parts) expectedRealHash.update(part);
const real = await prepareUpload(file, (data) => pdfjs.getDocument({ data, disableFontFace: true }));
assert.equal(real.contentHash, expectedRealHash.digest('hex'));
assert.equal(real.inspection.pageCount, 1);
console.log(`PASS: real pdf.js parse/hash/cleanup of ${file.size} bytes`);
