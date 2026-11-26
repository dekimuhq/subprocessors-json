/**
 * Host normalisation and matching shared by the schema (validating `hosts`)
 * and the egress guard. Matching is always on a parsed, normalised host —
 * never substring / startsWith on a URL string.
 */

export type HostPattern =
  | { kind: "exact"; host: string }
  | { kind: "wildcard"; suffix: string };

const LABEL = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/;

/** True for dotted-quad IPv4 or bracketed IPv6 (the forms WHATWG URL yields). */
export function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Lower-case, punycode (IDNA), strip one trailing dot. Returns null if not a plain host. */
export function normalizeHost(input: string): string | null {
  let s = input.trim();
  if (!s || /[\s/\\@?#%]/.test(s)) return null;
  const bracketed = s.startsWith("[") && s.endsWith("]");
  if (s.includes(":") && !bracketed) return null; // ports / schemes are not hosts
  if (s.endsWith(".") && !bracketed) s = s.slice(0, -1);
  let u: URL;
  try { u = new URL(`http://${s}/`); } catch { return null; }
  if (u.port || u.username || u.password) return null;
  return u.hostname.endsWith(".") ? u.hostname.slice(0, -1) : u.hostname;
}

/** A hostname made of non-empty DNS-ish labels. IP literals are not hostnames. */
export function isHostname(host: string): boolean {
  if (!host || host.length > 253 || isIpLiteral(host)) return false;
  return host.split(".").every((l) => l.length > 0 && l.length <= 63 && LABEL.test(l));
}

/**
 * Parse a declared pattern: an exact hostname, or `*.suffix` with at least two
 * labels after the `*.` (so `*.com` is refused). IP literals are not allowed.
 * `allowIp` lets the caller's own `allowHosts` list an exact IP / `localhost`.
 */
export function parseHostPattern(raw: string, opts: { allowIp?: boolean } = {}): HostPattern | null {
  if (raw.startsWith("*.")) {
    const suffix = normalizeHost(raw.slice(2));
    if (!suffix || !isHostname(suffix) || suffix.split(".").length < 2) return null;
    return { kind: "wildcard", suffix };
  }
  if (raw.includes("*")) return null;
  const host = normalizeHost(raw);
  if (!host) return null;
  if (isIpLiteral(host)) return opts.allowIp ? { kind: "exact", host } : null;
  return isHostname(host) ? { kind: "exact", host } : null;
}

/** `*.x.com` matches any depth below x.com (a.x.com, a.b.x.com) but NOT x.com itself. */
export function matchesPattern(p: HostPattern, host: string): boolean {
  if (p.kind === "exact") return host === p.host;
  if (isIpLiteral(host)) return false;
  return host.length > p.suffix.length + 1 && host.endsWith("." + p.suffix);
}
