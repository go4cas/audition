// The app at the site root: ui/dist is Vaultbase's public folder
// (VAULTBASE_PUBLIC_DIR, VAULTBASE_PUBLIC_SPA=1), and GET /api/custom/app/*
// redirects old links there (TECH-SPEC Q2).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { boot, type Harness } from "./harness.ts";
import { ROOT } from "../scripts/lib/vaultbase.ts";
import { APP_CSP, EDGE_HEADERS, rootTarget } from "../vb_hooks/lib/static.ts";

const page = { headers: { accept: "text/html" } };

describe("policy and redirect target (pure)", () => {
  test("an old app link goes to the same page at the root, query kept", () => {
    expect(rootTarget("/app/")).toBe("/");
    expect(rootTarget("/app")).toBe("/");
    expect(rootTarget("/app/runs/123", { task: "x y" })).toBe("/runs/123?task=x+y");
    expect(rootTarget("/app/vote/tok-1")).toBe("/vote/tok-1");
  });
  test("a redirect never leaves the site", () => {
    expect(rootTarget("/app//evil.example/x")).toBe("/");
    expect(rootTarget("/app/\\evil.example")).toBe("/");
  });
  test("the CSP is strict, meta-safe, and lets only OneSignal in", () => {
    expect(APP_CSP).toContain("default-src 'self'");
    expect(APP_CSP).toContain("style-src-attr 'unsafe-inline'");
    expect(APP_CSP).not.toContain("unsafe-eval");
    expect(APP_CSP).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // A <meta> policy ignores frame-ancestors; the edge sends it instead.
    expect(APP_CSP).not.toContain("frame-ancestors");
    expect(EDGE_HEADERS["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    for (const host of APP_CSP.match(/https:\/\/[^\s;]+/g) ?? []) expect(host).toMatch(/^https:\/\/([a-z]+\.)?onesignal\.com$/);
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

  test("/ serves the app shell with its CSP in a meta tag, signed out", async () => {
    const r = await fetch(`${h.url}/`, page);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toStartWith("text/html");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-cache");
    const html = await r.text();
    expect(html).toContain("<title>Audition</title>");
    // The CSP comes first in <head>, so it covers every file the page loads.
    const meta = /<head>\s*<meta charset="utf-8">\s*<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
    expect(meta).not.toBeNull();
    expect(meta![1]).toBe(APP_CSP);
    expect(html).toContain('<meta name="referrer" content="same-origin">');
    expect(html).not.toContain("/api/custom/app/");
    // Absolute asset URLs at the root: the app uses real paths (/runs/123), so relative ones would break.
    expect(html).not.toMatch(/(href|src)="(?!\/)[^"]*"/);
    expect(html).toContain('<meta name="description"');
  });

  test("build files carry a content hash in their name and are cached for a year", async () => {
    const html = await (await fetch(`${h.url}/`, page)).text();
    const main = /<script type="module" src="(\/main-[A-Za-z0-9]{8,}\.js)"><\/script>/.exec(html);
    expect(main).not.toBeNull();
    const css = /href="(\/styles\/app-[0-9a-f]{10}\.css)"/.exec(html);
    const font = /href="\/(fonts\/bricolage-grotesque-latin-[0-9a-f]{10}\.woff2)"/.exec(html);
    const fontsCss = /href="(\/styles\/fonts-[0-9a-f]{10}\.css)"/.exec(html);
    expect(css && font && fontsCss).toBeTruthy();
    // fonts.css names the stamped font files.
    expect(await (await fetch(h.url + fontsCss![1])).text()).toContain(`url(../${font![1]})`);
    const year = "public, max-age=31536000, immutable";
    for (const [path, type] of [[main![1], "javascript"], [css![1], "text/css"], ["/" + font![1], "font/woff2"]] as const) {
      const r = await fetch(h.url + path);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain(type);
      expect(r.headers.get("cache-control")).toBe(year);
    }
    // The first-load chunks are preloaded with main.js (Lighthouse), when Bun splits any off.
    for (const m of html.matchAll(/<link rel="modulepreload" href="(\/chunks\/chunk-[\w]+\.js)">/g)) {
      expect((await fetch(h.url + m[1])).status).toBe(200);
    }
  });

  test("a page navigation to an app route gets index.html; a missing file stays a 404", async () => {
    const deep = await fetch(`${h.url}/w/123/settings`, page);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain("<title>Audition</title>");
    expect((await fetch(`${h.url}/styles/missing.css`)).status).toBe(404);
    const icon = await fetch(`${h.url}/icons/favicon.svg`);
    expect(icon.headers.get("content-type")).toStartWith("image/svg+xml");
  });

  test("Vaultbase's own paths keep priority over the app", async () => {
    const api = await fetch(`${h.url}/api/nope`, page);
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("application/json");
    expect((await fetch(`${h.url}/_/ready`)).status).toBe(200);
  });

  test("old /api/custom/app/ links redirect to the same page at the root", async () => {
    const r = await fetch(`${h.url}/api/custom/app/runs/abc?task=t1`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/runs/abc?task=t1");
    const home = await fetch(`${h.url}/api/custom/app/`, { redirect: "manual" });
    expect(home.headers.get("location")).toBe("/");
    const evil = await fetch(`${h.url}/api/custom/app//evil.example/`, { redirect: "manual" });
    expect(evil.headers.get("location")).toBe("/");
  });

  test("OneSignal's service worker is served next to the app", async () => {
    const w = await fetch(`${h.url}/OneSignalSDKWorker.js`);
    expect(w.status).toBe(200);
    expect(await w.text()).toContain('importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js")');
  });

  test("robots.txt is a real file, valid for Lighthouse, never the SPA index.html", async () => {
    for (const accept of ["*/*", "text/html"]) {
      const r = await fetch(`${h.url}/robots.txt`, { headers: { accept } });
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toStartWith("text/plain");
      const text = await r.text();
      expect(text).not.toContain("<html");
      expect(text).toContain("User-agent: *");
      // Lighthouse's robots-txt audit fails on any unknown directive (such as
      // Cloudflare's Content-Signal), and the sign-in page at / must stay crawlable.
      for (const line of text.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean)) {
        expect(line).toMatch(/^(user-agent|allow|disallow|sitemap):\s*\S/i);
        expect(line).not.toMatch(/^disallow:\s*\/\s*$/i);
      }
    }
  });

  test("path traversal and dotfiles never reach files outside ui/dist", async () => {
    for (const p of ["/..%2f..%2fvaultbase.lock.json", "/%2e%2e/%2e%2e/package.json", "/../package.json"]) {
      const text = await (await fetch(h.url + p)).text();
      expect(text).not.toContain("sha256");
      expect(text).not.toContain("\"scripts\"");
    }
  });
});
