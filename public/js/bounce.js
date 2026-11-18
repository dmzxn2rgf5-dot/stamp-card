(function () {
  var d = JSON.parse(document.getElementById("bounce-data").textContent);
  location.replace(d.to);
})();
