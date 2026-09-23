import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the transfer wrapper without browser automation or remote writes.
let current, behavior, aborted;
class Upload {
  constructor(file, options) { current = options; }
  start() { behavior(current); }
  async abort() { aborted++; }
}
const exports = {};
const compiled = ts.transpileModule(fs.readFileSync('src/lib/bookUpload.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(compiled, { exports, require: () => ({ Upload }), URL, setTimeout, clearTimeout });
const options = { baseUrl: 'https://example.supabase.co', storagePath: 'owner/book/book.pdf', upsert: false, getAccessToken: async () => 'test-token', idleTimeoutMs: 50 };
assert.equal(exports.resumableEndpoint(options.baseUrl), 'https://example.storage.supabase.co/storage/v1/upload/resumable');
for (const [status, code] of [[413, 'BOOK_STORAGE_SIZE_LIMIT'], [403, 'BOOK_UPLOAD_AUTH'], [500, 'BOOK_UPLOAD_FAILED']]) {
  aborted = 0;
  behavior = o => o.onError({ originalResponse: { getStatus: () => status } });
  await assert.rejects(exports.uploadBookChunks({}, options), new RegExp(code));
  assert.equal(aborted, 1);
}
behavior = () => {};
aborted = 0;
await assert.rejects(exports.uploadBookChunks({}, { ...options, idleTimeoutMs: 5 }), /BOOK_UPLOAD_STALLED/);
assert.equal(aborted, 1);
const progress = [];
behavior = o => { o.onProgress(50, 100); o.onSuccess(); };
await exports.uploadBookChunks({}, { ...options, onProgress: p => progress.push(p.percent) });
assert.deepEqual(progress, [0, 50, 100]);
assert.equal(current.chunkSize, 6 * 1024 * 1024);
assert.equal(current.storeFingerprintForResuming, false);
const headers = {};
// Start a fresh in-flight request to verify its auth hook before settlement.
behavior = () => {};
const pending = exports.uploadBookChunks({}, options);
await current.onBeforeRequest({ setHeader: (key, value) => { headers[key] = value; } });
assert.equal(headers.Authorization, 'Bearer test-token');
current.onSuccess();
await pending;
console.log('PASS: real progress, 6 MiB chunks, auth header, 413 classification, denied upload, failed upload, idle abort');
