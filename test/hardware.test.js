/* Unit tests for the pure logic behind the hardware tests.
   No framework needed — run with: node test/hardware.test.js

   Only the parts that can be wrong *quietly* are here. A webcam preview that
   fails is obvious the moment you look at it; a refresh-rate figure that is
   six Hz low because one garbage-collection pause dragged the average is not,
   and it is the number the whole page exists to report. */

"use strict";

const assert = require("assert");

const RR = require("../assets/js/refreshrate.js");
const Battery = require("../assets/js/battery.js");
const Touch = require("../assets/js/touchscreen.js");
const Colour = require("../assets/js/colortest.js");
const Keyboard = require("../assets/js/keyboard.js");
const Sys = require("../assets/js/sysinfo.js");

let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log("ok  " + name);
}

/** `n` frame intervals for a perfectly steady display running at `hz`. */
const steady = (hz, n) => Array.from({ length: n }, () => 1000 / hz);

/** The same, with a little noise, which is what a real machine produces. */
function noisy(hz, n, jitterMs) {
  const base = 1000 / hz;
  let seed = 42;
  return Array.from({ length: n }, () => {
    // Deterministic pseudo-random so a failure is reproducible.
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return base + ((seed / 2147483648) - 0.5) * 2 * jitterMs;
  });
}

/* ------------------------------ refresh rate ------------------------------ */

test("a steady display measures at its real rate", () => {
  for (const hz of [60, 75, 120, 144, 165, 240]) {
    const s = RR.summariseFrameIntervals(steady(hz, 300));
    assert.ok(Math.abs(s.hz - hz) < 0.01, hz + "Hz measured as " + s.hz);
    assert.strictEqual(RR.snapToCommonRate(s.hz), hz);
  }
});

test("one stall does not drag the estimate down", () => {
  // The whole reason this uses a median. A 300ms garbage-collection pause in
  // an otherwise clean 144Hz sample: the mean lands near 138Hz, which looks
  // plausible enough to be believed and is wrong.
  const intervals = steady(144, 299).concat([300]);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  assert.ok(1000 / mean < 140, "the mean really would be misleading here: " + (1000 / mean).toFixed(1));

  const s = RR.summariseFrameIntervals(intervals);
  assert.ok(Math.abs(s.hz - 144) < 0.5, "median should still read 144, got " + s.hz);
  assert.strictEqual(RR.snapToCommonRate(s.hz), 144);
  assert.strictEqual(s.dropped, 1, "and the stall is still reported, not hidden");
});

test("implausible intervals are discarded rather than measured", () => {
  // A backgrounded tab gets one frame a second. Reporting that as a 1Hz
  // display would be the most embarrassing possible failure for this page.
  const intervals = steady(60, 200).concat([1000, 2000, 0.0001, NaN, Infinity, -5]);
  const s = RR.summariseFrameIntervals(intervals);
  assert.strictEqual(s.samples, 200);
  assert.strictEqual(s.discarded, 6);
  assert.ok(Math.abs(s.hz - 60) < 0.01);
});

test("too few samples yields nothing rather than a guess", () => {
  assert.strictEqual(RR.summariseFrameIntervals([], 30), null);
  assert.strictEqual(RR.summariseFrameIntervals(steady(60, 29), 30), null);
  assert.ok(RR.summariseFrameIntervals(steady(60, 30), 30));
});

test("a noisy sample still lands on the right rate", () => {
  // ±1ms of jitter on a 144Hz panel (6.94ms frames) is a lot, and the answer
  // must still be 144 rather than a shrug.
  const s = RR.summariseFrameIntervals(noisy(144, 400, 1));
  assert.strictEqual(RR.snapToCommonRate(s.hz), 144, "measured " + s.hz.toFixed(2));
  assert.ok(s.jitterMs > 0.5, "and the jitter is reported: " + s.jitterMs.toFixed(2));
});

test("snapToCommonRate refuses to round a rate that is not one", () => {
  assert.strictEqual(RR.snapToCommonRate(60), 60);
  assert.strictEqual(RR.snapToCommonRate(59.9), 60, "the NTSC family is within tolerance");
  assert.strictEqual(RR.snapToCommonRate(143.5), 144);
  // Halfway between 144 and 165 is not either of them, and saying so is more
  // useful than picking the nearer one and sounding certain.
  assert.strictEqual(RR.snapToCommonRate(154), null);
  assert.strictEqual(RR.snapToCommonRate(0), null);
  assert.strictEqual(RR.snapToCommonRate(NaN), null);
  assert.strictEqual(RR.snapToCommonRate(-60), null);
});

