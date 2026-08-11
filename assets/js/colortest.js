/* hardwarecheckup.com — Colour & Gradient Test
   100% client-side. Patterns are drawn on your own screen; nothing is sent.

   The companion to the dead pixel test, answering a different question. That
   one asks "is any single pixel broken"; this one asks "is the panel as a
   whole any good" — smooth gradients expose banding from a 6-bit panel or a
   bad colour profile, the grey steps expose black crush and white clipping,
   and a flat field exposes backlight tint and clouding. */
(function () {
  "use strict";

  /* Patterns are declared as data so the sequence, the labels and the
     explanations on the page cannot drift apart. `draw` receives a 2D context
     already sized to the screen. */
  var PATTERNS = [
    {
      id: "grey-ramp",
      name: "Greyscale gradient",
      look: "Look for horizontal bands instead of a smooth fade — that is colour banding.",
      draw: function (ctx, w, h) { linear(ctx, w, h, "#000000", "#ffffff"); },
    },
    {
      id: "grey-steps",
      name: "Greyscale steps",
      look: "Count the steps at each end. If the darkest few look identical your panel is crushing blacks; if the lightest few do, it is clipping whites.",
      draw: function (ctx, w, h) { steps(ctx, w, h, 32); },
    },
    {
      id: "red-ramp",
      name: "Red gradient",
      look: "Banding in one channel only usually means a colour-profile problem rather than the panel.",
      draw: function (ctx, w, h) { linear(ctx, w, h, "#000000", "#ff0000"); },
    },
    {
      id: "green-ramp",
      name: "Green gradient",
      look: "Green carries most of perceived brightness, so banding shows here first.",
      draw: function (ctx, w, h) { linear(ctx, w, h, "#000000", "#00ff00"); },
    },
    {
      id: "blue-ramp",
      name: "Blue gradient",
      look: "Blue is the hardest for a panel to render smoothly — some banding here is normal.",
      draw: function (ctx, w, h) { linear(ctx, w, h, "#000000", "#0000ff"); },
    },
    {
      id: "spectrum",
      name: "Full spectrum",
      look: "Every hue at full saturation. Look for abrupt jumps and for hues that arrive muddy.",
      draw: function (ctx, w, h) {
        var g = ctx.createLinearGradient(0, 0, w, 0);
        for (var i = 0; i <= 12; i++) g.addColorStop(i / 12, "hsl(" + (i * 30) + ",100%,50%)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      },
    },
    {
      id: "white",
      name: "Flat white",
      look: "Uniformity and tint. Look for patches that are warmer, cooler or dimmer — backlight clouding shows here.",
      draw: function (ctx, w, h) { flat(ctx, w, h, "#ffffff"); },
    },
    {
      id: "grey-50",
      name: "Flat 50% grey",
      look: "The fairest test of tint. A neutral grey should look neutral, not pink, green or blue.",
      draw: function (ctx, w, h) { flat(ctx, w, h, "#808080"); },
    },
    {
      id: "black",
      name: "Flat black",
      look: "Backlight bleed and IPS glow, most obvious at the corners in a dark room.",
      draw: function (ctx, w, h) { flat(ctx, w, h, "#000000"); },
    },
    {
      id: "rgb-bars",
      name: "Primary bars",
      look: "Pure red, green and blue side by side. Each should be vivid and even, with no tint drifting across the bar.",
      draw: function (ctx, w, h) {
        var cols = ["#ff0000", "#00ff00", "#0000ff", "#00ffff", "#ff00ff", "#ffff00"];
        var bw = w / cols.length;
        for (var i = 0; i < cols.length; i++) {
          ctx.fillStyle = cols[i];
          ctx.fillRect(i * bw, 0, bw + 1, h);
        }
      },
    },
  ];

  function flat(ctx, w, h, colour) {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, w, h);
  }

  function linear(ctx, w, h, from, to) {
    var g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, from);
    g.addColorStop(1, to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Discrete steps rather than a gradient.
   *
   * Drawn as hard-edged blocks on purpose: a gradient hides crush because the
   * eye fills in the missing detail, while adjacent flat blocks that render
   * identically are unmistakable.
   */
  function steps(ctx, w, h, count) {
    var bw = w / count;
    for (var i = 0; i < count; i++) {
      var v = Math.round((i / (count - 1)) * 255);
      ctx.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
      ctx.fillRect(i * bw, 0, bw + 1, h);
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PATTERNS: PATTERNS };
  }

  if (typeof document === "undefined") return;

  /* ------------------------------ DOM wiring ------------------------------ */

  var overlay = document.getElementById("ct-overlay");
  if (!overlay) return;
  var canvas = document.getElementById("ct-canvas");
  var hint = document.getElementById("ct-hint");
  var startBtn = document.getElementById("start-btn");
  var patternRow = document.getElementById("pattern-row");

  var ctx = canvas.getContext("2d");
  var index = 0;
  var open = false;

  function paint() {
    var dpr = window.devicePixelRatio || 1;
    var w = window.innerWidth;
    var h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Gradients are drawn at CSS-pixel scale so a step is a whole device pixel
    // wide — drawing at backing-store scale would dither the very banding the
    // test is meant to reveal.
    PATTERNS[index].draw(ctx, w, h);

    var p = PATTERNS[index];
    hint.innerHTML =
      "<strong>" + p.name + "</strong> (" + (index + 1) + "/" + PATTERNS.length + ") · " + p.look +
      "<br>Click / → / Space: next · ← : previous · H: hide this text · Esc: exit";
  }

  function openOverlay(startIndex) {
    index = startIndex || 0;
    open = true;
    overlay.classList.add("open");
    hint.style.display = "block";
    paint();
    if (overlay.requestFullscreen) {
      overlay.requestFullscreen().catch(function () {}); // fullscreen is best-effort
    }
  }

  function closeOverlay() {
    open = false;
    overlay.classList.remove("open");
    hint.style.display = "none";
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  }

  function next() { index = (index + 1) % PATTERNS.length; paint(); }
  function prev() { index = (index - 1 + PATTERNS.length) % PATTERNS.length; paint(); }

  // Build the pattern shortcuts on the tool page.
  PATTERNS.forEach(function (p, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pattern-btn";
    b.textContent = p.name;
    b.addEventListener("click", function () { openOverlay(i); });
    patternRow.appendChild(b);
  });

  overlay.addEventListener("click", function () { next(); });

  document.addEventListener("keydown", function (e) {
    if (!open) return;
    switch (e.key) {
      case "Escape": closeOverlay(); break;
      case "ArrowRight": case " ": case "Spacebar": e.preventDefault(); next(); break;
      case "ArrowLeft": e.preventDefault(); prev(); break;
      // The caption sits over the pattern, so it has to be dismissable —
      // otherwise it is the one part of the screen you cannot judge.
      case "h": case "H": hint.style.display = hint.style.display === "none" ? "block" : "none"; break;
      default: break;
    }
  });

  document.addEventListener("fullscreenchange", function () {
    if (!document.fullscreenElement && open) closeOverlay();
  });
  window.addEventListener("resize", function () { if (open) paint(); });

  startBtn.addEventListener("click", function () { openOverlay(0); });
})();
