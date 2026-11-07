// Audition UI entry: the page shell, routes and sign-in guard.
// Folder layout follows quiver's conventions (pages/, layouts/, components/,
// state/) so a later move to quiver stays cheap (TECH-SPEC tech stack).
import { auth } from "./api.js";
import { route, start, refresh } from "./router.js";
import { mountShell, renderPage } from "./layouts/shell.js";
import { installPopovers, placeThumbs } from "./lib/ui.js";
import { refreshInbox } from "./state/inbox.js";

import signin from "./pages/signin.js";
import home from "./pages/home.js";
import workspace from "./pages/workspace.js";
import workspaceSettings from "./pages/workspace-settings.js";
import role from "./pages/role.js";
import task from "./pages/task.js";
import contenders from "./pages/contenders.js";
import contenderForm from "./pages/contender-form.js";
import newRun from "./pages/new-run.js";
import run from "./pages/run.js";
import handoff from "./pages/handoff.js";
import judge from "./pages/judge.js";
import leaderboard from "./pages/leaderboard.js";
import notFound from "./pages/not-found.js";

route("/signin", signin, { bare: true, open: true });
route("/", home);
route("/w/new", workspaceSettings, { section: "workspaces" });
route("/w/:id", workspace);
route("/w/:id/settings", workspaceSettings);
route("/w/:ws/roles/new", role);
route("/r/:id", role);
route("/r/:role/tasks/new", task);
route("/t/:id", task);
route("/contenders", contenders, { section: "contenders" });
route("/contenders/new", contenderForm, { section: "contenders" });
route("/contenders/:id/edit", contenderForm, { section: "contenders" });
route("/runs/new", newRun);
route("/runs/:id", run);
route("/handoff/:run/:task", handoff);
route("/judge/:run/:task", judge);
route("/leaderboard/:role", leaderboard);
route("*", notFound);

installPopovers();
addEventListener("resize", placeThumbs);
mountShell(document.getElementById("root"));

auth.onChange((t) => { if (!t) refresh(); });
start({
  before: (next) => (!auth.token && !next.route?.open ? "/signin" : null),
  render: (next) => {
    renderPage(next);
    if (auth.token && !next.route?.bare) refreshInbox();
  },
});
