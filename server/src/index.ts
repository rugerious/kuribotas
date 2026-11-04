import { createApp } from "./app.ts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);

const server = createApp();
server.listen(port, host, () => {
  console.log(`kuribotas server listening on http://${host}:${port}`);
});

// Docker and systemd stop processes with SIGTERM: finish open requests, then exit.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
