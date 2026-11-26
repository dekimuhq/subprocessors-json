import type { Subprocessor, SubprocessorsDoc } from "./schema.js";

export interface FieldChange { field: string; from: unknown; to: unknown }
export interface DiffResult {
  added: Subprocessor[];
  removed: Subprocessor[];
  changed: { id: string; name: string; changes: FieldChange[] }[];
}

const FIELDS = ["name", "purpose", "category", "location", "status", "effectiveFrom", "dpaUrl"] as const;

const LISTS = ["hosts", "dataCategories"] as const;
/** Order-insensitive key for the optional list members (proposed extension). */
const norm = (v: string[] | undefined): string | undefined => (v ? JSON.stringify([...v].sort()) : undefined);

/** Compare two snapshots. Entries match on `id`; order never matters. */
export function diffSubprocessors(before: SubprocessorsDoc, after: SubprocessorsDoc): DiffResult {
  const b = new Map(before.subprocessors.map((s) => [s.id, s]));
  const a = new Map(after.subprocessors.map((s) => [s.id, s]));
  const added = after.subprocessors.filter((s) => !b.has(s.id));
  const removed = before.subprocessors.filter((s) => !a.has(s.id));
  const changed: DiffResult["changed"] = [];
  for (const s of after.subprocessors) {
    const old = b.get(s.id);
    if (!old) continue;
    const changes: FieldChange[] = [];
    for (const f of FIELDS) {
      if (old[f] !== s[f]) changes.push({ field: f, from: old[f], to: s[f] });
    }
    for (const f of LISTS) {
      const [o, n] = [norm(old[f]), norm(s[f])];
      if (o !== n) changes.push({ field: f, from: old[f], to: s[f] });
    }
    if (changes.length) changed.push({ id: s.id, name: s.name, changes });
  }
  return { added, removed, changed };
}

export function isEmptyDiff(d: DiffResult): boolean {
  return d.added.length + d.removed.length + d.changed.length === 0;
}

export function formatDiff(d: DiffResult): string {
  if (isEmptyDiff(d)) return "No changes.";
  const out: string[] = [];
  for (const s of d.added) out.push(`+ ${s.name} (${s.category}, ${s.location}) — ${s.purpose}`);
  for (const s of d.removed) out.push(`- ${s.name} (${s.category}, ${s.location})`);
  for (const c of d.changed) {
    out.push(`~ ${c.name}`);
    for (const f of c.changes) out.push(`    ${f.field}: ${JSON.stringify(f.from ?? null)} -> ${JSON.stringify(f.to ?? null)}`);
  }
  return out.join("\n");
}
