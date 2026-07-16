/* hardwarecheckup.com — Mouse Test
   100% client-side. Mouse events are read locally to drive the on-screen indicators; nothing is sent. */
(function () {
  "use strict";

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

  var btnEls = { 0: btnLeft, 1: btnMiddle, 2: btnRight };
  var btnNames = { 0: "Left", 1: "Middle", 2: "Right" };
  var clickCount = 0;

  function down(e) {
    var el = btnEls[e.button];
    if (el) el.classList.add("active");
    lastBtnEl.textContent = btnNames[e.button] || ("Button " + e.button);
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
    dragPad.textContent = "Press and drag inside this box";
    [btnLeft, btnMiddle, btnRight].forEach(function (el) { if (el) el.classList.remove("active"); });
  });
})();
