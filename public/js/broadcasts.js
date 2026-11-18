// Owner Broadcasts page: live character count + preview, publish, end.
(function () {
  var cfg = JSON.parse(document.getElementById("bc-data").textContent);
  var form = document.getElementById("bc-form");
  var box = form.message;
  var count = document.getElementById("bc-count");
  var preview = document.getElementById("bc-preview-msg");
  var err = document.getElementById("bc-err");
  var placeholder = preview.textContent;

  function update() {
    var n = Array.from(box.value).length;
    count.textContent = n;
    count.style.color = n > cfg.max ? "#B3261E" : "";
    // textContent: the message is never treated as HTML.
    preview.textContent = box.value.trim() ? box.value : placeholder;
  }
  box.addEventListener("input", update);
  update();

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.classList.add("hidden");
    var msg = "This will show to every customer the next time they open their card.";
    if (!cfg.contrastOk) msg += "\n\nWarning: the text colour has low contrast on the pop-up background (" + cfg.ratio + ":1, needs 4.5:1).";
    msg += "\n\nPublish now?";
    if (!confirm(msg)) return;
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    window.api("POST", "/api/admin/broadcasts", { message: box.value, endDate: form.endDate.value || null }).then(function (r) {
      btn.disabled = false;
      if (r.ok) location.reload();
      else { err.textContent = r.message || "Couldn't publish."; err.classList.remove("hidden"); }
    });
  });

  var end = document.getElementById("end-now");
  if (end) end.addEventListener("click", function () {
    if (!confirm("End this broadcast now? Customers who haven't seen it won't see it.")) return;
    window.api("POST", "/api/admin/broadcasts/" + end.getAttribute("data-id") + "/end").then(function (r) {
      if (r.ok) location.reload(); else alert(r.message || "Couldn't end it.");
    });
  });
})();
