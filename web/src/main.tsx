import { render } from "preact";
import { App } from "./app.tsx";

const root = document.getElementById("app");
if (root !== null) render(<App />, root);
