import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { handleApiRoutes } from "./server/apiRouter.js";

function adsparkApiPlugin() {
  return {
    name: "adspark-api-plugin",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url && req.url.startsWith("/api/")) {
          handleApiRoutes(req, res, next);
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), adsparkApiPlugin()],
});
