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
 * Suffixes under which unrelated tenants get their own subdomain (platform
 * hosting, object storage, CDNs, tunnels) and a few public-suffix families.
 * `*.<one of these>` is "any tenant of the platform", i.e. in practice the
 * internet. Deliberately small and incomplete: a wildcard is only as narrow as
 * its publisher makes it, and this list is a guard rail, not the public suffix list.
 */
export const SHARED_SUFFIXES: readonly string[] = [
  "vercel.app", "now.sh", "github.io", "githubusercontent.com", "gitlab.io", "pages.dev", "workers.dev",
  "netlify.app", "herokuapp.com", "cloudfront.net", "blob.core.windows.net", "core.windows.net",
  "azurewebsites.net", "azureedge.net", "trafficmanager.net", "cloudapp.azure.com", "web.app",
  "firebaseapp.com", "appspot.com", "run.app", "cloudfunctions.net", "fly.dev", "ngrok-free.app", "ngrok.io",
  "ngrok.app", "onrender.com", "railway.app", "up.railway.app", "surge.sh", "glitch.me", "repl.co",
  "ondigitalocean.app", "supabase.co", "upstash.io", "amazonaws.com", "s3.amazonaws.com", "elasticbeanstalk.com",
  "myshopify.com", "wixsite.com", "weebly.com", "pythonanywhere.com", "stackhero-network.com", "r2.dev",
];
const CC_SECOND_LEVEL = /^(co|com|org|net|ac|gov|edu|ne|or|go|gob|nom)\.[a-z]{2}$/;

/** True when `suffix` (already normalised) is a shared / public-suffix-like domain. */
export function isSharedSuffix(suffix: string): boolean {
  if (SHARED_SUFFIXES.includes(suffix) || CC_SECOND_LEVEL.test(suffix)) return true;
  // Any AWS service/region endpoint (s3.eu-west-1.amazonaws.com, execute-api.x.amazonaws.com): every customer lives there.
  return suffix.endsWith(".amazonaws.com") && suffix.split(".").length <= 4;
}

/** `localhost` and anything under it: loopback by name, not a vendor. */
export function isLocalName(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

/**
 * Parse a declared pattern: an exact hostname, or `*.suffix` with at least two
 * labels after the `*.` (so `*.com` is refused). IP literals are not allowed.
 * `allowIp` lets the caller's own `allowHosts` list an exact IP / `localhost`;
 * vendors may not list either. Shared-suffix wildcards parse fine here and are
 * refused separately (see `isSharedSuffix`) so the caller can override knowingly.
 */
export function parseHostPattern(raw: string, opts: { allowIp?: boolean } = {}): HostPattern | null {
  if (raw.startsWith("*.")) {
    const suffix = normalizeHost(raw.slice(2));
    if (!suffix || !isHostname(suffix) || suffix.split(".").length < 2) return null;
    if (!opts.allowIp && isLocalName(suffix)) return null;
    return { kind: "wildcard", suffix };
  }
  if (raw.includes("*")) return null;
  const host = normalizeHost(raw);
  if (!host) return null;
  if (isIpLiteral(host)) return opts.allowIp ? { kind: "exact", host } : null;
  if (!opts.allowIp && isLocalName(host)) return null;
  return isHostname(host) ? { kind: "exact", host } : null;
}

/** `*.x.com` matches any depth below x.com (a.x.com, a.b.x.com) but NOT x.com itself. */
export function matchesPattern(p: HostPattern, host: string): boolean {
  if (p.kind === "exact") return host === p.host;
  if (isIpLiteral(host)) return false;
  return host.length > p.suffix.length + 1 && host.endsWith("." + p.suffix);
}
