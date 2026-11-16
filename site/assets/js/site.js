// Audition site: small interactions, no dependencies.
// Everything here is progressive: the page reads fine with scripts off.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const ICONS = (root.dataset.base || "") + "assets/icons.svg";
  const icon = (id, cls = "icon") => `<svg class="${cls}"><use href="${ICONS}#${id}"/></svg>`;

  // ---- Theme toggle (system by default, remembered once chosen) ----
  const dark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  $("#theme")?.addEventListener("click", () => {
    const next = dark() ? "light" : "dark";
    const swap = () => { root.dataset.theme = next; try { localStorage.setItem("audition-theme", next); } catch {} };
    if (document.startViewTransition && !reduce) document.startViewTransition(swap); else swap();
  });

  // ---- Sticky nav gets a background once you scroll ----
  const nav = $("#nav");
  const onScrollNav = () => nav.classList.toggle("is-stuck", scrollY > 8);

  // ---- Reveal on scroll ----
  // Blocks already on screen stay put; the rest fade up as they arrive.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("is-in"); e.target.classList.remove("is-pending"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  $$(".reveal").forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight) { el.classList.add("is-in"); return; }
    if (!reduce) el.classList.add("is-pending");
    io.observe(el);
  });
  // Stagger list rows without hand-numbering them.
  $$(".vb__list li").forEach((li, i) => li.style.setProperty("--i", i % 10));

  // ---- Hero: rotating role ----
  const roles = ["role.", "researcher.", "copywriter.", "image maker.", "stock analyst.", "trip planner.", "code reviewer."];
  const rot = $("#rotator");
  if (rot && !reduce) {
    let i = 0;
    setInterval(() => {
      const old = rot.querySelector(".rotator__word:not(.is-out)");
      i = (i + 1) % roles.length;
      const w = document.createElement("span");
      w.className = "rotator__word is-in"; w.textContent = roles[i];
      old.classList.add("is-out");
      rot.append(w);
      setTimeout(() => old.remove(), 500);
    }, 2400);
  }

  // ---- Hero: stars fill in, one by one, on a loop ----
  const stars = $$("#heroStars .icon");
  if (stars.length && !reduce) {
    let n = 0;
    setInterval(() => {
      n = n >= 5 ? 0 : n + 1;
      stars.forEach((s, k) => s.classList.toggle("on", k < n));
    }, 520);
  } else stars.forEach((s) => s.classList.add("on"));

  // ---- Hero: spotlight follows the pointer, floats drift with it ----
  const hero = $("#hero"), spot = $(".hero__spot"), floats = $$(".float");
  if (hero && !reduce && matchMedia("(pointer: fine)").matches) {
    let raf = 0;
    hero.addEventListener("pointermove", (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = hero.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        spot.style.setProperty("--mx", `${30 + x * 40}%`);
        for (const f of floats) {
          const d = +f.dataset.depth || 1;
          f.style.setProperty("--fx", `${(x - 0.5) * 18 * d}px`);
          f.style.setProperty("--fy", `${(y - 0.5) * 12 * d}px`);
        }
      });
    });
  }

  // ---- Hero: the product shot tilts back until you scroll to it ----
  const frame = $("#heroFrame");
  const onScrollTilt = () => {
    if (!frame || reduce) return;
    const r = frame.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, 1 - (r.top - innerHeight * 0.18) / (innerHeight * 0.62)));
    frame.style.setProperty("--tilt", `${(1 - p) * 22}deg`);
    frame.style.setProperty("--tscale", `${0.94 + p * 0.06}`);
  };

  // ---- How it works: steps light up, the screen beside them follows ----
  const steps = $$(".step"), shots = $$("#storyShots .shot"), url = $("#storyUrl"), fill = $(".steps__fill"), stepsEl = $("#steps");
  let current = 0;
  const show = (n) => {
    if (n === current) return;
    current = n;
    steps.forEach((s, k) => s.classList.toggle("is-on", k === n));
    shots.forEach((s, k) => s.classList.toggle("is-on", k === n));
    if (url && shots[n]) url.textContent = shots[n].dataset.url;
  };
  const onScrollSteps = () => {
    if (!stepsEl) return;
    const mid = innerHeight * 0.5;
    let n = 0;
    steps.forEach((s, k) => { if (s.getBoundingClientRect().top < mid) n = k; });
    show(n);
    const r = stepsEl.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (mid - r.top) / r.height));
    fill?.style.setProperty("--fill", `${p * 100}%`);
  };

  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { onScrollNav(); onScrollTilt(); onScrollSteps(); ticking = false; });
  }, { passive: true });
  onScrollNav(); onScrollTilt(); onScrollSteps();

  // ---- Feature tiles: a soft light follows the pointer ----
  $$("[data-glow]").forEach((t) => t.addEventListener("pointermove", (e) => {
    const r = t.getBoundingClientRect();
    t.style.setProperty("--x", `${e.clientX - r.left}px`);
    t.style.setProperty("--y", `${e.clientY - r.top}px`);
  }));

  // ---- Try it: blind judging demo ----
  const rubric = [["Practical and realistic", 35], ["Matches the brief", 30], ["Specific places named", 20], ["Easy to follow", 15]];
  const cards = $$("#duel .card3d");
  const btn = $("#reveal"), hint = $("#duelHint"), bar = $("#blindbar");
  let revealed = false;
  cards.forEach((card) => {
    const box = $("[data-rate]", card), id = card.dataset.card;
    box.innerHTML = rubric.map(([name], r) => `
      <div class="rate__row"><span>${name}</span><span class="star-input" role="radiogroup" aria-label="${name}, answer ${id}">
        ${[5, 4, 3, 2, 1].map((v) => `<input type="radio" id="${id}${r}-${v}" name="${id}${r}" value="${v}"><label for="${id}${r}-${v}" title="${v} star${v > 1 ? "s" : ""}">${icon("i-star")}<span class="sr-only">${v} stars</span></label>`).join("")}
      </span></div>`).join("");
    box.addEventListener("change", () => update());
  });
  const score = (card) => {
    let total = 0, weight = 0;
    rubric.forEach(([, w], r) => {
      const v = $(`input[name="${card.dataset.card}${r}"]:checked`, card);
      if (v) { total += +v.value * w; weight += w; }
    });
    return weight ? total / weight : null;
  };
  function update() {
    const s = cards.map(score);
    cards.forEach((c, k) => {
      const el = $("[data-score]", c), txt = s[k] == null ? "–" : s[k].toFixed(1);
      if (el.textContent !== txt) { el.textContent = txt; const b = el.parentElement; b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }
    });
    const best = s[0] != null && s[1] != null && s[0] !== s[1] ? (s[0] > s[1] ? 0 : 1) : -1;
    cards.forEach((c, k) => c.classList.toggle("is-best", k === best));
    const ready = s.every((v) => v != null);
    btn.disabled = !ready && !revealed;
    if (!revealed) hint.textContent = ready ? (best < 0 ? "A tie. Reveal anyway, or change a star." : `${"AB"[best]} is ahead. Ready when you are.`) : "Rate at least one line on each answer.";
  }
  btn?.addEventListener("click", () => {
    if (revealed) return reset();
    revealed = true;
    const s = cards.map(score);
    cards.forEach((c, k) => {
      const back = document.createElement("div");
      back.className = "face face--back";
      const won = c.classList.contains("is-best");
      back.innerHTML = `<div class="reveal-crown">${icon(won ? "i-champion" : "i-me")}</div><div class="reveal-name">${c.dataset.who}</div><div class="reveal-kind">${c.dataset.kind}</div><div class="face__score" style="margin:.6rem 0 0">${icon("i-star")}${s[k].toFixed(1)}</div>`;
      c.append(back);
      setTimeout(() => c.classList.add("is-flipped"), k * 140);
      if (won && !reduce) setTimeout(() => burst(c), 650);
    });
    bar.classList.add("is-revealed");
    $("span", bar).textContent = "Names revealed. In Audition, this happens on the leaderboard, after judging.";
    hint.textContent = "Your stars stayed fair: you didn't know who was who.";
    btn.innerHTML = `${icon("i-again")}<span>Judge again</span>`;
    btn.disabled = false;
  });
  function reset() {
    revealed = false;
    cards.forEach((c) => { c.classList.remove("is-flipped", "is-best"); setTimeout(() => $(".face--back", c)?.remove(), 800); $$("input", c).forEach((i) => (i.checked = false)); });
    bar.classList.remove("is-revealed");
    $("span", bar).textContent = "Names are hidden and the order is shuffled.";
    btn.innerHTML = `${icon("i-confirmed")}<span>Reveal who's who</span>`;
    update();
  }
  function burst(card) {
    const r = card.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let k = 0; k < 18; k++) {
      const s = document.createElement("span");
      s.className = "burst"; s.innerHTML = icon("i-star");
      s.style.left = `${cx}px`; s.style.top = `${cy}px`;
      document.body.append(s);
      const a = (Math.PI * 2 * k) / 18 + Math.random() * 0.4, d = 90 + Math.random() * 120;
      s.animate([
        { transform: "translate(-50%,-50%) scale(.2) rotate(0)", opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(${0.6 + Math.random() * 0.8}) rotate(${Math.random() * 300}deg)`, opacity: 0 },
      ], { duration: 900 + Math.random() * 400, easing: "cubic-bezier(.22,1,.36,1)" }).onfinish = () => s.remove();
    }
  }

  // ---- Vaultbase: numbers count up ----
  const counters = $$("[data-count]");
  const cio = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    cio.unobserve(e.target);
    const end = +e.target.dataset.count;
    if (reduce || end < 2) return;
    const t0 = performance.now();
    const tick = (t) => { const p = Math.min(1, (t - t0) / 1100); e.target.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); };
    e.target.textContent = "0"; requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  counters.forEach((c) => cio.observe(c));

  // ---- Install: tabs with a sliding pill ----
  const tabs = $$("#tabs [role=tab]"), pill = $(".tabs__pill");
  const place = (t) => { if (pill) { pill.style.width = `${t.offsetWidth}px`; pill.style.transform = `translateX(${t.offsetLeft}px)`; } };
  const select = (t) => {
    tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", on); x.tabIndex = on ? 0 : -1; $("#" + x.getAttribute("aria-controls")).hidden = !on; });
    place(t);
  };
  tabs.forEach((t, k) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = tabs[(k + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      select(n); n.focus();
    });
  });
  if (tabs[0]) { place(tabs[0]); addEventListener("resize", () => place(tabs.find((t) => t.getAttribute("aria-selected") === "true"))); document.fonts?.ready.then(() => place(tabs.find((t) => t.getAttribute("aria-selected") === "true"))); }

  // ---- Install: copy buttons ----
  $$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); } catch { return; }
    const label = $("span", b), use = $("use", b);
    b.classList.add("is-done"); label.textContent = "Copied"; use.setAttribute("href", `${ICONS}#i-check`);
    setTimeout(() => { b.classList.remove("is-done"); label.textContent = "Copy"; use.setAttribute("href", `${ICONS}#i-copy`); }, 1600);
  }));

  // ---- Install: the first terminal types itself once, when seen ----
  const typed = $("[data-type]");
  if (typed && !reduce) {
    const lines = typed.innerHTML.split("\n");
    typed.innerHTML = "";
    const tio = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      tio.disconnect();
      let i = 0;
      const caret = '<span class="caret"></span>';
      const next = () => {
        typed.innerHTML = lines.slice(0, i + 1).join("\n") + (i < lines.length - 1 ? caret : "");
        if (++i < lines.length) setTimeout(next, 380);
      };
      next();
    }, { threshold: 0.6 });
    tio.observe(typed);
  }
})();
