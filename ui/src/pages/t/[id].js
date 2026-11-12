import task from "../../editors/task.js";
import { routeArgs } from "../../lib/nav.js";

export const meta = { title: "Task · Audition" };

export default () => task(routeArgs());
