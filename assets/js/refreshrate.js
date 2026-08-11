/* hardwarecheckup.com — Screen Refresh Rate Test
   100% client-side. Frame timings are measured with requestAnimationFrame and read locally; nothing is sent.

   The statistics live above the DOM wiring and are exported under a module
   guard so they can be tested from Node without a browser — the arithmetic is
   the part that decides whether someone believes their new 144Hz monitor is
   actually running at 144Hz. */
(function () {
  "use strict";

  /* The rates real panels actually run at. A measurement lands on one of
     these or it is worth reporting as unusual, rather than rounding a 154
     into a confident "144" without saying so.

     The NTSC-derived rates (59.94, 29.97, 23.976) are deliberately not listed:
     they are within 0.1% of 60, 30 and 24, so the tolerance below absorbs them
     into the round number people are actually looking for. Printing "59.94 Hz"
     as the matched rate would be accurate and useless. */
  var COMMON_RATES = [24, 30, 48, 50, 60, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360, 480, 500];

  /* Two frames of a 60Hz panel is ~33ms; anything longer is a dropped frame
     or a stall, not a refresh interval, and must not drag the estimate down. */
  var MAX_PLAUSIBLE_INTERVAL_MS = 200;
  var MIN_PLAUSIBLE_INTERVAL_MS = 1000 / 1000; // 1000Hz ceiling

  function median(sorted) {
    if (!sorted.length) return 0;
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Turn raw frame-to-frame intervals into a refresh-rate estimate.
   *
   * The median rather than the mean, deliberately. A single garbage-collection
   * pause or a background tab switch produces one 300ms interval, and a mean
   * over 200 samples would drag a 144Hz reading down to about 138 — close
   * enough to look plausible and be completely wrong. The median ignores it.
   *
   * Returns null until there are enough samples to be worth showing.
   */
  function summariseFrameIntervals(intervals, minSamples) {
    var needed = minSamples || 30;
    var usable = [];
    for (var i = 0; i < intervals.length; i++) {
      var v = intervals[i];
      if (typeof v === "number" && isFinite(v) && v >= MIN_PLAUSIBLE_INTERVAL_MS && v <= MAX_PLAUSIBLE_INTERVAL_MS) {
        usable.push(v);
      }
    }
    if (usable.length < needed) return null;

    var sorted = usable.slice().sort(function (a, b) { return a - b; });
    var med = median(sorted);
    var hz = 1000 / med;

    // Jitter as the spread of the middle 90%, which describes what the eye
    // actually notices without letting one outlier define it.
    var lo = sorted[Math.floor(sorted.length * 0.05)];
    var hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];

    // A late frame is one that took at least 1.5 intervals — the threshold
    // where the frame after it has visibly arrived late.
    //
    // Counted over *every* finite interval, not just the ones kept for the
    // rate. A 300ms stall is excluded from the rate because it is plainly not
    // a refresh interval, but it is the most dropped a frame can get, and
    // discarding it from both would report a flawless run through a stutter.
    var dropped = 0;
    for (var j = 0; j < intervals.length; j++) {
      var d = intervals[j];
      if (typeof d === "number" && isFinite(d) && d > 0 && d > med * 1.5) dropped++;
    }

    return {
      hz: hz,
      medianMs: med,
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      jitterMs: hi - lo,
      samples: usable.length,
      discarded: intervals.length - usable.length,
      dropped: dropped,
    };
  }

  /**
   * The advertised rate a measurement corresponds to, or null when it does not
   * match any of them closely enough to claim.
   *
   * 2% tolerance: enough to absorb timer noise and the 59.94-vs-60 family,
   * tight enough that 100Hz is never reported as 120Hz.
   */
  function snapToCommonRate(hz, tolerance) {
    if (!isFinite(hz) || hz <= 0) return null;
    var tol = typeof tolerance === "number" ? tolerance : 0.02;
    var best = null;
    var bestErr = Infinity;
    for (var i = 0; i < COMMON_RATES.length; i++) {
      var err = Math.abs(hz - COMMON_RATES[i]) / COMMON_RATES[i];
      if (err < bestErr) { bestErr = err; best = COMMON_RATES[i]; }
    }
    return bestErr <= tol ? best : null;
  }

  /**
   * The sentence to show for a result — the reason anyone runs this test is to
   * find out whether the panel they paid for is configured to run at its rated
   * speed, and "60" on its own does not answer that.
   */
  function describeResult(summary) {
    if (!summary) return "";
    var snapped = snapToCommonRate(summary.hz);
    if (snapped === null) {
      return "That is not a standard refresh rate. A variable-refresh display (G-Sync or FreeSync) " +
        "can report a figure like this on an idle screen, and so can a browser that is throttling " +
        "this tab. Try again with the window focused and nothing else animating.";
    }
    if (snapped <= 61) {
      return "60Hz is the default almost everything ships at. If you bought a 120Hz, 144Hz or faster " +
        "panel, this is the number that means it is still set to 60 — check your display settings, " +
        "and check the cable, since some HDMI cables cannot carry a high rate at full resolution.";
    }
    return "That matches a " + snapped + "Hz display running at its rated speed.";
  }

  /* Exported for Node so the statistics can be tested without a browser. */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      summariseFrameIntervals: summariseFrameIntervals,
      snapToCommonRate: snapToCommonRate,
      describeResult: describeResult,
      COMMON_RATES: COMMON_RATES,
    };
  }

  if (typeof document === "undefined") return;

  /* ------------------------------ DOM wiring ------------------------------ */

  var startBtn = document.getElementById("start-btn");
  if (!startBtn) return;
  var stopBtn = document.getElementById("stop-btn");
  var status = document.getElementById("status");
  var bar = document.getElementById("rr-progress-bar");
  var verdict = document.getElementById("rr-verdict");
  var pulse = document.getElementById("rr-pulse");

  var hzEl = document.getElementById("f-hz");
  var frameEl = document.getElementById("f-frame");
  var jitterEl = document.getElementById("f-jitter");
  var samplesEl = document.getElementById("f-samples");
  var droppedEl = document.getElementById("f-dropped");
  var claimedEl = document.getElementById("f-claimed");

  /* Five seconds. A shorter window gives a number that wobbles by several Hz
     between runs, which reads as a broken tool; five seconds at 60Hz is 300
     samples and lands within a fraction of a Hz run to run. */
  var SAMPLE_MS = 5000;
  var WARMUP_FRAMES = 10; // the first frames after a rAF loop starts are not representative

  var running = false;
  var rafId = null;
  var intervals = [];
  var frames = 0;
  var lastTs = 0;
  var startTs = 0;

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "status-msg" + (kind ? " " + kind : "");
  }

  if (typeof requestAnimationFrame !== "function") {
    setStatus("Your browser does not support requestAnimationFrame, so frame timing cannot be measured here.", "error");
    startBtn.disabled = true;
    return;
  }

  function reset() {
    intervals = [];
    frames = 0;
    lastTs = 0;
    startTs = 0;
    [hzEl, frameEl, jitterEl, samplesEl, droppedEl, claimedEl].forEach(function (el) {
      if (el) { el.textContent = "—"; el.classList.remove("ok"); }
    });
    if (bar) bar.style.width = "0%";
    if (verdict) { verdict.textContent = ""; verdict.hidden = true; }
  }

  function paint(summary, done) {
    if (!summary) return;
    hzEl.textContent = summary.hz.toFixed(1) + " Hz";
    frameEl.textContent = summary.medianMs.toFixed(2) + " ms";
    jitterEl.textContent = "±" + summary.jitterMs.toFixed(2) + " ms";
    samplesEl.textContent = String(summary.samples);
    droppedEl.textContent = String(summary.dropped);

    var snapped = snapToCommonRate(summary.hz);
    claimedEl.textContent = snapped === null ? "Non-standard" : snapped + " Hz";
    if (done) {
      claimedEl.classList.toggle("ok", snapped !== null);
      if (verdict) {
        verdict.textContent = describeResult(summary);
        verdict.hidden = false;
      }
    }
  }

  function tick(ts) {
    if (!running) return;
    frames++;
    if (frames > WARMUP_FRAMES) {
      if (!startTs) startTs = ts;
      if (lastTs) intervals.push(ts - lastTs);
      var elapsed = ts - startTs;
      if (bar) bar.style.width = Math.min(100, (elapsed / SAMPLE_MS) * 100).toFixed(1) + "%";
      // A live number while it settles, so the wait is visibly doing something.
      if (intervals.length % 15 === 0) paint(summariseFrameIntervals(intervals), false);
      if (elapsed >= SAMPLE_MS) return finish();
    }
    lastTs = ts;
    rafId = requestAnimationFrame(tick);
  }

  function finish() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (pulse) pulse.classList.remove("is-running");
    startBtn.disabled = false;
    startBtn.textContent = "Measure again";
    if (stopBtn) stopBtn.disabled = true;

    var summary = summariseFrameIntervals(intervals);
    if (!summary) {
      setStatus("Not enough usable frames to measure. This usually means the tab lost focus — keep this window in front and try again.", "error");
      return;
    }
    paint(summary, true);
    setStatus("Measured over " + summary.samples + " frames.", "ok");
  }

  function start() {
    if (running) return;
    reset();
    running = true;
    startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (pulse) pulse.classList.add("is-running");
    setStatus("Measuring… keep this window focused and in front for five seconds.");
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    if (!running) return;
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (pulse) pulse.classList.remove("is-running");
    startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    var summary = summariseFrameIntervals(intervals);
    if (summary) {
      paint(summary, true);
      setStatus("Stopped early — measured over " + summary.samples + " frames.", "ok");
    } else {
      setStatus("Stopped before there were enough frames to measure.");
    }
  }

  startBtn.addEventListener("click", start);
  if (stopBtn) {
    stopBtn.disabled = true;
    stopBtn.addEventListener("click", stop);
  }

  /* A backgrounded tab gets its rAF calls throttled to about 1Hz, which would
     otherwise be reported as a 1Hz display. Abandon the run instead of lying. */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && running) {
      stop();
      setStatus("Measurement abandoned: the tab lost focus, and browsers slow frame delivery right down in the background. Start again with this window in front.", "error");
    }
  });
  window.addEventListener("pagehide", function () { if (running) stop(); });

  reset();
})();
