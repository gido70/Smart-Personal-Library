import "./lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SharedSupervisor from "./SharedSupervisor";
import "./globals.css";
import "./reader.css";
import "./pilot.css";
import "./v0103.css";
import "./presentation-polish.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{(window.location.pathname.endsWith("/user.html") || new URLSearchParams(window.location.search).get("supervisor")==="share") ? <SharedSupervisor/> : <App />}</React.StrictMode>,
);
