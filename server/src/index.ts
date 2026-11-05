import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const dataDir = process.env.DATA_DIR ?? "data"; // git-ignored; /data in the Docker image

mkdirSync(dataDir, { recursive: true });
const app = createApp({ dbPath: join(dataDir, "kuribotas.db") });

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
