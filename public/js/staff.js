(function () {
  var b = document.getElementById("logout");
  if (b) b.addEventListener("click", function () {
    fetch("/api/staff/logout", { method: "POST", credentials: "same-origin" }).then(function () { location.href = "/staff/login"; });
  });
})();
