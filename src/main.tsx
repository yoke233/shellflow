import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const app = <App />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  import.meta.env.DEV ? <React.StrictMode>{app}</React.StrictMode> : app,
);
