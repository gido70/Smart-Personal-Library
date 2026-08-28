import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const expected = new Map([
  ["src/globals.css", "4f089afa839a2964f3d1ac86c891a2ce261c56f160687fbb5ec518b5e0e358dc"],
  ["src/reader.css", "ba30d6563960868b2ac44718f6a34ef01f0f648bbb505c61541b6804bb1bf652"],
  ["src/pilot.css", "48d2bcc4296d54713d520546ef4d29896a5a6ac13e84ab932c2379dfbf688cad"],
]);

let failed = false;
for (const [file, digest] of expected) {
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  const ok = actual === digest;
  console.log(`${ok ? "PASS" : "FAIL"}  V0.10.2 visual baseline: ${file}`);
  if (!ok) failed = true;
}

const entry = readFileSync("src/main.tsx", "utf8");
const legacyEntry = /import App from "\.\/App"/.test(entry) && /<App\s*\/>/.test(entry) && !/AppV11/.test(entry);
console.log(`${legacyEntry ? "PASS" : "FAIL"}  V0.10.3 still renders the accepted V0.10.2 application`);
if (!legacyEntry) failed = true;

if (failed) process.exit(1);
