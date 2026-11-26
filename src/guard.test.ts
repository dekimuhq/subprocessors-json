import { describe, it, expect } from "vitest";
import { createEgressGuard, EgressDenied, type EgressEvent } from "./guard.js";
import { parseSubprocessors, type SubprocessorsDoc } from "./index.js";
import { base } from "./test-helpers.js";

const doc = (): SubprocessorsDoc => {
  const d = base();
  d.subprocessors = [
    { id: "vercel", name: "Vercel", purpose: "Hosting", category: "hosting", location: "EU", status: "active", hosts: ["vercel.com", "*.vercel.app"] },
    { id: "resend", name: "Resend", purpose: "Email", category: "email", location: "EU", status: "active", hosts: ["api.resend.com"], dataCategories: ["email-address", "message-content"] },
    { id: "future", name: "Future", purpose: "Later", category: "ai", location: "EU", status: "scheduled", effectiveFrom: "2027-01-01", hosts: ["api.future.example"] },
    { id: "nohosts", name: "NoHosts", purpose: "x", category: "other", location: "EU", status: "active" },
  ];
  return d;
};

const mk = (o: Partial<Parameters<typeof createEgressGuard>[1]> = {}) => {
  const events: EgressEvent[] = [];
  const g = createEgressGuard(doc(), { mode: "enforce", onEvent: (e) => events.push(e), ...o });
  return { g, events };
};

describe("document validation of the proposed extension", () => {
  it("existing documents without hosts/dataCategories still validate unchanged", () => {
    const r = parseSubprocessors(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subprocessors.every((s) => s.hosts === undefined && s.dataCategories === undefined)).toBe(true);
    }
  });
  it("accepts hosts + dataCategories", () => expect(parseSubprocessors(doc()).ok).toBe(true));
  it.each([["https://x.com"], ["x.com:443"], ["x.com/path"], ["*.com"], ["*"], ["a*.x.com"], ["1.2.3.4"], ["[::1]"], ["a..com"], ["user@x.com"], [""]])(
    "rejects bad host pattern %j",
    (h) => {
      const d = doc(); d.subprocessors[0]!.hosts = [h];
      expect(parseSubprocessors(d).ok).toBe(false);
    },
  );
  it("rejects empty hosts array and unknown members stay rejected", () => {
    const d = doc(); d.subprocessors[0]!.hosts = [];
    expect(parseSubprocessors(d).ok).toBe(false);
    expect(parseSubprocessors({ ...base(), hostz: 1 }).ok).toBe(false);
  });
});

