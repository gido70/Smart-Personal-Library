import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

const checks = [
  ["complete-state calculation", "const audioIsComplete = expectedAudioParts > 0 && audioUrls.length >= expectedAudioParts;"],
  ["saved-audio mobile action", 'audioIsComplete ? (rtl ? "تشغيل الصوت المحفوظ" : "Play saved audio")'],
  ["playback-only branch", "{audioIsComplete ? ("],
  ["saved audio heading", 'rtl ? "الصوت المحفوظ" : "Saved audio"'],
  ["saved players", "saved-audio-only"],
];

for (const [label, expected] of checks) {
  if (!app.includes(expected)) throw new Error(`Missing ${label}`);
}

console.log("Audio-complete UI verification passed.");
