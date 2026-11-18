(function () {
  var data = JSON.parse(document.getElementById("login-data").textContent);
  var staffId = null;
  var pin = "";
  var busy = false;
  var dots = document.getElementById("dots");
  var err = document.getElementById("err");

  function drawDots() {
    dots.innerHTML = "";
    var n = Math.max(4, pin.length);
    for (var i = 0; i < n; i++) {
      var d = document.createElement("i");
      if (i < pin.length) d.className = "on";
      dots.appendChild(d);
    }
  }

  document.getElementById("names").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    staffId = b.getAttribute("data-id");
    Array.prototype.forEach.call(this.querySelectorAll("button"), function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
    document.getElementById("pin-step").classList.remove("hidden");
    pin = "";
    drawDots();
    err.classList.add("hidden");
  });

  function submit() {
    if (busy || !staffId || pin.length < 4) return;
    busy = true;
    fetch("/api/staff/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId: staffId, pin: pin }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) { location.replace(data.next); return; }
        err.textContent = j.message || "Login failed.";
        err.classList.remove("hidden");
        pin = "";
        drawDots();
        if (navigator.vibrate) navigator.vibrate(120);
      })
      .catch(function () {
        err.textContent = "No connection. Try again.";
        err.classList.remove("hidden");
      })
      .then(function () { busy = false; });
  }

  document.getElementById("keypad").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var k = b.getAttribute("data-k");
    if (k === "del") pin = pin.slice(0, -1);
    else if (k === "go") return submit();
    else if (pin.length < 6) pin += k;
    drawDots();
  });
  document.addEventListener("keydown", function (e) {
    if (!staffId) return;
    if (/^\d$/.test(e.key) && pin.length < 6) pin += e.key;
    else if (e.key === "Backspace") pin = pin.slice(0, -1);
    else if (e.key === "Enter") return submit();
    else return;
    drawDots();
  });
})();
