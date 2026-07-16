/* hardwarecheckup.com — Dead Pixel Test
   100% client-side. Fills the screen with solid colours so dead (always-off) and stuck (always-on) pixels stand out. */
(function () {
  "use strict";

  var overlay = document.getElementById("dp-overlay");
  var hint = document.getElementById("dp-hint");
  var startBtn = document.getElementById("start-btn");
  var flashBtn = document.getElementById("flash-btn");
  var swatchRow = document.getElementById("swatch-row");

  var colors = [
    ["Red", "#ff0000"], ["Green", "#00ff00"], ["Blue", "#0000ff"],
    ["White", "#ffffff"], ["Black", "#000000"], ["Cyan", "#00ffff"],
    ["Magenta", "#ff00ff"], ["Yellow", "#ffff00"], ["Gray", "#808080"]
  ];

  var index = 0;
  var open = false;
  var flashing = false;
  var flashTimer = null;
  var flashOn = false;

  // Build the swatch shortcuts on the tool page.
  colors.forEach(function (c, i) {
    var b = document.createElement("button");
    b.className = "swatch";
    b.style.background = c[1];
    b.title = c[0];
    b.setAttribute("aria-label", "Start at " + c[0]);
    b.addEventListener("click", function () { openOverlay(i); });
    swatchRow.appendChild(b);
  });

  function applyColor() {
    overlay.style.background = colors[index][1];
    hint.innerHTML = "<strong>" + colors[index][0] + "</strong> (" + (index + 1) + "/" + colors.length + ") · " +
      "Click / → / Space: next · ← : previous · F: flasher · Esc: exit";
  }

  function openOverlay(startIndex) {
    index = startIndex || 0;
    open = true;
    stopFlash();
    applyColor();
    overlay.classList.add("open");
    hint.style.display = "block";
    if (overlay.requestFullscreen) {
      overlay.requestFullscreen().catch(function () {}); // fullscreen is best-effort
    }
  }

  function closeOverlay() {
    open = false;
    stopFlash();
    overlay.classList.remove("open");
    hint.style.display = "none";
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  }

  function next() { index = (index + 1) % colors.length; applyColor(); }
  function prev() { index = (index - 1 + colors.length) % colors.length; applyColor(); }

  function startFlash() {
    if (flashing) return;
    flashing = true;
    flashOn = false;
    hint.innerHTML = "<strong>Flasher</strong> · alternating black/white to surface stuck pixels · F: stop · Esc: exit";
    flashTimer = setInterval(function () {
      flashOn = !flashOn;
      overlay.style.background = flashOn ? "#ffffff" : "#000000";
    }, 400);
  }
  function stopFlash() {
    if (flashTimer) { clearInterval(flashTimer); flashTimer = null; }
    if (flashing) { flashing = false; applyColor(); }
  }
  function toggleFlash() { if (flashing) stopFlash(); else startFlash(); }

  // Click / tap advances (unless it was the flasher, where a click also advances after stopping).
  overlay.addEventListener("click", function () {
    if (flashing) { stopFlash(); return; }
    next();
  });

  document.addEventListener("keydown", function (e) {
    if (!open) return;
    switch (e.key) {
      case "Escape": closeOverlay(); break;
      case "ArrowRight": case " ": case "Spacebar": e.preventDefault(); if (flashing) stopFlash(); else next(); break;
      case "ArrowLeft": e.preventDefault(); if (flashing) stopFlash(); else prev(); break;
      case "f": case "F": toggleFlash(); break;
      default: break;
    }
  });

  // If the user leaves fullscreen via browser UI (Esc / F11), close the overlay too
  // so a single Esc is a clean exit instead of leaving a full-page colour stuck open.
  document.addEventListener("fullscreenchange", function () {
    if (!document.fullscreenElement && open) closeOverlay();
  });

  startBtn.addEventListener("click", function () { openOverlay(0); });
  flashBtn.addEventListener("click", function () { openOverlay(0); startFlash(); });
})();
