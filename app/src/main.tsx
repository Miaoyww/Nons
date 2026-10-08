import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@/styles/globals.css";
import { initializeFontSettings } from "@/lib/font-settings";
import { installPluginBridge } from "@/plugins/host";

initializeFontSettings();
installPluginBridge();

// Let custom menus handle the event first, then suppress the WebView default menu.
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

// Keep Tab from moving focus or triggering component-level navigation.
window.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, { capture: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
