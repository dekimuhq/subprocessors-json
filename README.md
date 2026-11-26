# subprocessors-json

An open format for sub-processor lists, with a validator and a diff. Spec: CC0. Code: Apache-2.0.

```sh
npx subprocessors-json validate https://example.com/.well-known/subprocessors.json
npx subprocessors-json diff old.json https://example.com/.well-known/subprocessors.json   # exit 1 when they differ
```

```json
{
  "format": "subprocessors-json/1",
  "publisher": { "name": "Acme SL", "objectionContact": "privacy@acme.example" },
  "updatedAt": "2026-11-18T10:00:00.000Z",
  "subprocessors": [
    { "id": "vercel", "name": "Vercel", "purpose": "Hosting", "category": "hosting", "location": "EU", "dpaUrl": "https://vercel.com/legal/dpa" }
  ]
}
```

## Egress guard (check outbound calls against the list)

Optionally, declare where each vendor is reached (`hosts`) and which data it may receive (`dataCategories`) — a [proposed additive extension](SPEC.md#6-proposed-additive-extension-informative-not-yet-normative) — and make outbound calls made through the guarded fetch fail closed (in enforce mode) outside the list:

```ts
import { createEgressGuard, EgressDenied, parseSubprocessorsText } from "subprocessors-json";

const r = parseSubprocessorsText(await readFile("subprocessors.json", "utf8"));
if (!r.ok) throw new Error(r.error);

const guard = createEgressGuard(r.value, {
  mode: "enforce",                       // or "report": allow, but emit allowed:false events
  allowHosts: ["app.example.com", "db.internal.example.com"], // infra you own
  onEvent: (e) => log(e),                // { ts, url_host, processor_id, data_category, allowed, mode, reason }
});

const guardedFetch = guard.fetch(fetch);
await guardedFetch("https://api.resend.com/emails", { method: "POST", body, egress: { dataCategory: "email-address" } });
// anything else throws EgressDenied (carrying the event) before a request is made
```

```sh
npx subprocessors-json check-egress subprocessors.json https://api.resend.com/ --category email-address   # exit 0 allowed, 1 denied, 2 usage/invalid
```

Matching is on the parsed host (exact or `*.suffix`; `*.x.com` does not match `x.com`), case/trailing-dot/punycode normalised. Prefer exact hosts: a wildcard over a shared suffix (`*.vercel.app`, `*.github.io`, `*.s3.amazonaws.com`, `*.co.uk`, ...) admits every tenant of that platform, so the guard refuses to be created with one unless you pass `allowSharedSuffix: true`. Redirects are followed manually and every hop is re-checked; an https-to-http hop is refused in enforce mode, and `Authorization`, `Cookie`, `x-api-key` and similar headers are dropped when a redirect changes origin (`stripHeadersOnRedirect` adds more). Non-http(s) schemes and URLs with userinfo are always refused; IP literals and `localhost` are refused unless you list them in `allowHosts`. Events carry the host only, never path, query or body.

`requireCategory` (default `false`) is a trade-off: off, a call that does not name its data category gets only the host-level check; on, every call to a processor that restricts categories must name one or it is denied.

Scope, plainly: this is enforced at the application's own outbound-call boundary. It does not stop code that bypasses the wrapper or a compromised runtime, it checks the destination name (not the address it resolves to), and it does not inspect the payload (the data category is what the caller declares). It is a runtime check of your own list, not a certification of anything.

Read [SPEC.md](SPEC.md). The machine schema is `subprocessors.schema.json`, generated from the code by `npm run gen:schema`. First implementation: [miniterms](https://miniterms.com).
