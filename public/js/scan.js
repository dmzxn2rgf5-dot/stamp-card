// In-app QR scanner for staff. Runs entirely on the phone: camera frames
// are decoded locally (native BarcodeDetector where available, otherwise
// jsQR) and never leave the device.
(function () {
  var video = document.getElementById("video");
  var statusEl = document.getElementById("scan-status");
  var codeForm = document.getElementById("code-form");
  var codeInput = document.getElementById("code");
  var CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
  var stream = null;
  var running = false;
  var done = false;
  var canvas = document.createElement("canvas");
  var ctx = canvas.getContext("2d", { willReadFrequently: true });
  var detector = null;
  var lastBad = 0;

  function setStatus(msg, bad) {
    statusEl.textContent = msg;
    statusEl.classList.toggle("bad", !!bad);
  }

  /** Only accept our own card QRs: https://<this site>/staff/stamp/<code>. */
  function scanCodeFrom(text) {
    try {
      var u = new URL(String(text).trim());
      if (u.origin !== location.origin) return null;
      var m = u.pathname.match(/^\/staff\/stamp\/([0-9A-Za-z]{10})$/);
      return m && CODE.test(m[1].toUpperCase()) ? m[1].toUpperCase() : null;
    } catch (e) {
      return null;
    }
  }

  function go(code) {
    if (done) return;
    done = true;
    stop();
    if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) {} }
    setStatus("Card found – opening…");
    location.href = "/staff/stamp/" + code;
  }

  function handle(text) {
    var code = scanCodeFrom(text);
    if (code) return go(code);
    var now = Date.now();
    if (now - lastBad > 1500) {
      lastBad = now;
      setStatus("That's not one of our loyalty cards. Scan the QR on the customer's card.", true);
      setTimeout(function () { if (!done) setStatus("Point the camera at the customer's card QR"); }, 2500);
    }
  }

  function stop() {
    running = false;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }

  function tick() {
    if (!running) return;
    if (video.readyState >= 2 && video.videoWidth) {
      if (detector) {
        detector.detect(video).then(function (codes) {
          if (codes && codes.length) handle(codes[0].rawValue);
        }).catch(function () {}).then(schedule);
        return;
      }
      // Decode the centre square, downscaled: fast enough on older phones.
      var vw = video.videoWidth, vh = video.videoHeight;
      var side = Math.min(vw, vh) * 0.8;
      var size = Math.min(480, Math.round(side));
      canvas.width = canvas.height = size;
      ctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
      var img = ctx.getImageData(0, 0, size, size);
      var r = window.jsQR(img.data, size, size, { inversionAttempts: "dontInvert" });
      if (r && r.data) handle(r.data);
    }
    schedule();
  }
  function schedule() { if (running) setTimeout(function () { requestAnimationFrame(tick); }, 120); }

  function start() {
    if (done || running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("This browser can't open the camera here. Use your phone's camera app, or type the card code.", true);
      showCode();
      return;
    }
    setStatus("Starting camera…");
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(function () {
        running = true;
        setStatus("Point the camera at the customer's card QR");
        tick();
      })
      .catch(function (e) {
        stop();
        if (e && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
          setStatus("Camera access is blocked. Allow it for this site in your browser settings (iPhone: Settings › Safari › Camera), or type the card code.", true);
        } else if (e && e.name === "NotFoundError") {
          setStatus("No camera found on this device. Type the card code instead.", true);
        } else {
          setStatus("Couldn't start the camera. Try again, or type the card code.", true);
        }
        showCode();
      });
  }

  function showCode() {
    codeForm.classList.remove("hidden");
    document.getElementById("show-code").classList.add("hidden");
  }
  document.getElementById("show-code").addEventListener("click", function () { showCode(); codeInput.focus(); });
  codeForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var code = codeInput.value.toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (CODE.test(code)) go(code);
    else setStatus("Card codes are 10 letters and numbers, shown under the customer's QR.", true);
  });

  // Free the camera when the page is hidden; resume when it comes back.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") stop();
    else start();
  });
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", function (e) { if (e.persisted) { done = false; start(); } });

  if ("BarcodeDetector" in window) {
    window.BarcodeDetector.getSupportedFormats().then(function (f) {
      if (f.indexOf("qr_code") !== -1) detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    }).catch(function () {}).then(start);
  } else {
    start();
  }
})();
