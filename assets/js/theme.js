/* hardwarecheckup.com — shared theme toggle + footer year.
   Runs on every page. 100% client-side; no network, no storage of anything but the theme choice. */
(function () {
  "use strict";
  var THEME_KEY = "hwcheckup-theme";

  try {
    var stored = localStorage.getItem(THEME_KEY);
    if (stored) document.documentElement.setAttribute("data-theme", stored);
  } catch (e) {}

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", function () {
        var current =
          document.documentElement.getAttribute("data-theme") ||
          (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        var next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      });
    }
    var yr = document.getElementById("year");
    if (yr) yr.textContent = new Date().getFullYear();
  });
})();
