// Shown in #main when a page fails to load or render (quiver:app views/error.js).
import { html } from "@arrow-js/core";
import { errorBox } from "../components/page.js";

export default ({ message, retry }) => html`<section class="page page--narrow" data-screen="error">${errorBox(message, retry)}</section>`;
