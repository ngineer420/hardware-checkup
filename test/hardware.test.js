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

console.log("\nAll " + count + " tests passed.");
