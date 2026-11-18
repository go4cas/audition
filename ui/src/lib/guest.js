// The guest side of guest voters (TECH-SPEC §10b). A guest is a Vaultbase
// anonymous session of the `guests` collection, kept in its own storage key so
// it never mixes with the owner's token (api.js): an owner who opens a guest
// link on their own device votes as a guest, and stays signed in as the owner.

const KEY = "audition.guest";
let token = null;
try { token = localStorage.getItem(KEY); } catch { /* storage blocked: a new guest each visit */ }

const save = (t) => {
  token = t;
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* ignore */ }
};

export class GuestError extends Error {
  constructor(status, message) { super(message || `Request failed (${status})`); this.status = status; }
}

/** A guest session: the stored one, or a new anonymous one. */
async function session() {
  if (token) return token;
  const r = await fetch("/api/v1/auth/guests/anonymous", { method: "POST" });
  const j = await r.json().catch(() => null);
  if (r.status === 429) throw new GuestError(429, "Too many people are joining from your network right now. Try again in a minute.");
  if (!r.ok || !j?.data?.token) throw new GuestError(r.status, "Voting isn't open on this Audition right now.");
  save(j.data.token);
  return token;
}

/** A guest route call. A guest session the server no longer knows is replaced once. */
async function call(method, path, body, { raw = false } = {}, retry = true) {
  const t = await session();
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if ((res.status === 401 || res.status === 403) && retry) { save(null); return call(method, path, body, { raw }, false); }
  if (raw) { if (!res.ok) throw new GuestError(res.status); return res; }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new GuestError(res.status, j?.error);
  return j?.data;
}

const G = (token) => `/api/custom/guest/${encodeURIComponent(token)}`;
export const ballot = (link) => call("GET", G(link));
export const vote = (link, body) => call("POST", G(link) + "/votes", body);

/** An output file as an object URL (the guest route needs the header, so <img src> can't fetch it). */
const blobs = new Map();
export function guestFile(url) {
  if (!blobs.has(url)) {
    blobs.set(url, call("GET", url, undefined, { raw: true }).then((r) => r.blob()).then((b) => URL.createObjectURL(b))
      .catch((e) => { blobs.delete(url); throw e; }));
  }
  return blobs.get(url);
}
