#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "./fetch.js";
import { diffSubprocessors, formatDiff, isEmptyDiff } from "./diff.js";

const USAGE = "usage: subprocessors-json validate <url|file>\n       subprocessors-json diff [--json] <before url|file> <after url|file>";

export async function run(argv: string[], fetchImpl: typeof fetch = fetch): Promise<0 | 1 | 2> {
  const [cmd, ...rest] = argv;
  const json = rest.includes("--json");
  const args = rest.filter((a) => a !== "--json");
  if (cmd === "validate" && args.length === 1) {
    const r = await loadSnapshot(args[0]!, fetchImpl);
    if (!r.ok) { console.error(`INVALID: ${r.error}`); return 1; }
    console.log(`OK: ${r.value.publisher.name} — ${r.value.subprocessors.length} sub-processor(s)`);
    return 0;
  }
  if (cmd === "diff" && args.length === 2) {
    const [b, a] = await Promise.all([loadSnapshot(args[0]!, fetchImpl), loadSnapshot(args[1]!, fetchImpl)]);
    if (!b.ok) { console.error(`INVALID (before): ${b.error}`); return 2; }
    if (!a.ok) { console.error(`INVALID (after): ${a.error}`); return 2; }
    const d = diffSubprocessors(b.value, a.value);
    console.log(json ? JSON.stringify(d, null, 2) : formatDiff(d));
    return isEmptyDiff(d) ? 0 : 1; // like diff(1): 1 = differences found
  }
  console.error(USAGE);
  return 2;
}

function isEntryPoint(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}
if (isEntryPoint()) run(process.argv.slice(2)).then((c) => process.exit(c));
