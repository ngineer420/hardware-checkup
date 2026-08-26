/* hardwarecheckup.com — Mouse Test
   100% client-side. Mouse events are read locally to drive the on-screen indicators; nothing is sent.

   The switch-bounce arithmetic lives above the DOM wiring and is exported under
   a module guard so it can be tested from Node without a browser. The
   `dblclick` event cannot see the fault people search for: a worn switch that
   fires two presses when the finger pressed once looks identical to a fast
   intended double click. Timing can see it. A human double click takes more
   than 100 ms between presses. A bouncing switch fires its second press inside
   a few milliseconds, so an interval under BOUNCE_THRESHOLD_MS on the same
   button is flagged as a suspected bounce. */
(function () {
  "use strict";

  /* Two presses of the same button closer together than this are flagged as a
     suspected switch bounce. The gap between a bounce (a few ms, rarely past
     30) and the fastest deliberate double click (about 100 ms) is wide, so the
     threshold sits well clear of both. */
  var BOUNCE_THRESHOLD_MS = 80;

  /* How many slow single clicks the drill asks for. Enough to catch a switch
     that bounces one press in twenty, short enough to finish in under a minute. */
  var DRILL_TARGET = 50;

  /**
   * Keeps the last press time per button and counts presses that arrived too
   * soon after the previous press of the same button.
   *
   * `record` returns the interval since the last press of that button in ms,
   * or null for the first press of a button. A press flagged as a bounce is
   * still counted in `presses`, because the switch really did report it.
   */
  function createBounceTracker(thresholdMs) {
    var threshold = thresholdMs == null ? BOUNCE_THRESHOLD_MS : thresholdMs;
    var last = {};
    var state = { presses: 0, bounces: 0, shortestMs: null };

    function record(button, t) {
      state.presses++;
      var prev = last[button];
      last[button] = t;
      if (prev == null) return { intervalMs: null, bounce: false };
      var interval = t - prev;
      if (state.shortestMs == null || interval < state.shortestMs) state.shortestMs = interval;
      var bounce = interval < threshold;
      if (bounce) state.bounces++;
      return { intervalMs: interval, bounce: bounce };
    }

    function reset() {
      last = {};
      state.presses = 0;
      state.bounces = 0;
      state.shortestMs = null;
    }

    return { record: record, reset: reset, state: state };
  }

  /** "3 in 120 clicks" — the counter text under the bounce label. */
  function describeBounces(state) {
    return state.bounces + " in " + state.presses + (state.presses === 1 ? " click" : " clicks");
  }

  /** "12 ms", or a dash before any two presses of one button. */
  function describeShortest(state) {
    if (state.shortestMs == null) return "—";
    return Math.round(state.shortestMs) + " ms";
  }

  /**
   * The drill counts deliberate presses toward the target. A bounce is not a
   * new press, it is the previous press registered twice, so it adds to
   * `doubled` and not to `done`.
   */
  function drillStep(drill, result) {
    if (result.bounce) drill.doubled++;
    else drill.done++;
    if (drill.done >= drill.target) drill.finished = true;
    return drill;
  }

  function describeDrill(drill) {
    if (!drill.finished) {
      return drill.done + " of " + drill.target + " clicks done. " +
        (drill.doubled === 0 ? "None registered as two so far." : drill.doubled + " registered as two so far.");
    }
    if (drill.doubled === 0) return drill.target + " single clicks, 0 registered as two. The switch looks healthy. ✓";
    return drill.target + " single clicks, " + drill.doubled + " registered as two. That points to a bouncing switch.";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      BOUNCE_THRESHOLD_MS: BOUNCE_THRESHOLD_MS,
      DRILL_TARGET: DRILL_TARGET,
      createBounceTracker: createBounceTracker,
      describeBounces: describeBounces,
      describeShortest: describeShortest,
      drillStep: drillStep,
      describeDrill: describeDrill
    };
    return;
  }

  var pad = document.getElementById("mouse-pad");
  var dragPad = document.getElementById("drag-pad");
  var resetBtn = document.getElementById("reset-btn");
  var btnLeft = document.getElementById("btn-left");
  var btnMiddle = document.getElementById("btn-middle");
  var btnRight = document.getElementById("btn-right");

  var posEl = document.getElementById("f-pos");
  var lastBtnEl = document.getElementById("f-lastbtn");
  var clicksEl = document.getElementById("f-clicks");
  var dblEl = document.getElementById("f-dbl");
  var scrollEl = document.getElementById("f-scroll");
  var bounceEl = document.getElementById("f-bounce");
  var shortestEl = document.getElementById("f-shortest");

  var drillPad = document.getElementById("drill-pad");
  var drillStartBtn = document.getElementById("drill-start");
  var drillStatusEl = document.getElementById("drill-status");

  var btnEls = { 0: btnLeft, 1: btnMiddle, 2: btnRight };
  var btnNames = { 0: "Left", 1: "Middle", 2: "Right" };
  var clickCount = 0;
  var tracker = createBounceTracker();
  var drill = null;

  function renderBounces() {
    bounceEl.textContent = describeBounces(tracker.state);
    bounceEl.classList.toggle("warn", tracker.state.bounces > 0);
    shortestEl.textContent = describeShortest(tracker.state);
    shortestEl.classList.toggle("warn", tracker.state.shortestMs != null && tracker.state.shortestMs < BOUNCE_THRESHOLD_MS);
  }

  function renderDrill() {
    if (!drill) {
      drillStatusEl.textContent = "";
      drillStatusEl.className = "status-msg";
      drillPad.textContent = "Press Start, then click here " + DRILL_TARGET + " times. Leave a full second between clicks.";
      drillPad.classList.remove("running");
      return;
    }
    drillStatusEl.textContent = describeDrill(drill);
    drillStatusEl.className = "status-msg " + (drill.finished ? (drill.doubled === 0 ? "ok" : "error") : "");
    if (drill.finished) {
      drillPad.classList.remove("running");
      drillPad.textContent = "Drill complete. Press Start to run it again.";
    } else {
      drillPad.classList.add("running");
      drillPad.textContent = "Click " + (drill.target - drill.done) + " more times, slowly.";
    }
  }

  function down(e) {
    var el = btnEls[e.button];
    if (el) el.classList.add("active");
    lastBtnEl.textContent = btnNames[e.button] || ("Button " + e.button);

    var result = tracker.record(e.button, e.timeStamp);
    renderBounces();
    if (drill && !drill.finished && e.button === 0 && (e.target === drillPad || drillPad.contains(e.target))) {
      drillStep(drill, result);
      renderDrill();
    }
  }
  function up(e) {
    var el = btnEls[e.button];
    if (el) el.classList.remove("active");
  }

  // Track buttons on the whole window so a release outside the mouse graphic still clears it.
  window.addEventListener("mousedown", down);
  window.addEventListener("mouseup", up);
  // Suppress the context menu inside the tool so right-click can be tested.
  pad.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  drillPad.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  window.addEventListener("click", function () {
    clickCount++;
    clicksEl.textContent = clickCount;
  });
  window.addEventListener("dblclick", function () {
    dblEl.textContent = "Detected ✓";
    dblEl.classList.add("ok");
  });

  window.addEventListener("mousemove", function (e) {
    posEl.textContent = e.clientX + ", " + e.clientY;
  });

  window.addEventListener("wheel", function (e) {
    if (e.deltaY < 0) scrollEl.textContent = "Up ↑";
    else if (e.deltaY > 0) scrollEl.textContent = "Down ↓";
    else if (e.deltaX < 0) scrollEl.textContent = "Left ←";
    else if (e.deltaX > 0) scrollEl.textContent = "Right →";
  }, { passive: true });

  drillStartBtn.addEventListener("click", function () {
    drill = { target: DRILL_TARGET, done: 0, doubled: 0, finished: false };
    renderDrill();
  });

  // Drag test (pointer events cover mouse + touch + pen).
  var dragging = false;
  dragPad.addEventListener("pointerdown", function (e) {
    dragging = true;
    dragPad.classList.add("dragging");
    dragPad.textContent = "Dragging… release to finish";
    if (dragPad.setPointerCapture) { try { dragPad.setPointerCapture(e.pointerId); } catch (err) {} }
  });
  dragPad.addEventListener("pointermove", function (e) {
    if (dragging) dragPad.textContent = "Dragging… (" + Math.round(e.clientX) + ", " + Math.round(e.clientY) + ")";
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    dragPad.classList.remove("dragging");
    dragPad.textContent = "Drag test passed ✓ — press and drag again to repeat";
  }
  dragPad.addEventListener("pointerup", endDrag);
  dragPad.addEventListener("pointercancel", endDrag);

  resetBtn.addEventListener("click", function () {
    clickCount = 0;
    clicksEl.textContent = "0";
    dblEl.textContent = "—";
    dblEl.classList.remove("ok");
    scrollEl.textContent = "—";
    lastBtnEl.textContent = "—";
    posEl.textContent = "—";
    tracker.reset();
    renderBounces();
    drill = null;
    renderDrill();
    dragPad.textContent = "Press and drag inside this box";
    [btnLeft, btnMiddle, btnRight].forEach(function (el) { if (el) el.classList.remove("active"); });
  });

  renderBounces();
  renderDrill();
})();
