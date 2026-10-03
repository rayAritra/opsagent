import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { z } from "zod";
let folder = process.cwd();
while (!existsSync(resolve(folder, "turbo.json")) && dirname(folder) !== folder)
  folder = dirname(folder);
export const projectRoot = folder;
config({ path: resolve(folder, ".env"), quiet: true });
const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://opsagent:opsagent@127.0.0.1:5433/opsagent"),
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  OPSAGENT_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  OPSAGENT_MODEL: z.string().default("claude-sonnet-5-5"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  CONSOLE_URL: z.string().url().default("http://127.0.0.1:3000"),
  MOCK_COMPANY_URL: z.string().url().default("http://127.0.0.1:3001"),
  OPSAGENT_MAX_STEPS: z.coerce.number().positive().default(60),
  OPSAGENT_MAX_TOKENS: z.coerce.number().positive().default(100000),
  OPSAGENT_MAX_SECONDS: z.coerce.number().positive().default(600),
  OPSAGENT_CHAOS: z.coerce.number().default(0),
});
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(
  projectRoot,
  process.env.PLAYWRIGHT_BROWSERS_PATH || ".local/browsers",
);
export const env = schema.parse(
  Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== "")),
);
