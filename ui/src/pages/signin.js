// 1. Sign in: one owner account; the code field appears only when two-step
// sign-in is on (Vaultbase answers mfa_required).
import { html, reactive } from "@arrow-js/core";
import { signIn, signInCode } from "../api.js";
import { go } from "../lib/nav.js";
import { icon, toast } from "../lib/ui.js";
import { logo } from "../layouts/shell.js";

export default function signin({ query }) {
  const s = reactive({ email: "", password: "", code: "", mfa: null, error: "", busy: false });
  const submit = async (e) => {
    e.preventDefault();
    s.busy = true; s.error = "";
    try {
      if (s.mfa) await signInCode(s.mfa, s.code);
      else {
        const r = await signIn(s.email.trim(), s.password);
        if (r.mfaToken) { s.mfa = r.mfaToken; s.busy = false; return; }
      }
      toast("Signed in");
      go(query.next && query.next.startsWith("/") ? query.next : "/");
    } catch (err) {
      s.error = err.status === 401 || err.status === 400 ? (s.mfa ? "That code didn't work. Try the newest one." : "That email and password don't match.") : err.message;
    }
    s.busy = false;
  };
  return html`<section class="page page--narrow" data-screen="signin">
    <div class="panel signin">
      <div class="panel__body signin__body">
        <div class="stack-sm signin__head">
          <span class="brand__mark has-logo signin__mark">${logo()}</span>
          <h1>Welcome back</h1>
          <p class="muted small">Audition has one owner account. Nobody else can sign in.</p>
        </div>
        <form class="stack" @submit="${submit}">
          <div class="field"><label for="si-email">Email</label><input class="input" id="si-email" type="email" autocomplete="username" required value="${() => s.email}" @input="${(e) => { s.email = e.target.value; }}" disabled="${() => !!s.mfa}"></div>
          <div class="field"><label for="si-pass">Password</label><input class="input" id="si-pass" type="password" autocomplete="current-password" required value="${() => s.password}" @input="${(e) => { s.password = e.target.value; }}" disabled="${() => !!s.mfa}"></div>
          ${() => (s.mfa ? html`<div class="field"><label for="si-code">${icon("mfa")}Code from your authenticator app</label><input class="input num" id="si-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123 456" required @input="${(e) => { s.code = e.target.value; }}"><span class="hint">Two-step sign-in is on for this account.</span></div>` : "")}
          ${() => (s.error ? html`<div class="notice" data-state="error" role="alert">${icon("error")}<div>${s.error}</div></div>` : "")}
          <button class="${() => "btn btn--primary btn--lg" + (s.busy ? " is-loading" : "")}" type="submit">Sign in${icon("arrow-right", "i--nudge")}</button>
        </form>
      </div>
    </div>
  </section>`;
}
