import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const productShells = new Map([
  ["/securities", "/securities.html"],
  ["/securities/architecture", "/securities-architecture.html"],
  ["/xnhan", "/xnhan.html"],
  ["/xnhan/about", "/xnhan-about.html"],
]);

export function rewriteProductShellRequestUrl(requestUrl) {
  if (typeof requestUrl !== "string") return requestUrl;

  const parsed = new URL(requestUrl, "http://vite.local");
  const pathname = parsed.pathname.length > 1
    ? parsed.pathname.replace(/\/+$/u, "")
    : parsed.pathname;
  const shell = productShells.get(pathname);

  return shell ? `${shell}${parsed.search}` : requestUrl;
}

function useRouteSpecificShells(server) {
  server.middlewares.use((request, _response, next) => {
    request.url = rewriteProductShellRequestUrl(request.url);
    next();
  });
}

function routeSpecificShells() {
  return {
    name: "route-specific-html-shells",
    configureServer: useRouteSpecificShells,
    configurePreviewServer: useRouteSpecificShells,
  };
}

export default defineConfig({
  build: {
    outDir: "dist/client",
    rollupOptions: {
      input: {
        securities: fileURLToPath(new URL("./securities.html", import.meta.url)),
        securitiesArchitecture: fileURLToPath(new URL("./securities-architecture.html", import.meta.url)),
        portfolio: fileURLToPath(new URL("./index.html", import.meta.url)),
        xnhan: fileURLToPath(new URL("./xnhan.html", import.meta.url)),
        xnhanAbout: fileURLToPath(
          new URL("./xnhan-about.html", import.meta.url),
        ),
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    fs: {
      strict: true,
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/key.txt", "**/.dev.vars*"],
    },
    warmup: {
      clientFiles: [
        "./src/main.jsx",
        "./src/xnhan/xnhan-main.jsx",
        "./src/xnhan/xnhan-about-main.jsx",
      ],
    },
  },
  plugins: [routeSpecificShells(), react()],
});
