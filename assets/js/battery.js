/* hardwarecheckup.com — Battery Readout
   100% client-side. The Battery Status API is read locally; nothing is sent.

   This tool exists in a browser landscape where the API it depends on is
   being withdrawn: Safari has never shipped it, Firefox removed it from web
   content in 2016 over fingerprinting, and Chrome restricts it to secure
   contexts. So the unavailable path is not an afterthought here — it is the
   path most visitors on some platforms will take, and it has to explain
   itself rather than render an empty panel that looks broken. */
(function () {
  "use strict";

  /** Seconds to something a person reads at a glance. */
  function formatDuration(seconds) {
    if (seconds === Infinity || seconds === null || seconds === undefined) return "Unknown";
    if (!isFinite(seconds) || seconds < 0) return "Unknown";
    if (seconds === 0) return "—";
    var mins = Math.round(seconds / 60);
    if (mins < 60) return mins + (mins === 1 ? " minute" : " minutes");
    var hours = Math.floor(mins / 60);
    var rem = mins % 60;
    return hours + "h" + (rem ? " " + rem + "m" : "");
  }

  /**
   * What the reported level means, in words.
   *
   * Deliberately does not say "battery health". The Battery Status API reports
   * the *charge* level as a fraction of the battery's current full capacity —
   * it has no access to design capacity, cycle count, or wear. A battery worn
   * to 60% of its original capacity still reads 100% here when full. Saying so
   * matters, because "battery health" is what people search for and this API
   * cannot answer it.
   */
  function describeLevel(level, charging) {
    var pct = Math.round(level * 100);
    if (charging) {
      return pct >= 99 ? "Fully charged and on power." : "Charging — currently at " + pct + "%.";
    }
    if (pct <= 10) return "Very low — " + pct + "% remaining.";
    if (pct <= 25) return "Low — " + pct + "% remaining.";
    return "On battery — " + pct + "% remaining.";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { formatDuration: formatDuration, describeLevel: describeLevel };
  }

  if (typeof document === "undefined") return;

  /* ------------------------------ DOM wiring ------------------------------ */

  var panel = document.getElementById("battery-panel");
  if (!panel) return;
  var status = document.getElementById("status");
  var unsupported = document.getElementById("battery-unsupported");
  var fill = document.getElementById("bat-fill");
  var bolt = document.getElementById("bat-bolt");
  var pctEl = document.getElementById("bat-pct");

  var levelEl = document.getElementById("f-level");
  var chargingEl = document.getElementById("f-charging");
  var fullEl = document.getElementById("f-full");
  var emptyEl = document.getElementById("f-empty");

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "status-msg" + (kind ? " " + kind : "");
  }

  /**
   * The one path that has to be clean. Hide the readout entirely rather than
   * leaving four em-dashes that read as a broken tool, and name the reason —
   * the browser, not the machine — plus what to do instead.
   */
  function unavailable(reason) {
    panel.hidden = true;
    if (unsupported) {
      var why = document.getElementById("battery-why");
      if (why) why.textContent = reason;
      unsupported.hidden = false;
    }
    setStatus("Battery information is not available in this browser.", "error");
  }

  if (!navigator.getBattery && !navigator.battery) {
    unavailable(
      "This browser does not expose the Battery Status API. Safari has never supported it, and " +
      "Firefox removed it from web pages in 2016 because it could be used to help fingerprint " +
      "visitors. That is a deliberate privacy decision, not a fault with your device or this page."
    );
    return;
  }

  function render(bat) {
    var pct = Math.round(bat.level * 100);
    if (fill) fill.style.width = pct + "%";
    if (pctEl) pctEl.textContent = pct + "%";
    if (fill) {
      fill.classList.toggle("is-low", pct <= 20 && !bat.charging);
      fill.classList.toggle("is-charging", Boolean(bat.charging));
    }
    if (bolt) bolt.hidden = !bat.charging;

    levelEl.textContent = pct + "%";
    chargingEl.textContent = bat.charging ? "Yes — on power" : "No — on battery";
    chargingEl.classList.toggle("ok", Boolean(bat.charging));

    // The spec uses Infinity for "not charging / already full", which would
    // otherwise print as the literal string "Infinity".
    fullEl.textContent = bat.charging ? formatDuration(bat.chargingTime) : "—";
    emptyEl.textContent = bat.charging ? "—" : formatDuration(bat.dischargingTime);

    setStatus(describeLevel(bat.level, bat.charging), bat.charging || bat.level > 0.25 ? "ok" : "");
  }

  function attach(bat) {
    panel.hidden = false;
    render(bat);
    ["levelchange", "chargingchange", "chargingtimechange", "dischargingtimechange"].forEach(function (evt) {
      bat.addEventListener(evt, function () { render(bat); });
    });
  }

  try {
    var result = navigator.getBattery ? navigator.getBattery() : null;
    if (result && typeof result.then === "function") {
      result.then(attach, function () {
        // Chrome rejects on an insecure origin and in some embedded contexts.
        unavailable(
          "This browser has the Battery Status API but refused the request. That usually means the " +
          "page is not on a secure (https) connection, or it is inside a frame that is not allowed " +
          "to read battery information."
        );
      });
    } else if (navigator.battery) {
      attach(navigator.battery); // the old synchronous shape, still around on a few builds
    } else {
      unavailable("This browser does not expose the Battery Status API.");
    }
  } catch (e) {
    unavailable("This browser blocked the battery request: " + (e && e.message ? e.message : "unknown reason") + ".");
  }
})();
