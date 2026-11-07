// GET /api/custom/app/* serves the built UI (TECH-SPEC Q2).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { boot, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { mimeFor, resolveAsset } from "../vb_hooks/lib/static.ts";

describe("resolveAsset (pure)", () => {
  const files = new Set(["/d/index.html", "/d/app.js", "/d/assets/x.css"]);
  const fs = { exists: async (p: string) => files.has(p), isFile: async (p: string) => files.has(p) };
  test("serves a file, and index.html for anything else", async () => {
    expect((await resolveAsset("/d", "/app/app.js", fs))?.path).toBe("/d/app.js");
    expect((await resolveAsset("/d", "/app/assets/x.css", fs))?.mime).toBe("text/css; charset=utf-8");
    expect((await resolveAsset("/d", "/app/", fs))?.path).toBe("/d/index.html");
    expect((await resolveAsset("/d", "/app/runs/123", fs))?.isIndex).toBe(true);
  });
  test("never leaves the dist folder", async () => {
    const bad = { exists: async () => true, isFile: async () => true };
    expect((await resolveAsset("/d", "/app/../../etc/passwd", bad))?.path).toBe("/d/index.html");
    expect((await resolveAsset("/d", "/app/%2e%2e/%2e%2e/etc/passwd", bad))?.path).toBe("/d/index.html");
  });
  test("mime types", () => {
    expect(mimeFor("a.js")).toBe("text/javascript; charset=utf-8");
    expect(mimeFor("a.svg")).toBe("image/svg+xml");
    expect(mimeFor("main.js.map")).toBe("application/json");
    expect(mimeFor("a.bin")).toBe("application/octet-stream");
  });
});

describe("on a running instance", () => {
  let h: Harness;
  beforeAll(async () => {
    const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
    if (b.exitCode !== 0) throw new Error(b.stderr.toString());
    h = await boot();
  });
  afterAll(async () => { await h?.cleanup(); });

  test("/api/custom/app/ serves the app shell with a strict CSP, signed out", async () => {
    const r = await fetch(`${h.url}/api/custom/app/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-security-policy")).toContain("script-src 'self';");
    // Only style *attributes* may be inline (per-element hue and width values); <style> and scripts may not.
    expect(r.headers.get("content-security-policy")).toContain("style-src 'self'; style-src-attr 'unsafe-inline';");
    const html = await r.text();
    expect(html).toContain("<title>Audition</title>");
    expect(html).toContain('<script type="module" src="main.js"></script>');
  });

  test("assets get their MIME type; unknown paths fall back to index.html", async () => {
    const css = await fetch(`${h.url}/api/custom/app/styles/app.css`);
    expect(css.headers.get("content-type")).toBe("text/css; charset=utf-8");
    const deep = await fetch(`${h.url}/api/custom/app/workspaces/123`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain("<title>Audition</title>");
    const icon = await fetch(`${h.url}/api/custom/app/icons/favicon.svg`);
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    const js = await fetch(`${h.url}/api/custom/app/main.js`);
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const font = await fetch(`${h.url}/api/custom/app/fonts/instrument-sans-latin.woff2`);
    expect(font.headers.get("content-type")).toBe("font/woff2");
  });

  test("path traversal never reaches files outside ui/dist", async () => {
    for (const p of ["/api/custom/app/..%2f..%2fvaultbase.lock.json", "/api/custom/app/%2e%2e/%2e%2e/package.json"]) {
      const r = await fetch(h.url + p);
      const text = await r.text();
      expect(text).not.toContain("sha256");
      expect(text).not.toContain("\"scripts\"");
    }
  });
});
