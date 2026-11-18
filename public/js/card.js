// Customer card: live updates by polling, stamp animation, offline cache,
// and the Add to Home Screen tip.
(function () {
  var data = JSON.parse(document.getElementById("card-data").textContent);
  var key = data.storageKey;
  var secretId = data.secretId;
  var state = data.state;
  var offlineShell = !!data.offline;
  if (offlineShell) {
    // Served by the service worker with no network: rebuild from localStorage.
    try {
      secretId = localStorage.getItem(key);
      var saved = JSON.parse(localStorage.getItem(key + ":state") || "null");
      if (saved) state = saved;
    } catch (e) {}
    if (!secretId) { document.getElementById("status").textContent = "You're offline. Reconnect to open your card."; return; }
    var qrImg = document.getElementById("qr");
    if (qrImg) qrImg.src = "/card/" + secretId + "/qr.svg";
  }
  var POLL_MS = 2000;
  var IDLE_STOP_MS = 5 * 60 * 1000;
  var lastChange = Date.now();
  var timer = null;
  var failures = 0;

  var $ = function (id) { return document.getElementById(id); };
  var slots = Array.prototype.slice.call(document.querySelectorAll("#slots .slot"));
  var statusEl = $("status");

  function store(s) {
    if (offlineShell) return;
    try {
      localStorage.setItem(key, secretId);
      localStorage.setItem(key + ":state", JSON.stringify(s));
    } catch (e) {}
  }
  store(state);

  function progressText(s) {
    var left = s.required - s.stamps;
    var label = data.rewardLabel.toLowerCase();
    if (left <= 0) return s.required + " of " + s.required + " – " + label + " ready!";
    return s.stamps + " of " + s.required + " – " + left + " more for a " + label;
  }

  function render(next, animate) {
    if (next.required !== slots.length) { if (!offlineShell) location.reload(); return; }
    var prevFilled = Math.min(state.stamps, state.required);
    var nowFilled = Math.min(next.stamps, next.required);
    slots.forEach(function (el, i) {
      var filled = i < nowFilled;
      el.classList.toggle("filled", filled);
      el.classList.remove("pop");
      if (animate && filled && i >= prevFilled) {
        // stagger the pop-in of new stamps
        void el.offsetWidth;
        el.style.animationDelay = (i - prevFilled) * 120 + "ms";
        el.classList.add("pop");
      }
    });
    $("slots").setAttribute("aria-label", nowFilled + " of " + next.required + " stamps");
    var p = $("progress");
    p.textContent = progressText(next);
    if (next.stamps > next.required) {
      var sm = document.createElement("small");
      sm.textContent = "+" + (next.stamps - next.required) + " carried over";
      p.appendChild(sm);
    }
    $("reward").classList.toggle("hidden", !next.rewardReady);
    if (animate && navigator.vibrate) {
      try { navigator.vibrate(next.stamps > state.stamps ? [40, 60, 40] : 60); } catch (e) {}
    }
    state = next;
    if (window.__showSaveLink) window.__showSaveLink(next);
    store(next);
  }

  function setStatus(msg) { statusEl.textContent = msg || ""; }

  function poll() {
    timer = null;
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastChange > IDLE_STOP_MS) { setStatus(""); return; }
    fetch("/api/card/" + secretId + "?since=" + state.version, { cache: "no-store", credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 204) return null;
        if (r.status === 404) {
          // Card was restored on another device (secret rotated) or removed.
          gone = true;
          setStatus("");
          var p = $("progress");
          p.textContent = "This card has moved to another device.";
          var a = document.createElement("a");
          a.href = "/recover"; a.textContent = " Lost your card?"; a.style.color = "inherit";
          p.appendChild(a);
          return null;
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (next) {
        failures = 0;
        setStatus("");
        if (next && next.version !== state.version) {
          lastChange = Date.now();
          render(next, true);
        }
      })
      .catch(function () {
        failures++;
        if (failures >= 2) setStatus("Reconnecting…");
      })
      .then(schedule);
  }

  var gone = false;
  function schedule() {
    if (gone) return;
    if (timer || document.visibilityState !== "visible") return;
    timer = setTimeout(poll, POLL_MS);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      lastChange = Date.now();
      if (timer) { clearTimeout(timer); timer = null; }
      poll();
    } else if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });
  window.addEventListener("online", function () { lastChange = Date.now(); poll(); });
  window.addEventListener("offline", function () { setStatus("Offline – showing your last saved stamps. Reconnecting…"); });

  // If the page was served from bfcache / offline, prefer a newer cached state.
  try {
    var cached = JSON.parse(localStorage.getItem(key + ":state") || "null");
    if (cached && cached.version > state.version) render(cached, false);
  } catch (e) {}
  if (offlineShell) {
    var shellState = state;
    state = { stamps: 0, required: slots.length, version: -1 };
    render(shellState, false);
    setStatus("Offline – showing your last saved stamps. Reconnecting…");
    window.addEventListener("online", function () { location.replace("/card/" + secretId); });
    return;
  }
  if (!navigator.onLine) setStatus("Offline – showing your last saved stamps. Reconnecting…");
  schedule();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  }

  // ── Broadcast pop-up (Amendment 2) ──────────────────────
  // Only closes via ×; tapping the dimmed background does nothing.
  var bc = $("bc");
  if (bc) {
    var lastFocus = document.activeElement;
    $("bc-close").focus();
    document.body.style.overflow = "hidden";
    bc.addEventListener("keydown", function (e) {
      if (e.key === "Tab") { e.preventDefault(); $("bc-close").focus(); } // keep focus inside
    });
    $("bc-close").addEventListener("click", function () {
      var id = bc.getAttribute("data-id");
      bc.remove();
      document.body.style.overflow = "";
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      var url = "/api/card/" + secretId + "/broadcast/" + encodeURIComponent(id) + "/dismiss";
      var send = function (n) {
        fetch(url, { method: "POST", credentials: "same-origin", keepalive: true }).catch(function () {
          if (n < 3) setTimeout(function () { send(n + 1); }, 2000 * (n + 1));
        });
      };
      send(0);
    });
  }

  // ── Save card to email (Amendment 1) ────────────────────
  if (data.emailOn && $("save-card")) {
    var emailStatus = data.emailStatus;
    var show = function (status, masked) {
      emailStatus = status;
      $("email-none").classList.toggle("hidden", status !== "none" || (state.stamps < 1 && !state.rewardsRedeemed));
      $("email-pending").classList.toggle("hidden", status !== "pending");
      $("email-verified").classList.toggle("hidden", status !== "verified");
      if (masked) Array.prototype.forEach.call(document.querySelectorAll("[data-masked]"), function (el) { el.textContent = masked; });
    };
    window.__showSaveLink = function () { show(emailStatus); };
    $("email-open").addEventListener("click", function () {
      $("email-form").classList.toggle("hidden");
      var input = $("email-form").querySelector("input[type=email]");
      if (!$("email-form").classList.contains("hidden")) input.focus();
    });
    $("email-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = this, err = $("email-err"), btn = f.querySelector("button[type=submit]");
      err.classList.add("hidden");
      btn.disabled = true;
      fetch("/api/card/" + secretId + "/email", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: f.email.value, optIn: f.optIn.checked }),
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          btn.disabled = false;
          if (j.ok) { f.classList.add("hidden"); f.reset(); show("pending", j.masked); }
          else { err.textContent = j.message || "Couldn't save."; err.classList.remove("hidden"); }
        })
        .catch(function () { btn.disabled = false; err.textContent = "No connection. Try again."; err.classList.remove("hidden"); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-remove]"), function (b) {
      b.addEventListener("click", function () {
        if (!confirm("Remove your email from this card? You won't be able to recover it by email, and offers will stop.")) return;
        fetch("/api/card/" + secretId + "/email/remove", { method: "POST", credentials: "same-origin" })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (j.ok) show("none"); });
      });
    });
  }

  // ── Add to Home Screen tip ──────────────────────────────
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  var dismissed = false;
  try { dismissed = localStorage.getItem("a2hs-dismissed") === "1"; } catch (e) {}
  if (!standalone && !dismissed) {
    var ua = navigator.userAgent;
    var isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/.test(ua);
    if (isIOS || isAndroid) {
      $("a2hs").classList.remove("hidden");
      $(isIOS ? "a2hs-ios" : "a2hs-android").classList.remove("hidden");
    }
  }
  $("a2hs-close").addEventListener("click", function () {
    $("a2hs").classList.add("hidden");
    try { localStorage.setItem("a2hs-dismissed", "1"); } catch (e) {}
  });
  var deferred = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    $("a2hs-install").classList.remove("hidden");
  });
  $("a2hs-install").addEventListener("click", function () {
    if (!deferred) return;
    deferred.prompt();
    deferred = null;
    $("a2hs").classList.add("hidden");
  });
})();
