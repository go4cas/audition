// "Add role" in a workspace (?stage=<id> preselects the stage).
import role from "../../../../editors/role.js";
import { routeArgs } from "../../../../lib/nav.js";

export const meta = { title: "New role · Audition" };

export default () => {
  const { params, query } = routeArgs();
  return role({ params: { ws: params.id }, query });
};
