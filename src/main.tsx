import "./lib/polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AppV11 from "./AppV11";
import "./globals.css";
import "./reader.css";
import "./pilot.css";
import "./v011.css";
import "./v011-review-fixes.css";

const legacy = new URLSearchParams(window.location.search).get("legacy") === "1";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{legacy ? <App /> : <AppV11 />}</React.StrictMode>,
);
