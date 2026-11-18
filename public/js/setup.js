// First-run setup wizard: five steps, one request at the end.
(function () {
  var f = document.getElementById("wizard");
  var cfg = JSON.parse(document.getElementById("setup-data").textContent);
  var steps = Array.prototype.slice.call(f.querySelectorAll("[data-step]"));
  var dots = Array.prototype.slice.call(document.querySelectorAll("[data-step-dot]"));
  var err = document.getElementById("err");
  var back = document.getElementById("back");
  var next = document.getElementById("next");
  var preview = document.getElementById("preview");
  var step = 1;
  var touched = { rewardLabel: false, stampIcon: false };

  function show(n) {
    step = n;
    steps.forEach(function (s) { s.classList.toggle("hidden", Number(s.getAttribute("data-step")) !== n); });
    dots.forEach(function (d) { var i = Number(d.getAttribute("data-step-dot")); d.classList.toggle("on", i === n); d.classList.toggle("done", i < n); });
    back.disabled = n === 1;
    next.textContent = n === 4 ? "Finish setup" : "Next";
    document.getElementById("wiz-nav").classList.toggle("hidden", n === 5);
    hideErr();
    var first = steps[n - 1].querySelector("input, select");
    if (first && n < 5) first.focus();
    window.scrollTo(0, 0);
  }
  function fail(msg) { err.textContent = msg; err.classList.remove("hidden"); }
  function hideErr() { err.classList.add("hidden"); }

  function valid(n) {
    if (n === 1) {
      if (!f.ownerName.value.trim()) return "Enter your name.";
      if (!/^\d{4,6}$/.test(f.pin.value)) return "Your PIN must be 4–6 digits.";
      if (f.pin.value !== f.pin2.value) return "The two PINs don't match.";
    }
    if (n === 2) {
      if (!f.shopName.value.trim()) return "Enter your business name.";
      var file = f.logo.files[0];
      if (file && file.size > 200 * 1024) return "The logo must be under 200 KB.";
    }
    if (n === 3) {
      var bad = ["primary", "secondary", "text"].filter(function (k) { return !/^#[0-9a-fA-F]{6}$/.test(f[k].value); });
      if (bad.length) return "Colours must look like #2F6FED.";
    }
    if (n === 4) {
      var s = Number(f.stampsRequired.value);
      if (!(s >= 3 && s <= 20)) return "Stamps for a reward must be between 3 and 20.";
      if (!f.rewardLabel.value.trim()) return "Say what the reward is.";
    }
    return null;
  }

  // ── Venue type picks the starting reward and icon ──
  f.rewardLabel.addEventListener("input", function () { touched.rewardLabel = true; });
  f.venueType.addEventListener("change", function () {
    var p = cfg.presets[f.venueType.value];
    if (!p) return;
    if (!touched.rewardLabel) f.rewardLabel.value = p.rewardLabel;
    if (!touched.stampIcon) { var r = f.querySelector('input[name="stampIcon"][value="' + p.stampIcon + '"]'); if (r) r.checked = true; drawSlots(); }
  });
  f.venueType.dispatchEvent(new Event("change"));

  // ── Live preview ──
  function lum(hex) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function paint() {
    preview.style.setProperty("--primary", f.primary.value);
    preview.style.setProperty("--secondary", f.secondary.value);
    preview.style.setProperty("--on-primary", f.text.value);
    preview.style.setProperty("--broadcast-bg", f.secondary.value);
    document.getElementById("contrast-warn").classList.toggle("hidden", contrast(f.text.value, f.secondary.value) >= 4.5);
  }
  ["primary", "secondary", "text"].forEach(function (k) {
    var picker = f[k];
    var hex = f.querySelector('[data-hex-for="' + k + '"]');
    picker.addEventListener("input", function () { hex.value = picker.value.toUpperCase(); paint(); });
    hex.addEventListener("input", function () {
      var v = hex.value.trim();
      if (v[0] !== "#") v = "#" + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { picker.value = v.toLowerCase(); paint(); }
    });
  });
  function drawSlots() {
    var box = preview.querySelector("[data-slots-preview]");
    var n = Math.min(20, Math.max(3, Number(f.stampsRequired.value) || 10));
    var checked = f.querySelector('input[name="stampIcon"]:checked');
    var svg = cfg.icons[checked ? checked.value : "circle"];
    var html = "";
    for (var i = 0; i < n; i++) html += '<div class="slot' + (i < Math.min(3, n - 1) ? " filled" : "") + '">' + svg + '<span class="num">' + (i + 1) + "</span></div>";
    box.innerHTML = html;
    box.style.setProperty("--cols", n <= 6 ? n : Math.ceil(n / 2));
  }
  f.stampsRequired.addEventListener("input", drawSlots);
  Array.prototype.forEach.call(f.querySelectorAll('input[name="stampIcon"]'), function (r) {
    r.addEventListener("change", function () { touched.stampIcon = true; drawSlots(); });
  });
  f.shopName.addEventListener("input", function () {
    preview.querySelector("[data-name-preview]").textContent = f.shopName.value || f.shopName.placeholder;
  });
  f.logo.addEventListener("change", function () {
    var file = f.logo.files[0];
    if (!file) return;
    var url = URL.createObjectURL(file);
    Array.prototype.forEach.call(document.querySelectorAll("[data-logo-preview], #wiz-logo"), function (img) { img.src = url; });
  });
  paint();
  drawSlots();

  // ── Navigation ──
  back.addEventListener("click", function () { if (step > 1) show(step - 1); });
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    var problem = valid(step);
    if (problem) return fail(problem);
    if (step < 4) return show(step + 1);
    next.disabled = true;
    next.textContent = "Setting up…";
    var icon = f.querySelector('input[name="stampIcon"]:checked');
    window.api("POST", "/api/setup", {
      token: f.getAttribute("data-token"),
      ownerName: f.ownerName.value,
      pin: f.pin.value,
      shopName: f.shopName.value,
      venueType: f.venueType.value,
      primary: f.primary.value,
      secondary: f.secondary.value,
      text: f.text.value,
      stampsRequired: Number(f.stampsRequired.value),
      rewardLabel: f.rewardLabel.value,
      stampIcon: icon ? icon.value : undefined,
    }).then(function (r) {
      if (!r.ok) { next.disabled = false; next.textContent = "Finish setup"; return fail(r.message || "Setup failed."); }
      var file = f.logo.files[0];
      if (!file) return show(5);
      var fd = new FormData(); fd.append("file", file);
      return window.api("POST", "/api/admin/logo", fd).then(function (u) {
        show(5);
        if (!u.ok) fail("You're all set up, but the logo didn't upload: " + (u.message || "try again in Admin") + ".");
      });
    });
  });
})();
