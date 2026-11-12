// Global middleware (quiver:app): everything but /signin needs a token. The
// page asked for comes back after sign-in through ?next=.
import { auth } from "../api.js";

export default function signedIn({ to }) {
  if (auth.token || to === "/signin") return undefined;
  return to === "/" ? "/signin" : "/signin?next=" + encodeURIComponent(to);
}
