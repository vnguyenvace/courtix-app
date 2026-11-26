import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encrypts each club's messaging credentials (LINE channel secret and access token) before they
// go into the database. Key: CHANNEL_SECRETS_KEY, server-only, any long random string (it is
// hashed to 32 bytes). Format: "v1:<iv>:<tag>:<ciphertext>", all base64url. AES-256-GCM also
// detects tampering.
//
// Changing CHANNEL_SECRETS_KEY makes stored credentials unreadable: clubs then reconnect.

function key(): Buffer {
  const raw = process.env.CHANNEL_SECRETS_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("CHANNEL_SECRETS_KEY isn't set (at least 32 characters), so messaging accounts can't be connected.");
  }
  return createHash("sha256").update(raw).digest();
}

export function secretsConfigured() {
  return (process.env.CHANNEL_SECRETS_KEY ?? "").length >= 32;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Stored credential is in an unknown format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
