import React from "react";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import "./base.css";
import { XNhanApp } from "./XNhanApp.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <XNhanApp />
  </React.StrictMode>,
);
