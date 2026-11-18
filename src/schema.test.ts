import { describe, it, expect } from "vitest";
import { parseSubprocessors, parseSubprocessorsText } from "./parse.js";
import { base } from "./test-helpers.js";

describe("parse", () => {
  it("accepts a valid document", () => expect(parseSubprocessors(base()).ok).toBe(true));
  it("defaults status to active", () => {
    const d = base(); delete (d.subprocessors[0] as { status?: string }).status;
    const r = parseSubprocessors(d);
    expect(r.ok && r.value.subprocessors[0]!.status).toBe("active");
  });
  it("rejects a wrong format tag", () => expect(parseSubprocessors({ ...base(), format: "x/1" }).ok).toBe(false));
  it("rejects unknown fields (strict)", () => {
    const d = { ...base(), extra: 1 };
    expect(parseSubprocessors(d).ok).toBe(false);
  });
  it("rejects duplicate ids", () => {
    const d = base(); d.subprocessors[1]!.id = "a";
    const r = parseSubprocessors(d);
    expect(!r.ok && r.error).toContain("duplicate id");
  });
  it("requires effectiveFrom when scheduled", () => {
    const d = base(); d.subprocessors[0]!.status = "scheduled";
    expect(parseSubprocessors(d).ok).toBe(false);
    d.subprocessors[0]!.effectiveFrom = "2026-12-01";
    expect(parseSubprocessors(d).ok).toBe(true);
  });
  it("rejects an impossible date", () => {
    const d = base(); d.subprocessors[0]!.effectiveFrom = "2026-02-30";
    expect(parseSubprocessors(d).ok).toBe(false);
  });
  it("rejects a non-http dpaUrl", () => {
    const d = base(); d.subprocessors[0]!.dpaUrl = "javascript:alert(1)";
    expect(parseSubprocessors(d).ok).toBe(false);
  });
  it("rejects unknown category", () => {
    const d = base() as unknown as { subprocessors: { category: string }[] };
    d.subprocessors[0]!.category = "crypto";
    expect(parseSubprocessors(d).ok).toBe(false);
  });
  it("reports non-JSON text", () => expect(parseSubprocessorsText("<html>").ok).toBe(false));
});
