// Navigation helpers on top of quiver (docs/PLATFORM-UPGRADES.md part C).
// The app lives under one fixed base path, served by vb_hooks/routes/app.ts.
// Pages pass base-relative paths ("/runs/123") with an optional query object;
// APP is the base without its trailing slash, for building link hrefs.
import { go as quiverGo, url } from "@go4cas/quiver";

export const BASE = "/api/custom/app/";
export const APP = BASE.slice(0, -1);

const withQuery = (path, query) => {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "")).toString() : "";
  return path + (qs ? "?" + qs : "");
};

/** A link href for a base-relative path: href("/runs/new", { role }) → "/api/custom/app/runs/new?role=…". */
export const href = (path, query) => url(withQuery(path, query));

/** Navigate in the app (after a save, sign-in, sign-out). Links use plain hrefs. */
export const go = (path, query) => quiverGo(withQuery(path, query));

/** The current query string as a plain object. Quiver's routes are path-only. */
export const currentQuery = () => Object.fromEntries(new URLSearchParams(location.search));

/**
 * An old hash link (`/api/custom/app/#/runs/123?task=x`, from before quiver)
 * as the new path URL, or null when the URL has no `#/` route.
 */
export function fromHashLink(loc = location) {
  if (!loc.hash.startsWith("#/")) return null;
  return APP + loc.hash.slice(1);
}
