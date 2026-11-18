import type { SubprocessorsDoc } from "./schema.js";

export const base = (): SubprocessorsDoc => ({
  format: "subprocessors-json/1",
  publisher: { name: "Acme SL", url: "https://acme.example" },
  updatedAt: "2026-11-18T10:00:00.000Z",
  subprocessors: [
    { id: "a", name: "Vercel", purpose: "Hosting", category: "hosting", location: "EU", status: "active", dpaUrl: "https://vercel.com/legal/dpa" },
    { id: "b", name: "Resend", purpose: "Email delivery", category: "email", location: "EU", status: "active" },
  ],
});
