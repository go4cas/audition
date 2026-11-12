// Quiver 3.2 conventions (docs/PLATFORM-UPGRADES.md part D): the quiver:app
// module built from ui/src keeps every URL of the 3.1 route table, the main
// nav, the sign-in middleware and the views, with no build warnings.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../scripts/lib/vaultbase.ts";

describe("quiver:app", () => {
  const dir = mkdtempSync(join(tmpdir(), "audition-quiver-"));
  const out = join(dir, "app.gen.js");
  const r = Bun.spawnSync([join(ROOT, "node_modules", ".bin", "quiver"), "app", "--src", join(ROOT, "ui", "src"), "--out", out], { cwd: ROOT });
  const gen = r.exitCode === 0 ? readFileSync(out, "utf8") : "";
  rmSync(dir, { recursive: true, force: true });

  test("builds without errors or warnings", () => {
    expect(r.exitCode).toBe(0);
    expect(r.stderr.toString()).toBe("");
  });

  test("has the same URLs as the 3.1 route table", () => {
    const routes = [...gen.matchAll(/^\s*'([^']+)': \(\) => import\(/gm)].map((m) => m[1]!.replace(/:\w+/g, ":p"));
    expect(routes.sort()).toEqual([
      "/", "/contenders", "/contenders/:p/edit", "/contenders/new", "/handoff/:p/:p", "/judge/:p/:p",
      "/leaderboard/:p", "/r/:p", "/r/:p/tasks/new", "/runs/:p", "/runs/new", "/signin", "/t/:p",
      "/w/:p", "/w/:p/roles/new", "/w/:p/settings", "/w/new",
    ]);
    expect(gen).toMatch(/notFound: \(\) => import\('[^']+\/pages\/not-found\.js'\)/);
  });

  test("the main nav comes from the pages' meta.nav", () => {
    expect(gen).toContain("{ to: '/', label: 'Workspaces' },\n    { to: '/contenders', label: 'Contenders' },");
  });

  test("the sign-in guard is global middleware, and both views are set", () => {
    expect(gen).toMatch(/import middleware0 from '[^']+\/middleware\/auth\.js'/);
    expect(gen).toContain("middleware: { global: [middleware0], sections: {} }");
    expect(gen).toContain("views: { loading, error }");
    // The shell is mounted once outside the outlet, not a quiver layout (QD1).
    expect(gen).toContain("layouts: {}");
  });
});
