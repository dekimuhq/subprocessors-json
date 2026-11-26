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
  it("check-egress: exit 0 allowed, 1 denied, 2 usage/invalid; --category and --json", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = base();
    d.subprocessors[0]!.hosts = ["vercel.com", "*.vercel.app"];
    d.subprocessors[1]!.hosts = ["api.resend.com"];
    d.subprocessors[1]!.dataCategories = ["email-address"];
    const f = respond({ "https://x/s.json": d, "https://x/bad.json": {} });
    const S = "https://x/s.json";
    expect(await run(["check-egress", S, "https://vercel.com/a?q=1"], f)).toBe(0);
    expect(await run(["check-egress", S, "https://vercel.com.evil.com/"], f)).toBe(1);
    expect(await run(["check-egress", S, "https://vercel.app/"], f)).toBe(1);
    expect(await run(["check-egress", S, "https://api.resend.com/", "--category", "email-address"], f)).toBe(0);
    expect(await run(["check-egress", S, "https://api.resend.com/", "--category", "payment-card"], f)).toBe(1);
    expect(await run(["check-egress", "--allow-host", "app.example", S, "https://app.example/"], f)).toBe(0);
    expect(await run(["check-egress", "--allow-host", "https://bad", S, "https://app.example/"], f)).toBe(2);
    expect(await run(["check-egress", "https://x/bad.json", "https://vercel.com/"], f)).toBe(2);
    expect(await run(["check-egress", S], f)).toBe(2);
    expect(await run(["check-egress", S, "https://x/", "--category"], f)).toBe(2);
    log.mockClear();
    await run(["check-egress", "--json", S, "https://evil.com/secret?x=1"], f);
    const out = String(log.mock.calls[0]![0]);
    expect(JSON.parse(out)).toMatchObject({ url_host: "evil.com", allowed: false, mode: "enforce" });
    expect(out).not.toContain("secret");
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
  it("check-egress exits 1 on a denied destination (real process exit code)", () => {
    const dir = mkdtempSync(join(tmpdir(), "spj-"));
    const d = base(); d.subprocessors[0]!.hosts = ["vercel.com"];
    writeFileSync(join(dir, "s.json"), JSON.stringify(d));
    expect(execFileSync("node", [dist, "check-egress", join(dir, "s.json"), "https://vercel.com/"], { encoding: "utf8" })).toContain("ALLOWED");
    let status = 0;
    try { execFileSync("node", [dist, "check-egress", join(dir, "s.json"), "https://evil.com/"], { encoding: "utf8", stdio: "pipe" }); }
    catch (e) { status = (e as { status: number }).status; }
    expect(status).toBe(1);
  });
});
