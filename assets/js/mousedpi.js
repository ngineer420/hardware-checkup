/* hardwarecheckup.com — Mouse DPI (CPI) estimator
   100% client-side. Movement deltas are counted locally; nothing is sent.

   Same shape as pollingrate.js: the arithmetic lives above the DOM wiring and
   is exported under a module guard so it can be tested from Node. That split
   earns its keep here more than anywhere, because a browser cannot read a
   mouse sensor's DPI at all. It can only count how far the pointer moved and
   divide by a distance the person measured with their own hands — so every
   number this panel prints is an inference standing on two shaky legs, and
   the honest handling of both legs is arithmetic, which is testable.

   The two legs:

     1. The ruler. There is deliberately no on-screen ruler anywhere in this
        file, because the distance that matters is travelled on the mousepad,
        not on the screen, and no page can know how many millimetres of desk a
        screen pixel corresponds to. A bank card is the ruler instead: every
        ID-1 card — credit, debit, most loyalty cards — is 85.60 mm wide by
        ISO/IEC 7810, to a tolerance of a tenth of a millimetre.

     2. The pointer pipeline. Between the sensor and `movementX` sit the
        operating system's pointer acceleration curve and its pointer-speed
        slider. With acceleration on, what comes out is effective CPI for the
        speed you happened to swipe at, not the sensor's DPI, and the only way
        to tell is to swipe twice at different speeds and see whether the
        answers agree. That comparison is in here as `compareRuns`, and it is
        the single most useful thing this panel does.

   Browser zoom was expected to be a third leg and measured its way off the
   list — see `countsFromMovement`. */
