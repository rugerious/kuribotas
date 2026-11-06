import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { encrypt, generateVapidKeys, isValidSubscription, vapidAuthorization } from "../src/push.ts";

// RFC 8291, Appendix A: the standard's own worked example. Same keys, salt and text must give
// exactly the same bytes, or our encryption is wrong.
test("encryption matches RFC 8291's worked example, byte for byte", () => {
  const body = encrypt(
    "When I grow up, I want to be a watermelon",
    {
      endpoint: "https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV",
      keys: {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
    },
    {
      salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"),
      serverPrivate: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"),
    },
  );
  assert.equal(
    body.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

test("the VAPID token names the push service and is signed with our key", () => {
  const keys = generateVapidKeys();
  const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, 1_700_000_000_000);
  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(match);
  const [, h, c, s, k] = match;
  assert.equal(k, keys.publicKey);
  const claims = JSON.parse(Buffer.from(c ?? "", "base64url").toString()) as Record<string, unknown>;
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.exp, 1_700_000_000 + 12 * 3600);
  const pub = Buffer.from(keys.publicKey, "base64url");
  const jwk = { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") };
  const ok = verify("sha256", Buffer.from(`${h}.${c}`), { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s ?? "", "base64url"));
  assert.ok(ok);
});

test("only real push services' addresses are accepted, with well-formed keys", () => {
  const keys = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
  assert.ok(isValidSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys }));
  assert.ok(isValidSubscription({ endpoint: "https://web.push.apple.com/abc", keys }));
  assert.ok(isValidSubscription({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/x", keys }));
  for (const endpoint of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.example/x", "not a url"]) {
    assert.equal(isValidSubscription({ endpoint, keys }), false, endpoint);
  }
  assert.equal(isValidSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { ...keys, auth: "short" } }), false);
});
