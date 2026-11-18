const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
// Crockford base32 – no I, L, O, U so codes are unambiguous if ever read aloud.
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomString(alphabet: string, length: number): string {
  // Rejection sampling so every character is uniformly random.
  const max = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < max) out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** 24 chars of base62 ≈ 142 bits. */
export const newSecretId = () => randomString(BASE62, 24);
/** 10 chars of base32 = 50 bits. Public; only usable by logged-in staff. */
export const newScanCode = () => randomString(BASE32, 10);
export const newId = () => randomString(BASE62, 20);
export const newToken = () => randomString(BASE62, 40);

export const isSecretId = (s: string) => /^[0-9A-Za-z]{24}$/.test(s);
export const isScanCode = (s: string) => /^[0-9A-HJKMNP-TV-Z]{10}$/.test(s);
export const isId = (s: unknown): s is string => typeof s === "string" && /^[0-9A-Za-z]{8,64}$/.test(s);

const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

// Workers caps PBKDF2 at 100,000 iterations. The count is stored in the
// hash string so it can be changed later without breaking old PINs.
export const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(pin, salt, iterations);
  return `pbkdf2$${iterations}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, iter, saltHex, hashHex] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltHex || !hashHex) return false;
  const hash = await pbkdf2(pin, fromHex(saltHex), Number(iter));
  const expected = fromHex(hashHex);
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
  return diff === 0;
}

export const isValidPin = (pin: unknown): pin is string => typeof pin === "string" && /^\d{4,6}$/.test(pin);
