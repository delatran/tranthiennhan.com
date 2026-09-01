import React from "react";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import "./base.css";
import { XNhanAboutApp } from "./XNhanAboutApp.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <XNhanAboutApp />
  </React.StrictMode>,
);
