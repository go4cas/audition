// Loaders shared by the pages. Phase 1 has one owner and small tables, so
// pages simply load what they need on arrival; nothing is cached across pages.
import { custom, list } from "../api.js";

const COLLECTIONS = ["workspaces", "groups", "roles", "tasks", "contenders", "connections", "runs", "castings"];
const SORT = { groups: "order", runs: "created", castings: "-created" };

/** Load whole collections: `const d = await load("roles", "tasks")` → d.roles, d.byId.roles.get(id). */
export async function load(...names) {
  const want = names.length ? names : COLLECTIONS;
  const rows = await Promise.all(want.map((n) => list(n, { sort: SORT[n] })));
  const d = { byId: {} };
  want.forEach((n, i) => { d[n] = rows[i]; d.byId[n] = new Map(rows[i].map((r) => [r.id, r])); });
  if (d.runs) d.runNo = new Map(d.runs.map((r, i) => [r.id, i + 1]));
  return d;
}

export const runLabel = (d, run) => `Run ${d.runNo?.get(run.id) ?? "?"}`;

/** The confirmed casting for a role: its newest confirmed casting (TECH-SPEC §6). */
export const championOf = (d, roleId) => d.castings.find((c) => c.role === roleId && c.confirmed);

/**
 * Every role's leaderboard (or one workspace's) as a Map by role id, in one
 * request (GET /leaderboards). If it fails the pages just show no boards.
 */
export async function leaderboards(workspace) {
  try { return new Map(Object.entries((await custom.leaderboards(workspace)) || {})); } catch { return new Map(); }
}

export const sortRoles = (d, roles) => {
  const order = (r) => (r.group ? d.byId.groups.get(r.group)?.order ?? 0 : 1e9);
  return [...roles].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
};

export const PROVIDER_LABEL = { anthropic: "Anthropic", "openai-compatible": "OpenAI-compatible", mock: "Mock", manual: "Manual" };
export const contenderMeta = (d, c) => {
  const conn = d.byId.connections?.get(c.connection);
  if (c.mode === "handoff") return "Copy and paste";
  const bits = [c.model, conn ? PROVIDER_LABEL[conn.provider] : null, c.config?.effort ? `${c.config.effort} effort` : null, c.config?.image ? "makes images" : null];
  return bits.filter(Boolean).join(" · ");
};
