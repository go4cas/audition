import task from "../../../../editors/task.js";
import { routeArgs } from "../../../../lib/nav.js";

export const meta = { title: "New task · Audition" };

export default () => task({ params: { role: routeArgs().params.id } });
