(function () {
  function msg(form, text, ok) {
    var el = form.querySelector("[data-msg]");
    if (el) { el.textContent = text; el.style.color = ok ? "" : "#B3261E"; }
  }
  function after(form, r, reload) {
    if (r.ok) { msg(form, "Saved", true); if (reload) setTimeout(function () { location.reload(); }, 300); }
    else msg(form, r.message || "Couldn't save.", false);
  }

  var rules = document.getElementById("rules-form");
  rules.addEventListener("submit", function (e) {
    e.preventDefault();
    window.api("PATCH", "/api/admin/shop", {
      name: rules.name.value,
      rewardLabel: rules.rewardLabel.value,
      stampsRequired: +rules.stampsRequired.value,
      maxStampsPerScan: +rules.maxStampsPerScan.value,
      maxStampsPerDay: +rules.maxStampsPerDay.value,
    }).then(function (r) { after(rules, r, true); });
  });

  var brand = document.getElementById("brand-form");
  // Colour pickers ⇄ hex fields, live preview, and the contrast warning.
  var map = { primary: "--primary", secondary: "--secondary", text: "--on-primary", accent: "--accent", ink: "--ink", background: "--bg", surface: "--surface" };
  function lum(hex) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function checkContrast() {
    var bg = brand.broadcastBg.value === "primary" ? brand.primary.value : brand.secondary.value;
    document.getElementById("contrast-warn").classList.toggle("hidden", contrast(brand.text.value, bg) >= 4.5);
  }
  Object.keys(map).forEach(function (k) {
    var picker = brand[k];
    var hex = brand.querySelector('[data-hex-for="' + k + '"]');
    picker.addEventListener("input", function () {
      hex.value = this.value.toUpperCase();
      document.documentElement.style.setProperty(map[k], this.value);
      checkContrast();
    });
    hex.addEventListener("input", function () {
      var v = this.value.trim();
      if (v[0] !== "#") v = "#" + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        picker.value = v.toLowerCase();
        document.documentElement.style.setProperty(map[k], v);
        checkContrast();
      }
    });
  });
  brand.broadcastBg.addEventListener("change", checkContrast);
  brand.addEventListener("submit", function (e) {
    e.preventDefault();
    window.api("PATCH", "/api/admin/shop", {
      primary: brand.primary.value,
      secondary: brand.secondary.value,
      text: brand.text.value,
      broadcastBg: brand.broadcastBg.value,
      theme: {
        accent: brand.accent.value,
        ink: brand.ink.value,
        background: brand.background.value,
        surface: brand.surface.value,
        stampIcon: brand.stampIcon.value,
        tagline: brand.tagline.value,
        fontDisplay: brand.fontDisplay.value,
        fontBody: brand.fontBody.value,
        fontsUrl: brand.fontsUrl.value,
        showNameWithLogo: brand.showNameWithLogo.checked,
        poweredBy: brand.poweredBy.checked,
      },
    }).then(function (r) { after(brand, r, true); });
  });
  document.getElementById("brand-reset").addEventListener("click", function () {
    if (!confirm("Reset colours, fonts, icon and logo to the defaults?")) return;
    window.api("PATCH", "/api/admin/shop", { reset: true }).then(function (r) { after(brand, r, true); });
  });

  var logo = document.getElementById("logo-form");
  logo.addEventListener("submit", function (e) {
    e.preventDefault();
    var file = logo.file.files[0];
    var p = file
      ? (function () { var fd = new FormData(); fd.append("file", file); return window.api("POST", "/api/admin/logo", fd); })()
      : window.api("PATCH", "/api/admin/shop", { logoUrl: logo.url.value || null });
    p.then(function (r) { after(logo, r, true); });
  });

  var icon = document.getElementById("stamp-icon-form");
  icon.addEventListener("submit", function (e) {
    e.preventDefault();
    var file = icon.file.files[0];
    if (!file) return;
    var fd = new FormData(); fd.append("file", file);
    window.api("POST", "/api/admin/stamp-icon", fd).then(function (r) { after(icon, r, true); });
  });

  document.getElementById("staff").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-revoke")) {
      if (!confirm("Log this device out?")) return;
      window.api("POST", "/api/admin/sessions/revoke", { sessionId: b.getAttribute("data-revoke") }).then(function (r) {
        if (r.ok) location.reload(); else alert(r.message);
      });
      return;
    }
    var act = b.getAttribute("data-act");
    if (!act) return;
    var row = b.closest("tr");
    var body = { action: act, staffId: row.getAttribute("data-id") };
    var name = row.getAttribute("data-name");
    if (act === "rename") { body.name = prompt("New name for " + name, name); if (!body.name) return; }
    if (act === "reset_pin") { body.pin = prompt("New 4–6 digit PIN for " + name); if (!body.pin) return; }
    if (act === "deactivate" && !confirm("Deactivate " + name + "? They'll be logged out everywhere.")) return;
    window.api("POST", "/api/admin/staff", body).then(function (r) {
      if (r.ok) location.reload(); else alert(r.message || "Couldn't update.");
    });
  });

  var add = document.getElementById("add-staff");
  add.addEventListener("submit", function (e) {
    e.preventDefault();
    window.api("POST", "/api/admin/staff", { action: "add", name: add.name.value, pin: add.pin.value, role: add.role.value })
      .then(function (r) { after(add, r, true); });
  });
})();
