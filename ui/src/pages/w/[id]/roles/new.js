// "Add role" in a workspace (?group=<id> preselects the group).
import role from "../../../../editors/role.js";
import { routeArgs } from "../../../../lib/nav.js";

export const meta = { title: "New role · Audition" };

export default () => {
  const { params, query } = routeArgs();
  return role({ params: { ws: params.id }, query });
};