test("the 60Hz verdict says the thing people came for", () => {
  const at60 = RR.describeResult(RR.summariseFrameIntervals(steady(60, 200)));
  assert.match(at60, /still set to 60/);
  const at144 = RR.describeResult(RR.summariseFrameIntervals(steady(144, 200)));
  assert.match(at144, /144Hz display running at its rated speed/);
  const odd = RR.describeResult(RR.summariseFrameIntervals(steady(154, 200)));
  assert.match(odd, /not a standard refresh rate/);
});

/* -------------------------------- battery -------------------------------- */

test("battery durations read as time, and Infinity never leaks out", () => {
  // The spec uses Infinity for "not charging" / "already full". Printing the
  // literal string "Infinity" in a readout is the classic version of this bug.
  assert.strictEqual(Battery.formatDuration(Infinity), "Unknown");
  assert.strictEqual(Battery.formatDuration(null), "Unknown");
  assert.strictEqual(Battery.formatDuration(undefined), "Unknown");
  assert.strictEqual(Battery.formatDuration(NaN), "Unknown");
  assert.strictEqual(Battery.formatDuration(-1), "Unknown");

  assert.strictEqual(Battery.formatDuration(0), "—");
  assert.strictEqual(Battery.formatDuration(60), "1 minute");
  assert.strictEqual(Battery.formatDuration(600), "10 minutes");
  assert.strictEqual(Battery.formatDuration(3600), "1h");
  assert.strictEqual(Battery.formatDuration(5400), "1h 30m");
  assert.strictEqual(Battery.formatDuration(9000), "2h 30m");
});

test("battery wording never claims to know the health", () => {
  const samples = [
    Battery.describeLevel(1, true), Battery.describeLevel(0.5, true),
    Battery.describeLevel(0.05, false), Battery.describeLevel(0.2, false),
    Battery.describeLevel(0.8, false),
  ];
  for (const s of samples) {
    assert.ok(!/health/i.test(s), "the API cannot report health: " + s);
  }
  assert.match(Battery.describeLevel(1, true), /Fully charged/);
  assert.match(Battery.describeLevel(0.5, true), /Charging/);
  assert.match(Battery.describeLevel(0.05, false), /Very low/);
  assert.match(Battery.describeLevel(0.8, false), /80% remaining/);
});

/* ------------------------------ touchscreen ------------------------------ */

test("every point maps to a cell, including the exact edges", () => {
  const { GRID_COLS: C, GRID_ROWS: R } = Touch;
  const w = 600, h = 400;
  assert.strictEqual(Touch.cellIndex(0, 0, w, h, C, R), 0);
  // The bottom-right corner is exactly at width/height, which naive flooring
  // puts one row past the end of the array — a click there would silently
  // fail to mark the last zone, and the coverage map would never complete.
  assert.strictEqual(Touch.cellIndex(w, h, w, h, C, R), C * R - 1);
  assert.strictEqual(Touch.cellIndex(w - 0.01, h - 0.01, w, h, C, R), C * R - 1);
  // And a pointer dragged outside the box clamps rather than going negative.
  assert.strictEqual(Touch.cellIndex(-50, -50, w, h, C, R), 0);
  assert.strictEqual(Touch.cellIndex(w + 999, h + 999, w, h, C, R), C * R - 1);

  for (let i = 0; i < 400; i++) {
    const idx = Touch.cellIndex(Math.random() * w, Math.random() * h, w, h, C, R);
    assert.ok(idx >= 0 && idx < C * R, "out of range: " + idx);
  }
});

test("a zero-sized surface does not divide by zero", () => {
  assert.strictEqual(Touch.cellIndex(10, 10, 0, 0, 12, 8), -1);
});

/* -------------------------------- colour -------------------------------- */

