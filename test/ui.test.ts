// T4 Done-when 3 to 5, checked without a browser: runtime dependencies, the
// UI build size, the judging screen's data source, and "outputs" wording.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../scripts/lib/vaultbase.ts";

const UI = join(ROOT, "ui", "src");
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : [p];
});
const js = files(UI).filter((f) => f.endsWith(".js"));

describe("dependencies", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  test("the only runtime dependency is @arrow-js/core, at an exact version", () => {
    expect(Object.keys(pkg.dependencies)).toEqual(["@arrow-js/core"]);
    expect(pkg.dependencies["@arrow-js/core"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
  test("no Tailwind or Vite anywhere", () => {
    const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
    for (const banned of ["tailwind", "vite"]) {
      expect(lock.toLowerCase()).not.toContain(`"${banned}`);
      for (const f of files(UI)) if (/\.(js|css|html)$/.test(f)) expect(readFileSync(f, "utf8").toLowerCase()).not.toContain(`@${banned}`);
    }
  });
  test("UI code imports nothing but Arrow and its own modules", () => {
    for (const f of js) {
      for (const m of readFileSync(f, "utf8").matchAll(/^\s*import\s[^'"]*["']([^"']+)["']/gm)) {
        expect(m[1] === "@arrow-js/core" || m[1].startsWith(".")).toBe(true);
      }
    }
  });
});

describe("build", () => {
  test("the UI builds, and its size is reported", () => {
    const b = Bun.spawnSync(["bun", join(ROOT, "scripts", "build-ui.ts")]);
    expect(b.exitCode).toBe(0);
    const dist = join(ROOT, "ui", "dist");
    const size = (ext: string) => files(dist).filter((f) => f.endsWith(ext)).reduce((n, f) => n + statSync(f).size, 0);
    const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
    const arrow = ["index.mjs", "chunks"].reduce((n, p) => {
      const full = join(ROOT, "node_modules", "@arrow-js", "core", "dist", p);
      return n + (statSync(full).isDirectory() ? files(full).filter((f) => f.endsWith(".mjs")).reduce((m, f) => m + statSync(f).size, 0) : statSync(full).size);
    }, 0);
    console.log(`UI build, minified: JS ${kb(size(".js"))} (Arrow.js package files: ${kb(arrow)}), CSS ${kb(size(".css"))}, HTML ${kb(size(".html"))}`);
    // TECH-SPEC T4 Done-when 3: under 150 KB of minified JS (CSS not counted).
    expect(size(".js")).toBeLessThan(150 * 1024);
    // The bundle is minified and ships a linked source map.
    const main = readFileSync(join(dist, "main.js"), "utf8");
    expect(main).toContain("//# sourceMappingURL=main.js.map");
    expect(JSON.parse(readFileSync(join(dist, "main.js.map"), "utf8")).sources.length).toBeGreaterThan(1);
  });
});

describe("judging screen (Done-when 4)", () => {
  const src = readFileSync(join(UI, "pages", "judge.js"), "utf8");
  test("never reads attempts: no attempts collection or route at all", () => {
    expect(src).not.toContain("/collections/attempts");
    expect(src).not.toContain("/api/v1/attempts");
    expect(src).not.toMatch(/\battempts\b/);
  });
  test("its only read is the blind route", () => {
    const calls = [...src.matchAll(/\bcustom\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(calls)).toEqual(new Set(["judging"]));
    // From the API client it takes the blind route, verdict creation and file
    // download helpers, and nothing that lists or reads records.
    const api = src.match(/import \{([^}]+)\} from "\.\.\/api\.js"/)![1].split(",").map((x) => x.trim()).sort();
    expect(api).toEqual(["create", "custom", "fileLabel", "fileUrl"]);
    expect(src).not.toMatch(/\b(list|one|fetch|request)\(/);
    expect(src).not.toMatch(/from "\.\.\/state\/data\.js"/);
    expect([...src.matchAll(/\bcreate\("(\w+)"/g)].map((m) => m[1])).toEqual(["verdicts"]);
  });
  test("the blind route in api.js is GET /api/custom/judging/:run/:task", () => {
    expect(readFileSync(join(UI, "api.js"), "utf8")).toContain('judging: async (runId, taskId) => data(await request("GET", C(`/judging/${runId}/${taskId}`)))');
  });
});

describe("wording (Done-when 5)", () => {
  test("no sentence in the UI says attempt", () => {
    // Text between tags in templates, and string literals that read as a
    // sentence (start with a capital, contain a space). Code names such as the
    // attempts collection are fine; the browser walkthrough also checks every
    // screen's visible text.
    for (const f of js) {
      const src = readFileSync(f, "utf8");
      const text = [...src.matchAll(/>([^<>]*)</g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, ""));
      const sentences = [...src.matchAll(/(["'`])([A-Z][^"'`\n]* [^"'`\n]*)\1/g)].map((m) => m[2]);
      const bad = [...text, ...sentences].filter((t) => /\battempts?\b/i.test(t));
      expect({ file: f, bad }).toEqual({ file: f, bad: [] });
    }
  });
});
