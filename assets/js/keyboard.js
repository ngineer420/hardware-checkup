/* hardwarecheckup.com — Keyboard Tester
   100% client-side. Keystrokes are read locally to light up the on-screen keyboard; nothing is logged or sent.

   Key capture is scoped to a focusable test surface rather than the whole
   window. Swallowing Tab, Space and the arrow keys is the entire point of the
   tool — a sticky spacebar is one of the commonest reasons anyone opens a key
   tester — but doing it globally left a keyboard-only visitor with no way to
   reach the nav, the theme toggle or a single link on the page. So the surface
   has to be given focus first (click it, or Tab into it), and Escape or moving
   focus away hands the keyboard back. Same shape as an in-browser terminal or
   a game key-rebinding dialog, for the same reason. */
(function () {
  "use strict";

  /* --------------------------- pure logic --------------------------- */

  /* While the surface holds focus we swallow essentially everything, so a key
     under test does what it does on this page and nothing else: no scrolling
     on Space, no focus move on Tab, and no Firefox quick-find on "/". Two
     exemptions keep that from becoming its own trap:

       - Escape, which is the documented way out. It is still reported, so you
         can confirm the key works; it just also releases the keyboard.
       - Anything held with Ctrl, Cmd or Alt, so Cmd+C, Ctrl+R and the browser's
         own shortcuts keep working while the surface is focused. */
  function shouldPreventDefault(code, capturing, modifiers) {
    if (!capturing) return false;
    if (isReleaseKey(code)) return false;
    if (modifiers && (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey)) return false;
    return true;
  }

  /** Escape is the escape hatch, in both senses. */
  function isReleaseKey(code) {
    return code === "Escape";
  }

  /** What to print in the "last key" readout. */
  function keyLabel(key) {
    if (key === " " || key === "Spacebar") return "Space";
    if (!key) return "—";
    return key;
  }

  function captureStatusText(capturing) {
    return capturing
      ? "Capturing keys — every key you press is reported here instead of doing its usual job. Press Esc to release the keyboard."
      : "Not capturing — click the keyboard below, or press Tab to move focus into it, to start.";
  }

  /* Releasing has to hand focus to something *after* the surface. Sending it
     backwards (to the reset button, say) would mean the next Tab walks straight
     back into the capture surface, which is the original trap wearing a hat. */
  function nextAfter(list, current) {
    var i = list.indexOf(current);
    if (i === -1) return null;
    return i + 1 < list.length ? list[i + 1] : null;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      shouldPreventDefault: shouldPreventDefault,
      isReleaseKey: isReleaseKey,
      keyLabel: keyLabel,
      captureStatusText: captureStatusText,
      nextAfter: nextAfter,
    };
  }

  if (typeof document === "undefined") return;

  /* ------------------------------ DOM wiring ------------------------------ */

  var kb = document.getElementById("kb");
  var surface = document.getElementById("kb-surface");
  var statusEl = document.getElementById("kb-status");
  var resetBtn = document.getElementById("reset-btn");
  var lastKeyEl = document.getElementById("f-key");
  var codeEl = document.getElementById("f-code");
  var keyCodeEl = document.getElementById("f-keycode");
  var downCountEl = document.getElementById("f-count");
  var heldCountEl = document.getElementById("f-held");

  if (!kb || !surface) return;

  // Layout by event.code. Each row is an array of [code, label, widthClass?].
  var rows = [
    [
      ["Escape", "Esc"], ["F1", "F1"], ["F2", "F2"], ["F3", "F3"], ["F4", "F4"],
      ["F5", "F5"], ["F6", "F6"], ["F7", "F7"], ["F8", "F8"], ["F9", "F9"],
      ["F10", "F10"], ["F11", "F11"], ["F12", "F12"]
    ],
    [
      ["Backquote", "`"], ["Digit1", "1"], ["Digit2", "2"], ["Digit3", "3"], ["Digit4", "4"],
      ["Digit5", "5"], ["Digit6", "6"], ["Digit7", "7"], ["Digit8", "8"], ["Digit9", "9"],
      ["Digit0", "0"], ["Minus", "-"], ["Equal", "="], ["Backspace", "⌫", "w-20"]
    ],
    [
      ["Tab", "Tab", "w-15"], ["KeyQ", "Q"], ["KeyW", "W"], ["KeyE", "E"], ["KeyR", "R"],
      ["KeyT", "T"], ["KeyY", "Y"], ["KeyU", "U"], ["KeyI", "I"], ["KeyO", "O"],
      ["KeyP", "P"], ["BracketLeft", "["], ["BracketRight", "]"], ["Backslash", "\\", "w-15"]
    ],
    [
      ["CapsLock", "Caps", "w-175"], ["KeyA", "A"], ["KeyS", "S"], ["KeyD", "D"], ["KeyF", "F"],
      ["KeyG", "G"], ["KeyH", "H"], ["KeyJ", "J"], ["KeyK", "K"], ["KeyL", "L"],
      ["Semicolon", ";"], ["Quote", "'"], ["Enter", "Enter", "w-225"]
    ],
    [
      ["ShiftLeft", "Shift", "w-225"], ["KeyZ", "Z"], ["KeyX", "X"], ["KeyC", "C"], ["KeyV", "V"],
      ["KeyB", "B"], ["KeyN", "N"], ["KeyM", "M"], ["Comma", ","], ["Period", "."],
      ["Slash", "/"], ["ShiftRight", "Shift", "w-275"]
    ],
    [
      ["ControlLeft", "Ctrl", "w-15"], ["MetaLeft", "Meta", "w-15"], ["AltLeft", "Alt", "w-15"],
      ["Space", "Space", "w-space"],
      ["AltRight", "Alt", "w-15"], ["MetaRight", "Meta", "w-15"], ["ContextMenu", "Menu", "w-15"], ["ControlRight", "Ctrl", "w-15"]
    ],
    [
      ["ArrowLeft", "←"], ["ArrowUp", "↑"], ["ArrowDown", "↓"], ["ArrowRight", "→"]
    ]
  ];

  var keyEls = {}; // code -> element
  var active = {}; // code -> true while physically down right now
  var everPressed = 0;
  var capturing = false;
  var resumeAfterReset = false;

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function build() {
    rows.forEach(function (row) {
      var rowEl = document.createElement("div");
      rowEl.className = "kb-row";
      row.forEach(function (spec) {
        var code = spec[0], label = spec[1], w = spec[2];
        var el = document.createElement("div");
        el.className = "key" + (w ? " " + w : "");
        el.textContent = label;
        el.dataset.code = code;
        rowEl.appendChild(el);
        keyEls[code] = el;
      });
      kb.appendChild(rowEl);
    });
  }

  function updateActiveCount() {
    var n = 0;
    for (var k in active) if (active[k]) n++;
    if (heldCountEl) heldCountEl.textContent = n;
  }

  function clearHeldNow() {
    Object.keys(keyEls).forEach(function (c) { keyEls[c].classList.remove("active"); });
    active = {};
    updateActiveCount();
  }

  function setCapturing(on) {
    if (capturing === on) return;
    capturing = on;
    surface.classList.toggle("capturing", on);
    surface.setAttribute("aria-label", on
      ? "Keyboard test surface, capturing keys. Press Escape to release."
      : "Keyboard test surface. Focus this area to capture keys.");
    if (statusEl) {
      statusEl.textContent = captureStatusText(on);
      statusEl.classList.toggle("live", on);
    }
    if (!on) clearHeldNow();
  }

  /* The first focusable element that comes after the surface in the document.
     The erabb.it mark is deliberately excluded — it is a 10px signature in the
     corner, not somewhere to land a released keyboard. */
  function releaseTarget() {
    var all = Array.prototype.slice.call(document.querySelectorAll(FOCUSABLE));
    var candidates = all.filter(function (el) {
      if (el === surface) return true;
      if (surface.contains(el)) return false;
      if (el.classList.contains("erabbit-mark")) return false;
      if (el.classList.contains("skip-link")) return false;
      // offsetParent is null for display:none (and for the collapsed mobile nav).
      return el.offsetParent !== null || el === document.activeElement;
    });
    return nextAfter(candidates, surface);
  }

  function release() {
    var next = releaseTarget();
    if (next) next.focus();
    else surface.blur();
    setCapturing(false);
  }

  function onDown(e) {
    if (shouldPreventDefault(e.code, capturing, e)) e.preventDefault();

    if (lastKeyEl) lastKeyEl.textContent = keyLabel(e.key);
    if (codeEl) codeEl.textContent = e.code || "—";
    if (keyCodeEl) keyCodeEl.textContent = (e.keyCode || e.which || 0);

    if (!e.repeat && !active[e.code]) {
      everPressed++;
      if (downCountEl) downCountEl.textContent = everPressed;
    }
    active[e.code] = true;
    var el = keyEls[e.code];
    if (el) {
      el.classList.add("active"); // bright while physically down (many at once = N-key rollover)
      el.classList.add("held");   // persists after release so you can see every key that registered
    }
    updateActiveCount();

    // Report Escape first, then hand the keyboard back — so you can still prove
    // the Esc key works, and still get out with it.
    if (isReleaseKey(e.code)) release();
  }

  function onUp(e) {
    active[e.code] = false;
    var el = keyEls[e.code];
    if (el) el.classList.remove("active"); // .held stays lit until reset (dead-key / stuck-key check)
    updateActiveCount();
  }

  function reset() {
    active = {};
    everPressed = 0;
    if (downCountEl) downCountEl.textContent = "0";
    if (heldCountEl) heldCountEl.textContent = "0";
    if (lastKeyEl) lastKeyEl.textContent = "—";
    if (codeEl) codeEl.textContent = "—";
    if (keyCodeEl) keyCodeEl.textContent = "—";
    Object.keys(keyEls).forEach(function (c) {
      keyEls[c].classList.remove("active", "held");
    });
  }

  build();
  setCapturing(false);
  if (statusEl) statusEl.textContent = captureStatusText(false);

  surface.addEventListener("focus", function () { setCapturing(true); });
  surface.addEventListener("blur", function () { setCapturing(false); });
  surface.addEventListener("keydown", onDown);
  surface.addEventListener("keyup", onUp);

  // Clicking the surface (or the "click to start" prompt over it) focuses it.
  surface.addEventListener("mousedown", function (e) {
    e.preventDefault(); // keep the click from landing focus on an ancestor instead
    surface.focus();
  });
  surface.addEventListener("touchstart", function () { surface.focus(); }, { passive: true });

  if (resetBtn) {
    // Clicking Reset necessarily blurs the surface. For a mouse user that would
    // mean clicking back into the keyboard every time, so put focus back — but
    // only for a pointer, never for someone who tabbed to the button and would
    // be yanked into capture without asking.
    resetBtn.addEventListener("mousedown", function () { resumeAfterReset = capturing; });
    resetBtn.addEventListener("click", function () {
      reset();
      if (resumeAfterReset) surface.focus();
      resumeAfterReset = false;
    });
  }

  /* If the window loses focus mid-press we never get keyup — clear the
     "currently down" highlight (but keep .held so the record of which keys
     registered survives). */
  window.addEventListener("blur", clearHeldNow);
})();
