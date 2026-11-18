// Shared fetch helper for staff/admin pages.
window.api = function (method, url, body) {
  return fetch(url, {
    method: method,
    credentials: "same-origin",
    headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: body == null ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  }).then(function (r) {
    if (r.status === 401) {
      location.href = "/staff/login?next=" + encodeURIComponent(location.pathname);
      return new Promise(function () {});
    }
    return r.json().catch(function () { return { ok: false, message: "Something went wrong." }; }).then(function (j) {
      if (!r.ok && j.ok === undefined) j.ok = false;
      return j;
    });
  }, function () {
    return { ok: false, message: "No connection. Check the Wi-Fi and try again." };
  });
};
