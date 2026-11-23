// Plain-fetch client for Vaultbase's records API and Audition's custom routes
// (TECH-SPEC Q3). Same origin, so paths are absolute from the server root.
// The owner's token lives in localStorage; a 401 signs the owner out.

const KEY = "audition.token";
let token = null;
try { token = localStorage.getItem(KEY); } catch { /* storage blocked */ }
const listeners = new Set();

export const auth = {
  get token() { return token; },
  set(t) {
    token = t || null;
    try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
    listeners.forEach((f) => f(token));
  },
  onChange(f) { listeners.add(f); return () => listeners.delete(f); },
};

export class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.error || body.message)) || `Request failed (${status})`);
    this.status = status;
    this.details = body && body.details;
  }
}

async function request(method, path, body, { raw = false } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  let res = await fetch(path, { method, headers, body: payload });
  // Vaultbase's rate limit (300 requests per 10 s on /api/*, NOTES RF2) answers
  // 429 before doing anything, so the same request is safe to send again once
  // it says so: wait Retry-After (at most 5 s), up to three times.
  for (let i = 0; res.status === 429 && i < 3; i++) {
    const wait = Math.min(5, Number(res.headers.get("retry-after")) || 1);
    await new Promise((r) => setTimeout(r, wait * 1000));
    res = await fetch(path, { method, headers, body: payload });
  }
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, null);
    return res;
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: text }; }
  if (res.status === 401 && token) auth.set(null);
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

const q = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

/** Quote a value for a Vaultbase filter expression. */
export const lit = (v) => JSON.stringify(String(v));

// ---------- Records ----------
const R = (c) => `/api/v1/${c}`;

export async function list(collection, { filter, sort, expand, perPage = 500 } = {}) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await request("GET", R(collection) + q({ filter, sort, expand, perPage, page }));
    out.push(...(r.data || []));
    if (!r.totalPages || page >= r.totalPages) return out;
  }
}
/** One page of a collection, with its totals: { data, totalItems, totalPages }. */
export const page = (collection, { filter, sort, perPage = 50, page: n = 1 } = {}) =>
  request("GET", R(collection) + q({ filter, sort, perPage, page: n }));
export const one = async (collection, id) => (await request("GET", `${R(collection)}/${id}`)).data;
export const create = async (collection, data) => (await request("POST", R(collection), data)).data;
export const update = async (collection, id, data) => (await request("PATCH", `${R(collection)}/${id}`, data)).data;
export const remove = (collection, id) => request("DELETE", `${R(collection)}/${id}`);

// ---------- Sign-in ----------
export async function signIn(email, password) {
  const r = await request("POST", "/api/v1/auth/users/login", { email, password });
  if (r.data && r.data.mfa_required) return { mfaToken: r.data.mfa_token };
  auth.set(r.data.token);
  return { record: r.data.record };
}
export async function signInCode(mfaToken, code) {
  const r = await request("POST", "/api/v1/auth/users/login/mfa", { mfa_token: mfaToken, code: code.replace(/\s+/g, "") });
  auth.set(r.data.token);
  return { record: r.data.record };
}
export const signOut = () => auth.set(null);
/** The signed-in owner, from the token (no extra call needed). */
export function me() {
  if (!token) return null;
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
}

// ---------- Custom routes (TECH-SPEC §7) ----------
const C = (p) => `/api/custom${p}`;
const data = (r) => (r && "data" in r ? r.data : r);
export const custom = {
  preview: async (body) => data(await request("POST", C("/runs/preview"), body)),
  startRun: async (body) => data(await request("POST", C("/runs"), body)),
  runAgain: async (id) => data(await request("POST", C(`/runs/${id}/again`))),
  outcomes: async () => data(await request("GET", C("/outcomes"))),
  push: async () => data(await request("GET", C("/push"))),
  scoreOutcome: async (id, body) => data(await request("POST", C(`/outcomes/${id}`), body)),
  runSchedule: async (id, schedule) => data(await request("POST", C(`/runs/${id}/schedule`), { schedule })),
  run: async (id) => data(await request("GET", C(`/runs/${id}`))),
  handoff: async (runId, taskId) => data(await request("GET", C(`/handoff/${runId}/${taskId}`))),
  judging: async (runId, taskId) => data(await request("GET", C(`/judging/${runId}/${taskId}`))),
  leaderboard: async (roleId) => data(await request("GET", C(`/leaderboard/${roleId}`))),
  leaderboards: async (workspace) => data(await request("GET", C("/leaderboards" + (workspace ? `?workspace=${encodeURIComponent(workspace)}` : "")))),
  cast: async (body) => data(await request("POST", C("/castings"), body)),
  keepChampion: async (role) => data(await request("POST", C(`/champion/${role}/keep`))),
  restoreChampion: async (role, rationale) => data(await request("POST", C(`/champion/${role}/restore`), { rationale })),
  compose: async (taskId) => data(await request("POST", C(`/tasks/${taskId}/compose`))),
  removeKey: (connectionId) => request("DELETE", C(`/connections/${connectionId}/key`)),
};

// ---------- Files ----------
// Uploads go through Audition's owner upload route (multipart, parts named
// `file`). Vaultbase's own endpoint works since 0.41.1 (F9) but can't take
// Markdown, CSV or zip files (NOTES.md W1), so the route stays.
// F4: the server checks types by extension; we also set a MIME type the
// Vaultbase allowlist accepts.
const TEXTLIKE = /\.(md|markdown|txt|csv|log)$/i;
export function uploadMime(file) {
  if (TEXTLIKE.test(file.name)) return "text/plain";
  if (/\.zip$/i.test(file.name)) return "application/octet-stream";
  return file.type || "application/octet-stream";
}
export async function upload(collection, id, field, files) {
  const form = new FormData();
  for (const f of files) form.append("file", new File([f], f.name, { type: uploadMime(f) }));
  return data(await request("POST", C(`/files/${collection}/${id}/${field}`), form));
}
/** Protected files need the bearer header, so they are fetched as blobs. */
const blobCache = new Map();
export function fileUrl(nameOrUrl) {
  const path = nameOrUrl.startsWith("/") ? nameOrUrl : `/api/v1/files/${nameOrUrl}`;
  if (!blobCache.has(path)) {
    blobCache.set(path, request("GET", path, undefined, { raw: true })
      .then((r) => r.blob()).then((b) => URL.createObjectURL(b))
      .catch((e) => { blobCache.delete(path); throw e; }));
  }
  return blobCache.get(path);
}
/**
 * A small preview of an image file, made and cached by Vaultbase. The sizes
 * must be in the file field's `thumbs` list (schema/snapshot.json), or
 * Vaultbase sends the full file. Opening an image still uses fileUrl.
 */
export const THUMB = { small: "160x120_cover", card: "640x640_cover" };
export const thumbUrl = (nameOrUrl, size) => fileUrl(`${nameOrUrl}?thumb=${size}`);
/** Original file name: Vaultbase stores files as <uuid>.<ext>. */
export const fileLabel = (name) => String(name).replace(/^.*\//, "");
