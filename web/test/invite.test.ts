import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCode, inviteToken, showCode } from "../src/invite.ts";

test("invite links carry their token after # (person or device); anything else is no invite", () => {
  const token = "Ab3_-".repeat(9);
  assert.equal(inviteToken(`#convite=${token}`), token);
  assert.equal(inviteToken(`#aparelho=${token}`), token);
  assert.equal(inviteToken(""), null);
  assert.equal(inviteToken("#convite=short"), null);
  assert.equal(inviteToken(`#convite=${token}&x=<script>`), null);
});

test("device codes: typed any way, shown in two halves, and accepted after #aparelho=", () => {
  assert.equal(cleanCode(" abcd-efgh "), "ABCDEFGH");
  assert.equal(showCode("ABCDEFGH"), "ABCD-EFGH");
  assert.equal(inviteToken("#aparelho=ABCDEFGH"), "ABCDEFGH");
  assert.equal(inviteToken("#convite=ABCDEFGH"), null); // person invites are always long
});