describe("host matching", () => {
  it("allows exact and wildcard hosts, attributes the processor", () => {
    const { g } = mk();
    expect(g.check("https://vercel.com/x")).toMatchObject({ allowed: true, processor: { id: "vercel" }, reason: "processor" });
    expect(g.check("https://app.vercel.app/")).toMatchObject({ allowed: true, processor: { id: "vercel" } });
    expect(g.check("https://a.b.vercel.app/")).toMatchObject({ allowed: true });
  });
  it("wildcard does NOT match the apex; apex needs its own entry", () => {
    const { g } = mk();
    expect(g.check("https://vercel.app/").allowed).toBe(false);
    expect(g.check("https://vercel.com/").allowed).toBe(true); // listed exactly
    expect(g.check("https://www.vercel.com/").allowed).toBe(false); // exact does not cover subdomains
  });
  it("normalises case, trailing dot, punycode", () => {
    const d = doc(); d.subprocessors[0]!.hosts = ["münchen.example", "*.Tätig.example"];
    const g = createEgressGuard(d, { mode: "enforce" });
    expect(g.check("https://MÜNCHEN.example./").allowed).toBe(true);
    expect(g.check("https://xn--mnchen-3ya.example/").allowed).toBe(true);
    expect(g.check("https://a.xn--ttig-loa.example/").allowed).toBe(true);
    expect(g.check("https://API.RESEND.COM./v1").allowed).toBe(true);
  });
  it.each([
    ["suffix trick", "https://vercel.com.evil.com/"],
    ["path trick", "https://evil.com/vercel.com"],
    ["userinfo, evil host", "https://vercel.com@evil.com/"],
    ["userinfo, allowed host", "https://evil.com@vercel.com/"],
    ["userinfo with password", "https://u:p@vercel.com/"],
    ["backslash", "https://evil.com\\@vercel.com/"],
    ["query trick", "https://evil.com/?h=vercel.com"],
    ["fragment trick", "https://evil.com/#@vercel.com"],
    ["prefix label", "https://evilvercel.com/"],
    ["suffix without dot", "https://evilvercel.app/"],
    ["wildcard w/o dot boundary", "https://xvercel.app/"],
    ["port trick", "https://vercel.com:443.evil.com/"],
    ["IPv4 literal", "https://127.0.0.1/"],
    ["IPv4 hex/decimal form", "https://0x7f.1/"],
    ["IPv4 integer", "https://2130706433/"],
    ["IPv6 literal", "https://[::1]/"],
    ["IPv6 mapped", "https://[::ffff:127.0.0.1]/"],
    ["localhost", "http://localhost/"],
    ["localhost with port", "http://localhost:3000/"],
    ["empty label wildcard", "https://a..vercel.app/"],
    ["percent-encoded dot", "https://vercel%2ecom.evil.com/"],
    ["unlisted", "https://example.org/"],
    ["processor without hosts", "https://nohosts.example/"],
  ])("denies %s", (_n, url) => {
    const { g } = mk();
    expect(g.check(url).allowed).toBe(false);
  });
  it("percent-encoded host that decodes to a listed host is that host (parser-consistent)", () => {
    const { g } = mk();
    expect(g.check("https://vercel%2ecom/").allowed).toBe(true);
  });
  it("accepts a non-default port on a listed host (ports are not part of the list)", () => {
    expect(mk().g.check("https://vercel.com:8443/").allowed).toBe(true);
  });
  it("refuses non-http(s) schemes and invalid URLs", () => {
    const { g } = mk();
    for (const u of ["ftp://vercel.com/", "file:///etc/passwd", "javascript:alert(1)", "data:text/plain,x", "ws://vercel.com/", "not a url", "//vercel.com/", ""]) {
      expect(g.check(u).allowed, u).toBe(false);
    }
    expect(g.check("ftp://vercel.com/").reason).toBe("denied:scheme");
    expect(g.check("not a url").reason).toBe("denied:invalid-url");
  });
  it("scheduled entries are not in use", () => {
    const r = mk().g.check("https://api.future.example/");
    expect(r).toMatchObject({ allowed: false, reason: "denied:scheduled" });
  });
  it("allowHosts covers the app's own infra (exact / wildcard / IP / localhost) and is attributed to no processor", () => {
    const { g } = mk({ allowHosts: ["app.example", "*.internal.example", "localhost", "10.0.0.5"] });
    expect(g.check("https://app.example/")).toMatchObject({ allowed: true, reason: "own-host" });
    expect(g.check("https://app.example/")).not.toHaveProperty("processor");
    expect(g.check("https://db.internal.example/").allowed).toBe(true);
    expect(g.check("https://internal.example/").allowed).toBe(false);
    expect(g.check("http://localhost:3000/").allowed).toBe(true);
    expect(g.check("http://10.0.0.5/").allowed).toBe(true);
    expect(g.check("http://10.0.0.6/").allowed).toBe(false);
  });
  it("throws on a malformed allowHosts entry (misconfiguration must be loud)", () => {
    expect(() => createEgressGuard(doc(), { mode: "enforce", allowHosts: ["https://x.com"] })).toThrow();
    expect(() => createEgressGuard(doc(), { mode: "enforce", allowHosts: ["*.com"] })).toThrow();
  });
});

describe("data categories", () => {
  it("allows a declared category, denies an undeclared one", () => {
    const { g } = mk();
    expect(g.check("https://api.resend.com/", { dataCategory: "email-address" }).allowed).toBe(true);
    expect(g.check("https://api.resend.com/", { dataCategory: "EMAIL-ADDRESS" }).allowed).toBe(true);
    const r = g.check("https://api.resend.com/", { dataCategory: "payment-card" });
    expect(r).toMatchObject({ allowed: false, reason: "denied:category", processor: { id: "resend" } });
  });
  it("entry without dataCategories is unrestricted; no category given = host-level check", () => {
    const { g } = mk();
    expect(g.check("https://vercel.com/", { dataCategory: "anything" }).allowed).toBe(true);
    expect(g.check("https://api.resend.com/").allowed).toBe(true);
  });
  it("requireCategory denies a restricted processor when the caller names no category", () => {
    const { g } = mk({ requireCategory: true });
    expect(g.check("https://api.resend.com/")).toMatchObject({ allowed: false, reason: "denied:category" });
    expect(g.check("https://vercel.com/").allowed).toBe(true);
  });
});

