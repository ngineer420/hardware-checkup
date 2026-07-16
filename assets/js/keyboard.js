/* hardwarecheckup.com — Keyboard Tester
   100% client-side. Keystrokes are read locally to light up the on-screen keyboard; nothing is logged or sent. */
(function () {
  "use strict";

  var kb = document.getElementById("kb");
  var resetBtn = document.getElementById("reset-btn");
  var lastKeyEl = document.getElementById("f-key");
  var codeEl = document.getElementById("f-code");
  var keyCodeEl = document.getElementById("f-keycode");
  var downCountEl = document.getElementById("f-count");
  var heldCountEl = document.getElementById("f-held");

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
    heldCountEl.textContent = n;
  }

  function onDown(e) {
    // Prevent Tab/Space/Backspace/arrows from scrolling or leaving the page while testing.
    if (["Tab", "Space", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].indexOf(e.code) !== -1) {
      e.preventDefault();
    }
    lastKeyEl.textContent = e.key === " " ? "Space" : (e.key || "—");
    codeEl.textContent = e.code || "—";
    keyCodeEl.textContent = (e.keyCode || e.which || 0);

    if (!e.repeat && !active[e.code]) {
      everPressed++;
      downCountEl.textContent = everPressed;
    }
    active[e.code] = true;
    var el = keyEls[e.code];
    if (el) {
      el.classList.add("active"); // bright while physically down (many at once = N-key rollover)
      el.classList.add("held");   // persists after release so you can see every key that registered
    }
    updateActiveCount();
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
    downCountEl.textContent = "0";
    heldCountEl.textContent = "0";
    lastKeyEl.textContent = "—";
    codeEl.textContent = "—";
    keyCodeEl.textContent = "—";
    Object.keys(keyEls).forEach(function (c) {
      keyEls[c].classList.remove("active", "held");
    });
  }

  build();
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  // If focus leaves the window mid-press we never get keyup — clear the "currently down" highlight
  // (but keep .held so the record of which keys registered survives).
  window.addEventListener("blur", function () {
    Object.keys(keyEls).forEach(function (c) { keyEls[c].classList.remove("active"); });
    active = {};
    updateActiveCount();
  });
  resetBtn.addEventListener("click", reset);
})();
