import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ConnectedApp } from "./connected/ConnectedApp.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("アプリの描画先が見つかりません。");

const queryClient = new QueryClient();
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {new URLSearchParams(location.search).get("mode") === "demo" ? (
        <App />
      ) : (
        <ConnectedApp />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
