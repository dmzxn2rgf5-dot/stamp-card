// Enquiry form: send without leaving the page. Without JS the form posts straight to Web3Forms.
(function () {
  var f = document.getElementById("enquiry-form");
  if (!f) return;
  var err = document.getElementById("enquiry-error");
  var done = document.getElementById("enquiry-done");
  var btn = f.querySelector("button[type=submit]");
  function fail(msg) { err.textContent = msg; err.classList.remove("hidden"); btn.disabled = false; btn.textContent = "Send"; }
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    err.classList.add("hidden");
    var picked = f.querySelector("input[name=choice]:checked");
    if (!picked) { fail("Please pick an option."); f.querySelector("input[name=choice]").focus(); return; }
    var email = f.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { fail("Please enter a valid email address."); f.email.focus(); return; }
    btn.disabled = true;
    btn.textContent = "Sending…";
    // 1. This site checks and cleans the details. 2. The browser sends them to Web3Forms.
    fetch("/api/enquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: picked.getAttribute("data-choice"), email: email, venueName: f.venueName.value, venueType: f.venueType.value, botcheck: f.botcheck.checked }),
    })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (out) {
        if (!out.ok) throw new Error(out.message || "");
        if (!out.payload) return { success: true }; // honeypot: nothing to send
        return fetch(out.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(out.payload),
        }).then(function (r) { return r.json().catch(function () { return { success: false }; }); });
      })
      .then(function (res) {
        if (!res.success) throw new Error("");
        f.classList.add("hidden");
        done.classList.remove("hidden");
      })
      .catch(function (e) { fail((e && e.message) || "Sorry, that didn't send. Please try again later."); });
  });
})();
