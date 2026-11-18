// Global middleware (quiver:app): everything but /signin and the guest
// voting page (/vote/<link>, TECH-SPEC §10b) needs the owner's token. The page
// asked for comes back after sign-in through ?next=.
import { auth } from "../api.js";

export default function signedIn({ to }) {
  if (auth.token || to === "/signin" || to.startsWith("/vote/")) return undefined;
  return to === "/" ? "/signin" : "/signin?next=" + encodeURIComponent(to);
}
