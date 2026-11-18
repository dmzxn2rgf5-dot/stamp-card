// Owner Customers page: list with search/filter/sort/paging, plus a
// detail drawer for actions and event history.
(function () {
  var cfg = JSON.parse(document.getElementById("customers-data").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var form = $("filters");
  var page = 1;
  var total = 0;
  var pageSize = 50;
  var searchTimer = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function date(ts) {
    if (!ts) return "–";
    return new Intl.DateTimeFormat("en-GB", { timeZone: cfg.tz, day: "numeric", month: "short", year: "numeric" }).format(ts);
  }
  function params() {
    var p = new URLSearchParams();
    var q = form.q.value.trim();
    if (q) p.set("q", q);
    p.set("sort", form.sort.value);
    ["hasEmail", "optedIn", "rewardReady", "lapsed"].forEach(function (k) {
      var el = document.querySelector('input[name="' + k + '"]');
      if (el && el.checked) p.set(k, "1");
    });
    p.set("page", String(page));
    return p;
  }

  function emailCell(r) {
    if (!r.email) return '<span class="muted">–</span>';
    if (!r.email_verified_at) return '<span class="muted-row">' + esc(r.email) + ' <span class="pill off">pending</span></span>';
    return esc(r.email);
  }

  function load() {
    $("rows").innerHTML = '<tr><td colspan="' + (cfg.emailOn ? 7 : 5) + '" class="muted">Loading…</td></tr>';
    window.api("GET", "/api/admin/customers?" + params().toString()).then(function (res) {
      if (!res.ok) { $("rows").innerHTML = '<tr><td colspan="' + (cfg.emailOn ? 7 : 5) + '">' + esc(res.message || "Couldn't load.") + "</td></tr>"; return; }
      total = res.total;
      pageSize = res.pageSize;
      $("count").textContent = total + " card" + (total === 1 ? "" : "s");
      var pages = Math.max(1, Math.ceil(total / pageSize));
      $("pageinfo").textContent = "Page " + page + " of " + pages;
      $("prev").disabled = page <= 1;
      $("next").disabled = page >= pages;
      if (!res.rows.length) { $("rows").innerHTML = '<tr><td colspan="' + (cfg.emailOn ? 7 : 5) + '" class="muted">No customers match.</td></tr>'; return; }
      $("rows").innerHTML = res.rows.map(function (r) {
        var optIn = r.email_verified_at && r.marketing_opt_in ? "Yes · " + date(r.marketing_opt_in_at) : "No";
        var ready = r.stamps >= res.required ? ' <span class="pill">ready</span>' : "";
        return '<tr data-id="' + esc(r.id) + '" style="cursor:pointer">' +
          (cfg.emailOn ? "<td>" + emailCell(r) + "</td>" : "") +
          "<td>" + r.stamps + " / " + res.required + ready + "</td>" +
          "<td>" + r.rewards_redeemed + "</td>" +
          (cfg.emailOn ? "<td>" + optIn + "</td>" : "") +
          "<td>" + date(r.created_at) + "</td>" +
          "<td>" + date(r.last_visit) + "</td>" +
          "<td><code>" + esc(r.scan_code) + "</code></td></tr>";
      }).join("");
    });
  }

  form.addEventListener("input", function (e) {
    page = 1;
    if (e.target.name === "q") { clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); }
    else load();
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[form="filters"]'), function (el) {
    el.addEventListener("change", function () { page = 1; load(); });
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); });
  $("prev").addEventListener("click", function () { if (page > 1) { page--; load(); } });
  $("next").addEventListener("click", function () { page++; load(); });
  $("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-id]");
    if (tr) openCustomer(tr.getAttribute("data-id"));
  });

  // ── Detail drawer ───────────────────────────────────────
  var drawer = $("drawer");
  function close() { drawer.classList.add("hidden"); }
  drawer.addEventListener("click", function (e) { if (e.target === drawer) close(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

  function openCustomer(id) {
    drawer.classList.remove("hidden");
    $("drawer-body").innerHTML = '<p class="muted">Loading…</p>';
    window.api("GET", "/api/admin/customers/" + encodeURIComponent(id)).then(function (res) {
      if (!res.ok) { $("drawer-body").innerHTML = "<p>" + esc(res.message) + "</p>"; return; }
      render(res.customer, res.events);
    });
  }

  function render(cu, events) {
    var emailLine = cu.emailStatus === "none"
      ? '<span class="muted">No email saved</span>'
      : esc(cu.email) + (cu.emailStatus === "pending" ? ' <span class="pill off">pending</span>' : ' <span class="pill">verified</span>');
    $("drawer-body").innerHTML =
      '<div class="row" style="justify-content:space-between"><h2 id="d-title" style="flex:1 1 auto;margin:0">Card <code>' + esc(cu.scanCode) + '</code></h2>' +
      '<button class="btn btn-sm" id="d-close" type="button" style="flex:0 0 auto">Close</button></div>' +
      '<div class="stats" style="margin:14px 0">' +
      '<div class="stat"><b>' + cu.stamps + " / " + cu.required + "</b><span>Stamps</span></div>" +
      '<div class="stat"><b>' + cu.rewardsRedeemed + "</b><span>Rewards redeemed</span></div></div>" +
      "<p>" + (cfg.emailOn ? "<b>Email:</b> " + emailLine + "<br><b>Offers:</b> " + (cu.optIn && cu.emailStatus === "verified" ? "Opted in " + date(cu.optInAt) : "No") + "<br>" : "") +
      "<b>Card created:</b> " + date(cu.createdAt) + "</p>" +
      '<div class="alert hidden" id="d-msg" role="status"></div>' +

      (cfg.emailOn ? '<section class="panel"><h3>Email</h3>' +
      (cu.emailStatus === "verified" && cfg.emailOn ? '<p><button class="btn btn-primary btn-sm" id="d-send" type="button">Send recovery link</button></p>' : "") +
      '<form id="d-email" class="row" style="align-items:flex-end"><label class="field" style="flex:2 1 200px">' + (cu.email ? "Change email" : "Add email") +
      '<input type="email" name="email" required></label><button class="btn btn-sm" type="submit" style="flex:0 0 auto">Save &amp; send confirmation</button></form>' +
      (cu.email ? '<button class="btn btn-sm btn-ghost" id="d-remove" type="button">Remove email</button>' : "") +
      '<p class="small muted">A new email must be confirmed by the customer before it can recover the card.</p></section>' : "") +

      '<section class="panel"><h3>Adjust stamps</h3><form id="d-adjust" class="row" style="align-items:flex-end">' +
      '<label class="field" style="flex:0 1 110px">Change<input type="number" name="amount" required step="1" min="-100" max="100" placeholder="+1 or -1"></label>' +
      '<label class="field" style="flex:2 1 200px">Reason (required)<input name="reason" required maxlength="200"></label>' +
      '<button class="btn btn-sm btn-primary" type="submit" style="flex:0 0 auto">Adjust</button></form></section>' +

      '<section class="panel"><h3>History</h3><div class="table-scroll"><table class="list"><tbody>' +
      (events.length ? events.map(function (e) {
        var amt = e.type === "stamp" || e.type === "merge" ? " +" + e.amount : e.type === "adjust" ? " " + (e.amount > 0 ? "+" : "") + e.amount : e.type === "redeem" ? " −" + e.amount : "";
        return '<tr style="' + (e.undone ? "opacity:.5;text-decoration:line-through" : "") + '"><td>' + esc(e.time) + "</td><td>" + esc(e.label) + esc(amt) +
          (e.note ? '<br><span class="small muted">' + esc(e.note) + "</span>" : "") + "</td><td>" + esc(e.staff) + "</td></tr>";
      }).join("") : '<tr><td class="muted">No history yet.</td></tr>') +
      "</tbody></table></div></section>" +

      '<section class="panel"><h3>Delete customer</h3><p class="small">' + (cfg.emailOn ? "Erases the email and offers consent, and retires" : "Retires") + ' the card so its link and QR stop working. Use this for data deletion requests.</p>' +
      '<button class="btn btn-sm btn-danger" id="d-delete" type="button">' + (cfg.emailOn ? "Delete card and email" : "Delete card") + "</button></section>";

    function msg(text, ok) { var m = $("d-msg"); m.textContent = text; m.className = "alert" + (ok ? " ok" : ""); m.scrollIntoView({ block: "nearest" }); }
    function done(r, okText) { if (r.ok) { msg(okText, true); openCustomerSoon(cu.id); load(); } else msg(r.message || "Something went wrong."); }

    $("d-close").addEventListener("click", close);
    if ($("d-send")) $("d-send").addEventListener("click", function () {
      if (!confirm("Email a recovery link to " + cu.email + "?")) return;
      window.api("POST", "/api/admin/customers/" + cu.id + "/send-recovery").then(function (r) { done(r, "Recovery link sent to " + cu.email + "."); });
    });
    if ($("d-email")) $("d-email").addEventListener("submit", function (e) {
      e.preventDefault();
      window.api("PATCH", "/api/admin/customers/" + cu.id, { email: this.email.value }).then(function (r) { done(r, "Saved. A confirmation link was sent to the new address."); });
    });
    if ($("d-remove")) $("d-remove").addEventListener("click", function () {
      if (!confirm("Remove the email from this card? Nothing is sent, and offers consent is cleared.")) return;
      window.api("PATCH", "/api/admin/customers/" + cu.id, { email: null }).then(function (r) { done(r, "Email removed."); });
    });
    $("d-adjust").addEventListener("submit", function (e) {
      e.preventDefault();
      var amount = parseInt(this.amount.value, 10);
      window.api("PATCH", "/api/admin/customers/" + cu.id, { adjust: { amount: amount, reason: this.reason.value } }).then(function (r) {
        done(r, "Stamps adjusted by " + (amount > 0 ? "+" : "") + amount + ".");
      });
    });
    $("d-delete").addEventListener("click", function () {
      if (!confirm(cfg.emailOn ? "Delete this card and its email? This can't be undone." : "Delete this card? This can't be undone.")) return;
      window.api("DELETE", "/api/admin/customers/" + cu.id).then(function (r) {
        if (r.ok) { close(); load(); } else msg(r.message || "Couldn't delete.");
      });
    });
  }

  var reopenTimer = null;
  function openCustomerSoon(id) {
    clearTimeout(reopenTimer);
    reopenTimer = setTimeout(function () {
      var keep = $("d-msg") ? $("d-msg").outerHTML : "";
      window.api("GET", "/api/admin/customers/" + encodeURIComponent(id)).then(function (res) {
        if (!res.ok) { close(); return; }
        render(res.customer, res.events);
        if (keep) { var m = $("d-msg"); m.outerHTML = keep; }
      });
    }, 300);
  }

  load();
})();
