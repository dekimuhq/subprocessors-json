import { subprocessorsDocSchema, type SubprocessorsDoc } from "./schema.js";

export type ParseResult = { ok: true; value: SubprocessorsDoc } | { ok: false; error: string };

export function parseSubprocessors(input: unknown): ParseResult {
  const r = subprocessorsDocSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  const error = r.error.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error };
}

export function parseSubprocessorsText(text: string): ParseResult {
  let json: unknown;
  try { json = JSON.parse(text); } catch (e) { return { ok: false, error: `not JSON: ${(e as Error).message}` }; }
  return parseSubprocessors(json);
}