(function () {
  "use strict";

  var MM_PER_INCH = 25.4;

  /* ISO/IEC 7810 ID-1: 85.60 x 53.98 mm, tolerance ±0.12 mm. Every payment
     card on earth, which is what makes it the one ruler already on the desk. */
  var CARD_MM = 85.60;

  var UNIT_MM = { card: CARD_MM, mm: 1, cm: 10, in: MM_PER_INCH };

  /* The steps sensors are actually sold in. A measurement lands on one of
     these or it is worth saying so, rather than dressing 1704 up as "1600". */
  var COMMON_DPI = [
    400, 500, 600, 800, 1000, 1200, 1600, 2000, 2400, 3200,
    4000, 5000, 6400, 8000, 12000, 16000, 20000, 25600, 32000,
  ];

  /* How far the ends of a swipe can be from the ends of the card. Four
     millimetres at each end is generous to the person and unkind to the
     result, which is the right way round: it is the number that sets the
     claimed uncertainty, and a flattering value here would produce confident
     ranges that do not contain the truth. It has to be generous, too — the
     cursor is invisible during a Pointer Lock swipe, the sensor sits
     somewhere under the palm, and what actually gets lined up against the
     card's edge is the shell of the mouse. */
  var ENDPOINT_SLOP_MM = 8;

  /* Under this the endpoint slop is a large fraction of the whole distance
     and the range comes out too wide to name a sensor. One card is 3.4 in. */
  var MIN_INCHES = 3;

  /* Under this nothing was swiped — the pointer was nudged. */
  var MIN_COUNTS = 200;
  var MIN_SAMPLES = 5;

  /* Above this fraction the swipe wandered off the straight line, so the
     path the hand took is longer than the distance the card measured and the
     DPI reads high. */
  var MAX_DRIFT_RATIO = 0.2;

  /* Path length over net displacement. 1.0 is a perfectly monotonic swipe;
     anything much above it means the hand backed up, and the backing-up was
     not part of the distance across the card. */
  var MAX_WANDER_RATIO = 1.12;

  /* A floor under the disagreement that gets called acceleration. Runs are
     compared by whether their uncertainty intervals overlap, which scales
     itself to how far each swipe travelled — but two very long swipes carry
     such narrow intervals that a 2% wobble would miss them and get reported
     as a fault. Nothing under this is worth a warning either way. */
  var RUN_AGREEMENT = 0.05;

  /**
   * A distance typed by a person, in inches, or null if it is not a distance.
   *
   * `card` is the point of the whole exercise: nobody owns a millimetre rule,
   * everybody owns a card that is 85.60 mm to a tenth of a millimetre.
   */
  function distanceToInches(value, unit) {
    var n = typeof value === "number" ? value : parseFloat(value);
    if (!isFinite(n) || n <= 0) return null;
    var mm = UNIT_MM[unit];
    if (!mm) return null;
    return (n * mm) / MM_PER_INCH;
  }

  /**
   * Fold a stream of pointer-lock movement deltas into the four numbers that
   * describe a swipe.
   *
   * `net` is the displacement that the card measured. `path` is how far the
   * hand actually travelled, which is longer whenever it backed up, and
   * `drift` is how far it wandered off the axis. Keeping all three is what
   * lets the estimate refuse a swipe that was not a straight line rather than
   * quietly reporting the DPI of a squiggle.
   *
   * Deltas come in already summed by the browser when it coalesces, so this
   * never needs to care how many events carried them.
   */
  function sumMovement(events) {
    var net = 0, drift = 0, path = 0, samples = 0, maxStep = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var dx = e && typeof e.movementX === "number" ? e.movementX : NaN;
      var dy = e && typeof e.movementY === "number" ? e.movementY : 0;
      if (!isFinite(dx)) continue;
      if (!isFinite(dy)) dy = 0;
      net += dx;
      drift += dy;
      path += Math.abs(dx);
      if (Math.abs(dx) > maxStep) maxStep = Math.abs(dx);
      samples++;
    }
    return { net: net, drift: drift, path: path, samples: samples, maxStep: maxStep };
  }

  /**
   * A `movementX` total to sensor counts. It is an identity, and that is a
   * measured result rather than a shrug.
   *
   * The obvious correction — divide by `devicePixelRatio` — is wrong, and so
   * is the correction the Pointer Lock spec implies. What was measured, on
   * Chrome 151 on macOS: a fixed raw pointer delta of 10 was posted directly
   * into the OS event stream, in the same `kCGMouseEventDeltaX` field a real
   * mouse fills in, with the page pointer-locked. That was repeated at forced
   * device scale factors of 1, 2 and 3, and at real browser zoom levels of
   * 100%, 125% and 200%.
   *
   * In all six configurations `movementX` came back as exactly 10, and a
   * twenty-event swipe totalled exactly 200 counts for 200 units of physical
   * motion. Across those runs `devicePixelRatio` moved 1 → 2 → 3 → 2.5 → 4
   * and `clientX` moved 500 → 400 → 250. The `clientX` figures are the
   * control: they are what proves the zoom actually applied, and they are
   * what rules out the tempting explanation below.
   *
   * So under Pointer Lock in Chrome, `movementX` is the operating system's own
   * pointer delta passed through untouched. It is not in CSS pixels, it is not
   * scaled by `devicePixelRatio`, and it does not track `clientX` — a swipe
   * measured at 200% zoom reports the same counts as the same swipe at 100%.
   * Dividing by anything here would introduce an error rather than remove one:
   * on a Retina Mac at 100% zoom, dividing by the ratio of 2 would halve a
   * correct answer.
   *
   * `devicePixelRatio` could not have done the job even had the units gone the
   * other way, because it is the display scale and the browser zoom multiplied
   * together and a page cannot see which is which. A 2 means "Retina at 100%"
   * and "1x display at 200%" identically.
   *
   * The caveat that survives the measurement: the Pointer Lock specification
   * says these values are in CSS pixels, and Chrome measurably does not do
   * that. A browser that follows the spec here would report fewer counts as
   * the page is zoomed in. Only Chrome was measured, so the page still asks
   * for 100% zoom — it costs the user nothing and it is the right instruction
   * everywhere this was not tested.
   */
  function countsFromMovement(delta) {
    return Math.abs(delta);
  }

  /**
   * The interval a measurement honestly supports.
   *
   * A single figure would be a lie of precision: the error is dominated by
   * where the mouse actually started and stopped relative to the card's edges,
   * which is worth a few millimetres however carefully anyone swipes. Longer
   * swipes are better measurements, and this is the arithmetic that says so —
   * one card carries about ±9.9%, two about ±4.7%, three about ±3.1%.
   */
  function dpiRange(counts, inches, slopMm) {
    var slop = typeof slopMm === "number" ? slopMm : ENDPOINT_SLOP_MM;
    if (!isFinite(counts) || counts <= 0 || !isFinite(inches) || inches <= 0) return null;
    var mm = inches * MM_PER_INCH;
    if (slop >= mm) return null;
    return {
      dpi: counts / inches,
      /* A longer travel than the card says means a lower DPI, so the far end
         of the distance interval is the near end of the DPI one. */
      low: counts / ((mm + slop) / MM_PER_INCH),
      high: counts / ((mm - slop) / MM_PER_INCH),
    };
  }

  /** The catalogue values a measurement cannot rule out. */
  function candidatesInRange(low, high) {
    var out = [];
    for (var i = 0; i < COMMON_DPI.length; i++) {
      if (COMMON_DPI[i] >= low && COMMON_DPI[i] <= high) out.push(COMMON_DPI[i]);
    }
    return out;
  }

  /**
   * Turn one swipe into a result, or into a stated reason there is no result.
   *
   * Every refusal here is a case where a number could have been printed and
   * would have been wrong: a nudge instead of a swipe, a swipe shorter than
   * the slop it carries, a diagonal, a hand that backed up mid-stroke. The
   * polling panel prints "≥ 500 Hz" rather than a confident wrong figure when
   * the clock runs out of resolution; these are the same move.
   *
   * `locked` is not a detail. Without Pointer Lock the pointer stops at the
   * edge of the screen while the hand keeps going, the deltas stop arriving,
   * and the total comes out low — which reads as a 400 DPI mouse rather than
   * as a broken measurement. A run that was not locked gets no number at all.
   */
  function estimateDpi(swipe, inches, opts) {
    var o = opts || {};
    var slop = typeof o.slopMm === "number" ? o.slopMm : ENDPOINT_SLOP_MM;

    if (o.locked === false) return { ok: false, reason: "unlocked" };
    if (!isFinite(inches) || inches <= 0) return { ok: false, reason: "no-distance" };
    if (inches < (typeof o.minInches === "number" ? o.minInches : MIN_INCHES)) {
      return { ok: false, reason: "distance-too-short", inches: inches };
    }
    if (!swipe || swipe.samples < MIN_SAMPLES) return { ok: false, reason: "no-swipe" };

    var counts = countsFromMovement(swipe.net);
    if (counts < MIN_COUNTS) return { ok: false, reason: "swipe-too-short", counts: counts };

    var wander = counts > 0 ? swipe.path / counts : Infinity;
    var driftRatio = counts > 0 ? Math.abs(swipe.drift) / counts : Infinity;
    if (wander > MAX_WANDER_RATIO) {
      return { ok: false, reason: "wandered", wander: wander, counts: counts };
    }
    if (driftRatio > MAX_DRIFT_RATIO) {
      return { ok: false, reason: "diagonal", driftRatio: driftRatio, counts: counts };
    }

    var range = dpiRange(counts, inches, slop);
    if (!range) return { ok: false, reason: "distance-too-short", inches: inches };
    var candidates = candidatesInRange(range.low, range.high);

    return {
      ok: true,
      dpi: range.dpi,
      low: range.low,
      high: range.high,
      /* Half-width of the interval as a fraction — the "± n%" the panel
         prints, and the number that shrinks when someone swipes further. */
      uncertainty: (range.high - range.low) / 2 / range.dpi,
      counts: counts,
      inches: inches,
      samples: swipe.samples,
      wander: wander,
      driftRatio: driftRatio,
      candidates: candidates,
      /* Named only when the measurement can rule out every other catalogue
         value. Two candidates in the interval is not a 1600 DPI mouse, it is
         a swipe that was too short to tell 1600 from 2000. */
      nearest: candidates.length === 1 ? candidates[0] : null,
    };
  }

  /**
   * Whether repeated swipes agree, which is the only acceleration detector a
   * web page can honestly build.
   *
   * A sensor's DPI is a constant. If two swipes across the same card produce
   * different figures, something between the sensor and the page is
   * speed-dependent, and on a desktop that something is almost always pointer
   * acceleration — Windows' "Enhance pointer precision", or macOS, which
   * accelerates by default and offers no checkbox to stop it.
   *
   * This is why the panel asks for a slow swipe and a fast one rather than
   * two careful identical ones. Two identical swipes hide the effect.
   *
   * Runs are compared by whether their uncertainty intervals overlap, not
   * against a fixed percentage. A fixed threshold would be wrong at both ends:
   * two one-card swipes each carrying ±10% can disagree by 15% and mean
   * nothing, while two four-card swipes disagreeing by 8% mean a great deal.
   * Overlap scales itself to how carefully the measurement was taken.
   */
  function compareRuns(results) {
    var runs = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r || !isFinite(r.dpi) || r.dpi <= 0) continue;
      runs.push({
        dpi: r.dpi,
        low: isFinite(r.low) ? r.low : r.dpi,
        high: isFinite(r.high) ? r.high : r.dpi,
      });
    }
    if (runs.length < 2) return { runs: runs.length, spread: null, consistent: null };

    var minDpi = Infinity, maxDpi = -Infinity, highestLow = -Infinity, lowestHigh = Infinity;
    for (var j = 0; j < runs.length; j++) {
      if (runs[j].dpi < minDpi) minDpi = runs[j].dpi;
      if (runs[j].dpi > maxDpi) maxDpi = runs[j].dpi;
      if (runs[j].low > highestLow) highestLow = runs[j].low;
      if (runs[j].high < lowestHigh) lowestHigh = runs[j].high;
    }
    var spread = (maxDpi - minDpi) / ((maxDpi + minDpi) / 2);
    return {
      runs: runs.length,
      low: minDpi,
      high: maxDpi,
      spread: spread,
      overlap: highestLow <= lowestHigh,
      consistent: highestLow <= lowestHigh || spread <= RUN_AGREEMENT,
    };
  }

  function fmtDpi(n) {
    return String(Math.round(n / 10) * 10);
  }

  /** The sentence under the big number. */
  function describeResult(result) {
    if (!result) return "";
    if (!result.ok) {
      switch (result.reason) {
        case "unlocked":
          return "The browser would not lock the pointer, so the swipe would have stopped at the " +
            "edge of the screen while your hand kept going — and that reads as a low DPI rather " +
            "than as a failed measurement. No figure is shown, because any figure would be wrong.";
        case "no-distance":
          return "Enter the distance you are going to swipe first.";
        case "distance-too-short":
          return "Measure across at least " + MIN_INCHES + " inches — a little under one bank " +
            "card. The few millimetres of slop at each end of a swipe is a large share of a short " +
            "distance, and the answer comes out too vague to name a sensor.";
        case "no-swipe":
          return "No movement was recorded. Click the pad, then swipe.";
        case "swipe-too-short":
          return "Only " + Math.round(result.counts) + " counts were recorded, which is a nudge " +
            "rather than a swipe. Start at one edge of the card and travel the whole distance you " +
            "entered, in one motion.";
        case "wandered":
          return "The pointer travelled " + Math.round((result.wander - 1) * 100) + "% further than " +
            "it ended up from where it started, so the hand backed up part-way through. The card " +
            "measured the straight line, not the round trip. Swipe once, in one direction.";
        case "diagonal":
          return "The swipe drifted " + Math.round(result.driftRatio * 100) + "% as far up or down " +
            "as it did sideways, so the distance across the card is not the distance the mouse " +
            "moved. Keep the swipe along the card's long edge.";
        default:
          return "That swipe could not be measured.";
      }
    }

    var body = "";
    if (result.nearest) {
      body = "That is consistent with a " + result.nearest + " DPI setting, and with no other " +
        "standard value.";
    } else if (result.candidates.length > 1) {
      body = "This swipe cannot separate " + result.candidates.join(" from ") + " — every one of " +
        "them fits the measurement. Swipe across a longer distance to narrow it.";
    } else {
      body = "No standard DPI step falls inside that range. Either the sensor is set to a custom " +
        "value, or pointer acceleration is bending the reading — swipe again at a different speed " +
        "and see whether the answer moves.";
    }
    return body + " Remember this is counts per inch as the operating system delivers them, which " +
      "equals the sensor's DPI only when pointer acceleration is off.";
  }

  /** The verdict once there is more than one run to compare. */
  function describeRuns(comparison) {
    if (!comparison || comparison.runs < 2) return "";
    if (comparison.consistent) {
      return "Your " + comparison.runs + " swipes agree to within " +
        Math.round(comparison.spread * 100) + "%, which is what a fixed sensor DPI with pointer " +
        "acceleration switched off looks like. Treat the figure above as a real reading.";
    }
    return "Your swipes measured " + fmtDpi(comparison.low) + " and " + fmtDpi(comparison.high) +
      " — a " + Math.round(comparison.spread * 100) + "% disagreement. A sensor's DPI does not " +
      "change between swipes, so something speed-dependent sits between it and this page, and that " +
      "is almost always pointer acceleration. What you are measuring is effective CPI at the speed " +
      "you happened to swipe, not the mouse's DPI. Turn acceleration off and measure again.";
  }

  /** The platform-specific way to turn acceleration off, stated up front. */
  function describeAcceleration(platform) {
    var p = String(platform || "").toLowerCase();
    if (p.indexOf("win") > -1) {
      return "On Windows, open Settings › Bluetooth & devices › Mouse › Additional mouse settings › " +
        "Pointer Options and clear “Enhance pointer precision”. With it on, the pointer moves " +
        "further per count the faster you swipe, and what this panel measures is effective CPI at " +
        "that speed rather than the sensor's DPI.";
    }
    if (p.indexOf("mac") > -1) {
      return "macOS accelerates the pointer by default and has no checkbox to stop it, so on a Mac " +
        "this panel measures effective CPI, not the sensor's DPI. To disable it for a real reading, " +
        "run “defaults write .GlobalPreferences com.apple.mouse.scaling -1” in Terminal and log out " +
        "and back in; set it back to 3 afterwards. Many gaming mice ship a driver that bypasses the " +
        "curve as well.";
    }
    if (p.indexOf("linux") > -1 || p.indexOf("x11") > -1) {
      return "On Linux, set a flat pointer acceleration profile — “xinput set-prop <device> " +
        "'libinput Accel Profile Enabled' 0 1”, or the equivalent in your desktop's mouse settings. " +
        "With the adaptive profile on, this panel measures effective CPI rather than the sensor's DPI.";
    }
    return "Turn off your system's pointer acceleration before measuring — “Enhance pointer " +
      "precision” on Windows, the default curve on macOS, an adaptive libinput profile on Linux. " +
      "With it on, the pointer moves further per count the faster you swipe, and what this panel " +
      "measures is effective CPI at that speed rather than the sensor's DPI.";
  }

  /* Exported for Node so the arithmetic can be tested without a browser. */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      distanceToInches: distanceToInches,
      sumMovement: sumMovement,
      countsFromMovement: countsFromMovement,
      dpiRange: dpiRange,
      candidatesInRange: candidatesInRange,
      estimateDpi: estimateDpi,
      compareRuns: compareRuns,
      describeResult: describeResult,
      describeRuns: describeRuns,
      describeAcceleration: describeAcceleration,
      CARD_MM: CARD_MM,
      MM_PER_INCH: MM_PER_INCH,
      COMMON_DPI: COMMON_DPI,
      ENDPOINT_SLOP_MM: ENDPOINT_SLOP_MM,
      MIN_INCHES: MIN_INCHES,
      MIN_COUNTS: MIN_COUNTS,
      RUN_AGREEMENT: RUN_AGREEMENT,
    };
  }

  if (typeof document === "undefined") return;

  /* ------------------------------ DOM wiring ------------------------------ */

  var pad = document.getElementById("dpi-pad");
  if (!pad) return;

  var countInput = document.getElementById("dpi-count");
  var unitSelect = document.getElementById("dpi-unit");
  var distEl = document.getElementById("dpi-dist");
  var startBtn = document.getElementById("dpi-start");
  var resetBtn = document.getElementById("dpi-reset");
  var valueEl = document.getElementById("dpi-value");
  var subEl = document.getElementById("dpi-sub");
  var answerEl = document.getElementById("dpi-answer");
  var statusEl = document.getElementById("dpi-status");
  var verdictEl = document.getElementById("dpi-verdict");
  var runsEl = document.getElementById("dpi-runs");
  var accelEl = document.getElementById("dpi-accel-note");

  var fRange = document.getElementById("d-range");
  var fMatch = document.getElementById("d-match");
  var fCounts = document.getElementById("d-counts");
  var fDist = document.getElementById("d-dist");
  var fStraight = document.getElementById("d-straight");
  var fSamples = document.getElementById("d-samples");
  var fLock = document.getElementById("d-lock");
  var fRatio = document.getElementById("d-ratio");

  var LOCK_SUPPORTED = typeof pad.requestPointerLock === "function";
  var events = [];
  var capturing = false;
  var history = [];

  function currentInches() {
    return distanceToInches(countInput ? countInput.value : null, unitSelect ? unitSelect.value : "card");
  }

  function fmtInches(inches) {
    return inches === null ? "—" : inches.toFixed(2) + " in";
  }

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = "status-msg" + (kind ? " " + kind : "");
  }

  function showDistance() {
    var inches = currentInches();
    if (distEl) {
      distEl.textContent = inches === null ? "enter a distance"
        : "= " + Math.round(inches * MM_PER_INCH) + " mm (" + inches.toFixed(2) + " in)";
    }
    if (fDist) fDist.textContent = fmtInches(inches);
    if (startBtn) startBtn.disabled = inches === null || !LOCK_SUPPORTED;
  }

  /* Live counter while the pointer is locked. The cursor is invisible during a
     lock, so without this the pad gives no sign that anything is happening. */
  function paintLive() {
    if (!capturing) return;
    var s = sumMovement(events);
    pad.textContent = Math.round(Math.abs(s.net)) + " counts";
    var hint = document.createElement("span");
    hint.className = "dpi-pad-hint";
    hint.textContent = "keep swiping — click when you reach the far edge";
    pad.appendChild(hint);
  }

  function beginCapture() {
    events = [];
    capturing = true;
    pad.classList.add("is-locked");
    setStatus("Locked. Swipe from one edge of the card to the other, then click to finish.", "ok");
    paintLive();
  }

  function idleText() {
    pad.textContent = LOCK_SUPPORTED
      ? "Click here to lock the pointer, then swipe"
      : "This browser does not support Pointer Lock";
    var hint = document.createElement("span");
    hint.className = "dpi-pad-hint";
    hint.textContent = LOCK_SUPPORTED
      ? "the cursor disappears while measuring — press Esc to cancel"
      : "without it a long swipe stops at the screen edge and measures low";
    pad.appendChild(hint);
  }

  function render(result) {
    if (!result || !result.ok) {
      answerEl.classList.add("is-unavailable");
      valueEl.textContent = "—";
      subEl.textContent = "no reading from that swipe";
      [fRange, fMatch, fStraight].forEach(function (el) {
        if (el) { el.textContent = "—"; el.classList.remove("ok"); }
      });
      if (verdictEl) {
        verdictEl.textContent = describeResult(result);
        verdictEl.hidden = !verdictEl.textContent;
      }
      return;
    }

    answerEl.classList.remove("is-unavailable");
    valueEl.textContent = "≈ " + fmtDpi(result.dpi);
    subEl.textContent = "counts per inch, ±" + (result.uncertainty * 100).toFixed(1) +
      "% — an inference, not a spec-sheet reading";
    if (fRange) fRange.textContent = fmtDpi(result.low) + "–" + fmtDpi(result.high);
    if (fMatch) {
      fMatch.textContent = result.nearest ? result.nearest + " DPI"
        : (result.candidates.length ? result.candidates.join(" or ") : "Non-standard");
      fMatch.classList.toggle("ok", !!result.nearest);
    }
    if (fCounts) fCounts.textContent = Math.round(result.counts);
    if (fSamples) fSamples.textContent = String(result.samples);
    if (fStraight) fStraight.textContent = Math.round(100 / result.wander) + "%";
    if (verdictEl) {
      verdictEl.textContent = describeResult(result);
      verdictEl.hidden = false;
    }
  }

  function endCapture() {
    if (!capturing) return;
    capturing = false;
    pad.classList.remove("is-locked");
    idleText();

    var inches = currentInches();
    var result = estimateDpi(sumMovement(events), inches, { locked: true });
    render(result);

    if (result.ok) {
      history.push(result);
      setStatus("Measured. Swipe again at a different speed — that is how acceleration shows itself.", "ok");
    } else {
      setStatus("Nothing usable from that swipe. Try again.", "error");
    }

    var comparison = compareRuns(history);
    if (runsEl) {
      runsEl.textContent = describeRuns(comparison);
      runsEl.hidden = !runsEl.textContent;
      runsEl.classList.toggle("is-warning", comparison.consistent === false);
    }
  }

  function onMove(e) {
    if (!capturing) return;
    events.push({ movementX: e.movementX, movementY: e.movementY });
    if (events.length % 8 === 0) paintLive();
  }

  document.addEventListener("mousemove", onMove, { passive: true });

  document.addEventListener("pointerlockchange", function () {
    if (document.pointerLockElement === pad) {
      beginCapture();
    } else if (capturing) {
      endCapture();
    }
  });

  document.addEventListener("pointerlockerror", function () {
    capturing = false;
    pad.classList.remove("is-locked");
    idleText();
    render({ ok: false, reason: "unlocked" });
    setStatus("The browser refused to lock the pointer.", "error");
  });

  /* The click that ends a locked swipe. It has to be on the document rather
     than the pad, because under a lock there is no pointer position and so no
     element under it in the ordinary sense. */
  document.addEventListener("mousedown", function (e) {
    if (!capturing) return;
    e.preventDefault();
    document.exitPointerLock();
  });

  function requestLock() {
    if (!LOCK_SUPPORTED) {
      render({ ok: false, reason: "unlocked" });
      return;
    }
    if (currentInches() === null) {
      setStatus("Enter the distance you are going to swipe first.", "error");
      return;
    }
    if (verdictEl) verdictEl.hidden = true;
    pad.requestPointerLock();
  }

  pad.addEventListener("click", requestLock);
  if (startBtn) startBtn.addEventListener("click", requestLock);

  if (countInput) countInput.addEventListener("input", showDistance);
  if (unitSelect) unitSelect.addEventListener("change", showDistance);

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      history = [];
      events = [];
      render(null);
      if (fCounts) fCounts.textContent = "—";
      if (fSamples) fSamples.textContent = "—";
      if (verdictEl) { verdictEl.textContent = ""; verdictEl.hidden = true; }
      if (runsEl) { runsEl.textContent = ""; runsEl.hidden = true; }
      setStatus("Cleared. Lay the card down and swipe again.");
    });
  }

  /* Shown because it is the number everyone reaches for first, and because
     seeing it sit at 2 next to a correct reading is the quickest way to see
     that it is not the divisor. `resize` fires on zoom in every engine. */
  window.addEventListener("resize", function () {
    if (fRatio) fRatio.textContent = String(Math.round(window.devicePixelRatio * 100) / 100);
  });

  if (fRatio) fRatio.textContent = String(Math.round(window.devicePixelRatio * 100) / 100);
  if (fLock) {
    fLock.textContent = LOCK_SUPPORTED ? "Supported" : "Unsupported";
    fLock.classList.toggle("warn", !LOCK_SUPPORTED);
  }
  if (accelEl) {
    accelEl.textContent = describeAcceleration(
      (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ""
    );
  }

  idleText();
  showDistance();

  if (!LOCK_SUPPORTED) {
    setStatus("This browser has no Pointer Lock, so a swipe would stop at the edge of the screen " +
      "and measure low. No figure is offered rather than a wrong one.", "error");
  } else if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches &&
             !window.matchMedia("(any-pointer: fine)").matches) {
    setStatus("This device has no mouse attached, so there is no DPI to measure. Open this page on " +
      "a computer with a mouse.", "error");
    if (startBtn) startBtn.disabled = true;
  } else {
    setStatus("Lay a bank card on the mousepad, set the distance above, then click the pad.");
  }
})();
