/* hardwarecheckup.com — Speaker Test
   100% client-side. Tones are generated locally with the Web Audio API. Nothing is recorded. */
(function () {
  "use strict";

  var leftBtn = document.getElementById("test-left");
  var rightBtn = document.getElementById("test-right");
  var bothBtn = document.getElementById("test-both");
  var sweepBtn = document.getElementById("test-sweep");
  var stopBtn = document.getElementById("stop-btn");
  var freqRange = document.getElementById("freq");
  var freqVal = document.getElementById("freq-val");
  var volRange = document.getElementById("vol");
  var volVal = document.getElementById("vol-val");
  var status = document.getElementById("status");
  var waveSelect = document.getElementById("wave");

  var audioCtx = null;
  var osc = null;
  var gain = null;
  var panner = null;
  var sweepTimer = null;

  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    setStatus("Your browser does not support the Web Audio API. Try a recent Chrome, Firefox, Edge, or Safari.", "error");
    [leftBtn, rightBtn, bothBtn, sweepBtn].forEach(function (b) { if (b) b.disabled = true; });
    return;
  }

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "status-msg" + (kind ? " " + kind : "");
  }

  function ensureCtx() {
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function vol() { return parseInt(volRange.value, 10) / 100; }

  function stopTone() {
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
    if (osc) {
      try {
        gain.gain.cancelScheduledValues(audioCtx.currentTime);
        gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
      } catch (e) {}
      var toStop = osc;
      setTimeout(function () { try { toStop.stop(); toStop.disconnect(); } catch (e) {} }, 120);
      osc = null;
    }
    stopBtn.disabled = true;
  }

  // pan: -1 left, 0 both, +1 right
  function playTone(freq, pan) {
    stopTone();
    var ctx = ensureCtx();
    osc = ctx.createOscillator();
    gain = ctx.createGain();
    osc.type = waveSelect.value;
    osc.frequency.value = freq;
    gain.gain.value = 0;

    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      osc.connect(gain).connect(panner).connect(ctx.destination);
    } else {
      // Fallback: channel merger for older Safari without StereoPannerNode.
      var merger = ctx.createChannelMerger(2);
      osc.connect(gain);
      if (pan <= 0) gain.connect(merger, 0, 0); // left
      if (pan >= 0) gain.connect(merger, 0, 1); // right
      merger.connect(ctx.destination);
    }

    osc.start();
    gain.gain.setTargetAtTime(vol(), ctx.currentTime, 0.02);
    stopBtn.disabled = false;
  }

  function setGainLive() {
    if (gain && audioCtx) gain.gain.setTargetAtTime(vol(), audioCtx.currentTime, 0.02);
  }
  function setFreqLive() {
    if (osc && audioCtx) osc.frequency.setTargetAtTime(parseInt(freqRange.value, 10), audioCtx.currentTime, 0.02);
  }

  leftBtn.addEventListener("click", function () {
    playTone(parseInt(freqRange.value, 10), -1);
    setStatus("Playing tone in the LEFT channel only. You should hear it from your left speaker.", "ok");
  });
  rightBtn.addEventListener("click", function () {
    playTone(parseInt(freqRange.value, 10), 1);
    setStatus("Playing tone in the RIGHT channel only. You should hear it from your right speaker.", "ok");
  });
  bothBtn.addEventListener("click", function () {
    playTone(parseInt(freqRange.value, 10), 0);
    setStatus("Playing tone in BOTH channels (centered).", "ok");
  });

  sweepBtn.addEventListener("click", function () {
    stopTone();
    var ctx = ensureCtx();
    osc = ctx.createOscillator();
    gain = ctx.createGain();
    osc.type = waveSelect.value;
    gain.gain.value = 0;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = 0;
      osc.connect(gain).connect(panner).connect(ctx.destination);
    } else {
      osc.connect(gain).connect(ctx.destination);
    }
    var startF = 100, endF = 12000, dur = 6;
    osc.frequency.setValueAtTime(startF, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endF, ctx.currentTime + dur);
    osc.start();
    gain.gain.setTargetAtTime(vol(), ctx.currentTime, 0.02);
    stopBtn.disabled = false;
    setStatus("Frequency sweep 100 Hz → 12 kHz. A healthy system rises smoothly with no gaps or buzzing.", "ok");
    // reflect the sweeping frequency in the readout
    var t0 = ctx.currentTime;
    sweepTimer = setInterval(function () {
      if (!osc) return;
      var elapsed = ctx.currentTime - t0;
      if (elapsed >= dur) {
        clearInterval(sweepTimer); sweepTimer = null;
        stopTone();
        setStatus("Sweep finished.", "ok");
        return;
      }
      var f = Math.round(startF * Math.pow(endF / startF, elapsed / dur));
      freqRange.value = Math.min(freqRange.max, Math.max(freqRange.min, f));
      freqVal.textContent = f + " Hz";
    }, 60);
  });

  stopBtn.addEventListener("click", function () { stopTone(); setStatus("Stopped."); });

  freqRange.addEventListener("input", function () {
    freqVal.textContent = freqRange.value + " Hz";
    setFreqLive();
  });
  volRange.addEventListener("input", function () {
    volVal.textContent = volRange.value + "%";
    setGainLive();
  });
  waveSelect.addEventListener("change", function () { if (osc) osc.type = waveSelect.value; });

  freqVal.textContent = freqRange.value + " Hz";
  volVal.textContent = volRange.value + "%";
  stopBtn.disabled = true;
  window.addEventListener("pagehide", stopTone);
})();
