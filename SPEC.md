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

## 6. Non-goals

Not a register of processing, not a DPA, not proof that a vendor is compliant, and not a replacement for the controller's own notice obligations.
