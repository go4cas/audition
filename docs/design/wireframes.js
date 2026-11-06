// Audition wireframes v2: a tiny hash router plus the interactions worth
// feeling. Vanilla JS, no dependencies, sample data only.
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- Icons: <i data-i="name" class="..."> becomes an inline sprite <svg> ----------
  function icon(name, cls) {
    return '<svg class="i' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }
  function hydrateIcons(root) {
    $$("i[data-i]", root).forEach(function (el) {
      var tmp = document.createElement("span");
      tmp.innerHTML = icon(el.dataset.i, el.className);
      var svg = tmp.firstChild;
      if (el.getAttribute("style")) svg.setAttribute("style", el.getAttribute("style"));
      if (el.dataset.tip) svg.dataset.tip = el.dataset.tip;
      el.replaceWith(svg);
    });
  }

  // ---------- Toasts ----------
  var toaster = $("#toaster");
  function toast(text, tone, iconName) {
    var t = document.createElement("div");
    t.className = "toast";
    t.dataset.tone = tone || "done";
    t.setAttribute("role", "status");
    t.innerHTML = icon(iconName || "done") + "<span>" + text + "</span>";
    toaster.appendChild(t);
    setTimeout(function () {
      t.classList.add("is-leaving");
      t.addEventListener("animationend", function () { t.remove(); });
    }, 2600);
  }

  // ---------- Router ----------
  var screens = $$("[data-screen]");
  var names = screens.map(function (s) { return s.dataset.screen; });
  var pick = $("#screen-pick");
  function show() {
    var name = location.hash.replace("#", "");
    if (name && names.indexOf(name) === -1) return; // in-page anchors like #out-b
    if (!name) name = "home";
    screens.forEach(function (s) { s.hidden = s.dataset.screen !== name; });
    $("#topbar").hidden = name === "signin";
    $(".bottom-nav").hidden = name === "signin";
    var section = /^contender/.test(name) ? "contenders" : "workspaces";
    $$("[data-nav]").forEach(function (a) {
      if (a.dataset.nav === section) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    pick.value = name;
    window.scrollTo(0, 0);
    requestAnimationFrame(function () { $$(".seg").forEach(placeThumb); });
    if (name === "run") startLiveRun();
    if (name === "run") animateProgress();
  }
  pick.addEventListener("change", function () { location.hash = pick.value; });
  window.addEventListener("hashchange", show);

  // ---------- Theme switch (wireframe only) ----------
  var themePick = $("#theme-pick");
  try { themePick.value = localStorage.getItem("audition-wire-theme") || ""; } catch (e) { /* storage blocked */ }
  function applyTheme() {
    if (themePick.value) document.documentElement.setAttribute("data-theme", themePick.value);
    else document.documentElement.removeAttribute("data-theme");
    try { localStorage.setItem("audition-wire-theme", themePick.value); } catch (e) { /* storage blocked */ }
  }
  themePick.addEventListener("change", applyTheme);
  applyTheme();

  // ---------- Forms: wireframes go nowhere, but say what would happen ----------
  $$("form[data-demo-form]").forEach(function (f) {
    if (f.id === "handoff-form") return;
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = $('button[type="submit"]', f);
      if (!btn) return;
      btn.classList.add("is-loading");
      setTimeout(function () {
        btn.classList.remove("is-loading");
        if (f.dataset.toast) toast(f.dataset.toast);
        if (f.dataset.go) location.hash = f.dataset.go;
      }, 650);
    });
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-toast]");
    if (b) toast(b.dataset.toast);
  });

  // ---------- Popovers: native popover attribute, placed next to whatever opened them ----------
  var lastInvoker = null;
  document.addEventListener("click", function (e) {
    var inv = e.target.closest("[popovertarget]");
    if (inv) lastInvoker = inv;
  }, true);
  // Places an open popover under (or above) the control that opened it, inside the viewport.
  function placePop(pop, invoker, align) {
    var r = invoker.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight, gap = 6, vw = window.innerWidth, vh = window.innerHeight;
    var want = align === "start" ? r.left : r.left + r.width / 2 - w / 2;
    var left = Math.min(Math.max(16, want), vw - w - 16);
    var below = r.bottom + gap + h < vh - 16 || r.top < h + gap + 16;
    var top = below ? r.bottom + gap : r.top - gap - h;
    pop.style.left = left + "px";
    pop.style.top = Math.max(16, top) + "px";
    pop.style.setProperty("--origin", (r.left + r.width / 2 - left) + "px " + (below ? "top" : "bottom"));
  }
  $$(".pop").forEach(function (pop) {
    pop.addEventListener("toggle", function (e) {
      $$('[popovertarget="' + pop.id + '"]').forEach(function (b) { b.setAttribute("aria-expanded", String(e.newState === "open")); });
      if (e.newState !== "open" || !lastInvoker) return;
      placePop(pop, lastInvoker);
    });
  });
  window.addEventListener("scroll", function () { $$(".pop").forEach(function (p) { try { p.hidePopover(); } catch (e) { /* not open */ } }); }, { passive: true });

  // ---------- Dropdowns: upgrade every <select class="select"> ----------
  // The native select stays in the DOM (hidden) so forms keep their value.
  // Options may carry data-icon, data-avatar="hue:INITIALS" and data-desc.
  var ddCount = 0;
  function optVisual(o) {
    if (o.dataset.avatar) {
      var a = o.dataset.avatar.split(":");
      return '<span class="avatar avatar--sm" style="--h:' + a[0] + '">' + a[1] + "</span>";
    }
    return o.dataset.icon ? icon(o.dataset.icon) : "";
  }
  function enhanceSelect(sel) {
    var id = "dd-" + (++ddCount);
    var wrap = document.createElement("div");
    wrap.className = "dd";
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.tabIndex = -1;
    sel.setAttribute("aria-hidden", "true");
    var label = sel.id ? document.querySelector('label[for="' + sel.id + '"]') : null;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dd__btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", id);
    if (label) { btn.id = sel.id + "-btn"; label.setAttribute("for", btn.id); }
    wrap.appendChild(btn);
    var menu = document.createElement("div");
    menu.className = "pop dd__menu";
    menu.id = id;
    menu.setAttribute("popover", "");
    menu.setAttribute("role", "listbox");
    if (label) menu.setAttribute("aria-label", label.textContent.trim());
    var html = "";
    Array.prototype.forEach.call(sel.children, function (child) {
      var group = child.tagName === "OPTGROUP" ? child : null;
      var opts = group ? Array.prototype.slice.call(child.children) : [child];
      if (group) html += '<div class="dd__group" role="presentation">' + group.label + "</div>";
      opts.forEach(function (o) {
        html += '<button type="button" class="dd__opt" role="option" data-value="' + o.index + '">' + optVisual(o) +
          '<span class="dd__opt-text"><span>' + o.textContent + "</span>" + (o.dataset.desc ? '<span class="dd__opt-desc">' + o.dataset.desc + "</span>" : "") + "</span>" +
          icon("check", "dd__tick") + "</button>";
      });
    });
    menu.innerHTML = html;
    document.body.appendChild(menu);
    var options = $$(".dd__opt", menu);

    function render() {
      var o = sel.options[sel.selectedIndex];
      btn.innerHTML = '<span class="dd__value">' + optVisual(o) + "<span>" + o.textContent + "</span></span>" + icon("caret-down", "dd__caret");
      options.forEach(function (b) { b.setAttribute("aria-selected", String(Number(b.dataset.value) === sel.selectedIndex)); });
    }
    function open() {
      menu.style.minWidth = btn.offsetWidth + "px";
      menu.showPopover();
      placePop(menu, btn, "start");
      var current = options.filter(function (b) { return b.getAttribute("aria-selected") === "true"; })[0] || options[0];
      current.focus();
    }
    function choose(b) {
      sel.selectedIndex = Number(b.dataset.value);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      render();
      menu.hidePopover();
      btn.focus();
    }
    btn.addEventListener("click", function () { if (menu.matches(":popover-open")) menu.hidePopover(); else open(); });
    btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); }
    });
    menu.addEventListener("toggle", function (e) { btn.setAttribute("aria-expanded", String(e.newState === "open")); });
    menu.addEventListener("click", function (e) { var b = e.target.closest(".dd__opt"); if (b) choose(b); });
    menu.addEventListener("keydown", function (e) {
      var i = options.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); options[Math.min(i + 1, options.length - 1)].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); options[Math.max(i - 1, 0)].focus(); }
      else if (e.key === "Home") { e.preventDefault(); options[0].focus(); }
      else if (e.key === "End") { e.preventDefault(); options[options.length - 1].focus(); }
      else if (e.key === "Tab") { menu.hidePopover(); }
      else if (e.key.length === 1) {
        var k = e.key.toLowerCase();
        var hit = options.filter(function (b) { return b.textContent.trim().toLowerCase().indexOf(k) === 0; })[0];
        if (hit) hit.focus();
      }
    });
    menu.addEventListener("toggle", function (e) { if (e.newState === "closed" && document.activeElement && menu.contains(document.activeElement)) btn.focus(); });
    render();
  }
  $$("select.select").forEach(enhanceSelect);

  // ---------- Segmented control: sliding thumb ----------
  function placeThumb(seg) {
    var thumb = $(".seg__thumb", seg);
    if (!thumb) { thumb = document.createElement("span"); thumb.className = "seg__thumb"; seg.prepend(thumb); }
    var checked = $("input:checked", seg);
    if (!checked || !seg.offsetParent) return;
    var label = seg.querySelector('label[for="' + checked.id + '"]');
    thumb.style.setProperty("--x", label.offsetLeft + "px");
    thumb.style.setProperty("--w", label.offsetWidth + "px");
    thumb.style.top = label.offsetTop + "px";
    thumb.style.bottom = "auto";
    thumb.style.height = label.offsetHeight + "px";
  }
  $$(".seg").forEach(function (seg) { seg.addEventListener("change", function () { placeThumb(seg); }); });
  window.addEventListener("resize", function () { $$(".seg").forEach(placeThumb); });

  // ---------- Stars ----------
  function starInput(name, value, label, disabled) {
    var html = '<span class="star-input" role="radiogroup" aria-label="' + label + '"' + (disabled ? ' aria-disabled="true"' : "") + ">";
    for (var i = 5; i >= 1; i--) {
      var id = name + "-" + i;
      html += '<input type="radio" name="' + name + '" id="' + id + '" value="' + i + '"' + (i === value ? " checked" : "") + (disabled ? " disabled" : "") + ">";
      html += '<label for="' + id + '" title="' + i + " star" + (i > 1 ? "s" : "") + '">' + icon("star") + "</label>";
    }
    return html + "</span>";
  }
  // A star click pops the star and throws a few gold sparks.
  document.addEventListener("change", function (e) {
    var input = e.target;
    if (!input.closest || !input.closest(".star-input")) return;
    var label = input.nextElementSibling;
    label.classList.remove("is-popped"); void label.offsetWidth; label.classList.add("is-popped");
    if (reduced) return;
    var r = label.getBoundingClientRect();
    for (var k = 0; k < 6; k++) {
      var s = document.createElement("span");
      s.className = "sparkle";
      var a = (Math.PI * 2 * k) / 6 + Math.random() * 0.5;
      s.style.left = (r.left + r.width / 2 - 3) + "px";
      s.style.top = (r.top + r.height / 2 - 3) + "px";
      s.style.setProperty("--dx", Math.cos(a) * 22 + "px");
      s.style.setProperty("--dy", Math.sin(a) * 22 + "px");
      document.body.appendChild(s);
      s.addEventListener("animationend", function () { this.remove(); });
    }
  });

  var CRITERIA = [
    { name: "Matches the spec", w: 0.4 },
    { name: "Code quality", w: 0.3 },
    { name: "Accessibility", w: 0.2 },
    { name: "Responsiveness", w: 0.1 }
  ];
  function weighted(stars) { return stars.reduce(function (sum, s, i) { return sum + s * CRITERIA[i].w; }, 0); }

  // ---------- Judge: text and code outputs (blind: nothing names the contender) ----------
  var JUDGE_DATA = [
    { letter: "A", summary: "Built the settings screen with three sections as <code>&lt;section&gt;</code> landmarks. Form fields use visible labels. Danger zone asks for confirmation inline.",
      branch: "audition/settings-a", claim: [["done", "Build passed"], ["done", "14 tests passed"], ["done", "Lint: 0 warnings"]], shots: 2,
      ai: [5, 4, 4, 4], reasons: ["All three sections and every field from the spec.", "Small functions, one unused import.", "Labels present; focus order follows the layout.", "Single column at 375 px."] },
    { letter: "B", summary: "Settings page with tabs for Profile and Notifications. Danger zone sits under Profile.",
      branch: "audition/settings-b", claim: [["done", "Build passed"], ["error", "9 passed, 1 failed"], ["error", "Lint: 3 warnings"]], shots: 1,
      ai: [4, 3, 3, 4], reasons: ["Danger zone merged into Profile, not its own section.", "Some duplicated handlers.", "Tabs lack arrow-key support.", "Works at phone width."] },
    { letter: "C", summary: "Implemented Profile and Notifications. Danger zone left as a TODO.",
      branch: "audition/settings-c", claim: [["done", "Build passed"], ["draft", "No tests written"], ["draft", "Lint not run"]], shots: 0,
      ai: [3, 4, 2, 3], reasons: ["Danger zone missing.", "Clean and short.", "Inputs use placeholders instead of labels.", "Overflows slightly at 375 px."] },
    { letter: "D", summary: "All three sections. Uses a details element for Danger zone so it starts closed.",
      branch: "audition/settings-d", claim: [["done", "Build passed"], ["done", "11 tests passed"], ["error", "Lint: 1 warning"]], shots: 2,
      ai: [4, 4, 3, 3], reasons: ["All sections; one notification toggle missing.", "Readable.", "Good labels; contrast low on secondary text.", "Buttons crowd at 375 px."],
      mine: [4, 4, 4, 3] }
  ];
  var CLAIM_ICON = { done: "done", error: "error", draft: "draft" };

  function renderOutput(o, idx) {
    var stars = o.mine || o.ai;
    var over = !!o.mine;
    var crit = CRITERIA.map(function (c, i) {
      var changed = over && o.mine[i] !== o.ai[i];
      return '<div class="crit"><span class="crit__name">' + c.name +
        '<button class="info-btn" type="button" popovertarget="pop-reason" data-reason="' + idx + "," + i + '" aria-label="Why these stars">' + icon(changed ? "edit" : "ai", changed ? "changed" : "") + "</button></span>" +
        '<span data-i-crit="' + i + '">' + starInput("o" + o.letter + "c" + i, stars[i], c.name + ", output " + o.letter, true) + "</span></div>";
    }).join("");
    var shots = "";
    for (var s = 1; s <= o.shots; s++) shots += '<button class="thumb" type="button" data-lightbox="Output ' + o.letter + ", screenshot " + s + '" data-variant="' + (idx + s) + '" aria-label="Screenshot ' + s + '">' + icon("image", "i--lg") + "</button>";
    return '<article class="output' + (over ? " is-overridden" : "") + '" id="out-' + o.letter.toLowerCase() + '" data-idx="' + idx + '">' +
      '<div class="output__head"><span class="letter-tile">' + o.letter + '</span><span class="state best-tag" data-state="champion">' + icon("trophy") + "Best so far</span>" +
      '<span class="score" data-score>' + icon("star") + "<span>" + weighted(stars).toFixed(1) + "</span></span></div>" +
      '<div class="output__body"><p>' + o.summary + "</p>" +
      '<p class="small row-tight">' + icon("branch") + "<code>" + o.branch + "</code></p>" +
      '<div class="claim"><span class="claim__label">' + icon("warning") + "The agent's own claim. Audition didn't check it.</span>" +
      o.claim.map(function (c) { return '<span class="claim__row" data-state="' + c[0] + '">' + icon(CLAIM_ICON[c[0]]) + c[1] + "</span>"; }).join("") + "</div>" +
      (o.shots ? '<div class="thumbs">' + shots + "</div>" : '<p class="xs muted row-tight">' + icon("image") + "No screenshots attached.</p>") +
      "</div>" +
      '<div class="output__rating">' + crit + "</div>" +
      '<div class="output__foot"><span class="judge-tag" data-tag>' + (over ? icon("me") + "Your stars count" : icon("ai") + "Judged by AI") + "</span>" +
      '<button class="btn btn--sm btn--quiet" type="button" data-override>' + icon("edit") + "<span>Change stars</span></button></div>" +
      "</article>";
  }
  var outputsEl = $("#outputs");
  outputsEl.innerHTML = JUDGE_DATA.map(renderOutput).join("");

  function currentStars(article) {
    return CRITERIA.map(function (c, i) {
      var checked = $('[data-i-crit="' + i + '"] input:checked', article);
      return checked ? Number(checked.value) : 0;
    });
  }
  function updateBest() {
    var best = null;
    $$(".output", outputsEl).forEach(function (a) {
      a.classList.remove("is-best");
      var s = weighted(currentStars(a));
      if (!best || s > best.s) best = { s: s, a: a };
    });
    best.a.classList.add("is-best");
    $("#best-out").textContent = "Output " + $(".letter-tile", best.a).textContent + " · " + best.s.toFixed(1);
  }
  outputsEl.addEventListener("change", function (e) {
    var art = e.target.closest(".output");
    if (!art) return;
    var sc = $("[data-score]", art);
    $("span", sc).textContent = weighted(currentStars(art)).toFixed(1);
    sc.classList.remove("is-changed"); void sc.offsetWidth; sc.classList.add("is-changed");
    updateBest();
  });
  outputsEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-override]");
    if (!btn) return;
    var art = btn.closest(".output");
    var editing = !art.classList.contains("is-editing");
    art.classList.toggle("is-editing", editing);
    $$(".star-input", art).forEach(function (g) { if (editing) g.removeAttribute("aria-disabled"); else g.setAttribute("aria-disabled", "true"); });
    $$(".star-input input", art).forEach(function (i) { i.disabled = !editing; });
    $("span", btn).textContent = editing ? "Done" : "Change stars";
    btn.className = editing ? "btn btn--sm btn--primary" : "btn btn--sm btn--quiet";
    if (!editing) {
      art.classList.add("is-overridden");
      $("[data-tag]", art).innerHTML = icon("me") + "Your stars count";
      toast("Your stars count now. The AI's stay in history.", "done", "check");
    }
  });
  // AI reasons live behind a popover so the columns stay calm.
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-reason]");
    if (!b) return;
    var p = b.dataset.reason.split(",").map(Number);
    var o = JUDGE_DATA[p[0]];
    $("#reason-title").textContent = CRITERIA[p[1]].name + " · Output " + o.letter;
    $("#reason-text").textContent = "AI: " + o.reasons[p[1]];
    $("#reason-note").textContent = o.mine && o.mine[p[1]] !== o.ai[p[1]]
      ? "The AI gave " + o.ai[p[1]] + " stars. You changed it to " + o.mine[p[1]] + "."
      : "The AI gave " + o.ai[p[1]] + " stars.";
  });
  updateBest();

  // Phone pager follows the swipe.
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        $$(".pager a").forEach(function (a) { a.classList.toggle("is-current", a.getAttribute("href") === "#" + en.target.id); });
      });
    }, { root: outputsEl, threshold: 0.6 });
    $$(".output", outputsEl).forEach(function (o) { io.observe(o); });
  }
  $$("[data-jump]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var t = $(a.getAttribute("href"));
      outputsEl.scrollTo({ left: t.offsetLeft - outputsEl.offsetLeft, behavior: reduced ? "auto" : "smooth" });
    });
  });

  // ---------- Judge: image grid ----------
  function bagArt(v) {
    var P = [["var(--gold)", "var(--text)", "var(--gold-soft)"], ["var(--accent)", "var(--surface)", "var(--accent-soft)"],
             ["var(--error)", "var(--text)", "var(--warning-bg)"], ["var(--text-muted)", "var(--surface)", "var(--active-bg)"]];
    var p = P[v % P.length];
    return '<svg class="art" viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="xMidYMid slice">' +
      '<rect width="100" height="100" fill="' + p[2] + '"/>' +
      '<circle cx="50" cy="54" r="30" fill="' + p[0] + '" opacity="0.18"/>' +
      '<path d="M34 34 L66 34 L70 80 L30 80 Z" fill="' + p[0] + '"/>' +
      '<path d="M34 34 L41 26 L59 26 L66 34 Z" fill="' + p[1] + '" opacity="0.85"/>' +
      '<circle cx="50" cy="58" r="8" fill="' + p[1] + '" opacity="0.8"/>' +
      (v === 2 ? '<rect x="22" y="86" width="56" height="5" rx="2.5" fill="' + p[1] + '"/>' : "") + "</svg>";
  }
  var IMG_CRITERIA = ["Matches the brief", "Visual quality", "On brand", "Usable as-is"];
  var IMAGE_DATA = [{ l: "A", n: 1, s: [4, 4, 5, 4] }, { l: "B", n: 3, s: [3, 4, 3, 3] }, { l: "C", n: 1, s: [2, 0, 0, 0] }, { l: "D", n: 2, s: [0, 0, 0, 0] }];
  var grid = $("#image-grid");
  grid.innerHTML = IMAGE_DATA.map(function (o, idx) {
    var rows = IMG_CRITERIA.map(function (c, i) {
      return '<div class="crit"><span class="crit__name">' + c + "</span>" + starInput("img" + o.l + "c" + i, o.s[i], c + ", output " + o.l, false) + "</div>";
    }).join("");
    return '<article class="image-card" data-card>' +
      '<button class="image-card__img ph" type="button" data-lightbox="Output ' + o.l + '" data-variant="' + idx + '" aria-label="Enlarge output ' + o.l + '">' +
      bagArt(idx) + '<span class="letter-tile">' + o.l + '</span><span class="zoom">' + icon("enlarge") + "</span>" +
      (o.n > 1 ? '<span class="chip">' + icon("image") + o.n + " images</span>" : "") + "</button>" +
      '<div class="output__rating">' + rows + "</div>" +
      '<div class="image-card__foot"><span class="score" data-score>' + icon("star") + "<span>–</span></span><span data-card-state></span></div></article>";
  }).join("");
  var IMG_W = [0.4, 0.3, 0.2, 0.1];
  function rateCards() {
    var rated = 0;
    $$("[data-card]", grid).forEach(function (card) {
      var vals = IMG_CRITERIA.map(function (c, i) { var x = $$(".crit", card)[i].querySelector("input:checked"); return x ? Number(x.value) : 0; });
      var full = vals.every(function (v) { return v > 0; });
      var started = vals.some(function (v) { return v > 0; });
      var was = card.classList.contains("is-rated");
      card.classList.toggle("is-rated", full);
      if (full) rated++;
      $("[data-score] span", card).textContent = full ? vals.reduce(function (s, v, i) { return s + v * IMG_W[i]; }, 0).toFixed(1) : "–";
      $("[data-card-state]", card).innerHTML = full
        ? '<span class="state' + (was ? "" : " is-new") + '" data-state="done">' + icon("done") + "Rated</span>"
        : started ? '<span class="state" data-state="active">' + icon("edit") + "In progress</span>"
                  : '<span class="state" data-state="draft">' + icon("draft") + "Not rated</span>";
    });
    $("#img-progress").textContent = rated + " of 4 rated";
    $("#img-bar").style.width = (rated / 4 * 100) + "%";
  }
  grid.addEventListener("change", rateCards);
  rateCards();

  // ---------- Lightbox (native dialog) ----------
  var lb = $("#lightbox");
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-lightbox]");
    if (t) {
      $("#lightbox-title").textContent = t.dataset.lightbox;
      $("#lightbox-img").innerHTML = bagArt(Number(t.dataset.variant || 0));
      lb.showModal();
      return;
    }
    if (e.target === lb || e.target.closest("#lightbox-close")) lb.close();
  });

  // ---------- Handoff ----------
  function setStep(n) {
    $$("#handoff-steps > li").forEach(function (li) {
      var s = Number(li.dataset.step);
      li.classList.toggle("is-done", s < n);
      li.classList.toggle("is-current", s === n);
    });
  }
  $$("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.getElementById(btn.dataset.copy);
      var label = $("span", btn);
      var done = function () {
        btn.classList.add("is-success");
        btn.querySelector("use").setAttribute("href", "#i-check");
        label.textContent = "Copied";
        var block = $("#copy-block"); block.classList.remove("is-copied"); void block.offsetWidth; block.classList.add("is-copied");
        toast("Prompt copied. Paste it into ChatGPT.", "done", "copy");
        setStep(2);
        setTimeout(function () { btn.classList.remove("is-success"); btn.querySelector("use").setAttribute("href", "#i-copy"); label.textContent = "Copy again"; }, 1800);
      };
      var fallback = function () {
        var r = document.createRange(); r.selectNodeContents(el);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        label.textContent = "Selected, press Ctrl+C";
        setStep(2);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.textContent).then(done, fallback);
      else fallback();
    });
  });
  var reply = $("#ho-reply");
  var submit = $("#ho-submit");
  reply.addEventListener("input", function () {
    var words = reply.value.trim() ? reply.value.trim().split(/\s+/).length : 0;
    $("#ho-count").textContent = words ? words + " words pasted" : "Nothing pasted yet";
    submit.disabled = !words;
    $("#ho-tip").dataset.tip = words ? "" : "Paste the reply first";
    if (!words) return;
    setStep(3);
  });
  reply.addEventListener("paste", function () { setTimeout(function () { reply.dispatchEvent(new Event("input")); }, 0); });
  reply.addEventListener("focus", function () { if (!reply.value) setStep(3); });
  var drop = $("#drop");
  ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); }); });
  ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); }); });
  function addFile(name, size) {
    var li = document.createElement("li");
    li.innerHTML = icon(/\.(png|jpe?g)$/.test(name) ? "image" : "file") + name + " · " + size +
      '<button class="icon-btn" type="button" aria-label="Remove ' + name + '" style="width:22px;height:22px">' + icon("close") + "</button>";
    $("button", li).addEventListener("click", function () { li.remove(); });
    $("#drop-files").appendChild(li);
  }
  drop.addEventListener("drop", function (e) {
    Array.prototype.forEach.call(e.dataTransfer.files || [], function (f) { addFile(f.name, Math.max(1, Math.round(f.size / 1024)) + " KB"); });
  });
  drop.addEventListener("click", function () { addFile("lisbon-map.png", "180 KB"); });
  var hf = $("#handoff-form");
  hf.addEventListener("submit", function (e) { e.preventDefault(); $("#ho-confirm").hidden = false; $("#ho-actions").hidden = true; });
  $("#ho-no").addEventListener("click", function () { $("#ho-confirm").hidden = true; $("#ho-actions").hidden = false; });
  $("#ho-yes").addEventListener("click", function () {
    $("#ho-confirm").hidden = true;
    $("#ho-done").hidden = false;
    $$("textarea, input", hf).forEach(function (i) { i.readOnly = true; });
    $$("#handoff-steps > li").forEach(function (li) { li.classList.add("is-done"); li.classList.remove("is-current"); });
    $$("[data-inbox-count]").forEach(function (c) { c.textContent = "4"; c.classList.remove("is-bumped"); void c.offsetWidth; c.classList.add("is-bumped"); });
    toast("Output submitted", "done", "send");
  });

  // ---------- Task: duplicate and edit ----------
  $("#task-dup").addEventListener("click", function () {
    $("#task-locked").hidden = true;
    $("#task-draft").hidden = false;
    $("#task-save").hidden = false;
    $("#task-version").innerHTML = '<span class="badge">Version 2</span><span class="state" data-state="draft">' + icon("edit") + "Draft, copied from version 1</span>";
    $$("#task-form input, #task-form textarea").forEach(function (i) { i.readOnly = false; i.disabled = false; });
    $("#tk-prompt").focus();
  });

  // ---------- Add contender: API or manual ----------
  $$('input[name="cn-mode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      $$("[data-mode]").forEach(function (b) { b.hidden = b.dataset.mode !== r.value; });
      $("#cn-name").value = r.value === "manual" ? "Claude Code (manual), plan mode" : "Opus 5.5, high reasoning, 0.6";
      $("#cn-mode-hint").textContent = r.value === "manual"
        ? "You copy the prompt into the tool and paste the reply back. You can type in tokens and time if the tool shows them."
        : "Audition sends the prompt to the provider and measures tokens and time.";
    });
  });

  // ---------- Weights must total 100 (workspace fitness and role rubric) ----------
  function wireWeights(inputs, bar, chip, label) {
    function check() {
      var vals = inputs.map(function (i) { return Number(i.value) || 0; });
      var total = vals.reduce(function (a, b) { return a + b; }, 0);
      $$("span", bar).forEach(function (s, i) { s.style.width = (vals[i] || 0) + "%"; });
      var ok = total === 100;
      chip.dataset.state = ok ? "done" : "warning";
      chip.innerHTML = icon(ok ? "done" : "warning") + (ok ? label : "Adds up to " + total + ", needs 100");
      inputs.forEach(function (i) { i.setAttribute("aria-invalid", String(!ok)); });
    }
    inputs.forEach(function (i) { i.addEventListener("input", check); });
  }
  wireWeights($$("[data-weight]"), $("#fw-bar"), $("#fw-total"), "Adds up to 100");
  wireWeights($$("[data-rb]"), $("#rb-bar"), $("#rb-total"), "Weights add up to 100%");

  // Stage reordering with a little slide.
  $("#stage-list").addEventListener("click", function (e) {
    var b = e.target.closest("[data-move]");
    if (!b) return;
    var li = b.closest("li");
    var other = b.dataset.move === "up" ? li.previousElementSibling : li.nextElementSibling;
    if (!other) return;
    if (b.dataset.move === "up") other.before(li); else other.after(li);
    li.animate([{ background: "var(--accent-soft)" }, { background: "transparent" }], { duration: 700 });
  });

  // ---------- New run: live call count (the spending guard) ----------
  var runForm = $("#run-form");
  function setTick(id, val) {
    var el = $("#" + id);
    if (el.textContent === String(val)) return;
    el.textContent = val;
    el.classList.remove("is-changed"); void el.offsetWidth; el.classList.add("is-changed");
  }
  function countRun() {
    var tasks = $$("[data-task]:checked", runForm).length;
    var api = $$('[data-contender="api"]:checked', runForm).length;
    var manual = $$('[data-contender="manual"]:checked', runForm).length;
    var ai = $("#nr-ai").checked;
    var outputs = tasks * (api + manual);
    setTick("sum-outputs", outputs);
    $("#sum-formula").textContent = tasks + " task" + (tasks === 1 ? "" : "s") + " × " + (api + manual) + " contender" + (api + manual === 1 ? "" : "s");
    setTick("sum-api", tasks * api);
    setTick("sum-judge", ai ? outputs : 0);
    setTick("sum-total", tasks * api + (ai ? outputs : 0));
    setTick("sum-manual", tasks * manual);
    $("#nr-warn").hidden = !ai || api === 0;
    var start = $("#start-run");
    start.disabled = outputs === 0;
    start.parentElement.dataset.tip = outputs === 0 ? "Pick at least one task and one contender" : "";
  }
  runForm.addEventListener("change", countRun);
  countRun();
  $("#start-run").addEventListener("click", function () {
    var b = this;
    b.classList.add("is-loading");
    setTimeout(function () { b.classList.remove("is-loading"); toast("Run 9 started", "done", "play"); location.hash = "run"; }, 700);
  });

  // ---------- Run: progress animates in, and one output finishes live ----------
  function animateProgress() {
    var segs = $$("#run-progress span");
    segs.forEach(function (s) { s.style.width = "0"; });
    requestAnimationFrame(function () { requestAnimationFrame(function () { segs.forEach(function (s) { s.style.width = s.dataset.w + "%"; }); }); });
  }
  var liveDone = false;
  function startLiveRun() {
    if (liveDone) return;
    setTimeout(function () {
      if (liveDone || location.hash !== "#run") return;
      liveDone = true;
      var chip = $("#live-chip");
      chip.dataset.state = "done";
      chip.classList.add("is-new");
      chip.innerHTML = icon("done") + "Judged";
      var segs = $$("#run-progress span");
      segs[0].dataset.w = "37.5"; segs[1].dataset.w = "12.5";
      segs[0].style.width = "37.5%"; segs[1].style.width = "12.5%";
      $("#lg-done").textContent = "3"; $("#lg-active").textContent = "1";
      $("#run-headline").textContent = "3 of 8 outputs judged";
      toast("Claude Code's output was judged", "done", "judge");
    }, 2600);
  }

  // ---------- Leaderboard ----------
  $("#champ-confirm").addEventListener("click", function () {
    var box = $("#champ-box");
    box.classList.add("is-confirmed");
    $("#champ-label").innerHTML = icon("confirmed", "") + "Champion since 6 Nov 2026";
    $("#champ-actions").innerHTML = '<span class="state is-new" data-state="champion">' + icon("champion") + 'Champion</span><button class="btn btn--sm btn--quiet" type="button">' + icon("history") + "History</button>";
    toast("Claude Code (manual) is now the UI engineer champion", "champion", "champion");
    if (reduced) return;
    var colors = ["var(--gold)", "var(--accent)", "var(--done)", "var(--active)"];
    for (var k = 0; k < 28; k++) {
      var c = document.createElement("span");
      c.className = "confetti";
      c.style.background = colors[k % colors.length];
      c.style.left = (10 + Math.random() * 30) + "%";
      c.style.setProperty("--dx", (Math.random() * 420 - 60) + "px");
      c.style.setProperty("--dy", (Math.random() * -140 + 60) + "px");
      c.style.setProperty("--rot", (Math.random() * 720 - 360) + "deg");
      c.style.animationDelay = (Math.random() * 120) + "ms";
      box.appendChild(c);
      c.addEventListener("animationend", function () { this.remove(); });
    }
  });
  var lbBody = $("#lb-table tbody");
  var lbRows = $$("tr[data-group]", lbBody);
  $("#lb-group").addEventListener("change", function (e) {
    lbBody.innerHTML = "";
    if (!e.target.checked) { lbRows.forEach(function (r) { lbBody.appendChild(r); }); return; }
    var groups = [];
    lbRows.forEach(function (r) { if (groups.indexOf(r.dataset.group) === -1) groups.push(r.dataset.group); });
    groups.forEach(function (g) {
      var head = document.createElement("tr");
      head.innerHTML = '<td colspan="8"><span class="eyebrow">' + g + "</span></td>";
      lbBody.appendChild(head);
      lbRows.filter(function (r) { return r.dataset.group === g; }).forEach(function (r) { lbBody.appendChild(r); });
    });
  });

  hydrateIcons(document);
  show();
})();
