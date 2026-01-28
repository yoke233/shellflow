import React from "react";
import ReactDOM from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import { log } from "./lib/log";
import App from "./App";
import { SplitProvider } from "./contexts/SplitContext";
import "./index.css";

// attachConsole() makes Rust logs appear in browser DevTools console
// (via the Webview target in tauri-plugin-log)
attachConsole();

// Use log.info() etc. to send frontend logs to stdout/file
log.info("[main] App starting");

const app = (
  <SplitProvider>
    <App />
  </SplitProvider>
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  import.meta.env.DEV ? <React.StrictMode>{app}</React.StrictMode> : app,
);
