/* hardwarecheckup.com — Touchscreen Test
   100% client-side. Touch and pointer events are read locally to draw on the canvas; nothing is sent.

   Pointer Events rather than Touch Events, so the same code covers a finger,
   a stylus and a mouse — this page is reached on the device being tested more
   often than most, but someone diagnosing a tablet from a desktop should not
   meet a dead page. */
(function () {
  "use strict";

  /* The drawing surface is divided into cells; a cell counts as proved once it
     has been touched. A digitiser dead zone shows up as a patch that will not
     light up no matter how hard you scrub at it, which is far easier to see
     than trying to judge a gap in a freehand scribble. */
  var GRID_COLS = 12;
  var GRID_ROWS = 8;

  /** Which grid cell a point falls in, as a flat index. */
  function cellIndex(x, y, width, height, cols, rows) {
    if (width <= 0 || height <= 0) return -1;
    var cx = Math.floor((x / width) * cols);
    var cy = Math.floor((y / height) * rows);
    if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
    if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
    return cy * cols + cx;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { cellIndex: cellIndex, GRID_COLS: GRID_COLS, GRID_ROWS: GRID_ROWS };
  }

  if (typeof document === "undefined") return;

  /* ------------------------------ DOM wiring ------------------------------ */

  var surface = document.getElementById("touch-surface");
  if (!surface) return;
  var canvas = document.getElementById("touch-canvas");
  var dots = document.getElementById("touch-dots");
  var gridEl = document.getElementById("touch-grid");
  var resetBtn = document.getElementById("reset-btn");
  var status = document.getElementById("status");
  var hint = document.getElementById("touch-hint");

  var activeEl = document.getElementById("f-active");
  var maxEl = document.getElementById("f-max");
  var typeEl = document.getElementById("f-type");
  var pressureEl = document.getElementById("f-pressure");
  var coverageEl = document.getElementById("f-coverage");
  var sizeEl = document.getElementById("f-size");

  var ctx = canvas.getContext("2d");
  var pointers = {};        // pointerId -> { x, y, el }
  var maxSimultaneous = 0;
  var covered = {};
  var coveredCount = 0;
  var cells = [];
  var dpr = 1;

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "status-msg" + (kind ? " " + kind : "");
  }

  function buildGrid() {
    gridEl.innerHTML = "";
    cells = [];
    gridEl.style.gridTemplateColumns = "repeat(" + GRID_COLS + ", 1fr)";
    for (var i = 0; i < GRID_COLS * GRID_ROWS; i++) {
      var cell = document.createElement("div");
      cell.className = "touch-cell";
      gridEl.appendChild(cell);
      cells.push(cell);
    }
  }

  /* The canvas backing store has to match the CSS size times the device pixel
     ratio, or strokes land blurred and offset from the finger on every phone
     — which on a page about digitiser accuracy would read as a fault. */
  function sizeCanvas() {
    var rect = surface.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (sizeEl) sizeEl.textContent = Math.round(rect.width) + " × " + Math.round(rect.height);
  }

  function strokeColour() {
    return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2dd6c4";
  }

  function updateCoverage(x, y, rect) {
    var idx = cellIndex(x, y, rect.width, rect.height, GRID_COLS, GRID_ROWS);
    if (idx < 0 || covered[idx]) return;
    covered[idx] = true;
    coveredCount++;
    if (cells[idx]) cells[idx].classList.add("is-hit");
    var total = GRID_COLS * GRID_ROWS;
    coverageEl.textContent = coveredCount + " / " + total;
    if (coveredCount === total) {
      coverageEl.classList.add("ok");
      setStatus("Every zone responded — no dead areas on this digitiser.", "ok");
    }
  }

  function dotFor(id) {
    var d = document.createElement("div");
    d.className = "touch-dot";
    d.dataset.id = String(id);
    dots.appendChild(d);
    return d;
  }

  function refreshCounts(e) {
    var n = Object.keys(pointers).length;
    activeEl.textContent = String(n);
    if (n > maxSimultaneous) {
      maxSimultaneous = n;
      maxEl.textContent = String(maxSimultaneous);
      maxEl.classList.toggle("ok", maxSimultaneous >= 2);
    }
    if (e) {
      typeEl.textContent = e.pointerType ? e.pointerType.charAt(0).toUpperCase() + e.pointerType.slice(1) : "Unknown";
      // A mouse always reports 0.5 while a button is down and 0 otherwise, so
      // a real pressure figure is itself evidence of a touch or pen digitiser.
      pressureEl.textContent = typeof e.pressure === "number" ? e.pressure.toFixed(2) : "—";
    }
  }

  function down(e) {
    if (hint && !hint.hidden) hint.hidden = true;
    surface.setPointerCapture && surface.setPointerCapture(e.pointerId);
    var rect = surface.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    pointers[e.pointerId] = { x: x, y: y, el: dotFor(e.pointerId) };
    moveDot(pointers[e.pointerId], x, y, e);
    updateCoverage(x, y, rect);
    refreshCounts(e);
    e.preventDefault();
  }

  function moveDot(p, x, y, e) {
    // Touch radius where the platform reports it — a stylus reads much smaller
    // than a fingertip and the difference is visible here.
    var size = Math.max(18, Math.min(90, (e.width || 0) * 2));
    p.el.style.transform = "translate(" + (x - size / 2) + "px," + (y - size / 2) + "px)";
    p.el.style.width = size + "px";
    p.el.style.height = size + "px";
  }

  function move(e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    var rect = surface.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    ctx.strokeStyle = strokeColour();
    ctx.lineWidth = Math.max(2, Math.min(14, (e.pressure || 0.5) * 10));
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    p.x = x;
    p.y = y;
    moveDot(p, x, y, e);
    updateCoverage(x, y, rect);
    if (typeof e.pressure === "number") pressureEl.textContent = e.pressure.toFixed(2);
    e.preventDefault();
  }

  function up(e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    p.el.remove();
    delete pointers[e.pointerId];
    refreshCounts(e);
  }

  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerup", up);
  surface.addEventListener("pointercancel", up);
  surface.addEventListener("pointerleave", up);
  // Without this the browser pans and zooms the page instead of reporting the
  // second finger, which is the thing a multi-touch test most needs to see.
  surface.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
  surface.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  function reset() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    Object.keys(pointers).forEach(function (id) { pointers[id].el.remove(); });
    pointers = {};
    covered = {};
    coveredCount = 0;
    maxSimultaneous = 0;
    cells.forEach(function (c) { c.classList.remove("is-hit"); });
    activeEl.textContent = "0";
    maxEl.textContent = "0";
    maxEl.classList.remove("ok");
    typeEl.textContent = "—";
    pressureEl.textContent = "—";
    coverageEl.textContent = "0 / " + GRID_COLS * GRID_ROWS;
    coverageEl.classList.remove("ok");
    if (hint) hint.hidden = false;
    setStatus("Drag across every part of the box. Any square that will not light up is a dead zone.");
  }

  if (resetBtn) resetBtn.addEventListener("click", reset);

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    // Resizing clears the canvas backing store, so the drawing goes anyway;
    // reset everything rather than leave half a stroke and a stale coverage map.
    resizeTimer = setTimeout(function () { sizeCanvas(); reset(); }, 150);
  });

  buildGrid();
  sizeCanvas();
  reset();

  if (!window.PointerEvent) {
    setStatus("This browser does not support Pointer Events, so touches cannot be tracked here. Try a current version of Chrome, Edge, Firefox or Safari.", "error");
  } else if (!("ontouchstart" in window) && navigator.maxTouchPoints === 0) {
    setStatus("No touchscreen detected on this device — you can still draw with a mouse to check the surface responds.", "");
  }
})();
