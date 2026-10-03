import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./config";
import { query } from "./index";
function key() {
  if (!env.CREDENTIAL_ENCRYPTION_KEY)
    throw Error("Set CREDENTIAL_ENCRYPTION_KEY using npm run setup");
  return Buffer.from(env.CREDENTIAL_ENCRYPTION_KEY, "hex");
}
export function encryptSecret(value: string, scope: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(scope));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decryptSecret(value: string, scope: string) {
  const [iv, tag, data] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(scope));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort()
        .map((k) => [k, canonical(record[k])]),
    );
  }
  return value;
}
export function hash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
export async function audit(
  orgId: string,
  actor: string,
  action: string,
  target: string,
  payload: unknown,
) {
  await query(
    "INSERT INTO platform.audit_log(org_id,actor,action,target,payload_hash,payload) VALUES($1,$2,$3,$4,$5,$6)",
    [orgId, actor, action, target, hash(payload), JSON.stringify(payload)],
  );
}
function sessionKey() {
  if (!env.SESSION_SECRET)
    throw Error("SESSION_SECRET not configured; run setup");
  return env.SESSION_SECRET;
}
export function signSession(system: string, expires = Date.now() + 3600000) {
  const payload = Buffer.from(JSON.stringify({ system, expires })).toString(
    "base64url",
  );
  return (
    payload +
    "." +
    createHmac("sha256", sessionKey()).update(payload).digest("hex")
  );
}
export function validSession(token: string | undefined, system: string) {
  try {
    if (!token) return false;
    const parts = token.split(".");
    if (
      parts.length !== 2 ||
      !/^[a-zA-Z0-9_-]+$/.test(parts[0]) ||
      !/^[a-f0-9]{64}$/.test(parts[1])
    )
      return false;
    const [payload, sig] = parts;
    const expected = createHmac("sha256", sessionKey())
      .update(payload)
      .digest();
    const actual = Buffer.from(sig, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return false;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      system: string;
      expires: number;
    };
    return parsed.system === system && parsed.expires > Date.now();
  } catch {
    return false;
  }
}
