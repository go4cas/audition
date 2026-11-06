// One REST endpoint: GET /api/settings returns the stored settings.
// The Back-end task adds saving (PUT /api/settings) with tests.
import { SettingsStore } from "./settings-store.ts";

export function createServer(store: SettingsStore, port = Number(process.env.PORT ?? 3000)) {
  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/settings" && req.method === "GET") {
        return Response.json(store.read());
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = createServer(new SettingsStore(process.env.SETTINGS_FILE ?? "settings.json"));
  console.log(`Listening on http://localhost:${server.port}`);
}
