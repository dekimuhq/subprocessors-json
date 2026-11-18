import { z } from "zod";

export const FORMAT = "subprocessors-json/1" as const;

export const CATEGORIES = [
  "hosting", "data-store", "email", "analytics", "payments", "ai", "support", "other",
] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
  .refine((v) => {
    const t = Date.parse(`${v}T00:00:00.000Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
  }, "is not a real date");

const httpsUrl = z.url({ protocol: /^https?$/ });

export const subprocessorSchema = z.strictObject({
  /** Stable identifier. Never reused; `diff` matches entries on it. */
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().min(1).max(280),
  category: z.enum(CATEGORIES),
  /** Where the data is processed: a country, region or "EU". Free text. */
  location: z.string().trim().min(1).max(60),
  /** active = in use now. scheduled = announced, starts on `effectiveFrom`. */
  status: z.enum(["active", "scheduled"]).default("active"),
  /** Date the vendor starts (scheduled) or started (active). */
  effectiveFrom: isoDate.optional(),
  dpaUrl: httpsUrl.optional(),
});

export const signatureSchema = z.strictObject({
  alg: z.string().min(1).max(40),
  keyId: z.string().min(1).max(200).optional(),
  /** Base64url signature over the canonical JSON of the document without `signature`. */
  value: z.string().min(1),
});

export const subprocessorsDocSchema = z
  .strictObject({
    format: z.literal(FORMAT),
    publisher: z.strictObject({
      name: z.string().trim().min(1).max(200),
      url: httpsUrl.optional(),
      /** Where a controller sends an Art. 28(2) objection. */
      objectionContact: z.string().trim().min(1).max(200).optional(),
    }),
    updatedAt: z.iso.datetime(),
    subprocessors: z.array(subprocessorSchema).max(1000),
    signature: signatureSchema.optional(),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    doc.subprocessors.forEach((s, i) => {
      if (seen.has(s.id)) {
        ctx.addIssue({ code: "custom", path: ["subprocessors", i, "id"], message: `duplicate id "${s.id}"` });
      }
      seen.add(s.id);
      if (s.status === "scheduled" && !s.effectiveFrom) {
        ctx.addIssue({ code: "custom", path: ["subprocessors", i, "effectiveFrom"], message: "required when status is scheduled" });
      }
    });
  });

export type Subprocessor = z.infer<typeof subprocessorSchema>;
export type SubprocessorsDoc = z.infer<typeof subprocessorsDocSchema>;
