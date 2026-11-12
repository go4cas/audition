// Unknown hash routes.
import { html } from "@arrow-js/core";
import { empty } from "../components/page.js";
import { APP } from "../lib/nav.js";

export const meta = { title: "Not found · Audition" };

export default function notFound() {
  return html`<section class="page page--narrow" data-screen="not-found">${empty("disabled", "This page doesn't exist", "The link may be old.", html`<a class="btn btn--primary" href="${APP + "/"}">Go home</a>`)}</section>`;
}
