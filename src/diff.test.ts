import { describe, it, expect } from "vitest";
import { diffSubprocessors, isEmptyDiff, formatDiff } from "./diff.js";
import { base } from "./test-helpers.js";

describe("diff", () => {
  it("negative control: identical snapshots are empty, order ignored", () => {
    const a = base(); const b = base(); b.subprocessors.reverse();
    expect(isEmptyDiff(diffSubprocessors(a, b))).toBe(true);
    expect(formatDiff(diffSubprocessors(a, b))).toBe("No changes.");
  });
  it("updatedAt alone is not a change", () => {
    const b = base(); b.updatedAt = "2027-01-01T00:00:00.000Z";
    expect(isEmptyDiff(diffSubprocessors(base(), b))).toBe(true);
  });
  it("detects added, removed and changed", () => {
    const b = base();
    b.subprocessors = b.subprocessors.filter((s) => s.id !== "b");
    b.subprocessors[0]!.location = "US";
    b.subprocessors.push({ id: "c", name: "OpenAI", purpose: "LLM", category: "ai", location: "US", status: "scheduled", effectiveFrom: "2026-12-01" });
    const d = diffSubprocessors(base(), b);
    expect(d.added.map((s) => s.id)).toEqual(["c"]);
    expect(d.removed.map((s) => s.id)).toEqual(["b"]);
    expect(d.changed).toEqual([{ id: "a", name: "Vercel", changes: [{ field: "location", from: "EU", to: "US" }] }]);
    expect(formatDiff(d)).toContain("+ OpenAI");
    expect(formatDiff(d)).toContain("- Resend");
    expect(formatDiff(d)).toContain('location: "EU" -> "US"');
  });
  it("detects a dpaUrl removed", () => {
    const b = base(); delete b.subprocessors[0]!.dpaUrl;
    expect(diffSubprocessors(base(), b).changed[0]!.changes[0]!.field).toBe("dpaUrl");
  });
});
