(function () {
  var d = JSON.parse(document.getElementById("stamp-data").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var amount = 1;
  var maxAmount = Math.max(1, Math.min(d.maxPerScan, d.leftToday || d.maxPerScan));
  var busy = false;
  var lastEventId = null;
  var undoTimer = null;

  function showErr(msg) { var e = $("err"); e.textContent = msg; e.classList.remove("hidden"); }
  function clearErr() { $("err").classList.add("hidden"); }

  function drawAmount() {
    $("amount").textContent = amount;
    $("amount-label").textContent = amount === 1 ? "stamp" : "stamps";
    $("minus").disabled = amount <= 1;
    $("plus").disabled = amount >= maxAmount;
  }
  if (d.leftToday === 0) {
    showErr("This card has had all its stamps for today.");
    $("confirm").disabled = true;
  }
  drawAmount();

  $("minus").addEventListener("click", function () { if (amount > 1) { amount--; drawAmount(); } });
  $("plus").addEventListener("click", function () { if (amount < maxAmount) { amount++; drawAmount(); } });
  if ($("show-stamp")) $("show-stamp").addEventListener("click", function () {
    $("stamp-controls").classList.remove("hidden");
    this.classList.add("hidden");
  });

  function done(kind, res) {
    lastEventId = res.eventId;
    $("screen-stamp").classList.add("hidden");
    $("screen-done").classList.remove("hidden");
    $("done-title").textContent = kind === "redeem" ? d.rewardLabel + " redeemed" : "+" + amount + " stamp" + (amount === 1 ? "" : "s");
    $("done-count").textContent = res.stamps;
    $("done-note").textContent = res.rewardReady
      ? d.rewardLabel + " ready – scan again to redeem."
      : (res.required - res.stamps) + " more to go.";
    if (navigator.vibrate) navigator.vibrate(60);
    startUndoTimer();
  }

  function startUndoTimer() {
    var until = Date.now() + d.undoWindowMs;
    var btn = $("undo");
    btn.classList.remove("hidden");
    btn.disabled = false;
    clearInterval(undoTimer);
    function tick() {
      var left = Math.max(0, until - Date.now());
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      $("undo-timer").textContent = "(" + m + ":" + (s < 10 ? "0" : "") + s + ")";
      if (left <= 0) { clearInterval(undoTimer); btn.classList.add("hidden"); }
    }
    tick();
    undoTimer = setInterval(tick, 1000);
  }

  function send(url, body, kind, btn) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    clearErr();
    window.api("POST", url, body).then(function (res) {
      busy = false;
      btn.disabled = false;
      if (res.ok) done(kind, res);
      else showErr(res.message || "Something went wrong.");
    });
  }

  $("confirm").addEventListener("click", function () {
    send("/api/staff/stamp", { scanCode: d.scanCode, amount: amount, idempotencyKey: d.idemKey }, "stamp", this);
  });
  if ($("redeem")) $("redeem").addEventListener("click", function () {
    send("/api/staff/redeem", { scanCode: d.scanCode, idempotencyKey: d.idemKey }, "redeem", this);
  });

  $("undo").addEventListener("click", function () {
    var btn = this;
    if (busy || !lastEventId) return;
    busy = true;
    btn.disabled = true;
    window.api("POST", "/api/staff/undo", { eventId: lastEventId }).then(function (res) {
      busy = false;
      var msg = $("undo-msg");
      msg.classList.remove("hidden");
      if (res.ok) {
        clearInterval(undoTimer);
        btn.classList.add("hidden");
        $("done-title").textContent = "Undone";
        $("done-count").textContent = res.stamps;
        $("done-note").textContent = "";
        msg.className = "alert ok";
        msg.textContent = "Reversed. The card is back to " + res.stamps + ".";
      } else {
        btn.disabled = false;
        msg.className = "alert";
        msg.textContent = res.message || "Couldn't undo.";
      }
    });
  });
})();
