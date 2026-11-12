// "New contender", or a duplicate of one with ?from=<id>.
import contenderForm from "../../editors/contender.js";
import { routeArgs } from "../../lib/nav.js";

export const meta = { title: "New contender · Audition" };

export default () => contenderForm({ params: {}, query: routeArgs().query });
