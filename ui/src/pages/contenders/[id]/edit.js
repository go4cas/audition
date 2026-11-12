import contenderForm from "../../../editors/contender.js";
import { routeArgs } from "../../../lib/nav.js";

export const meta = { title: "Edit contender · Audition" };

export default () => contenderForm(routeArgs());
