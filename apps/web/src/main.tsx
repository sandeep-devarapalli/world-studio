import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/spline-sans/400.css";
import "@fontsource/spline-sans/500.css";
import "@fontsource/source-serif-4/600.css";
import "@world-studio/design-system/world-studio.css";
import "./styles.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

