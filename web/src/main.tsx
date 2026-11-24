import "@fontsource-variable/source-sans-3/wght.css";
import "@fontsource-variable/source-sans-3/wght-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("The page has no #root element.");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
