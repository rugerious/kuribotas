// Web Push, written with Node's own crypto (no dependency): the message encryption of RFC 8291
// (aes128gcm, RFC 8188) and the server's signature of RFC 8292 (VAPID). It is checked against
// RFC 8291's own worked example in push.test.ts.
import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type PushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };
export type VapidKeys = { publicKey: string; privateKey: string }; // base64url: 65-byte point, 32-byte scalar
export type PushSend = (subscription: PushSubscription, payload: string, urgency: "normal" | "high") => Promise<number>;

const RECORD_SIZE = 4096;
const TTL_SECONDS = 24 * 60 * 60; // a notification nobody could receive for a day is dropped
// Who the push services may contact about this server (RFC 8292 asks for a URL or an email).
const SUBJECT = "https://github.com/rugerious/kuribotas";

const b64u = (b: Buffer): string => b.toString("base64url");
const unb64u = (s: string): Buffer => Buffer.from(s, "base64url");
const hmac = (key: Buffer, data: Buffer): Buffer => createHmac("sha256", key).update(data).digest();

// Only the real push services: anything else would let a client make this server call any URL.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function isValidSubscription(s: unknown): s is PushSubscription {
  if (typeof s !== "object" || s === null) return false;
  const v = s as Record<string, unknown>;
  const keys = v.keys as Record<string, unknown> | undefined;
  if (typeof v.endpoint !== "string" || typeof keys?.p256dh !== "string" || typeof keys.auth !== "string") return false;
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some((h) => h.test(url.hostname))) return false;
  const p256dh = unb64u(keys.p256dh);
  return p256dh.length === 65 && p256dh[0] === 0x04 && unb64u(keys.auth).length === 16;
}

// RFC 8291 section 3.4 + RFC 8188: one record, padding delimiter 0x02, keyid = our ephemeral public key.
// `salt` and `serverKeys` are only passed by the test that replays the RFC's example.
export function encrypt(
  payload: string,
  subscription: PushSubscription,
  test?: { salt: Buffer; serverPrivate: Buffer },
): Buffer {
  const uaPublic = unb64u(subscription.keys.p256dh);
  const authSecret = unb64u(subscription.keys.auth);
  const ecdh = createECDH("prime256v1");
  if (test) ecdh.setPrivateKey(test.serverPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const salt = test?.salt ?? randomBytes(16);

  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// RFC 8292: a short-lived ES256 token naming the push service's origin, signed with our private key.
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const pub = unb64u(keys.publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: keys.privateKey };
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT })));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

// The server's VAPID keys live in the private data folder (0600), created on first start. Without a
// path (tests), they live in memory. Losing them only means every device must turn notifications on again.
export function loadVapidKeys(path?: string): VapidKeys {
  if (path === undefined) return generateVapidKeys();
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as VapidKeys;
  const keys = generateVapidKeys();
  writeFileSync(path, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

// Sends one notification; returns the push service's HTTP status (201 = accepted, 404/410 = gone).
export function webPushSender(keys: VapidKeys): PushSend {
  return async (subscription, payload, urgency) => {
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        authorization: vapidAuthorization(subscription.endpoint, keys),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(TTL_SECONDS),
        urgency,
      },
      body: new Uint8Array(encrypt(payload, subscription)),
      signal: AbortSignal.timeout(10_000),
    });
    return res.status;
  };
}
