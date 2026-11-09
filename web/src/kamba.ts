// /kamba <código>: opens your Kamba Oculto envelope on this device only. The code never leaves the
// device (nothing is sent to the server or the room); the answer is a line only you see.

export type Envelope = { s: string; i: string; c: string }; // salt, iv, ciphertext (base64)
export type Sealed = { iter: number; e: readonly Envelope[] };
export type Opened = { nome: string; oferece: string; criancas: { nome: string; oferece: string }[] };

const bytes = (b64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));

// "bmru vcbj", "BMRU-VCBJ" and "bmruvcbj" are the same code.
export function normalCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

// The envelope this code opens, or null when it opens none.
export async function openEnvelope(code: string, sealed: Sealed): Promise<Opened | null> {
  const subtle = globalThis.crypto.subtle;
  const raw = new TextEncoder().encode(normalCode(code));
  if (raw.length === 0) return null;
  const base = await subtle.importKey("raw", raw, "PBKDF2", false, ["deriveKey"]);
  for (const e of sealed.e) {
    const key = await subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: bytes(e.s), iterations: sealed.iter },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    try {
      const plain = await subtle.decrypt({ name: "AES-GCM", iv: bytes(e.i) }, key, bytes(e.c));
      return JSON.parse(new TextDecoder().decode(plain)) as Opened;
    } catch {
      // not this one
    }
  }
  return null;
}
