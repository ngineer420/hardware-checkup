/* hardwarecheckup.com — Full Checkup
   100% client-side. One localStorage key, `hc-checkup`; nothing is sent.

   This file is loaded by EVERY page and does nothing at all unless one of two
   things is true:

     1. the URL carries `?checkup=1`, in which case it injects the verdict bar
        at the bottom of whichever tool page you are on, or
     2. the page is /full-checkup.html, in which case it renders the hub.

   That is why no tool page carries any checkup markup: adding a bar by hand to
   nine pages is nine chances to have nine slightly different bars, and the bar
   has to know the sequence anyway. The pages know nothing about the checkup;
   the checkup knows about the pages.

   Deliberately NOT on the readout pages. "Works / Problem" is a sensible
   question about a webcam and a nonsense one about a user agent string, and
   asking it there would make the whole flow feel unserious. The readouts are
   folded into the report card as machine-read facts instead, via sysinfo.js. */
(function () {
  "use strict";

  var KEY = "hc-checkup";
  var HUB = "/full-checkup.html";

  /* The nine real pass/fail tests, in the order a buyer should run them.
     Screen first: it is the most expensive thing to be wrong and the hardest to
     argue about afterwards. Then the inputs you will touch every day, then the
     camera and sound, which are the parts a seller is least likely to have
     tested and the easiest to live without.

     `measure` names an element on that page whose text is a real measurement
     rather than an opinion. When one is present at the moment the verdict is
     recorded it is stored with it, and the report card prints it in the
     machine-read column — that is what stops a printed card being nothing but
     assertions. */
  var SEQUENCE = [
    {
      id: "dead-pixel", name: "Dead pixels", href: "/dead-pixel-test.html",
      ask: "Any dots that stay black, white or coloured on every full-screen colour?",
      pass: "No stuck or dead pixels", fail: "Found a stuck or dead pixel",
    },
    {
      id: "colour", name: "Colour and backlight", href: "/color-test.html",
      ask: "Are the gradients smooth, with no banding, blotches or bright corners?",
      pass: "Even backlight, smooth gradients", fail: "Banding, blotches or backlight bleed",
    },
    {
      id: "refresh-rate", name: "Refresh rate", href: "/refresh-rate-test.html",
      ask: "Did the measured rate match what this machine is advertised as?",
      pass: "Runs at its rated refresh rate", fail: "Lower than advertised",
      measure: { sel: "#f-hz", label: "Measured refresh rate" },
      needs: "Press “Measure refresh rate” before answering — it takes five seconds.",
    },
    {
      id: "keyboard", name: "Keyboard", href: "/keyboard-test.html",
      ask: "Did every key you pressed light up, first time, exactly once?",
      pass: "Every key registers", fail: "A key is dead, doubling or sticky",
    },
    {
      id: "mouse", name: "Mouse and trackpad", href: "/mouse-test.html",
      ask: "Do all the buttons, the wheel and dragging behave — and does one click stay one click?",
      pass: "Buttons, wheel and drag all fine", fail: "A button, the wheel or dragging misbehaves",
    },
    {
      id: "touchscreen", name: "Touchscreen", href: "/touchscreen-test.html",
      ask: "Does every part of the screen respond to touch, with no dead patches?",
      pass: "Touch works across the whole screen", fail: "Dead or jumpy areas",
      optional: "Not a touchscreen? Skip this one — it is not a fault.",
    },
    {
      id: "webcam", name: "Webcam", href: "/webcam-test.html",
      ask: "Is the picture live, in focus, and free of lines or blotches?",
      pass: "Camera works", fail: "No picture, or a poor one",
    },
    {
      id: "mic", name: "Microphone", href: "/mic-test.html",
      ask: "Does the meter move when you speak, without crackling?",
      pass: "Microphone picks up sound", fail: "Silent, quiet or crackling",
    },
    {
      id: "speaker", name: "Speakers", href: "/speaker-test.html",
      ask: "Did you hear both the left and the right channel, clean at every tone?",
      pass: "Both channels clean", fail: "A channel is dead, or it buzzes",
    },
  ];

  var STATES = { pass: "Works", fail: "Problem", skip: "Skipped" };

  /* ------------------------------ the store ------------------------------ */

  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return blank(); }
    if (!raw) return blank();
    var data;
    try { data = JSON.parse(raw); } catch (e) { return blank(); }
    if (!data || typeof data !== "object" || !data.results) return blank();
    return { v: 1, started: data.started || null, results: data.results };
  }

  function blank() { return { v: 1, started: null, results: {} }; }

  function save(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
  }

  function record(id, state, note, measure) {
    var data = load();
    if (!data.started) data.started = new Date().toISOString();
    data.results[id] = {
      state: state,
      note: note || "",
      ts: new Date().toISOString(),
      measure: measure || null,
    };
    save(data);
    return data;
  }

  function stepIndex(id) {
    for (var i = 0; i < SEQUENCE.length; i++) if (SEQUENCE[i].id === id) return i;
    return -1;
  }

  function findStep(pathname) {
    for (var i = 0; i < SEQUENCE.length; i++) {
      if (SEQUENCE[i].href === pathname) return SEQUENCE[i];
    }
    return null;
  }

  /** The first test with no verdict yet, or null when the run is complete. */
  function nextUnanswered(data, afterIndex) {
    var start = typeof afterIndex === "number" ? afterIndex + 1 : 0;
    for (var i = start; i < SEQUENCE.length; i++) {
      if (!data.results[SEQUENCE[i].id]) return SEQUENCE[i];
    }
    for (var j = 0; j < start && j < SEQUENCE.length; j++) {
      if (!data.results[SEQUENCE[j].id]) return SEQUENCE[j];
    }
    return null;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function measureFrom(step) {
    if (!step.measure) return null;
    var node = document.querySelector(step.measure.sel);
    if (!node) return null;
    var text = (node.textContent || "").trim();
    if (!text || text === "—") return null;
    return { label: step.measure.label, value: text };
  }

  /* --------------------------- the verdict bar --------------------------- */

  function mountBar(step) {
    var data = load();
    var index = stepIndex(step.id);

    var bar = el("div", "checkup-bar");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Full checkup");

    var head = el("div", "cb-head");
    head.appendChild(el("span", "cb-step", "Step " + (index + 1) + " of " + SEQUENCE.length));
    head.appendChild(el("span", "cb-name", step.name));
    bar.appendChild(head);

    bar.appendChild(el("p", "cb-ask", step.ask));
    if (step.needs) bar.appendChild(el("p", "cb-needs", step.needs));
    if (step.optional) bar.appendChild(el("p", "cb-needs", step.optional));

    var noteWrap = el("div", "cb-note");
    noteWrap.hidden = true;
    var note = document.createElement("input");
    note.type = "text";
    note.className = "cb-note-input";
    note.maxLength = 140;
    note.placeholder = "What is wrong with it? (optional, printed on the card)";
    note.id = "cb-note-input";
    var noteLabel = el("label", "visually-hidden", "Note about this problem");
    noteLabel.setAttribute("for", "cb-note-input");
    var noteSave = el("button", "cb-btn cb-save", "Save and continue");
    noteSave.type = "button";
    noteWrap.appendChild(noteLabel);
    noteWrap.appendChild(note);
    noteWrap.appendChild(noteSave);

    var row = el("div", "cb-buttons");
    var passBtn = el("button", "cb-btn cb-pass", "Works");
    passBtn.type = "button";
    var failBtn = el("button", "cb-btn cb-fail", "Problem");
    failBtn.type = "button";
    var skipBtn = el("button", "cb-btn cb-skip", "Skip");
    skipBtn.type = "button";
    row.appendChild(passBtn);
    row.appendChild(failBtn);
    row.appendChild(skipBtn);
    bar.appendChild(row);
    bar.appendChild(noteWrap);

    var foot = el("div", "cb-foot");
    var hubLink = el("a", null, "Stop and see the report card");
    hubLink.href = HUB;
    foot.appendChild(hubLink);
    var existing = data.results[step.id];
    if (existing) {
      foot.appendChild(el("span", "cb-prev",
        "Already recorded as “" + (STATES[existing.state] || existing.state) + "”. Answering again replaces it."));
    }
    bar.appendChild(foot);

    document.body.appendChild(bar);
    // The bar is fixed to the bottom of the viewport, so without this it sits
    // on top of whatever the page ends with.
    document.body.classList.add("has-checkup-bar");

    function finish(state) {
      record(step.id, state, note.value, measureFrom(step));
      var next = nextUnanswered(load(), index);
      location.href = next ? next.href + "?checkup=1" : HUB;
    }

    passBtn.addEventListener("click", function () { finish("pass"); });
    skipBtn.addEventListener("click", function () { finish("skip"); });
    failBtn.addEventListener("click", function () {
      if (noteWrap.hidden) {
        noteWrap.hidden = false;
        note.focus();
        return;
      }
      finish("fail");
    });
    noteSave.addEventListener("click", function () { finish("fail"); });
    note.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); finish("fail"); }
    });
  }

  /* ------------------------------- the hub ------------------------------- */

  function renderHub() {
    var data = load();
    var listHost = document.getElementById("checkup-list");
    var startBtn = document.getElementById("checkup-start");
    var clearBtn = document.getElementById("checkup-clear");
    var printBtn = document.getElementById("checkup-print");
    var progressEl = document.getElementById("checkup-progress");
    var cardHost = document.getElementById("checkup-card");
    var verdictHost = document.getElementById("checkup-verdicts");
    var stampEl = document.getElementById("checkup-stamp");
    if (!listHost) return;

    var answered = 0;
    var problems = 0;
    for (var i = 0; i < SEQUENCE.length; i++) {
      var r = data.results[SEQUENCE[i].id];
      if (r) answered++;
      if (r && r.state === "fail") problems++;
    }

    /* The list of steps, each a link straight into that test in checkup mode —
       so the run can be picked up anywhere, not only from the top. */
    listHost.textContent = "";
    for (var j = 0; j < SEQUENCE.length; j++) {
      var step = SEQUENCE[j];
      var res = data.results[step.id];
      var item = el("li", "checkup-step" + (res ? " is-" + res.state : ""));

      var link = el("a", "cs-name", (j + 1) + ". " + step.name);
      link.href = step.href + "?checkup=1";
      item.appendChild(link);

      var state = el("span", "cs-state", res ? STATES[res.state] : "Not run");
      item.appendChild(state);

      if (res && res.note) item.appendChild(el("span", "cs-note", res.note));
      if (res && res.measure) {
        item.appendChild(el("span", "cs-measure", res.measure.label + ": " + res.measure.value));
      }
      listHost.appendChild(item);
    }

    if (progressEl) {
      progressEl.textContent = answered === 0
        ? "Nothing recorded on this device yet."
        : answered + " of " + SEQUENCE.length + " recorded" +
          (problems ? " · " + problems + " problem" + (problems === 1 ? "" : "s") + " found" : "");
    }

    if (startBtn) {
      var next = nextUnanswered(data);
      startBtn.textContent = answered === 0 ? "Start the checkup"
        : next ? "Continue with " + next.name.toLowerCase() : "Run it again";
      startBtn.href = next ? next.href + "?checkup=1" : SEQUENCE[0].href + "?checkup=1";
    }

    if (clearBtn) clearBtn.hidden = answered === 0;
    if (printBtn) printBtn.hidden = answered === 0;
    if (cardHost) cardHost.hidden = answered === 0;

    if (stampEl) {
      stampEl.textContent = data.started
        ? "Checked on " + new Date(data.started).toLocaleString()
        : "";
    }

    /* The human half of the card. Kept visually and verbally apart from the
       machine-read half below it: a verdict is somebody's opinion, and a card
       that blurs the two is exactly the card a seller would hand you. */
    if (verdictHost) {
      verdictHost.textContent = "";
      for (var k = 0; k < SEQUENCE.length; k++) {
        var s = SEQUENCE[k];
        var v = data.results[s.id];
        if (!v) continue;
        var row = el("div", "cc-row is-" + v.state);
        row.appendChild(el("span", "cc-label", s.name));
        var value = el("span", "cc-value");
        value.textContent = v.state === "pass" ? s.pass : v.state === "fail" ? s.fail : "Skipped";
        row.appendChild(value);
        if (v.note) row.appendChild(el("span", "cc-note", "“" + v.note + "”"));
        if (v.measure) row.appendChild(el("span", "cc-note", v.measure.label + ": " + v.measure.value));
        verdictHost.appendChild(row);
      }
      if (!answered) verdictHost.appendChild(el("p", "cc-empty", "No verdicts recorded yet."));
    }

    /* The machine-read half: measurements captured during the run, printed
       apart from the verdicts because nobody's opinion is involved in them. */
    var measureHost = document.getElementById("checkup-measures");
    if (measureHost) {
      measureHost.textContent = "";
      var any = false;
      for (var m = 0; m < SEQUENCE.length; m++) {
        var mr = data.results[SEQUENCE[m].id];
        if (!mr || !mr.measure) continue;
        any = true;
        var mrow = el("div", "cc-row");
        mrow.appendChild(el("span", "cc-label", mr.measure.label));
        mrow.appendChild(el("span", "cc-value", mr.measure.value));
        measureHost.appendChild(mrow);
      }
      if (!any) {
        measureHost.appendChild(el("p", "cc-empty",
          "Nothing measured yet — the refresh-rate step records its result here when you run it."));
      }
    }

    if (clearBtn && !clearBtn.dataset.bound) {
      clearBtn.dataset.bound = "1";
      clearBtn.addEventListener("click", function () {
        try { localStorage.removeItem(KEY); } catch (e) {}
        renderHub();
      });
    }
    if (printBtn && !printBtn.dataset.bound) {
      printBtn.dataset.bound = "1";
      printBtn.addEventListener("click", function () { window.print(); });
    }
  }

  /* Battery is a machine-read fact, not a verdict, so it belongs on the card
     rather than in the sequence — and the wording comes from battery.js's own
     tested helper rather than a second copy of it here. */
  function renderBattery() {
    var host = document.getElementById("checkup-battery");
    if (!host) return;
    if (!navigator.getBattery) {
      host.textContent = "Not available in this browser (Safari has never shipped the Battery Status API, and Firefox removed it).";
      return;
    }
    navigator.getBattery().then(function (b) {
      var describe = window.HCBattery && window.HCBattery.describeLevel;
      host.textContent = describe
        ? describe(b.level, b.charging)
        : Math.round(b.level * 100) + "%" + (b.charging ? ", charging" : ", on battery");
      // The caveat is a THIRD cell of the row, not text inside the value cell:
      // nested in the value it lands beside the label and overlaps it.
      var row = host.parentNode;
      if (row && !row.querySelector(".cc-note")) {
        row.appendChild(el("span", "cc-note",
          "The API reports charge, not battery health: a worn battery still reads 100% when full."));
      }
    }, function () {
      host.textContent = "This browser refused to report the battery.";
    });
  }

  /* --------------------------------- go --------------------------------- */

  if (location.pathname === HUB || /\/full-checkup(\.html)?$/.test(location.pathname)) {
    renderHub();
    renderBattery();
    return;
  }

  if (!/(^|[?&])checkup=1(&|$)/.test(location.search)) return;
  var current = findStep(location.pathname);
  if (current) mountBar(current);
})();
