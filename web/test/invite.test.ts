import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteToken } from "../src/invite.ts";

test("invite links carry their token after # (person or device); anything else is no invite", () => {
  const token = "Ab3_-".repeat(9);
  assert.equal(inviteToken(`#convite=${token}`), token);
  assert.equal(inviteToken(`#aparelho=${token}`), token);
  assert.equal(inviteToken(""), null);
  assert.equal(inviteToken("#convite=short"), null);
  assert.equal(inviteToken(`#convite=${token}&x=<script>`), null);
});
