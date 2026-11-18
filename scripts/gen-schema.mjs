import { writeFileSync } from "node:fs";
import { z } from "zod";
import { subprocessorsDocSchema } from "../dist/schema.js";

const schema = z.toJSONSchema(subprocessorsDocSchema, { target: "draft-7", io: "input" });
writeFileSync(new URL("../subprocessors.schema.json", import.meta.url), JSON.stringify(schema, null, 2) + "\n");
console.log("wrote subprocessors.schema.json");
