import React from "react";
import { createRoot } from "react-dom/client";
import "../fonts.css";
import "../base.css";
import { SecuritiesApp } from "./SecuritiesApp.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SecuritiesApp />
  </React.StrictMode>,
);
