import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULTS, SettingsStore } from "../src/settings-store.ts";
import { createServer } from "../src/server.ts";

const dir = mkdtempSync(join(tmpdir(), "settings-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the store returns defaults when no file exists", () => {
  expect(new SettingsStore(join(dir, "none.json")).read()).toEqual(DEFAULTS);
});

test("the store round-trips settings", () => {
  const store = new SettingsStore(join(dir, "s.json"));
  store.write({ ...DEFAULTS, displayName: "Ada" });
  expect(store.read().displayName).toBe("Ada");
});

test("GET /api/settings returns the settings", async () => {
  const server = createServer(new SettingsStore(join(dir, "api.json")), 0);
  const res = await fetch(`http://localhost:${server.port}/api/settings`);
  expect(res.status).toBe(200);
  expect((await res.json()).email).toBe(DEFAULTS.email);
  server.stop(true);
});
