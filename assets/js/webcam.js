/* hardwarecheckup.com — Webcam Test
   100% client-side. Video never leaves the browser; no recording, no upload. */
(function () {
  "use strict";

  var video = document.getElementById("preview");
  var placeholder = document.getElementById("video-placeholder");
  var startBtn = document.getElementById("start-btn");
  var stopBtn = document.getElementById("stop-btn");
  var mirrorBtn = document.getElementById("mirror-btn");
  var deviceSelect = document.getElementById("device-select");
  var status = document.getElementById("status");
  var resEl = document.getElementById("f-res");
  var fpsEl = document.getElementById("f-fps");
  var labelEl = document.getElementById("f-label");
  var aspectEl = document.getElementById("f-aspect");

  var stream = null;
  var mirrored = false;
  var rafId = null;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Your browser does not support camera access (getUserMedia). Try a recent version of Chrome, Firefox, Edge, or Safari.", "error");
    if (startBtn) startBtn.disabled = true;
    return;
  }

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "status-msg" + (kind ? " " + kind : "");
  }

  function stopStream() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    video.srcObject = null;
    video.hidden = true;
    placeholder.hidden = false;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    resEl.textContent = "—";
    fpsEl.textContent = "—";
    labelEl.textContent = "—";
    aspectEl.textContent = "—";
  }

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  function showTrackInfo() {
    if (!stream) return;
    var track = stream.getVideoTracks()[0];
    if (!track) return;
    var settings = track.getSettings ? track.getSettings() : {};
    var w = settings.width || video.videoWidth || 0;
    var h = settings.height || video.videoHeight || 0;
    resEl.textContent = w && h ? w + " × " + h : "unknown";
    fpsEl.textContent = settings.frameRate ? Math.round(settings.frameRate) + " fps" : "—";
    labelEl.textContent = track.label || "Camera";
    if (w && h) {
      var g = gcd(w, h) || 1;
      aspectEl.textContent = (w / g) + ":" + (h / g);
    } else {
      aspectEl.textContent = "—";
    }
  }

  // Measure real display frame rate as a live fallback (some browsers omit frameRate in settings).
  function measureFps() {
    var last = performance.now();
    var frames = 0;
    var acc = 0;
    function tick(now) {
      frames++;
      acc += now - last;
      last = now;
      if (acc >= 500) {
        var fps = Math.round((frames * 1000) / acc);
        var track = stream && stream.getVideoTracks()[0];
        var settings = track && track.getSettings ? track.getSettings() : {};
        if (!settings.frameRate) fpsEl.textContent = fps + " fps (measured)";
        frames = 0; acc = 0;
      }
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function populateDevices() {
    if (!navigator.mediaDevices.enumerateDevices) return Promise.resolve();
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var cams = devices.filter(function (d) { return d.kind === "videoinput"; });
      var prev = deviceSelect.value;
      deviceSelect.innerHTML = "";
      if (cams.length === 0) {
        var opt = document.createElement("option");
        opt.textContent = "No camera found";
        opt.value = "";
        deviceSelect.appendChild(opt);
        deviceSelect.disabled = true;
        return;
      }
      cams.forEach(function (cam, i) {
        var opt = document.createElement("option");
        opt.value = cam.deviceId;
        opt.textContent = cam.label || ("Camera " + (i + 1));
        deviceSelect.appendChild(opt);
      });
      deviceSelect.disabled = false;
      if (prev) deviceSelect.value = prev;
    });
  }

  function start() {
    setStatus("Requesting camera access…");
    startBtn.disabled = true;
    var constraints = { audio: false, video: true };
    var chosen = deviceSelect.value;
    if (chosen) constraints.video = { deviceId: { exact: chosen } };

    navigator.mediaDevices.getUserMedia(constraints).then(function (s) {
      stream = s;
      video.srcObject = s;
      video.hidden = false;
      placeholder.hidden = true;
      stopBtn.disabled = false;
      setStatus("Camera live. If you see yourself, your webcam works.", "ok");
      // Labels become available only after permission is granted — refresh the list.
      populateDevices();
      video.onloadedmetadata = function () { showTrackInfo(); };
      // getSettings may lag one tick behind; re-read shortly after.
      setTimeout(showTrackInfo, 400);
      measureFps();
    }).catch(function (err) {
      handleError(err);
      startBtn.disabled = false;
    });
  }

  function handleError(err) {
    var name = err && err.name ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      setStatus("Camera permission was denied. Allow camera access in your browser's site settings (the camera icon in the address bar), then try again.", "error");
    } else if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
      setStatus("No camera was found. Connect a webcam and reload, or pick a different device.", "error");
    } else if (name === "NotReadableError" || name === "TrackStartError") {
      setStatus("Your camera is in use by another app (Zoom, Teams, another tab…). Close it and try again.", "error");
    } else {
      setStatus("Could not start the camera: " + (err && err.message ? err.message : name || "unknown error"), "error");
    }
  }

  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", function () {
    stopStream();
    setStatus("Camera stopped.");
  });
  mirrorBtn.addEventListener("click", function () {
    mirrored = !mirrored;
    video.classList.toggle("mirrored", mirrored);
    mirrorBtn.setAttribute("aria-pressed", String(mirrored));
    mirrorBtn.textContent = mirrored ? "Mirror: on" : "Mirror: off";
  });
  deviceSelect.addEventListener("change", function () {
    if (stream) { stopStream(); start(); }
  });

  // Initial device list (labels may be blank until first permission grant).
  populateDevices();
  if (navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", populateDevices);
  }
  window.addEventListener("pagehide", stopStream);
})();