test("every colour pattern is drawable and describes what to look for", () => {
  assert.ok(Colour.PATTERNS.length >= 8);
  const ids = new Set();
  for (const p of Colour.PATTERNS) {
    assert.ok(p.id && !ids.has(p.id), "duplicate or missing pattern id: " + p.id);
    ids.add(p.id);
    assert.strictEqual(typeof p.draw, "function", p.id);
    assert.ok(p.name && p.look, p.id + " has no caption");
  }
  // The set has to cover all three purposes the page claims: a smooth ramp for
  // banding, discrete steps for crush, and flat fields for uniformity.
  assert.ok(ids.has("grey-ramp") && ids.has("grey-steps"));
  assert.ok(ids.has("white") && ids.has("black") && ids.has("grey-50"));
});

test("patterns paint without touching a real canvas", () => {
  // A tiny fake 2D context: enough to prove each draw function calls only the
  // API it claims to, and that none of them throw on an odd viewport.
  const calls = [];
  const ctx = {
    fillStyle: null,
    fillRect: (...a) => calls.push(["fillRect", ...a]),
    createLinearGradient: () => ({ addColorStop: (o, c) => calls.push(["stop", o, c]) }),
  };
  for (const p of Colour.PATTERNS) {
    calls.length = 0;
    p.draw(ctx, 1280, 800);
    assert.ok(calls.length > 0, p.id + " drew nothing");
    p.draw(ctx, 1, 1); // a 1px viewport must not throw or loop forever
  }
});

/* ------------------------------- keyboard -------------------------------- */

