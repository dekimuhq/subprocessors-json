import { parseSubprocessorsText, type ParseResult } from "./parse.js";

const MAX_BYTES = 2_000_000;

/** Load a snapshot from an http(s) URL or a local file path. */
export async function loadSnapshot(target: string, fetchImpl: typeof fetch = fetch): Promise<ParseResult> {
  let text: string;
  if (/^https?:\/\//.test(target)) {
    let res: Response;
    try { res = await fetchImpl(target, { headers: { accept: "application/json" }, redirect: "follow" }); }
    catch (e) { return { ok: false, error: `fetch failed: ${(e as Error).message}` }; }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} from ${target}` };
    text = await res.text();
  } else {
    const { readFile } = await import("node:fs/promises");
    try { text = await readFile(target, "utf8"); } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  if (text.length > MAX_BYTES) return { ok: false, error: "document larger than 2 MB" };
  return parseSubprocessorsText(text);
}
