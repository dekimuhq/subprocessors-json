import { describe, it, expect, vi, afterEach } from "vitest";
import { run } from "./cli.js";
import { base } from "./test-helpers.js";

const respond = (map: Record<string, unknown>): typeof fetch =>
  (async (url: string) => map[url] === undefined
    ? new Response("nope", { status: 404 })
    : new Response(JSON.stringify(map[url]), { status: 200 })) as typeof fetch;

afterEach(() => vi.restoreAllMocks());

describe("cli", () => {
  it("validate: ok / invalid / 404", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = respond({ "https://x/ok.json": base(), "https://x/bad.json": { format: "no" } });
    expect(await run(["validate", "https://x/ok.json"], f)).toBe(0);
    expect(await run(["validate", "https://x/bad.json"], f)).toBe(1);
    expect(await run(["validate", "https://x/missing.json"], f)).toBe(1);
  });
  it("diff exit codes: 0 identical, 1 differ, 2 invalid", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const changed = base(); changed.subprocessors.pop();
    const f = respond({ "https://x/a": base(), "https://x/b": changed, "https://x/bad": {} });
    expect(await run(["diff", "https://x/a", "https://x/a"], f)).toBe(0);
    expect(await run(["diff", "https://x/a", "https://x/b"], f)).toBe(1);
    expect(await run(["diff", "https://x/a", "https://x/bad"], f)).toBe(2);
  });
  it("usage error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run([])).toBe(2);
  });
});

// Entry-point trap (agents-txt 0.1.1): under npx the bin is a symlink, and a
// plain argv[1] === import.meta.url compare exited 0 with no output.
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("built bin through a symlink", () => {
  const dist = resolve(__dirname, "../dist/cli.js");
  it("prints OK for a valid file", () => {
    const dir = mkdtempSync(join(tmpdir(), "spj-"));
    const link = join(dir, "subprocessors-json");
    symlinkSync(dist, link);
    writeFileSync(join(dir, "s.json"), JSON.stringify(base()));
    const out = execFileSync("node", [link, "validate", join(dir, "s.json")], { encoding: "utf8" });
    expect(out).toContain("OK: Acme SL");
  });
});