const NAV_KEYS = ["Tab", "Space", "Enter", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const none = { ctrlKey: false, metaKey: false, altKey: false };

test("nothing is swallowed until the test surface has focus", () => {
  // This is the bug the whole change exists for. A global keydown handler that
  // ate Tab meant a keyboard-only visitor could not reach the nav, the theme
  // toggle or any link on the page — the tester held the keyboard hostage from
  // the moment the script ran.
  for (const code of NAV_KEYS.concat(["KeyA", "Slash", "F1", "Escape"])) {
    assert.strictEqual(
      Keyboard.shouldPreventDefault(code, false, none), false,
      code + " must reach the browser when the surface is not focused"
    );
  }
});

test("with focus, the keys the tool exists to test are swallowed", () => {
  // A sticky spacebar is one of the commonest reasons anyone opens a key
  // tester, so "just stop calling preventDefault" is not an available fix.
  for (const code of NAV_KEYS) {
    assert.strictEqual(Keyboard.shouldPreventDefault(code, true, none), true, code);
  }
  // And the printable keys too: "/" opens Firefox's quick-find otherwise, which
  // steals the next keystrokes mid-test.
  assert.strictEqual(Keyboard.shouldPreventDefault("Slash", true, none), true);
  assert.strictEqual(Keyboard.shouldPreventDefault("KeyQ", true, none), true);
});

test("Escape is never swallowed, because it is the way out", () => {
  assert.ok(Keyboard.isReleaseKey("Escape"));
  assert.ok(!Keyboard.isReleaseKey("Enter"));
  assert.strictEqual(Keyboard.shouldPreventDefault("Escape", true, none), false);
  assert.strictEqual(Keyboard.shouldPreventDefault("Escape", false, none), false);
});

test("browser shortcuts survive capture", () => {
  // Swallowing Cmd+C or Ctrl+R while the surface happens to hold focus would be
  // a smaller version of exactly the same trap.
  for (const mod of ["ctrlKey", "metaKey", "altKey"]) {
    const held = Object.assign({}, none, { [mod]: true });
    assert.strictEqual(Keyboard.shouldPreventDefault("KeyC", true, held), false, mod);
    assert.strictEqual(Keyboard.shouldPreventDefault("KeyR", true, held), false, mod);
    assert.strictEqual(Keyboard.shouldPreventDefault("Tab", true, held), false, mod + " + Tab");
  }
  // A missing modifiers object must not be read as "all modifiers held".
  assert.strictEqual(Keyboard.shouldPreventDefault("KeyC", true, undefined), true);
});

test("the readout names the space bar rather than printing a blank", () => {
  assert.strictEqual(Keyboard.keyLabel(" "), "Space");
  assert.strictEqual(Keyboard.keyLabel("Spacebar"), "Space"); // older Firefox/Edge
  assert.strictEqual(Keyboard.keyLabel(""), "—");
  assert.strictEqual(Keyboard.keyLabel(undefined), "—");
  assert.strictEqual(Keyboard.keyLabel("a"), "a");
  assert.strictEqual(Keyboard.keyLabel("Tab"), "Tab");
});

test("releasing hands focus forward, never back into the surface", () => {
  // Sending focus backwards — to the reset button just above, say — would mean
  // the next Tab walks straight back into capture. The trap, wearing a hat.
  const order = ["reset-btn", "surface", "article-link", "footer-home"];
  assert.strictEqual(Keyboard.nextAfter(order, "surface"), "article-link");
  assert.strictEqual(Keyboard.nextAfter(order, "footer-home"), null, "nothing after the last element");
  assert.strictEqual(Keyboard.nextAfter(order, "missing"), null);
  assert.strictEqual(Keyboard.nextAfter([], "surface"), null);
  assert.strictEqual(Keyboard.nextAfter(["surface"], "surface"), null);
});

test("the status line always says how to get the keyboard back", () => {
  const on = Keyboard.captureStatusText(true);
  const off = Keyboard.captureStatusText(false);
  assert.notStrictEqual(on, off);
  assert.match(on, /Esc/, "a capturing page must name its escape hatch: " + on);
  assert.match(off, /Tab|click/i, "and an idle page must say how to start: " + off);
});

/* ------------------------------ system info ------------------------------ */

/* Real user agent strings, kept verbatim. Hand-simplified ones hide exactly the
   overlaps that break naive detection — every Chromium browser below carries
   "Chrome/" and every WebKit one carries "Safari/". */
const UA = {
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  firefoxWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
  operaWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 OPR/123.0.0.0",
  vivaldiWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Vivaldi/6.7",
  samsung: "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  firefoxIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15",
  chromeos: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
};

test("a Chromium look-alike is never reported as Chrome", () => {
  // Edge, Opera, Vivaldi and Samsung Internet all ship "Chrome/" in their user
  // agent. Testing for Chrome first — the obvious implementation — reports all
  // four as Chrome, which is the single most common bug in this genre of page.
  assert.strictEqual(Sys.browserFromUA(UA.edgeWin).name, "Microsoft Edge");
  assert.strictEqual(Sys.browserFromUA(UA.edgeWin).major, 138);
  assert.strictEqual(Sys.browserFromUA(UA.operaWin).name, "Opera");
  assert.strictEqual(Sys.browserFromUA(UA.operaWin).major, 123);
  assert.strictEqual(Sys.browserFromUA(UA.vivaldiWin).name, "Vivaldi");
  assert.strictEqual(Sys.browserFromUA(UA.samsung).name, "Samsung Internet");
  assert.strictEqual(Sys.browserFromUA(UA.chromeWin).name, "Chrome");
});

test("Safari is Safari, and only when nothing else claims the string", () => {
  // Every WebKit browser carries "Safari/", so the Safari rule has to be last
  // and has to require the "Version/" token that only Safari itself sets.
  const s = Sys.browserFromUA(UA.safariMac);
  assert.strictEqual(s.name, "Safari");
  assert.strictEqual(s.version, "17.4");
  assert.strictEqual(Sys.browserFromUA(UA.safariIphone).name, "Safari");
  assert.strictEqual(Sys.browserFromUA(UA.firefoxIos).name, "Firefox");
  assert.strictEqual(Sys.browserFromUA(UA.firefoxWin).name, "Firefox");
});

test("the engine is the real engine, not the badge on the browser", () => {
  assert.strictEqual(Sys.engineFromUA(UA.chromeMac), "Blink");
  assert.strictEqual(Sys.engineFromUA(UA.edgeWin), "Blink");
  assert.strictEqual(Sys.engineFromUA(UA.firefoxWin), "Gecko");
  assert.strictEqual(Sys.engineFromUA(UA.safariMac), "WebKit");
  // Firefox on iOS is WebKit underneath — every iOS browser is. Reporting
  // "Gecko" there would be a confidently wrong answer.
  assert.match(Sys.engineFromUA(UA.firefoxIos), /^WebKit/);
  assert.strictEqual(Sys.engineFromUA(""), null);
  assert.strictEqual(Sys.engineFromUA(undefined), null);
});

test("Windows 10 and Windows 11 are not guessed apart from the user agent", () => {
  // Windows 11 reports NT 10.0, exactly as Windows 10 does. There is no signal
  // in the string, so the only honest answer names both.
  const os = Sys.osFromUA(UA.chromeWin);
  assert.strictEqual(os.name, "Windows 10 or 11");
  assert.match(os.note, /cannot tell the two apart/);
  assert.strictEqual(Sys.osFromUA("Mozilla/5.0 (Windows NT 6.1)").name, "Windows 7");
});

test("a frozen macOS version says it is frozen instead of claiming 10.15", () => {
  const os = Sys.osFromUA(UA.safariMac);
  assert.strictEqual(os.name, "macOS");
  assert.match(os.note, /since Big Sur reports itself as 10\.15\.7/);
});

test("mobile and desktop platforms are named from the string", () => {
  assert.strictEqual(Sys.osFromUA(UA.safariIphone).name, "iOS 17.4");
  assert.strictEqual(Sys.osFromUA(UA.chromeAndroid).name, "Android 14");
  assert.strictEqual(Sys.osFromUA(UA.samsung).name, "Android 13");
  assert.strictEqual(Sys.osFromUA(UA.chromeos).name, "ChromeOS");
  assert.strictEqual(Sys.osFromUA(UA.linuxFirefox).name, "Linux");
  // Android carries "Linux" in the same string, so order decides this one.
  assert.notStrictEqual(Sys.osFromUA(UA.chromeAndroid).name, "Linux");
  assert.strictEqual(Sys.osFromUA(""), null);
  assert.strictEqual(Sys.osFromUA(null), null);
});

test("the GREASE brand is discarded rather than reported as the browser", () => {
  // Client Hints deliberately inject a fake brand with shifting punctuation, so
  // that code taking brands[0] breaks in testing rather than in the wild.
  assert.ok(Sys.isGreaseBrand("Not_A Brand"));
  assert.ok(Sys.isGreaseBrand("Not(A:Brand"));
  assert.ok(Sys.isGreaseBrand(" Not;A Brand"));
  assert.ok(Sys.isGreaseBrand("Not=A?Brand"));
  assert.ok(!Sys.isGreaseBrand("Google Chrome"));

  const chrome = Sys.pickBrand([
    { brand: "Not_A Brand", version: "8" },
    { brand: "Chromium", version: "138" },
    { brand: "Google Chrome", version: "138" },
  ]);
  assert.strictEqual(chrome.name, "Google Chrome");
  assert.strictEqual(chrome.major, 138);

  // Chromium is real, but it is the platform rather than the product — only
  // used when the browser offers nothing more specific.
  assert.strictEqual(Sys.pickBrand([{ brand: "Chromium", version: "138" }, { brand: "Not.A/Brand", version: "24" }]).name, "Chromium");
  assert.strictEqual(Sys.pickBrand([{ brand: "Not_A Brand", version: "8" }]), null);
  assert.strictEqual(Sys.pickBrand([]), null);
  assert.strictEqual(Sys.pickBrand(null), null);
  assert.strictEqual(Sys.pickBrand(undefined), null);
});

test("Client Hints resolve the Windows version the user agent cannot", () => {
  // Microsoft's published mapping. 13 and up is Windows 11; 1 to 10 is 10.
  assert.strictEqual(Sys.windowsFromPlatformVersion("15.0.0"), "Windows 11");
  assert.strictEqual(Sys.windowsFromPlatformVersion("13.0.0"), "Windows 11");
  assert.strictEqual(Sys.windowsFromPlatformVersion("10.0.0"), "Windows 10");
  assert.strictEqual(Sys.windowsFromPlatformVersion("1.0.0"), "Windows 10");
  assert.strictEqual(Sys.windowsFromPlatformVersion("0.3.0"), "Windows 8.1");
  assert.strictEqual(Sys.windowsFromPlatformVersion("0.1.0"), "Windows 7");
  // 11 and 12 are assigned to neither, so they say so rather than round.
  assert.strictEqual(Sys.windowsFromPlatformVersion("12.0.0"), "Windows 10 or 11");
  assert.strictEqual(Sys.windowsFromPlatformVersion(""), "Windows");
  assert.strictEqual(Sys.windowsFromPlatformVersion(null), "Windows");

  assert.strictEqual(Sys.osFromClientHints("macOS", "14.5.0").name, "macOS 14.5");
  assert.strictEqual(Sys.osFromClientHints("Android", "13.0.0").name, "Android 13");
  assert.strictEqual(Sys.osFromClientHints("Linux", "").name, "Linux");
  // Chrome sends "Unknown" as the platform in some embedded contexts, which is
  // not an operating system and must not be printed as one.
  assert.strictEqual(Sys.osFromClientHints("Unknown", ""), null);
  assert.strictEqual(Sys.osFromClientHints(null, "14.0.0"), null);
});

test("Client Hints win over the user agent when both are present", () => {
  // The whole point of the hints: a Chrome on macOS 14 whose user agent still
  // says 10.15.7 must report 14, not the frozen figure.
  const env = {
    userAgent: UA.chromeMac,
    userAgentData: { brands: [{ brand: "Not_A Brand", version: "8" }, { brand: "Google Chrome", version: "138" }], platform: "macOS" },
    highEntropyValues: { platformVersion: "14.5.0", uaFullVersion: "138.0.7204.93" },
  };
  const by = Sys.fieldsById(Sys.buildReport(env));
  assert.strictEqual(by.os.value, "macOS 14.5");
  assert.strictEqual(by.browser.value, "Google Chrome 138");
  assert.strictEqual(by["browser-version"].value, "138.0.7204.93");
  assert.match(by.browser.note, /Client Hints/);
});

test("Safari's shape — no Client Hints, no deviceMemory — degrades cleanly", () => {
  // Safari differs from Chrome on exactly these two, and this is the readout
  // most visitors on a Mac or iPhone will actually see.
  const env = {
    userAgent: UA.safariMac,
    screen: { width: 1512, height: 982, availWidth: 1512, availHeight: 944, colorDepth: 30 },
    devicePixelRatio: 2,
    innerWidth: 1200,
    innerHeight: 800,
    hardwareConcurrency: 10,
    language: "en-GB",
    languages: ["en-GB", "en"],
    timeZone: "Europe/London",
    timezoneOffsetMinutes: -60,
  };
  const by = Sys.fieldsById(Sys.buildReport(env));
  assert.strictEqual(by.browser.value, "Safari 17");
  assert.strictEqual(by.engine.value, "WebKit");
  assert.strictEqual(by.cores.value, "10 logical processors");
  assert.strictEqual(by.resolution.value, "1512 × 982");
  assert.strictEqual(by.physical.value, "3024 × 1964");
  assert.strictEqual(by["colour-depth"].value, "30-bit");
  assert.strictEqual(by["utc-offset"].value, "UTC+01:00");

  // The two Safari does not offer must read as unavailable, with a reason —
  // never as 0 GB, "undefined", or an empty cell.
  assert.strictEqual(by.memory.available, false);
  assert.strictEqual(by.memory.value, Sys.NOT_AVAILABLE);
  assert.match(by.memory.hint, /Safari and Firefox do not/);
  assert.strictEqual(by.gpu.available, false);
  assert.match(by.gpu.hint, /WEBGL_debug_renderer_info/);
});

test("an empty environment reports nothing rather than inventing something", () => {
  // The degradation path in full: a browser that answers no question at all.
  // Every field must say it is unavailable, and none may leak "undefined",
  // "NaN", "null" or a zero pretending to be a measurement.
  const sections = Sys.buildReport({});
  let checked = 0;
  for (const section of sections) {
    for (const f of section.fields) {
      assert.strictEqual(f.available, false, f.id + " claimed a value from nothing");
      assert.match(f.value, /^Not /, f.id + " printed " + f.value);
      assert.doesNotMatch(f.value, /undefined|NaN|null|\[object/i, f.id);
      checked++;
    }
  }
  assert.ok(checked >= 20, "expected the whole readout to be covered, saw " + checked);

  // Everything says "not available in this browser" except the one field that
  // is missing for a different reason. Nobody has pressed the button yet, and
  // blaming the browser for that would be its own small lie.
  const by = Sys.fieldsById(sections);
  assert.strictEqual(by.resolution.value, Sys.NOT_AVAILABLE);
  assert.strictEqual(by["refresh-rate"].value, "Not measured yet");
  assert.match(by["refresh-rate"].hint, /takes five seconds/);
  // And with no argument at all, rather than throwing.
  assert.strictEqual(Sys.buildReport().length, sections.length);
});

test("a masked GPU string is not reported as a graphics card", () => {
  // What a browser hands back when it is refusing to tell you: reporting
  // "WebKit WebGL" as the GPU is precisely the confident nonsense to avoid.
  assert.ok(Sys.isMaskedGpuValue("WebKit WebGL"));
  assert.ok(Sys.isMaskedGpuValue("  webkit  "));
  assert.ok(Sys.isMaskedGpuValue("Mozilla"));
  assert.ok(Sys.isMaskedGpuValue(""));
  assert.ok(Sys.isMaskedGpuValue(null));
  assert.ok(Sys.isMaskedGpuValue(undefined));
  assert.strictEqual(Sys.describeGpu("WebKit", "WebKit WebGL"), null);
  assert.strictEqual(Sys.describeGpu(null, null), null);

  const real = Sys.describeGpu("Google Inc. (Apple)", "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)");
  assert.match(real.renderer, /Apple M1 Pro/);
  // A useful renderer with a masked vendor still counts as a reading.
  assert.strictEqual(Sys.describeGpu("Mozilla", "ANGLE (NVIDIA GeForce RTX 3080)").vendor, null);
  assert.match(Sys.describeGpu("Mozilla", "ANGLE (NVIDIA GeForce RTX 3080)").renderer, /RTX 3080/);
});

test("touch support is not claimed for a desktop that merely supports the events", () => {
  // Chrome exposes touch events on machines with no touchscreen at all, so the
  // point count is the honest signal and the event support is described as
  // what it is rather than as a touchscreen.
  assert.match(Sys.describeTouch(5, true).text, /up to 5 simultaneous touch points/);
  assert.strictEqual(Sys.describeTouch(1, true).text, "Yes — up to 1 touch point");
  const desktop = Sys.describeTouch(0, true);
  assert.strictEqual(desktop.supported, false);
  assert.match(desktop.text, /No touchscreen detected/);
  assert.match(desktop.text, /reports 0 touch points/);
  assert.strictEqual(Sys.describeTouch(0, false).text, "No touchscreen detected");
  assert.strictEqual(Sys.describeTouch(undefined, false), null);
});

test("an iPad pretending to be a Mac is flagged rather than reported as a desktop", () => {
  // "Request Desktop Website" sends a Mac user agent with nothing in the string
  // to contradict it. Ten touch points on a Mac is the only tell there is.
  const by = Sys.fieldsById(Sys.buildReport({ userAgent: UA.safariMac, maxTouchPoints: 5 }));
  assert.match(by.os.note, /Request Desktop Website/);
  // And a real Mac is not accused of being an iPad.
  const mac = Sys.fieldsById(Sys.buildReport({ userAgent: UA.safariMac, maxTouchPoints: 0 }));
  assert.doesNotMatch(String(mac.os.note), /Request Desktop Website/);
});

test("numbers are refused unless they are real measurements", () => {
  assert.strictEqual(Sys.formatDimensions(1920, 1080), "1920 × 1080");
  assert.strictEqual(Sys.formatDimensions(0, 1080), null);
  assert.strictEqual(Sys.formatDimensions(1920, NaN), null);
  assert.strictEqual(Sys.formatDimensions(undefined, undefined), null);
  assert.strictEqual(Sys.formatDimensions("1920", 1080), null);

  assert.strictEqual(Sys.formatPixelRatio(2), "2");
  assert.strictEqual(Sys.formatPixelRatio(1.5), "1.5");
  assert.strictEqual(Sys.formatPixelRatio(2.625), "2.625");
  assert.strictEqual(Sys.formatPixelRatio(0), null);
  assert.strictEqual(Sys.formatPixelRatio(undefined), null);

  // Physical pixels need both halves; a missing ratio must not silently mean 1.
  assert.strictEqual(Sys.physicalPixels(1512, 982, 2), "3024 × 1964");
  assert.strictEqual(Sys.physicalPixels(1512, 982, undefined), null);

  assert.strictEqual(Sys.formatCores(1), "1 logical processor");
  assert.strictEqual(Sys.formatCores(12), "12 logical processors");
  assert.strictEqual(Sys.formatCores(0), null);
  assert.strictEqual(Sys.formatCores(undefined), null);

  // deviceMemory is capped at 8 by the spec, so "8 GB" would understate a
  // 32 GB machine. "8 GB or more" is the true statement.
  assert.strictEqual(Sys.formatDeviceMemory(8), "8 GB or more");
  assert.strictEqual(Sys.formatDeviceMemory(4), "4 GB");
  assert.strictEqual(Sys.formatDeviceMemory(0.5), "0.5 GB");
  assert.strictEqual(Sys.formatDeviceMemory(undefined), null);
  assert.strictEqual(Sys.formatDeviceMemory(0), null);

  assert.strictEqual(Sys.formatColourDepth(24), "24-bit");
  assert.strictEqual(Sys.formatColourDepth(undefined), null);

  // getTimezoneOffset is inverted by design: UTC+1 reports -60.
  assert.strictEqual(Sys.formatUtcOffset(-60), "UTC+01:00");
  assert.strictEqual(Sys.formatUtcOffset(300), "UTC-05:00");
  assert.strictEqual(Sys.formatUtcOffset(-330), "UTC+05:30");
  assert.strictEqual(Sys.formatUtcOffset(0), "UTC+00:00");
  assert.strictEqual(Sys.formatUtcOffset(undefined), null);

  assert.strictEqual(Sys.formatLanguages(["en-GB", "en"]), "en-GB, en");
  assert.strictEqual(Sys.formatLanguages([]), null);
  assert.strictEqual(Sys.formatLanguages(undefined), null);
  assert.strictEqual(Sys.formatRefreshRate(59.94), "59.9 Hz");
  assert.strictEqual(Sys.formatRefreshRate(undefined), null);
});

test("each focused page leads with an answer, and says so when there is none", () => {
  const res = Sys.headline("resolution", { screen: { width: 1920, height: 1080 }, devicePixelRatio: 2 });
  assert.strictEqual(res.value, "1920 × 1080");
  assert.match(res.sub, /3840 × 2160/);

  const browser = Sys.headline("browser", { userAgent: UA.edgeWin });
  assert.strictEqual(browser.value, "Microsoft Edge 138");
  assert.match(browser.sub, /Windows 10 or 11/);
  assert.match(browser.sub, /Blink/);

  const ua = Sys.headline("user-agent", { userAgent: UA.firefoxWin });
  assert.strictEqual(ua.value, UA.firefoxWin);
  assert.match(ua.sub, /Firefox 126/);

  // The degradation path matters most here: these pages exist to print one
  // answer, so an empty headline would look like a broken page.
  for (const kind of ["resolution", "browser", "user-agent"]) {
    const none = Sys.headline(kind, {});
    assert.strictEqual(none.value, "Not available", kind);
    assert.ok(none.sub.length > 20, kind + " gave no explanation");
    assert.doesNotMatch(none.sub, /undefined|NaN/);
  }
});

test("the copy-all text is clean enough to paste into a ticket", () => {
  const env = {
    userAgent: UA.chromeWin,
    screen: { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400, colorDepth: 24 },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    hardwareConcurrency: 16,
    deviceMemory: 8,
    maxTouchPoints: 0,
    language: "en-GB",
    timeZone: "Europe/London",
    timezoneOffsetMinutes: -60,
  };
  const text = Sys.buildReportText(Sys.buildReport(env), { generatedAt: "2026-08-11T09:00:00.000Z" });

  assert.match(text, /^System information \(hardwarecheckup\.com\)/);
  assert.match(text, /Collected: 2026-08-11T09:00:00\.000Z/);
  assert.match(text, /Screen resolution: 2560 x 1440/);
  assert.match(text, /CPU cores: 16 logical processors/);
  assert.match(text, /User agent string: Mozilla\/5\.0 \(Windows NT 10\.0/);

  // The × renders beautifully on the page and turns into mojibake in plenty of
  // ticket systems, so the pasteable copy uses an ASCII x.
  assert.ok(text.indexOf("×") === -1, "the copy text should carry no × character");
  // No markup, no leftover placeholders, no runaway blank lines.
  assert.ok(text.indexOf("<") === -1 && text.indexOf("&nbsp;") === -1);
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
  assert.doesNotMatch(text, /\n{3}/);

  // Unavailable fields are still listed. "GPU: not available" is a useful line
  // in a bug report; a silently missing row is not. And each one keeps its own
  // reason, so the refresh rate does not get blamed on the browser.
  assert.match(text, /Graphics card: Not available in this browser/);
  assert.match(text, /Refresh rate: Not measured yet/);
  // And the honesty note travels with the paste, so nobody reads the absence of
  // an IP address as an oversight.
  assert.match(text, /does not include IP address/);

  // An empty environment still produces a whole, readable document.
  const empty = Sys.buildReportText(Sys.buildReport({}), {});
  assert.match(empty, /^System information/);
  assert.doesNotMatch(empty, /Collected:/);
  assert.ok(empty.split("\n").length > 20);
});

console.log("\nAll " + count + " tests passed.");
