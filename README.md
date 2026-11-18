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

Read [SPEC.md](SPEC.md). The machine schema is `subprocessors.schema.json`, generated from the code by `npm run gen:schema`. First implementation: [miniterms](https://miniterms.com).
