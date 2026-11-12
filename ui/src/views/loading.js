// Shown in #main while a page's chunk loads (quiver:app views/loading.js).
import { html } from "@arrow-js/core";
import { skeleton } from "../components/page.js";

export default () => html`<section class="page">${skeleton()}</section>`;
