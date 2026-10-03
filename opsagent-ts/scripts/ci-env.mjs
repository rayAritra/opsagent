import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
writeFileSync(
  ".env",
  readFileSync(".env.example", "utf8")
    .replace(
      "CREDENTIAL_ENCRYPTION_KEY=",
      "CREDENTIAL_ENCRYPTION_KEY=" + randomBytes(32).toString("hex"),
    )
    .replace(
      "SESSION_SECRET=",
      "SESSION_SECRET=" + randomBytes(32).toString("hex"),
    ),
);
