import { isHostname, isIpLiteral, isLocalName, isSharedSuffix, matchesPattern, parseHostPattern, type HostPattern } from "./hosts.js";
import { parseSubprocessors } from "./parse.js";
import type { Subprocessor, SubprocessorsDoc } from "./schema.js";

/**
 * Egress guard: makes outbound calls made through the guarded fetch fail closed (in enforce mode) unless the
 * destination host belongs to a declared (active) sub-processor, and emits one
 * structured, path-free event per decision.
 *
 * Scope: enforced at the application's own outbound-call boundary. It does not
 * stop code that bypasses the wrapper (raw sockets, another HTTP client, a child
 * process) or a compromised runtime. It checks the destination host name, not what is
 * sent (the data category is whatever the caller declares) and not the address the
 * name resolves to (DNS rebinding, nip.io-style names are out of scope).
 */

export type EgressMode = "enforce" | "report";

export type EgressReason =
  | "processor"
  | "own-host"
  | "denied:not-listed"
  | "denied:scheduled"
  | "denied:category"
  | "denied:scheme"
  | "denied:userinfo"
  | "denied:ip-literal"
  | "denied:localhost"
  | "denied:downgrade"
  | "denied:invalid-url";

/** Plain JSON. Host only: never path, query, userinfo, port or body. */
export interface EgressEvent {
  /** RFC 3339, UTC. */
  ts: string;
  /** Normalised host of the destination; null when the URL is unparseable or not http(s). */
  url_host: string | null;
  processor_id: string | null;
  data_category: string | null;
  allowed: boolean;
  mode: EgressMode;
  reason: EgressReason;
}

export interface EgressDecision {
  allowed: boolean;
  processor?: { id: string; name: string };
  reason: EgressReason;
  event: EgressEvent;
}

export interface EgressGuardOptions {
  mode: EgressMode;
  /** Hosts the application itself owns (own domains, database, localhost). Exact or `*.suffix`; IPs exact only. */
  allowHosts?: string[];
  /** Called once per decision. Errors / rejections here never change the decision. */
  onEvent?: (event: EgressEvent) => void | Promise<void>;
  /**
   * Deny a processor that declares `dataCategories` when the caller names no category.
   * Default false, a trade-off: false means a call that forgets to name its category gets
   * only the host-level check (fewer broken calls, weaker category enforcement); true makes
   * the category mandatory wherever the list restricts it (stricter, but every such call site must pass one).
   */
  requireCategory?: boolean;
  /** Redirect hops followed by the guarded fetch: an integer 0..20. Default 10. */
  maxRedirects?: number;
  /**
   * Wildcards (`*.suffix`) over a shared suffix (vercel.app, github.io, s3.amazonaws.com, co.uk, ...)
   * are refused at creation: they allow any tenant of the platform, i.e. the internet.
   * Set true only if you accept that. Applies to the list's `hosts` and to `allowHosts`.
   */
  allowSharedSuffix?: boolean;
  /** Extra header names dropped when a redirect changes origin (adds to authorization, cookie, proxy-authorization, x-api-key, api-key). */
  stripHeadersOnRedirect?: string[];
}

export class EgressDenied extends Error {
  readonly event: EgressEvent;
  constructor(event: EgressEvent) {
    super(`egress denied: ${event.url_host ?? "(unparseable destination)"} (${event.reason})`);
    this.name = "EgressDenied";
    this.event = event;
  }
}

export interface CheckOptions { dataCategory?: string }
export interface GuardedFetchOptions { dataCategory?: string }
/** Per-call category: `fetch(url, { egress: { dataCategory } })`. Stripped before the real fetch. */
export type GuardedInit = RequestInit & { egress?: { dataCategory?: string } };

export type GuardedFetch = (input: RequestInfo | URL, init?: GuardedInit) => Promise<Response>;

export interface EgressGuard {
  check(url: string | URL, opts?: CheckOptions): EgressDecision;
  fetch(realFetch: typeof fetch, opts?: GuardedFetchOptions): GuardedFetch;
}

interface Compiled { sp: Subprocessor; patterns: HostPattern[]; categories: Set<string> | null }

const lc = (s: string) => s.trim().toLowerCase();
const stripDot = (h: string) => (h.endsWith(".") ? h.slice(0, -1) : h);

