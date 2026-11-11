// The route table as a quiver manifest: one lazy page module per route, so
// Bun.build splits the UI into a small first-load bundle plus one chunk per
// page (Q6). Audition's pages take ({ params, query }); `page()` adapts them
// to quiver's argument-less page functions and carries each route's meta:
// `bare` (no top bar, for sign-in), `open` (no sign-in needed) and `section`
// (which main nav item is current).
import { useRoute } from "@go4cas/quiver";
import { currentQuery } from "./lib/nav.js";

const page = (load, meta = {}) => () => load().then((m) => ({
  meta,
  default: () => {
    const route = useRoute();
    return m.default({ params: route.params(), query: currentQuery() });
  },
}));

const contenders = { section: "contenders" };
// Static page titles (quiver sets document.title from meta.title).
const t = (name) => name + " · Audition";

export const routes = {
  "/signin": page(() => import("./pages/signin.js"), { bare: true, open: true, title: t("Sign in") }),
  "/": page(() => import("./pages/home.js"), { title: t("Workspaces") }),
  "/w/new": page(() => import("./pages/workspace-settings.js"), { title: t("New workspace") }),
  "/w/:id": page(() => import("./pages/workspace.js"), { title: t("Workspace") }),
  "/w/:id/settings": page(() => import("./pages/workspace-settings.js"), { title: t("Workspace settings") }),
  "/w/:ws/roles/new": page(() => import("./pages/role.js"), { title: t("New role") }),
  "/r/:id": page(() => import("./pages/role.js"), { title: t("Role") }),
  "/r/:role/tasks/new": page(() => import("./pages/task.js"), { title: t("New task") }),
  "/t/:id": page(() => import("./pages/task.js"), { title: t("Task") }),
  "/contenders": page(() => import("./pages/contenders.js"), { ...contenders, title: t("Contenders") }),
  "/contenders/new": page(() => import("./pages/contender-form.js"), { ...contenders, title: t("New contender") }),
  "/contenders/:id/edit": page(() => import("./pages/contender-form.js"), { ...contenders, title: t("Edit contender") }),
  "/runs/new": page(() => import("./pages/new-run.js"), { title: t("Start a run") }),
  "/runs/:id": page(() => import("./pages/run.js"), { title: t("Run") }),
  "/handoff/:run/:task": page(() => import("./pages/handoff.js"), { title: t("Paste replies") }),
  "/judge/:run/:task": page(() => import("./pages/judge.js"), { title: t("Judge") }),
  "/leaderboard/:role": page(() => import("./pages/leaderboard.js"), { title: t("Leaderboard") }),
};

export const notFound = page(() => import("./pages/not-found.js"), { title: t("Not found") });