describe("events", () => {
  it("one event per decision, host only: no path, query, userinfo, port or body", () => {
    const { g, events } = mk();
    g.check("https://user:pw@evil.com:8443/secret/path?email=a@b.c#frag");
    g.check("https://api.resend.com/v1/emails?to=a@b.c", { dataCategory: "email-address" });
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(Object.keys(e).sort()).toEqual(["allowed", "data_category", "mode", "processor_id", "reason", "ts", "url_host"]);
      const s = JSON.stringify(e);
      for (const leak of ["secret", "path", "email=", "a@b.c", "frag", "pw", "user:", "@", "8443"]) expect(s).not.toContain(leak);
      expect(new Date(e.ts).toISOString()).toBe(e.ts);
    }
    expect(events[0]).toMatchObject({ url_host: "evil.com", processor_id: null, data_category: null, allowed: false, mode: "enforce" });
    expect(events[1]).toMatchObject({ url_host: "api.resend.com", processor_id: "resend", data_category: "email-address", allowed: true });
  });
  it("unparseable / non-http URLs carry url_host null (nothing to leak)", () => {
    const { g, events } = mk();
    g.check("file:///home/me/secret.txt");
    g.check("::: not a url with personal@data.example");
    expect(events.map((e) => e.url_host)).toEqual([null, null]);
    expect(JSON.stringify(events)).not.toContain("secret");
    expect(JSON.stringify(events)).not.toContain("personal");
  });
  it("events are plain JSON", () => {
    const { g, events } = mk();
    g.check("https://vercel.com/");
    expect(JSON.parse(JSON.stringify(events[0]))).toEqual(events[0]);
  });
  it("a throwing or rejecting onEvent never changes the decision", async () => {
    const g1 = createEgressGuard(doc(), { mode: "enforce", onEvent: () => { throw new Error("boom"); } });
    expect(g1.check("https://vercel.com/").allowed).toBe(true);
    const g2 = createEgressGuard(doc(), { mode: "enforce", onEvent: async () => { throw new Error("boom"); } });
    expect(g2.check("https://evil.com/").allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 5)); // no unhandled rejection
  });
});

const ok = () => new Response("ok", { status: 200 });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