export function createEgressGuard(doc: SubprocessorsDoc, options: EgressGuardOptions): EgressGuard {
  const parsed = parseSubprocessors(doc);
  if (!parsed.ok) throw new Error(`createEgressGuard: invalid subprocessors document: ${parsed.error}`);
  const { mode, onEvent, requireCategory = false, maxRedirects = 10, allowSharedSuffix = false } = options;
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 20) {
    throw new Error("createEgressGuard: maxRedirects must be an integer 0..20");
  }
  const refuseShared = (raw: string, p: HostPattern, where: string): void => {
    if (!allowSharedSuffix && p.kind === "wildcard" && isSharedSuffix(p.suffix)) {
      throw new Error(`createEgressGuard: ${where} ${JSON.stringify(raw)} is a wildcard over a shared suffix (any tenant of ${p.suffix} would pass); list exact hosts, or set allowSharedSuffix: true to accept that`);
    }
  };

  const own: HostPattern[] = (options.allowHosts ?? []).map((h) => {
    const p = parseHostPattern(h, { allowIp: true });
    if (!p) throw new Error(`createEgressGuard: invalid allowHosts entry ${JSON.stringify(h)}`);
    refuseShared(h, p, "allowHosts entry");
    return p;
  });

  const active: Compiled[] = [];
  const scheduled: Compiled[] = [];
  for (const sp of parsed.value.subprocessors) {
    const patterns = (sp.hosts ?? []).map((h) => {
      const p = parseHostPattern(h)!;
      refuseShared(h, p, `hosts entry of "${sp.id}"`);
      return p;
    });
    if (!patterns.length) continue;
    const c: Compiled = { sp, patterns, categories: sp.dataCategories ? new Set(sp.dataCategories.map(lc)) : null };
    (sp.status === "scheduled" ? scheduled : active).push(c);
  }

  const emit = (e: EgressEvent) => {
    if (!onEvent) return;
    try {
      const r = onEvent(e);
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch { /* telemetry must never change a decision */ }
  };

  function decide(target: string | URL, dataCategory: string | undefined, forceDeny?: EgressReason): EgressDecision {
    const cat = dataCategory === undefined ? null : dataCategory;
    const mk = (host: string | null, allowedByRule: boolean, reason: EgressReason, sp?: Subprocessor): EgressDecision => {
      const event: EgressEvent = {
        ts: new Date().toISOString(),
        url_host: host,
        processor_id: sp?.id ?? null,
        data_category: cat,
        allowed: allowedByRule,
        mode,
        reason,
      };
      emit(event);
      return { allowed: allowedByRule, reason, event, ...(sp ? { processor: { id: sp.id, name: sp.name } } : {}) };
    };

    let u: URL;
    try { u = target instanceof URL ? target : new URL(target); } catch { return mk(null, false, "denied:invalid-url"); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return mk(null, false, "denied:scheme");
    const host = stripDot(u.hostname);
    if (u.username || u.password) return mk(host, false, "denied:userinfo");
    if (forceDeny) return mk(host, false, forceDeny);

    if (isIpLiteral(host)) {
      return own.some((p) => matchesPattern(p, host)) ? mk(host, true, "own-host") : mk(host, false, "denied:ip-literal");
    }
    if (!isHostname(host)) return mk(host, false, "denied:invalid-url");

    if (own.some((p) => matchesPattern(p, host))) return mk(host, true, "own-host");
    if (isLocalName(host)) return mk(host, false, "denied:localhost");

    const matches = active.filter((c) => c.patterns.some((p) => matchesPattern(p, host)));
    if (!matches.length) {
      const sched = scheduled.find((c) => c.patterns.some((p) => matchesPattern(p, host)));
      return sched ? mk(host, false, "denied:scheduled", sched.sp) : mk(host, false, "denied:not-listed");
    }
    // Prefer an exact match for attribution; any matching entry that allows the category is enough.
    const exactFirst = [...matches].sort(
      (a, b) => Number(b.patterns.some((p) => p.kind === "exact" && matchesPattern(p, host))) - Number(a.patterns.some((p) => p.kind === "exact" && matchesPattern(p, host))),
    );
    const okEntry = exactFirst.find((c) => {
      if (c.categories === null) return true;
      if (dataCategory === undefined) return !requireCategory;
      return c.categories.has(lc(dataCategory));
    });
    return okEntry ? mk(host, true, "processor", okEntry.sp) : mk(host, false, "denied:category", exactFirst[0]!.sp);
  }

  /** Verdict -> action: report mode never blocks. */
  const gate = (d: EgressDecision): void => {
    if (!d.allowed && mode === "enforce") throw new EgressDenied(d.event);
  };

  const REDIRECT = new Set([301, 302, 303, 307, 308]);
  const STRIP_CROSS_ORIGIN = [
    "authorization", "cookie", "proxy-authorization", "x-api-key", "api-key",
    ...(options.stripHeadersOnRedirect ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean),
  ];
  const STRIP_ON_BODY_DROP = ["content-type", "content-length", "content-encoding", "content-language", "content-location"];

  const replayable = (b: unknown): boolean =>
    b == null || typeof b === "string" || b instanceof URLSearchParams || b instanceof ArrayBuffer ||
    ArrayBuffer.isView(b) || (typeof Blob !== "undefined" && b instanceof Blob) ||
    (typeof FormData !== "undefined" && b instanceof FormData);

  return {
    check: (url, o = {}) => decide(url, o.dataCategory),

    fetch(realFetch, fo = {}) {
      return async (input, init) => {
        const { egress, ...rest } = (init ?? {}) as GuardedInit;
        const category = egress?.dataCategory ?? fo.dataCategory;
        const req = input instanceof Request ? input : null;
        const callerRedirect = rest.redirect ?? req?.redirect ?? "follow";
        const signal = rest.signal ?? req?.signal;

        let url = req ? req.url : input instanceof URL ? input.href : String(input);
        // Hand the real fetch the href we checked, not the caller's spelling. Unparseable input
        // is only reachable in report mode and is passed through so the real fetch fails natively.
        let firstTarget: RequestInfo | URL = req ?? input;
        if (!req) { try { firstTarget = url = new URL(url).href; } catch { /* decide() reports it */ } }
        let downgrade = false;
        let method = (rest.method ?? req?.method ?? "GET").toUpperCase();
        let headers = new Headers(rest.headers ?? req?.headers);
        let body: BodyInit | null | undefined = rest.body;
        let bodyReplayable = req ? req.body === null && replayable(body) : replayable(body);

        for (let hop = 0; ; hop++) {
          gate(decide(url, category, downgrade ? "denied:downgrade" : undefined));
          const callInit: RequestInit = hop === 0
            ? { ...rest, redirect: "manual" }
            : { ...rest, method, headers, redirect: "manual", ...(signal ? { signal } : {}), ...(body != null ? { body } : {}) };
          if (hop > 0 && body == null) delete callInit.body;
          const res = await realFetch(hop === 0 ? firstTarget : url, callInit);

          const loc = res.headers.get("location");
          if (!REDIRECT.has(res.status) || loc === null || callerRedirect === "manual") return res;
          if (callerRedirect === "error") {
            try { await res.body?.cancel(); } catch { /* ignore */ }
            throw new TypeError("redirect mode is 'error' and the server redirected");
          }
          try { await res.body?.cancel(); } catch { /* ignore */ }
          if (hop >= maxRedirects) throw new TypeError("too many redirects");

          let next: string;
          try { next = new URL(loc, url).href; } catch { next = loc; } // unparseable -> denied by decide()

          if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
            if (method !== "HEAD") method = "GET";
            body = undefined; bodyReplayable = true;
            for (const h of STRIP_ON_BODY_DROP) headers.delete(h);
          } else if (!bodyReplayable) {
            throw new TypeError("cannot replay request body across a redirect (stream body); pass a string/buffer or handle redirects yourself");
          }
          let sameOrigin = false;
          try {
            const [from, to] = [new URL(url), new URL(next)];
            sameOrigin = from.origin === to.origin;
            // https -> http is refused in enforce mode (reported in report mode): never carry data onto cleartext.
            downgrade = from.protocol === "https:" && to.protocol === "http:";
          } catch { /* decide() will deny */ }
          if (!sameOrigin) {
            headers = new Headers(headers);
            for (const h of STRIP_CROSS_ORIGIN) headers.delete(h);
          }
          url = next;
        }
      };
    },
  };
}
