import "./lib/polyfills";
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SharedSupervisor from "./SharedSupervisor";

const StudyParticipant = lazy(() => import("./study/StudyParticipant"));
const isStudy = window.location.pathname.endsWith("/study.html");
import "./globals.css";
import "./reader.css";
import "./pilot.css";
import "./v0103.css";
import "./presentation-polish.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isStudy ? <Suspense fallback={null}><StudyParticipant/></Suspense> : (window.location.pathname.endsWith("/user.html") || new URLSearchParams(window.location.search).get("supervisor")==="share") ? <SharedSupervisor/> : <App />}</React.StrictMode>,
);
