import { createApp } from "./app.ts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const app = createApp();
app.server.listen(port, host, () => {
  console.log(`kuribotas server listening on http://${host}:${port} (WebSocket at /ws)`);
});

// Docker and systemd stop processes with SIGTERM: say goodbye to chat clients, then exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
