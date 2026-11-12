import workspaceSettings from "../../../editors/workspace.js";
import { routeArgs } from "../../../lib/nav.js";

export const meta = { title: "Workspace settings · Audition" };

export default () => workspaceSettings(routeArgs());
