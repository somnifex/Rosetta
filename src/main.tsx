import "./i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { migrateStorageKeys } from "./lib/storage-keys";
import "katex/dist/katex.min.css";
import "./index.css";

migrateStorageKeys();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
