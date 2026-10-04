// Study data export: one CSV per instrument (participants as rows, item codes as columns, in instrument order),
// a codebook (data dictionary), and the formative feedback. UTF-8 with BOM so Arabic opens correctly in Excel.
type Item = { code: string; type: string; text: string | null; text_en?: string; options?: string[]; scale?: { min: number; max: number; labels: string[] }; reverse?: boolean; attention?: number; required?: boolean; show_if?: unknown };
type Def = { title?: string; sections: { title: string; items?: Item[]; source?: { name: string; cite?: string }[] }[] };
export type InstRowX = { key: string; version: string; definition: Def };
export type RespX = { participant_id: string; instrument_key: string; instrument_version: string; attention_passed: boolean | null; submitted_at: string; started_at: string | null; answers: Record<string, unknown> };
export type PartX = { id: string; code: string; is_test: boolean; status: string; consent_version: string | null; book_pages: number | null; ai_approved_at: string | null; reward_granted_at: string | null };

const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join(" | ") : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows: unknown[][]) => "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n");

export function download(name: string, csv: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function itemsOf(def: Def | undefined) { return (def?.sections ?? []).flatMap((s) => s.items ?? []); }

export function instrumentCsv(key: string, insts: InstRowX[], resps: RespX[], parts: PartX[], includeTests: boolean) {
  const rs = resps.filter((r) => r.instrument_key === key);
  const versions = [...new Set(rs.map((r) => r.instrument_version))];
  const def = insts.find((i) => i.key === key && i.version === (versions[0] ?? "")) ?? insts.find((i) => i.key === key);
  const codes: string[] = [];
  for (const it of itemsOf(def?.definition)) { codes.push(it.code); if (rs.some((r) => `${it.code}_OTHER` in r.answers)) codes.push(`${it.code}_OTHER`); }
  for (const r of rs) for (const k of Object.keys(r.answers)) if (!codes.includes(k)) codes.push(k); // answers from other versions
  const head = ["participant", "is_test", "status", "consent_version", "instrument_version", "started_at", "submitted_at", "duration_min", "attention_passed", ...codes];
  const rows: unknown[][] = [head];
  for (const r of rs) {
    const p = parts.find((x) => x.id === r.participant_id);
    if (!p || (!includeTests && p.is_test)) continue;
    const dur = r.started_at ? Math.round((new Date(r.submitted_at).getTime() - new Date(r.started_at).getTime()) / 6000) / 10 : "";
    rows.push([p.code, p.is_test ? 1 : 0, p.status, p.consent_version, r.instrument_version, r.started_at, r.submitted_at, dur, r.attention_passed === null ? "" : r.attention_passed ? 1 : 0, ...codes.map((c) => r.answers[c])]);
  }
  return { csv: toCsv(rows), n: rows.length - 1 };
}

export function codebookCsv(insts: InstRowX[]) {
  const rows: unknown[][] = [["instrument", "version", "section", "code", "text", "type", "options_or_scale", "reverse", "attention_expected", "required", "conditional", "source"]];
  for (const i of insts) for (const s of i.definition.sections ?? []) for (const it of s.items ?? []) {
    const opt = it.options ? it.options.join(" | ") : it.scale ? `${it.scale.min}-${it.scale.max}: ${it.scale.labels.filter(Boolean).join(" … ")}` : "";
    rows.push([i.key, i.version, s.title, it.code, it.text ?? it.text_en ?? "", it.type, opt, it.reverse ? 1 : 0, it.attention ?? "", it.required === false ? 0 : 1, it.show_if ? JSON.stringify(it.show_if) : "", (s.source ?? []).map((x) => x.name).join("; ")]);
  }
  return toCsv(rows);
}
