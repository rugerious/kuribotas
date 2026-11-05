import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? "data"; // git-ignored; /data in the Docker image
// The built web client: web/dist next to server/ (same layout in the repo and in the image).
const webDir = process.env.WEB_DIR ?? fileURLToPath(new URL("../../web/dist", import.meta.url));

mkdirSync(dataDir, { recursive: true });
if (!existsSync(join(webDir, "index.html"))) {
  console.warn(`no web client in ${webDir}: run "npm run build" (the chat still works on /ws)`);
}
// The family's own sounds go in <data>/sounds (nudge.mp3, tornado.mp3); without them, the sounds made in code play.
const app = createApp({ dbPath: join(dataDir, "kuribotas.db"), webDir, soundsDir: join(dataDir, "sounds") });

app.server.listen(port, host, () => {
  console.log(`kuribotas server listening on http://${host}:${port} (WebSocket at /ws, data in ${dataDir})`);
});

// Docker and systemd stop processes with SIGTERM: say goodbye to chat clients,
// close the database cleanly, then exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
