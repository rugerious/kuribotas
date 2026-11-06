import { render } from "preact";
import { App } from "./app.tsx";

const root = document.getElementById("app");
if (root !== null) render(<App />, root);

// The service worker makes the app installable and lets it open without network. Browsers only allow
// it on https (or localhost while developing); anywhere else the app simply works without it.
if ("serviceWorker" in navigator && isSecureContext) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // not installable here: nothing else changes
    });
  });
}
