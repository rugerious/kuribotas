// Makes an invite link from the server's console: the very first @, or anyone if no @ is around.
//   node server/src/invite.ts [--admin]
// Uses DATA_DIR and PUBLIC_URL like the server (in Docker: docker exec <container> node server/src/invite.ts).
// The link works once, for 7 days. Don't paste it anywhere public: whoever opens it first gets in.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { inviteLink, makeInvite } from "./auth.ts";
import { openStore } from "./store.ts";

const dataDir = process.env.DATA_DIR ?? "data";
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const admin = process.argv.includes("--admin");

mkdirSync(dataDir, { recursive: true });
const store = openStore(join(dataDir, "kuribotas.db"));
const token = makeInvite(store, "person", { personId: null, role: admin ? "admin" : "member", createdBy: null });
store.close();
console.log(`${admin ? "An @ invite" : "An invite"} for one person, valid for 7 days:\n${inviteLink(publicUrl, "person", token)}`);
