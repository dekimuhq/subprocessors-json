# subprocessors.json — Specification v1

Status: draft 1 · Spec licence: CC0 1.0 · Code licence: Apache-2.0

## 1. Purpose

GDPR Art. 28(2) lets a processor use sub-processors under a general written authorisation only if it **informs the controller of intended changes** and gives the controller the chance to object. Today vendors publish their list as an HTML page at an inconsistent path, and controllers watch it by hand or by scraping.

`subprocessors.json` is a small, machine-readable list that any vendor can publish and any tool can fetch, validate and diff. It carries the list. It does not change what Art. 28 requires, and publishing it is not by itself notice to any particular controller.

## 2. Location

Publish the document over HTTPS. Recommended well-known path: `/.well-known/subprocessors.json`. A publisher MAY use any other HTTPS URL and link to it from its sub-processor page. Serve `Content-Type: application/json`. Consumers SHOULD NOT fetch more than once an hour.

## 3. Document

A UTF-8 JSON object. Unknown members are **rejected** in v1, so a validator and a publisher cannot disagree silently; extensions arrive as a new `format` version.

| Member | Type | Required | Meaning |
|---|---|---|---|
| `format` | string | yes | Exactly `"subprocessors-json/1"`. |
| `publisher.name` | string 1–200 | yes | Legal or trading name of the processor. |
| `publisher.url` | https/http URL | no | The publisher's site. |
| `publisher.objectionContact` | string 1–200 | no | Where a controller sends an Art. 28(2) objection (an address or URL). |
| `updatedAt` | RFC 3339 date-time | yes | When the list was last edited. |
| `subprocessors` | array, ≤1000 | yes | The entries. |
| `signature` | object | no | See §5. |

### Entry

| Member | Type | Required | Meaning |
|---|---|---|---|
| `id` | string 1–120 | yes | Stable, never reused. Consumers match entries across snapshots on it. |
| `name` | string 1–120 | yes | The vendor. |
| `purpose` | string 1–280 | yes | What it processes data for. |
| `category` | enum | yes | `hosting` `data-store` `email` `analytics` `payments` `ai` `support` `other`. |
| `location` | string 1–60 | yes | Where the data is processed: a country, region or `EU`. Free text. |
| `status` | enum | no | `active` (default) or `scheduled`. |
| `effectiveFrom` | `YYYY-MM-DD` | when `scheduled` | Start date (scheduled) or start date already passed (active). A real calendar date, UTC. |
| `dpaUrl` | https/http URL | no | The vendor's DPA or terms. |

Rules a schema cannot express (the JSON Schema is therefore necessary, not sufficient): `id` values are unique within a document; `effectiveFrom` is required when `status` is `scheduled`.

A **scheduled** entry is an advance notice: the vendor is listed before it is used, so the notice can precede the change. A consumer MUST NOT treat a scheduled entry as in use.

## 4. Diff

Two snapshots are compared by `id`. An entry present only in the later one is **added**, only in the earlier **removed**; in both with any difference in `name`, `purpose`, `category`, `location`, `status`, `effectiveFrom` or `dpaUrl` is **changed**. Order and `updatedAt` are not changes. A change of `status` from `scheduled` to `active` is a change like any other.

## 5. Signature (optional, informational in v1)

`signature` is `{ alg, keyId?, value }`. `value` is a base64url signature over the document with `signature` removed, serialised with RFC 8785 JSON canonicalisation. v1 defines the shape only; this package validates the shape and does **not** verify the signature. Unsigned documents are fully conformant.

## 6. Proposed additive extension (informative, not yet normative)

v1 has **no** member that says which network destinations a sub-processor is reached on, or which kinds of data it may receive, so a list cannot be checked against what a system actually calls. This section proposes two optional entry members. It is informative: v1 as written above does not define these members, and a list that omits both is exactly as valid as before.

| Member | Type | Required | Meaning |
|---|---|---|---|
| `hosts` | array of 1–100 strings | no | Hostnames the vendor is reached on. Each is an exact hostname (`api.example.com`) or `*.suffix` (`*.example.com`). `hosts` is part of the published list; do not include internal-only endpoints. |
| `dataCategories` | array of 1–50 strings, each 1–60 | no | Data categories the vendor may receive, as the publisher names them (free text, compared case-insensitively). Absent = the list places no category limit on that entry. A publisher's declaration. It is not verified by this package, which compares it with the category the caller names. |

`hosts` patterns: lower-case ASCII (IDNA/punycode) after normalisation; one trailing dot is ignored; no scheme, port, path or userinfo; no IP literals, no `localhost` or `*.localhost`; `*.` is the only wildcard and needs at least two labels after it (`*.com` is invalid). `*.example.com` matches `a.example.com` and `a.b.example.com` but **not** `example.com` itself, which must be listed separately if it is meant. **A wildcard over a shared suffix (`*.vercel.app`, `*.github.io`, `*.s3.amazonaws.com`, `*.co.uk`, ...) is the same as allowing the internet**: every tenant of the platform matches, including an attacker's. Publishers SHOULD list exact hosts; this package refuses such wildcards unless the caller opts in explicitly. Matching is on the parsed host of a URL, never on substrings of the URL string.

**Compatibility caveat.** This package's validator and its published machine schema (`subprocessors.schema.json`) already implement this draft amendment: they accept both members and treat a change to either as a change in §4. §3 rejects unknown members in v1, so any other strict-v1 validator will reject a document that uses `hosts` or `dataCategories`. Adoption therefore needs a new `format` version (for example `subprocessors-json/2`) or a v1 amendment that every validator ships first. Until then, a publisher who wants a strictly v1-valid file should keep these members in a separate, privately held copy used only for enforcement.

## 7. Enforcement (informative)

A list that is only documentation can drift from what a system does. With the §6 members a deploying application can turn the list into a runtime check at its own outbound-call boundary (`createEgressGuard` in this package):

- A destination is allowed only if its host matches the `hosts` of an **active** entry (a `scheduled` entry is not in use, §3) or a host the application itself owns.
- When the caller names the data category of a call and the entry declares `dataCategories`, the category must be among them.
- Redirects are followed one hop at a time and every hop is checked again: a listed processor that redirects to an unlisted host is an egress.
- Non-http(s) schemes and URLs with userinfo are always refused; IP literals and `localhost` are refused unless the application lists them as its own. An https-to-http redirect hop is refused.
- Each decision yields a plain-JSON event: timestamp, destination **host only** (never path, query, userinfo, port or body), matched entry id, declared category, verdict and mode. An application may turn events into receipts or logs.

What this is not: it is enforced at the application's own outbound-call boundary. It does not stop code that bypasses the wrapper (another HTTP client, raw sockets, a child process) or a compromised runtime, it checks the destination rather than inspecting what is sent (the data category is declared by the caller), and it does not establish that a vendor or an application is compliant with anything. The guard checks host names, not resolved addresses: DNS rebinding and nip.io-style names that resolve to internal addresses are out of scope. A network-level egress policy is a stronger control.

## 8. Non-goals

Not a register of processing, not a DPA, not proof that a vendor, or the controller's own use of it, is compliant, and not a replacement for the controller's own notice obligations.
