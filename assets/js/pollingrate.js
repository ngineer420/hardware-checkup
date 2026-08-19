/* hardwarecheckup.com — Mouse Polling Rate Test
   100% client-side. Pointer events are timed locally; nothing is sent.

   The statistics live above the DOM wiring and are exported under a module
   guard so they can be tested from Node without a browser. That split matters
   more here than anywhere else on the site, because a polling-rate test in a
   browser is bounded by two things it does not control — how finely the clock
   ticks, and how aggressively the browser coalesces pointer events — and the
   honest handling of both is arithmetic, which is testable. */
(function () {
  "use strict";

  /* The rates real mice are actually built to run at. A measurement lands on
     one of these or it is worth reporting as unusual, rather than rounding a
     734 into a confident "1000" without saying so. */
  var COMMON_RATES = [125, 250, 500, 1000, 2000, 4000, 8000];

  /* An interval longer than this is a pause in the swirl — the hand slowed,
     stopped, or left the pad — not a polling interval. It is discarded from
     the rate rather than allowed to drag the median down. */
  var MAX_PLAUSIBLE_INTERVAL_MS = 100;

  /* Below this many usable intervals the numbers wobble by hundreds of Hz
     between runs, which reads as a broken tool. ~200 events is under a second
     of swirling on a 250Hz mouse and well under half a second on a 1000Hz one. */
  var MIN_SAMPLES = 200;

  /**
   * The smallest increment this browser's clock will admit to, in milliseconds.
   *
   * `now` is called in a tight loop and the smallest non-zero step it ever
   * takes is its granularity. This is not a micro-benchmark of the loop: the
   * loop body is far faster than any clock tick here, so what comes back is the
   * quantum, not the cost of asking.
   *
   * It is the number the whole page hinges on. Firefox coarsens
   * `performance.now()` and `event.timeStamp` to 1ms unless the document is
   * crossOriginIsolated, and a static site on GitHub Pages cannot send the
   * COOP/COEP headers that would earn the finer clock — so on Firefox this
   * returns 1, and a 500Hz mouse and a 1000Hz mouse genuinely cannot be told
   * apart. Chrome coarsens to 100µs, which returns 0.1.
   */
  function probeTimerResolution(now, iterations) {
    var loops = iterations || 40000;
    var smallest = Infinity;
    var last = now();
    for (var i = 0; i < loops; i++) {
      var t = now();
      var d = t - last;
      if (d > 0) {
        if (d < smallest) smallest = d;
        last = t;
      }
    }
    return isFinite(smallest) ? smallest : null;
  }

  /**
   * The highest polling rate a clock of this granularity can honestly resolve.
   *
   * Two rates are only distinguishable if their intervals differ by more than
   * one clock tick, so a rate is only claimable when its interval spans at
   * least two ticks: 1000 / (2 × resolution). At Firefox's 1ms that is 500Hz —
   * which is exactly why 500 and 1000 are indistinguishable there. At Chrome's
   * 0.1ms it is 5000Hz, comfortably above every mouse most people own.
   *
   * Reporting a number above this ceiling would not be a measurement, it would
   * be a rounding artefact with a confident font.
   */
  function resolvableCeilingHz(resolutionMs) {
    if (!resolutionMs || !isFinite(resolutionMs) || resolutionMs <= 0) return null;
    return 1000 / (2 * resolutionMs);
  }

  function median(sorted) {
    if (!sorted.length) return 0;
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
    return sorted[idx];
  }

  /**
   * Turn raw inter-event intervals into a polling-rate estimate.
   *
   * The median rather than the mean, for the same reason the refresh-rate test
   * uses it: one 40ms gap where the hand changed direction would drag a genuine
   * 1000Hz reading down to something plausible and wrong.
   *
   * `zero` intervals are counted rather than discarded quietly. Two events
   * carrying the same timestamp mean the clock could not separate them, which
   * is a fact about the browser worth showing, not noise to hide.
   */
  function summarisePolling(intervals, resolutionMs) {
    var usable = [];
    var zero = 0;
    var paused = 0;
    for (var i = 0; i < intervals.length; i++) {
      var v = intervals[i];
      if (typeof v !== "number" || !isFinite(v) || v < 0) continue;
      if (v === 0) { zero++; continue; }
      if (v > MAX_PLAUSIBLE_INTERVAL_MS) { paused++; continue; }
      usable.push(v);
    }
    if (usable.length < MIN_SAMPLES) return null;

    var sorted = usable.slice().sort(function (a, b) { return a - b; });
    var med = median(sorted);
    var measuredHz = 1000 / med;

    /* "Peak" is the 5th-percentile interval, not the single smallest one. The
       smallest is one sample and at these timescales it is regularly a
       quantisation artefact — with a 0.1ms clock a single 0.1ms gap would read
       as 10,000Hz. The fastest 5% is a rate the device actually sustained. */
    var fastHz = 1000 / percentile(sorted, 0.05);

    var ceiling = resolvableCeilingHz(resolutionMs);
    var capped = ceiling !== null && measuredHz > ceiling;

    return {
      measuredHz: measuredHz,
      reportedHz: capped ? ceiling : measuredHz,
      capped: capped,
      ceilingHz: ceiling,
      resolutionMs: resolutionMs || null,
      peakHz: ceiling !== null ? Math.min(fastHz, ceiling) : fastHz,
      medianMs: med,
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
      jitterMs: percentile(sorted, 0.95) - percentile(sorted, 0.05),
      samples: usable.length,
      zeroIntervals: zero,
      pauses: paused,
    };
  }

  /**
   * The advertised rate a measurement corresponds to, or null when it is not
   * close enough to any of them to claim.
   *
   * 12% tolerance, far looser than the refresh-rate test's 2%, and deliberately
   * so: a display is driven by a crystal and lands within a fraction of a Hz,
   * while a mouse is sampled through an operating system's USB scheduling and a
   * browser's event loop. A real 1000Hz mouse routinely measures in the 800s.
   * Tight enough that 500 is never called 1000 — the gap between neighbouring
   * rates is 100% — and loose enough not to call every real device "unusual".
   */
  function snapToCommonRate(hz, tolerance) {
    if (!isFinite(hz) || hz <= 0) return null;
    var tol = typeof tolerance === "number" ? tolerance : 0.12;
    var best = null;
    var bestErr = Infinity;
    for (var i = 0; i < COMMON_RATES.length; i++) {
      var err = Math.abs(hz - COMMON_RATES[i]) / COMMON_RATES[i];
      if (err < bestErr) { bestErr = err; best = COMMON_RATES[i]; }
    }
    return bestErr <= tol ? best : null;
  }

  /** The one sentence about the clock, shown before anyone swirls anything. */
  function describeResolution(resolutionMs) {
    if (!resolutionMs) return "This browser would not report its timer resolution.";
    var ceiling = resolvableCeilingHz(resolutionMs);
    var res = resolutionMs >= 1 ? resolutionMs.toFixed(0) : resolutionMs.toFixed(3).replace(/0+$/, "");
    if (ceiling >= 2000) {
      return "This browser's clock ticks every " + res + " ms, so it can resolve rates up to about " +
        Math.round(ceiling) + " Hz. That is fine for any mouse you are likely to own.";
    }
    return "This browser's clock only ticks every " + res + " ms, so it cannot tell rates above about " +
      Math.round(ceiling) + " Hz apart — a 500 Hz mouse and a 1000 Hz mouse look identical to it. " +
      "Firefox coarsens timestamps to 1 ms unless a page is cross-origin isolated, which a site served " +
      "from GitHub Pages cannot be. For a finer measurement, open this page in Chrome or Edge.";
  }

  /** The verdict sentence for a finished run. */
  function describeResult(summary) {
    if (!summary) return "";
    if (summary.capped) {
      return "Your mouse is polling at least " + Math.round(summary.ceilingHz) + " Hz — this browser's " +
        "clock cannot resolve any faster than that, so the real figure may be higher. Open this page in " +
        "Chrome or Edge to see how much higher.";
    }
    var snapped = snapToCommonRate(summary.measuredHz);
    if (snapped === null) {
      return "That does not match a standard polling rate. Browsers measure through the operating " +
        "system's event queue, so a busy machine, a laptop on battery, or a wireless receiver with a weak " +
        "link all report low. Swirl faster and steadier, close other windows, and measure again before " +
        "concluding the mouse is at fault.";
    }
    if (snapped <= 125) {
      return "125 Hz is the USB default every mouse falls back to. If yours is advertised as 500 Hz or " +
        "1000 Hz, its polling rate is either set low in its own software or the setting did not stick — " +
        "and on a wireless mouse, check that it is on its own receiver rather than a shared dongle.";
    }
    return "That matches a " + snapped + " Hz mouse running at its rated speed.";
  }

  /**
   * Intervals bucketed for a histogram. The shape is the point: a mouse locked
   * to one rate is a single spike, and two spikes means something — a receiver
   * dropping packets, or a browser handing over events in batches — that a
   * single median would hide completely.
   */
  function intervalHistogram(intervals, binMs, maxMs) {
    var bin = binMs || 0.25;
    var top = maxMs || 12;
    var count = Math.ceil(top / bin);
    var bins = [];
    for (var b = 0; b < count; b++) bins.push({ from: b * bin, to: (b + 1) * bin, count: 0 });
    var over = 0;
    for (var i = 0; i < intervals.length; i++) {
      var v = intervals[i];
      if (typeof v !== "number" || !isFinite(v) || v <= 0 || v > MAX_PLAUSIBLE_INTERVAL_MS) continue;
      if (v >= top) { over++; continue; }
      bins[Math.floor(v / bin)].count++;
    }
    return { bins: bins, over: over, binMs: bin, maxMs: top };
  }

  /* Exported for Node so the statistics can be tested without a browser. */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      probeTimerResolution: probeTimerResolution,
      resolvableCeilingHz: resolvableCeilingHz,
      summarisePolling: summarisePolling,
      snapToCommonRate: snapToCommonRate,
      describeResolution: describeResolution,
      describeResult: describeResult,
      intervalHistogram: intervalHistogram,
      COMMON_RATES: COMMON_RATES,
      MIN_SAMPLES: MIN_SAMPLES,
      MAX_PLAUSIBLE_INTERVAL_MS: MAX_PLAUSIBLE_INTERVAL_MS,
    };
  }

  if (typeof document === "undefined") return;

  /* ------------------------------ DOM wiring ------------------------------ */

  var pad = document.getElementById("pr-pad");
  if (!pad) return;

  var resetBtn = document.getElementById("reset-btn");
  var status = document.getElementById("status");
  var verdict = document.getElementById("pr-verdict");
  var bigVal = document.getElementById("pr-hz");
  var bigSub = document.getElementById("pr-hz-sub");
  var histEl = document.getElementById("pr-hist");
  var axisEl = document.getElementById("pr-axis");
  var clockEl = document.getElementById("pr-clock-note");

  var peakEl = document.getElementById("f-peak");
  var matchEl = document.getElementById("f-match");
  var intervalEl = document.getElementById("f-interval");
  var jitterEl = document.getElementById("f-jitter");
  var samplesEl = document.getElementById("f-samples");
  var resEl = document.getElementById("f-res");
  var ceilEl = document.getElementById("f-ceiling");
  var sourceEl = document.getElementById("f-source");

  /* Probed once, at load, before anything is measured against it. */
  var RESOLUTION = probeTimerResolution(function () { return performance.now(); });
  var CEILING = resolvableCeilingHz(RESOLUTION);

  /* A ring buffer of raw event timestamps. Fixed length and pre-allocated: the
     handler that fills it runs up to 8000 times a second on a fast mouse, so it
     does no allocation, no arithmetic beyond an index, and above all no DOM
     work. Everything else happens on an animation frame, off the hot path. */
  var CAPACITY = 8192;
  var stamps = new Float64Array(CAPACITY);
  var head = 0;      // next write position
  var filled = 0;    // how many slots hold real data
  var rawEvents = 0; // events as delivered, before getCoalescedEvents
  var totalEvents = 0;
  var usedCoalesced = false;
  var rafId = null;
  var lastPaint = 0;

  function push(ts) {
    stamps[head] = ts;
    head = (head + 1) % CAPACITY;
    if (filled < CAPACITY) filled++;
  }

  /* Chronological copy of the ring, turned into intervals. Called at most a few
     times a second from the paint loop, never from an event handler. */
  function currentIntervals() {
    var out = [];
    if (filled < 2) return out;
    var start = filled === CAPACITY ? head : 0;
    var prev = stamps[start];
    for (var i = 1; i < filled; i++) {
      var t = stamps[(start + i) % CAPACITY];
      out.push(t - prev);
      prev = t;
    }
    return out;
  }

  function onMove(e) {
    rawEvents++;
    /* A 1000Hz mouse behind a 60Hz frame loop delivers ~16 samples per event,
       and the browser hands them over with their original timestamps. Without
       this, every mouse on earth measures at the refresh rate. */
    if (e.getCoalescedEvents) {
      var list = e.getCoalescedEvents();
      if (list && list.length) {
        usedCoalesced = true;
        for (var i = 0; i < list.length; i++) { push(list[i].timeStamp); totalEvents++; }
        return;
      }
    }
    push(e.timeStamp);
    totalEvents++;
  }

  var EVENT_NAME = ("onpointerrawupdate" in window) ? "pointerrawupdate"
    : (window.PointerEvent ? "pointermove" : "mousemove");

  pad.addEventListener(EVENT_NAME, onMove, { passive: true });

  function fmtHz(hz) {
    return hz >= 1000 ? Math.round(hz / 10) * 10 + " Hz" : Math.round(hz) + " Hz";
  }

  function paintHistogram(intervals) {
    if (!histEl) return;
    var h = intervalHistogram(intervals, 0.25, 12);
    var peak = 0;
    for (var i = 0; i < h.bins.length; i++) if (h.bins[i].count > peak) peak = h.bins[i].count;
    histEl.textContent = "";
    if (axisEl) axisEl.hidden = !peak; // an axis with no chart under it is furniture
    if (!peak) return;
    for (var b = 0; b < h.bins.length; b++) {
      var bar = document.createElement("div");
      bar.className = "pr-bar";
      bar.style.height = Math.max(1, Math.round((h.bins[b].count / peak) * 100)) + "%";
      bar.title = h.bins[b].from.toFixed(2) + "–" + h.bins[b].to.toFixed(2) + " ms: " +
        h.bins[b].count + " intervals (" + Math.round(1000 / ((h.bins[b].from + h.bins[b].to) / 2)) + " Hz)";
      histEl.appendChild(bar);
    }
  }

  function paint() {
    var intervals = currentIntervals();
    var summary = summarisePolling(intervals, RESOLUTION);
    samplesEl.textContent = totalEvents ? String(totalEvents) : "—";
    sourceEl.textContent = EVENT_NAME + (usedCoalesced ? " + coalesced" : "");

    if (!summary) {
      bigVal.textContent = "—";
      bigSub.textContent = "Keep swirling — " + Math.max(0, MIN_SAMPLES - Math.max(0, intervals.length)) +
        " more samples needed";
      return;
    }

    bigVal.textContent = (summary.capped ? "≥ " : "") + fmtHz(summary.reportedHz);
    bigSub.textContent = summary.capped
      ? "capped by this browser's clock, not by your mouse"
      : "median polling rate";
    peakEl.textContent = fmtHz(summary.peakHz) + (summary.capped ? " (capped)" : "");
    intervalEl.textContent = summary.medianMs.toFixed(2) + " ms";
    jitterEl.textContent = "±" + summary.jitterMs.toFixed(2) + " ms";

    var snapped = summary.capped ? null : snapToCommonRate(summary.measuredHz);
    matchEl.textContent = summary.capped ? "Unresolvable" : (snapped === null ? "Non-standard" : snapped + " Hz");
    matchEl.classList.toggle("ok", snapped !== null);

    paintHistogram(intervals);
    if (verdict) {
      verdict.textContent = describeResult(summary);
      verdict.hidden = false;
    }
  }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (ts - lastPaint < 150) return; // paint at ~7Hz; the ring keeps filling regardless
    lastPaint = ts;
    paint();
  }

  function setStatus(msg, kind) {
    if (!status) return;
    status.textContent = msg;
    status.className = "status-msg" + (kind ? " " + kind : "");
  }

  pad.addEventListener("pointerenter", function () {
    pad.classList.add("is-active");
    setStatus("Sampling — keep the mouse moving inside the box.", "ok");
    if (rafId === null) rafId = requestAnimationFrame(loop);
  });
  pad.addEventListener("pointerleave", function () {
    pad.classList.remove("is-active");
    setStatus("Paused. Move back into the box to keep sampling.");
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    paint();
  });

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      head = 0; filled = 0; rawEvents = 0; totalEvents = 0; usedCoalesced = false;
      bigVal.textContent = "—";
      bigSub.textContent = "swirl the mouse to start";
      [peakEl, matchEl, intervalEl, jitterEl, samplesEl].forEach(function (el) {
        if (el) { el.textContent = "—"; el.classList.remove("ok"); }
      });
      if (histEl) histEl.textContent = "";
      if (axisEl) axisEl.hidden = true;
      if (verdict) { verdict.textContent = ""; verdict.hidden = true; }
      setStatus("Cleared. Swirl the mouse in the box to measure again.");
    });
  }

  /* The clock facts are stated before the first sample, not after: they decide
     what the measurement below is allowed to claim. */
  resEl.textContent = RESOLUTION === null ? "unknown"
    : (RESOLUTION >= 1 ? RESOLUTION.toFixed(0) : RESOLUTION.toFixed(3).replace(/0+$/, "")) + " ms";
  ceilEl.textContent = CEILING === null ? "unknown" : "~" + Math.round(CEILING) + " Hz";
  if (clockEl) clockEl.textContent = describeResolution(RESOLUTION);
  if (CEILING !== null && CEILING < 2000) {
    ceilEl.classList.add("warn");
    setStatus("This browser's clock is too coarse to separate the fastest mice — see the note below.", "error");
  } else {
    setStatus("Swirl the mouse around inside the box for a few seconds.");
  }

  bigSub.textContent = "swirl the mouse to start";

  /* A touch device has no polling rate to report and no way to swirl a mouse
     across a pad. Say so rather than showing a box that will never fill. */
  if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(any-pointer: fine)").matches) {
    setStatus("This device has no mouse attached, so there is no polling rate to measure. Open this page on a computer with a mouse.", "error");
  }
})();
