import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Field-level encryption for SSNs and other identifiers (AES-256-GCM).
 *
 * Stored format: `v1:<keyId>:<iv b64>:<ciphertext b64>:<tag b64>`. The key id lets us rotate keys
 * and later move to envelope encryption with a cloud KMS without changing callers.
 *
 * Keys: FIELD_ENCRYPTION_KEY is 32 random bytes, base64 (generate with
 * `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`), and
 * FIELD_ENCRYPTION_KEY_ID names it (default "k1"). Older keys stay readable through
 * FIELD_ENCRYPTION_OLD_KEYS="id1:base64,id2:base64".
 *
 * While TEST_IDS_ONLY is on (only fake 000-xx-xxxx SSNs are accepted) and no key is set, a fixed
 * development key with id "dev" is used so previews work. With TEST_IDS_ONLY off, a missing key is
 * an error: real SSNs are never written without a real key.
 */

const DEV_KEY = createHash("sha256").update("white-oak-preview-only-not-secret").digest();

interface Keyring {
  currentId: string;
  keys: Map<string, Buffer>;
}

function parseKey(b64: string, name: string): Buffer {
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded.`);
  return k;
}

export function keyring(env: Record<string, string | undefined> = process.env): Keyring {
  const keys = new Map<string, Buffer>();
  for (const pair of (env.FIELD_ENCRYPTION_OLD_KEYS ?? "").split(",").filter(Boolean)) {
    const [id, b64] = pair.split(":");
    keys.set(id, parseKey(b64, `FIELD_ENCRYPTION_OLD_KEYS (${id})`));
  }
  keys.set("dev", DEV_KEY);
  if (env.FIELD_ENCRYPTION_KEY) {
    const id = env.FIELD_ENCRYPTION_KEY_ID || "k1";
    keys.set(id, parseKey(env.FIELD_ENCRYPTION_KEY, "FIELD_ENCRYPTION_KEY"));
    return { currentId: id, keys };
  }
  if (env.TEST_IDS_ONLY === "false") {
    throw new Error("FIELD_ENCRYPTION_KEY is not set. Set it before turning off TEST_IDS_ONLY.");
  }
  return { currentId: "dev", keys };
}

export function encryptField(plain: string, ring: Keyring = keyring()): string {
  const key = ring.keys.get(ring.currentId)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", ring.currentId, iv.toString("base64"), ct.toString("base64"), cipher.getAuthTag().toString("base64")].join(":");
}

export function decryptField(stored: string, ring: Keyring = keyring()): string {
  const [v, id, iv, ct, tag] = stored.split(":");
  if (v !== "v1" || !iv || !ct || !tag) throw new Error("Not an encrypted field value.");
  const key = ring.keys.get(id);
  if (!key) throw new Error(`Encryption key "${id}" is not configured.`);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/** The key id a stored value was written with (to find rows that need re-encrypting after rotation). */
export const encryptedKeyId = (stored: string) => stored.split(":")[1];

/** Masked form kept in the plain `ssn` column for display and "has an SSN" checks. */
export const maskSsn = (ssn: string) => `***-**-${ssn.replace(/\D/g, "").slice(-4)}`;

/** Everything the app stores for an SSN: ciphertext, plus the masked form in the `ssn` column. */
export function protectSsn(ssn: string, ring?: Keyring): { ssnEncrypted: string; ssn: string } {
  return { ssnEncrypted: encryptField(ssn, ring), ssn: maskSsn(ssn) };
}

/** Full SSN for filings only. Falls back to the `ssn` column for rows saved before encryption (test SSNs). */
export function revealSsn(e: { ssnEncrypted?: string | null; ssn?: string | null }, ring?: Keyring): string {
  if (e.ssnEncrypted) return decryptField(e.ssnEncrypted, ring);
  return e.ssn ?? "";
}

export const ssnLast4 = (e: { ssn?: string | null }) => (e.ssn ?? "").replace(/\D/g, "").slice(-4);
