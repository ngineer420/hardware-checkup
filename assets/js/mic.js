/* hardwarecheckup.com — Microphone Test
   100% client-side. Audio is analysed live in the browser and never recorded or uploaded. */
(function () {
  "use strict";

  var startBtn = document.getElementById("start-btn");
  var stopBtn = document.getElementById("stop-btn");
  var deviceSelect = document.getElementById("device-select");
  var status = document.getElementById("status");
  var meterFill = document.getElementById("meter-fill");
  var canvas = document.getElementById("scope");
  var levelEl = document.getElementById("f-level");
  var peakEl = document.getElementById("f-peak");
  var labelEl = document.getElementById("f-label");
  var ctx = canvas.getContext("2d");

  var stream = null;
  var audioCtx = null;
  var analyser = null;
  var source = null;
  var rafId = null;
  var peakHold = 0;
  var timeData = null;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Your browser does not support microphone access (getUserMedia). Try a recent Chrome, Firefox, Edge, or Safari.", "error");
    if (startBtn) startBtn.disabled = true;
    return;
  }

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "status-msg" + (kind ? " " + kind : "");
  }

  function sizeCanvas() {
    var ratio = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 600;
    var h = canvas.clientHeight || 140;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function draw() {
    rafId = requestAnimationFrame(draw);
    if (!analyser) return;
    analyser.getByteTimeDomainData(timeData);

    var w = canvas.clientWidth || 600;
    var h = canvas.clientHeight || 140;
    ctx.clearRect(0, 0, w, h);

    // waveform
    ctx.lineWidth = 2;
    ctx.strokeStyle = cssVar("--accent", "#ffb454");
    ctx.beginPath();
    var slice = w / timeData.length;
    var sumSq = 0;
    for (var i = 0; i < timeData.length; i++) {
      var v = (timeData[i] - 128) / 128; // -1..1
      sumSq += v * v;
      var x = i * slice;
      var y = h / 2 + v * (h / 2 - 4);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // RMS -> level %
    var rms = Math.sqrt(sumSq / timeData.length);
    var level = Math.min(100, Math.round(rms * 140));
    meterFill.style.width = level + "%";
    levelEl.textContent = level + "%";
    if (level > peakHold) {
      peakHold = level;
      peakEl.textContent = peakHold + "%";
    }
  }

  function populateDevices() {
    if (!navigator.mediaDevices.enumerateDevices) return Promise.resolve();
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var mics = devices.filter(function (d) { return d.kind === "audioinput"; });
      var prev = deviceSelect.value;
      deviceSelect.innerHTML = "";
      if (mics.length === 0) {
        var opt = document.createElement("option");
        opt.textContent = "No microphone found";
        opt.value = "";
        deviceSelect.appendChild(opt);
        deviceSelect.disabled = true;
        return;
      }
      mics.forEach(function (mic, i) {
        var opt = document.createElement("option");
        opt.value = mic.deviceId;
        opt.textContent = mic.label || ("Microphone " + (i + 1));
        deviceSelect.appendChild(opt);
      });
      deviceSelect.disabled = false;
      if (prev) deviceSelect.value = prev;
    });
  }

  function stopAll() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (source) { try { source.disconnect(); } catch (e) {} source = null; }
    if (analyser) { try { analyser.disconnect(); } catch (e) {} analyser = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (audioCtx) { audioCtx.close().catch(function () {}); audioCtx = null; }
    meterFill.style.width = "0%";
    levelEl.textContent = "—";
    labelEl.textContent = "—";
    stopBtn.disabled = true;
    startBtn.disabled = false;
    if (ctx) ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  function start() {
    setStatus("Requesting microphone access…");
    startBtn.disabled = true;
    peakHold = 0;
    peakEl.textContent = "—";
    var constraints = { audio: true, video: false };
    var chosen = deviceSelect.value;
    if (chosen) constraints.audio = { deviceId: { exact: chosen } };

    navigator.mediaDevices.getUserMedia(constraints).then(function (s) {
      stream = s;
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtx();
      if (audioCtx.state === "suspended") audioCtx.resume();
      source = audioCtx.createMediaStreamSource(s);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      timeData = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      // Note: analyser is NOT connected to destination, so no feedback loop.

      var track = s.getAudioTracks()[0];
      labelEl.textContent = track ? (track.label || "Microphone") : "Microphone";
      stopBtn.disabled = false;
      setStatus("Listening. Speak or tap your mic — the meter and waveform should move.", "ok");
      populateDevices();
      sizeCanvas();
      draw();
    }).catch(function (err) {
      handleError(err);
      startBtn.disabled = false;
    });
  }

  function handleError(err) {
    var name = err && err.name ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      setStatus("Microphone permission was denied. Allow mic access in your browser's site settings (the mic icon in the address bar), then try again.", "error");
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      setStatus("No microphone was found. Connect one and reload, or choose a different device.", "error");
    } else if (name === "NotReadableError" || name === "TrackStartError") {
      setStatus("Your microphone is in use by another app. Close it and try again.", "error");
    } else {
      setStatus("Could not start the microphone: " + (err && err.message ? err.message : name || "unknown error"), "error");
    }
  }

  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", function () { stopAll(); setStatus("Microphone stopped."); });
  deviceSelect.addEventListener("change", function () { if (stream) { stopAll(); start(); } });
  window.addEventListener("resize", function () { if (analyser) sizeCanvas(); });

  populateDevices();
  if (navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", populateDevices);
  }
  window.addEventListener("pagehide", stopAll);
})();