describe("guarded fetch", () => {
  it("enforce: denied destination throws EgressDenied carrying the event, and never calls the real fetch", async () => {
    const { g, events } = mk();
    let called = 0;
    const f = g.fetch((async () => { called++; return ok(); }) as typeof fetch);
    const err = await f("https://evil.com/steal?x=1").catch((e) => e);
    expect(err).toBeInstanceOf(EgressDenied);
    expect(err.event).toMatchObject({ url_host: "evil.com", allowed: false, mode: "enforce" });
    expect(err.message).not.toContain("steal");
    expect(called).toBe(0);
    expect(events).toHaveLength(1);
  });
  it("allowed destination goes through with redirect: manual", async () => {
    const { g } = mk();
    const seen: (RequestInit | undefined)[] = [];
    const f = g.fetch((async (_u: unknown, init?: RequestInit) => { seen.push(init); return ok(); }) as typeof fetch);
    const r = await f("https://vercel.com/a", { method: "POST", body: "x" });
    expect(await r.text()).toBe("ok");
    expect(seen[0]?.redirect).toBe("manual");
  });
  it("re-checks every redirect hop: processor -> unlisted host is denied before the second request", async () => {
    const { g, events } = mk();
    const calls: string[] = [];
    const f = g.fetch((async (u: unknown) => {
      calls.push(String(u));
      return String(u).startsWith("https://vercel.com") ? redirect("https://evil.com/landing") : ok();
    }) as typeof fetch);
    const err = await f("https://vercel.com/start").catch((e) => e);
    expect(err).toBeInstanceOf(EgressDenied);
    expect(err.event.url_host).toBe("evil.com");
    expect(calls).toEqual(["https://vercel.com/start"]);
    expect(events.map((e) => [e.url_host, e.allowed])).toEqual([["vercel.com", true], ["evil.com", false]]);
  });
  it("follows redirects between listed hosts, resolves relative Location", async () => {
    const { g, events } = mk();
    const calls: string[] = [];
    const f = g.fetch((async (u: unknown) => {
      calls.push(String(u));
      if (calls.length === 1) return redirect("/two");
      if (calls.length === 2) return redirect("https://api.resend.com/three");
      return ok();
    }) as typeof fetch);
    const r = await f("https://vercel.com/one");
    expect(r.status).toBe(200);
    expect(calls).toEqual(["https://vercel.com/one", "https://vercel.com/two", "https://api.resend.com/three"]);
    expect(events).toHaveLength(3);
  });
  it("redirect to a non-http scheme or userinfo trick is denied", async () => {
    for (const to of ["file:///etc/passwd", "https://vercel.com@evil.com/"]) {
      const { g } = mk();
      const f = g.fetch((async () => redirect(to)) as typeof fetch);
      expect(await f("https://vercel.com/").catch((e) => e)).toBeInstanceOf(EgressDenied);
    }
  });
  it("redirect carries data category: a hop to a processor that lacks it is denied", async () => {
    const { g } = mk();
    const f = g.fetch((async (u: unknown) => String(u).includes("vercel") ? redirect("https://api.resend.com/") : ok()) as typeof fetch);
    expect(await f("https://vercel.com/", { egress: { dataCategory: "payment-card" } } as RequestInit).catch((e) => e)).toBeInstanceOf(EgressDenied);
  });
  it("303 / 302-on-POST become GET without body; auth headers are dropped on a host change", async () => {
    const { g } = mk({ allowHosts: ["app.example"] });
    const seen: { url: string; init?: RequestInit }[] = [];
    const f = g.fetch((async (u: unknown, init?: RequestInit) => {
      seen.push({ url: String(u), init });
      return seen.length === 1 ? redirect("https://app.example/next", 303) : ok();
    }) as typeof fetch);
    await f("https://vercel.com/", { method: "POST", body: "secret", headers: { authorization: "Bearer t", cookie: "a=b", "x-keep": "1" } });
    const h = new Headers(seen[1]!.init?.headers);
    expect(seen[1]!.init?.method).toBe("GET");
    expect(seen[1]!.init?.body).toBeUndefined();
    expect(h.get("authorization")).toBeNull();
    expect(h.get("cookie")).toBeNull();
    expect(h.get("x-keep")).toBe("1");
  });
  it("307 preserves a replayable body but refuses a stream body", async () => {
    const { g } = mk();
    const seen: RequestInit[] = [];
    const f = g.fetch((async (_u: unknown, init?: RequestInit) => {
      seen.push(init!);
      return seen.length === 1 ? redirect("https://vercel.com/b", 307) : ok();
    }) as typeof fetch);
    await f("https://vercel.com/a", { method: "POST", body: "payload" });
    expect(seen[1]!.body).toBe("payload");
    expect(seen[1]!.method).toBe("POST");
    const f2 = g.fetch((async () => redirect("https://vercel.com/b", 307)) as typeof fetch);
    const stream = new ReadableStream();
    await expect(f2("https://vercel.com/a", { method: "POST", body: stream, duplex: "half" } as RequestInit)).rejects.toThrow(/replay/);
  });
  it("redirect loops are capped", async () => {
    const { g } = mk();
    const f = g.fetch((async () => redirect("https://vercel.com/again")) as typeof fetch);
    await expect(f("https://vercel.com/")).rejects.toThrow(/too many redirects/i);
  });
  it("caller redirect:'manual' gets the 3xx back; 'error' throws; both still check the first hop", async () => {
    const { g } = mk();
    const f = g.fetch((async () => redirect("https://evil.com/")) as typeof fetch);
    const r = await f("https://vercel.com/", { redirect: "manual" });
    expect(r.status).toBe(302);
    await expect(f("https://vercel.com/", { redirect: "error" })).rejects.toThrow(TypeError);
    await expect(f("https://evil.com/", { redirect: "manual" })).rejects.toBeInstanceOf(EgressDenied);
  });
  it("accepts URL and Request inputs and checks their host", async () => {
    const { g } = mk();
    const f = g.fetch((async () => ok()) as typeof fetch);
    expect((await f(new URL("https://vercel.com/"))).status).toBe(200);
    expect((await f(new Request("https://vercel.com/"))).status).toBe(200);
    await expect(f(new Request("https://evil.com/"))).rejects.toBeInstanceOf(EgressDenied);
    await expect(f(new URL("https://evil.com/"))).rejects.toBeInstanceOf(EgressDenied);
  });
  it("report mode: allows, never throws, emits allowed:false with mode report", async () => {
    const { g, events } = mk({ mode: "report" });
    const f = g.fetch((async () => ok()) as typeof fetch);
    expect((await f("https://evil.com/x")).status).toBe(200);
    expect(events).toEqual([expect.objectContaining({ url_host: "evil.com", allowed: false, mode: "report" })]);
    expect(g.check("https://evil.com/")).toMatchObject({ allowed: false }); // check() reports the verdict
  });
  it("report mode still re-checks (and reports) redirect hops", async () => {
    const { g, events } = mk({ mode: "report" });
    let n = 0;
    const f = g.fetch((async () => (n++ === 0 ? redirect("https://evil.com/") : ok())) as typeof fetch);
    await f("https://vercel.com/");
    expect(events.map((e) => [e.url_host, e.allowed])).toEqual([["vercel.com", true], ["evil.com", false]]);
  });
  it("default dataCategory on fetch(real, { dataCategory })", async () => {
    const { g } = mk();
    const f = g.fetch((async () => ok()) as typeof fetch, { dataCategory: "payment-card" });
    await expect(f("https://api.resend.com/")).rejects.toBeInstanceOf(EgressDenied);
  });
});
