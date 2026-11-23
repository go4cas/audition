// GET /api/custom/app/* serves the built UI (TECH-SPEC Q2).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { boot, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { cacheControl, mimeFor, resolveAsset } from "../vb_hooks/lib/static.ts";

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
  test("cache lifetime: index never, build-hashed URLs a year, the rest five minutes", () => {
    expect(cacheControl("/app/", true, { v: "0123456789" })).toBe("no-cache");
    expect(cacheControl("/app/chunks/z7py0mje.js", false)).toBe("public, max-age=31536000, immutable");
    expect(cacheControl("/app/main.js", false, { v: "0674ae6f18" })).toBe("public, max-age=31536000, immutable");
    expect(cacheControl("/app/main.js", false)).toBe("public, max-age=300");
    expect(cacheControl("/app/main.js", false, { v: "latest" })).toBe("public, max-age=300");
    expect(cacheControl("/app/icons/favicon.svg", false)).toBe("public, max-age=300");
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
    // Absolute asset URLs: the app uses real paths (…/app/runs/123), so relative ones would break.
    // Cache busting: main.js and the stylesheets carry a content hash, so an upgrade reaches browsers at once.
    const main = /<script type="module" src="\/api\/custom\/app\/main\.js\?v=([0-9a-f]{10})"><\/script>/.exec(html);
    expect(main).not.toBeNull();
    expect(html).toMatch(/href="\/api\/custom\/app\/styles\/app\.css\?v=[0-9a-f]{10}"/);
    const js = await fetch(`${h.url}/api/custom/app/main.js?v=${main![1]}`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const bytes = new Uint8Array(await js.arrayBuffer());
    expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 10)).toBe(main![1]);
    expect(html).not.toMatch(/(href|src)="(?!\/api\/custom\/app\/)[^"]*"/);
    // Lighthouse (Nov 2026): a meta description, the first-load chunks preloaded
    // with main.js, and the fonts versioned like the rest.
    expect(html).toContain('<meta name="description"');
    const pre = [...html.matchAll(/<link rel="modulepreload" href="(\/api\/custom\/app\/chunks\/[\w-]+\.js)">/g)].map((m) => m[1]!);
    expect(pre.length).toBeGreaterThan(0);
    const chunk = await fetch(h.url + pre[0]);
    expect(chunk.status).toBe(200);
    expect(chunk.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(js.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(r.headers.get("cache-control")).toBe("no-cache");
    const font = /href="(\/api\/custom\/app\/fonts\/bricolage-grotesque-latin\.woff2\?v=[0-9a-f]{10})"/.exec(html);
    expect(font).not.toBeNull();
    const fontsCss = /href="(\/api\/custom\/app\/styles\/fonts\.css\?v=[0-9a-f]{10})"/.exec(html);
    expect(await (await fetch(h.url + fontsCss![1])).text()).toContain(font![1]!.replace("/api/custom/app/", "../"));
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
