// Audition wireframes: a tiny hash router plus the few interactions a reviewer
// needs to feel the flow. Vanilla JS, no dependencies. Sample data only.
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------- Router ----------
  var screens = $$("[data-screen]");
  var names = screens.map(function (s) { return s.dataset.screen; });
  var pick = $("#screen-pick");

  function show() {
    var name = location.hash.replace("#", "");
    // In-page anchors (like #out-b) are not screens; leave the view alone.
    if (name && names.indexOf(name) === -1) return;
    if (!name) name = "home";
    screens.forEach(function (s) { s.hidden = s.dataset.screen !== name; });
    $("#topbar").hidden = name === "signin";
    $(".bottom-nav").hidden = name === "signin";
    var section = /^contender/.test(name) ? "contenders" : "workspaces";
    $$("[data-nav]").forEach(function (a) {
      if (a.dataset.nav === section) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    pick.value = name;
    window.scrollTo(0, 0);
  }
  pick.addEventListener("change", function () { location.hash = pick.value; });
  window.addEventListener("hashchange", show);

  // Pager links jump inside the outputs strip without changing the screen.
  $$("[data-jump]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      var target = $(a.getAttribute("href"));
      if (target) target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    });
  });

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

  // Forms in a wireframe go nowhere.
  $$("form[data-demo-form]").forEach(function (f) {
    if (f.id === "handoff-form") return;
    f.addEventListener("submit", function (e) { e.preventDefault(); });
  });

  // ---------- Stars ----------
  function starsDisplay(n) {
    var on = "★".repeat(n), off = "★".repeat(5 - n);
    return '<span class="stars" aria-label="' + n + ' of 5 stars"><span class="on">' + on + "</span>" + off + "</span>";
  }
  // Five radios, written 5 to 1 so CSS can fill stars to the left on hover.
  function starInput(name, value, label, disabled) {
    var html = '<span class="star-input" role="radiogroup" aria-label="' + label + '"' + (disabled ? ' aria-disabled="true"' : "") + ">";
    for (var i = 5; i >= 1; i--) {
      var id = name + "-" + i;
      html += '<input type="radio" name="' + name + '" id="' + id + '" value="' + i + '"' + (i === value ? " checked" : "") + (disabled ? " disabled" : "") + ">";
      html += '<label for="' + id + '" title="' + i + ' star' + (i > 1 ? "s" : "") + '">★</label>';
    }
    return html + "</span>";
  }

  var CRITERIA = [
    { name: "Matches the spec", w: 0.4 },
    { name: "Code quality", w: 0.3 },
    { name: "Accessibility", w: 0.2 },
    { name: "Responsiveness", w: 0.1 }
  ];
  function weighted(stars) {
    return stars.reduce(function (sum, s, i) { return sum + s * CRITERIA[i].w; }, 0);
  }

  // ---------- Judge: text and code outputs ----------
  // Blind by design: nothing here names the contender.
  var JUDGE_DATA = [
    {
      letter: "A",
      summary: "Built the settings screen with three sections as <code>&lt;section&gt;</code> landmarks. Form fields use visible labels. Danger zone asks for confirmation inline.",
      branch: "audition/settings-a",
      claim: ["Build: pass", "Tests: 14 passed, 0 failed", "Lint: 0 warnings"],
      shots: 2,
      ai: [5, 4, 4, 4],
      reasons: ["All three sections and every field from the spec.", "Small functions, one unused import.", "Labels present; focus order follows layout.", "Single column at 375 px."]
    },
    {
      letter: "B",
      summary: "Settings page with tabs for Profile and Notifications. Danger zone sits under Profile.",
      branch: "audition/settings-b",
      claim: ["Build: pass", "Tests: 9 passed, 1 failed", "Lint: 3 warnings"],
      shots: 1,
      ai: [4, 3, 3, 4],
      reasons: ["Danger zone merged into Profile, not its own section.", "Some duplicated handlers.", "Tabs lack keyboard arrows.", "Works at phone width."]
    },
    {
      letter: "C",
      summary: "Implemented Profile and Notifications. Danger zone left as a TODO.",
      branch: "audition/settings-c",
      claim: ["Build: pass", "Tests: none written", "Lint: not run"],
      shots: 0,
      ai: [3, 4, 2, 3],
      reasons: ["Danger zone missing.", "Clean and short.", "Inputs use placeholders instead of labels.", "Overflows slightly at 375 px."]
    },
    {
      letter: "D",
      summary: "All three sections. Uses a details element for Danger zone so it starts closed.",
      branch: "audition/settings-d",
      claim: ["Build: pass", "Tests: 11 passed, 0 failed", "Lint: 1 warning"],
      shots: 2,
      ai: [4, 4, 3, 3],
      reasons: ["All sections; one notification toggle missing.", "Readable.", "Good labels; contrast low on secondary text.", "Buttons crowd at 375 px."],
      mine: [4, 4, 4, 3]
    }
  ];

  function renderOutput(o) {
    var stars = o.mine || o.ai;
    var overridden = !!o.mine;
    var crit = CRITERIA.map(function (c, i) {
      var changed = overridden && o.mine[i] !== o.ai[i];
      return '<div class="crit"><div class="crit__row"><span class="crit__name">' + c.name + "</span>" +
        '<span data-stars data-i="' + i + '">' + starInput("o" + o.letter + "c" + i, stars[i], c.name + ", output " + o.letter, !overridden) + "</span></div>" +
        '<span class="crit__reason">AI: ' + o.reasons[i] + (changed ? " · <strong>you changed " + o.ai[i] + " to " + o.mine[i] + "</strong>" : "") + "</span></div>";
    }).join("");
    var shots = "";
    for (var i = 1; i <= o.shots; i++) shots += '<button class="thumb" type="button" data-lightbox="Output ' + o.letter + ', screenshot ' + i + '">shot ' + i + "</button>";
    return '<article class="output' + (overridden ? " is-overridden" : "") + '" id="out-' + o.letter.toLowerCase() + '">' +
      '<div class="output__head"><span class="output__letter">Output ' + o.letter + '</span><span class="small"><span class="stars-score" data-score>' + weighted(stars).toFixed(1) + "</span> ★</span></div>" +
      '<div class="output__body"><p>' + o.summary + "</p>" +
      '<p class="small">Branch: <code>' + o.branch + "</code></p>" +
      '<div class="claim"><span class="claim__label">Agent\'s own claim, not checked by Audition</span>' + o.claim.map(function (c) { return "<span>" + c + "</span>"; }).join("") + "</div>" +
      (o.shots ? '<div class="thumbs">' + shots + "</div>" : '<p class="xs muted">No screenshots attached.</p>') +
      "</div>" +
      '<div class="output__rating">' + crit + "</div>" +
      '<div class="output__foot"><span class="judge-tag" data-tag>' + (overridden ? "Your stars count. The AI's stay in history." : "Judged by AI") + "</span>" +
      '<button class="btn btn--ghost" type="button" data-override="' + o.letter + '">' + (overridden ? "Done" : "Change stars") + "</button></div>" +
      "</article>";
  }

  var outputsEl = $("#outputs");
  outputsEl.innerHTML = JUDGE_DATA.map(renderOutput).join("");

  function rescore(article) {
    var vals = CRITERIA.map(function (c, i) {
      var checked = $('[data-i="' + i + '"] input:checked', article);
      return checked ? Number(checked.value) : 0;
    });
    $("[data-score]", article).textContent = weighted(vals).toFixed(1);
    updateBest();
  }
  function updateBest() {
    var best = null;
    $$(".output", outputsEl).forEach(function (a) {
      var s = Number($("[data-score]", a).textContent);
      if (!best || s > best.s) best = { s: s, l: $(".output__letter", a).textContent.replace("Output ", "") };
    });
    if (best) $("#best-out").textContent = best.l + " · " + best.s.toFixed(1);
  }
  outputsEl.addEventListener("change", function (e) {
    var art = e.target.closest(".output");
    if (art) rescore(art);
  });
  outputsEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-override]");
    if (!btn) return;
    var art = btn.closest(".output");
    var editing = btn.textContent === "Change stars";
    $$(".star-input", art).forEach(function (g) {
      if (editing) g.removeAttribute("aria-disabled"); else g.setAttribute("aria-disabled", "true");
    });
    $$(".star-input input", art).forEach(function (i) { i.disabled = !editing; });
    btn.textContent = editing ? "Done" : "Change stars";
    art.classList.add("is-overridden");
    $("[data-tag]", art).textContent = "Your stars count. The AI's stay in history.";
  });

  // ---------- Judge: image grid ----------
  // Flat placeholder art standing in for uploaded images.
  function bagArt(variant) {
    var palettes = [
      ["var(--star)", "var(--text)", "var(--surface)"],
      ["var(--accent)", "var(--surface)", "var(--star)"],
      ["var(--bad)", "var(--text)", "var(--warn-soft)"],
      ["var(--text-muted)", "var(--surface)", "var(--accent-soft)"]
    ];
    var p = palettes[variant % palettes.length];
    return '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="46" fill="' + p[2] + '"/>' +
      '<path d="M32 30 L68 30 L72 82 L28 82 Z" fill="' + p[0] + '"/>' +
      '<path d="M32 30 L40 22 L60 22 L68 30 Z" fill="' + p[1] + '" opacity="0.85"/>' +
      '<circle cx="50" cy="56" r="9" fill="' + p[1] + '" opacity="0.8"/>' +
      (variant === 2 ? '<rect x="22" y="86" width="56" height="6" rx="3" fill="' + p[1] + '"/>' : "") +
      "</svg>";
  }
  var IMG_CRITERIA = ["Matches the brief", "Visual quality", "On brand", "Usable as-is"];
  var IMAGE_DATA = [
    { letter: "A", count: 1, stars: [4, 4, 5, 4] },
    { letter: "B", count: 3, stars: [3, 4, 3, 3] },
    { letter: "C", count: 1, stars: [2, 0, 0, 0] },
    { letter: "D", count: 2, stars: [0, 0, 0, 0] }
  ];
  $("#image-grid").innerHTML = IMAGE_DATA.map(function (o, idx) {
    var rows = IMG_CRITERIA.map(function (c, i) {
      return '<div class="crit"><div class="crit__row"><span class="crit__name">' + c + "</span>" +
        starInput("img" + o.letter + "c" + i, o.stars[i], c + ", output " + o.letter, false) + "</div></div>";
    }).join("");
    return '<article class="image-card">' +
      '<button class="image-card__img ph" type="button" data-lightbox="Output ' + o.letter + '" data-variant="' + idx + '">' +
      bagArt(idx) + '<span class="letter">' + o.letter + "</span>" +
      (o.count > 1 ? '<span class="more">' + o.count + " images</span>" : "") + "</button>" +
      '<div class="output__rating">' + rows + "</div></article>";
  }).join("");

  // ---------- Lightbox ----------
  var lb = $("#lightbox");
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-lightbox]");
    if (t) {
      $("#lightbox-title").textContent = t.dataset.lightbox;
      $("#lightbox-img").innerHTML = bagArt(Number(t.dataset.variant || 0));
      lb.hidden = false;
      $("#lightbox-close").focus();
      return;
    }
    if (e.target === lb || e.target.id === "lightbox-close") lb.hidden = true;
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") lb.hidden = true; });

  // ---------- Copy prompt ----------
  $$("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.getElementById(btn.dataset.copy);
      var done = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy prompt"; }, 1600); };
      var fallback = function () {
        var r = document.createRange(); r.selectNodeContents(el);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        btn.textContent = "Selected, press Ctrl+C";
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.textContent).then(done, fallback);
      else fallback();
    });
  });

  // ---------- Handoff submit: confirm inline, then lock ----------
  var hf = $("#handoff-form");
  hf.addEventListener("submit", function (e) { e.preventDefault(); $("#ho-confirm").hidden = false; $("#ho-actions").hidden = true; });
  $("#ho-no").addEventListener("click", function () { $("#ho-confirm").hidden = true; $("#ho-actions").hidden = false; });
  $("#ho-yes").addEventListener("click", function () {
    $("#ho-confirm").hidden = true;
    $("#ho-done").hidden = false;
    $$("textarea, input", hf).forEach(function (i) { i.readOnly = true; });
  });

  // ---------- Task: duplicate and edit ----------
  $("#task-dup").addEventListener("click", function () {
    $("#task-locked").hidden = true;
    $("#task-draft").hidden = false;
    $("#task-save").hidden = false;
    $("#task-version").textContent = "Version 2 (draft), copied from version 1";
    $$("#task-form input, #task-form textarea").forEach(function (i) { i.readOnly = false; i.disabled = false; });
    $("#tk-prompt").focus();
  });

  // ---------- Add contender: API or manual ----------
  $$('input[name="cn-mode"]').forEach(function (r) {
    r.addEventListener("change", function () {
      $$("[data-mode]").forEach(function (b) { b.hidden = b.dataset.mode !== r.value; });
      $("#cn-name").value = r.value === "manual" ? "Claude Code (manual), plan mode" : "Opus 5.5, high reasoning, 0.6";
    });
  });

  // ---------- Workspace settings: fitness weights must total 100 ----------
  var weights = $$("[data-weight]");
  function checkWeights() {
    var total = weights.reduce(function (s, i) { return s + (Number(i.value) || 0); }, 0);
    $("#fw-total").textContent = total === 100 ? "Total 100. Ready to save." : "Total " + total + ". Make the three add up to 100.";
    $("#fw-total").className = "small" + (total === 100 ? "" : " status status--warn");
  }
  weights.forEach(function (i) { i.addEventListener("input", checkWeights); });

  // ---------- New run: live call count (the spending guard) ----------
  var runForm = $("#run-form");
  function countRun() {
    var tasks = $$("[data-task]:checked", runForm).length;
    var api = $$('[data-contender="api"]:checked', runForm).length;
    var manual = $$('[data-contender="manual"]:checked', runForm).length;
    var ai = $("#nr-ai").checked;
    var outputs = tasks * (api + manual);
    var judgeCalls = ai ? outputs : 0;
    $("#sum-outputs").textContent = tasks + " task" + (tasks === 1 ? "" : "s") + " × " + (api + manual) + " contenders = " + outputs;
    $("#sum-api").textContent = tasks * api;
    $("#sum-judge").textContent = ai ? judgeCalls : "0 (you judge)";
    $("#sum-total").textContent = tasks * api + judgeCalls;
    $("#sum-manual").textContent = manual
      ? "You'll copy " + tasks + " prompt" + (tasks === 1 ? "" : "s") + " and paste back " + tasks * manual + " outputs."
      : "No copying and pasting needed.";
    $("#nr-warn").hidden = !ai || api === 0;
  }
  runForm.addEventListener("change", countRun);
  countRun();

  // ---------- Leaderboard ----------
  $("#champ-confirm").addEventListener("click", function () {
    $("#champ-label").textContent = "Champion since 6 Nov 2026";
    $("#champ-actions").innerHTML = '<span class="status status--ok">Confirmed</span>';
  });
  // Group by model: rows keep their fitness order inside each group.
  var lbBody = $("#lb-table tbody");
  var lbRows = $$("tr[data-group]", lbBody);
  $("#lb-group").addEventListener("change", function (e) {
    lbBody.innerHTML = "";
    if (!e.target.checked) { lbRows.forEach(function (r) { lbBody.appendChild(r); }); return; }
    var groups = [];
    lbRows.forEach(function (r) { if (groups.indexOf(r.dataset.group) === -1) groups.push(r.dataset.group); });
    groups.forEach(function (g) {
      var head = document.createElement("tr");
      head.innerHTML = '<td colspan="8" class="section-label">' + g + "</td>";
      lbBody.appendChild(head);
      lbRows.filter(function (r) { return r.dataset.group === g; }).forEach(function (r) { lbBody.appendChild(r); });
    });
  });

  show();
})();
