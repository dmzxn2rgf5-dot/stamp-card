// /join without a cookie: recover a card from localStorage if we have one,
// otherwise ask the server for a new card.
(function () {
  var data = JSON.parse(document.getElementById("join-data").textContent);
  var id = null;
  try { id = localStorage.getItem(data.key); } catch (e) {}
  if (id && /^[0-9A-Za-z]{24}$/.test(id)) location.replace("/join?ls=" + encodeURIComponent(id));
  else location.replace("/join?new=1");
})();
