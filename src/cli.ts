#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "./fetch.js";
import { createEgressGuard } from "./guard.js";
import { diffSubprocessors, formatDiff, isEmptyDiff } from "./diff.js";

const USAGE = "usage: subprocessors-json validate <url|file>\n       subprocessors-json diff [--json] <before url|file> <after url|file>\n       subprocessors-json check-egress [--json] [--category <c>] [--allow-host <h>]... <url|file> <destination url>";

export async function run(argv: string[], fetchImpl: typeof fetch = fetch): Promise<0 | 1 | 2> {
  const [cmd, ...rest] = argv;
  if (cmd === "check-egress") return checkEgress(rest, fetchImpl);
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

/** Exit 0 = destination allowed, 1 = denied, 2 = usage error / invalid document. */
async function checkEgress(argv: string[], fetchImpl: typeof fetch): Promise<0 | 1 | 2> {
  let json = false;
  let category: string | undefined;
  const allowHosts: string[] = [];
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") json = true;
    else if (a === "--category" || a === "--allow-host") {
      const v = argv[++i];
      if (v === undefined) { console.error(USAGE); return 2; }
      if (a === "--category") category = v; else allowHosts.push(v);
    } else pos.push(a);
  }
  if (pos.length !== 2) { console.error(USAGE); return 2; }
  const r = await loadSnapshot(pos[0]!, fetchImpl);
  if (!r.ok) { console.error(`INVALID: ${r.error}`); return 2; }
  let d;
  try {
    const guard = createEgressGuard(r.value, { mode: "enforce", allowHosts });
    d = guard.check(pos[1]!, category === undefined ? {} : { dataCategory: category });
  } catch (e) { console.error(`ERROR: ${(e as Error).message}`); return 2; }
  if (json) console.log(JSON.stringify(d.event));
  else console.log(`${d.allowed ? "ALLOWED" : "DENIED"}: ${d.event.url_host ?? "(unparseable)"} — ${d.reason}${d.processor ? ` (${d.processor.id})` : ""}`);
  return d.allowed ? 0 : 1;
}

function isEntryPoint(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}
if (isEntryPoint()) run(process.argv.slice(2)).then((c) => process.exit(c));
