/* hardwarecheckup.com — shared theme toggle + mobile nav + footer year.
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
    /* Mobile nav disclosure. Same pattern as perfecttune.net. If this script
       never runs, the footer tool list is still there on every page, so
       navigation never depends on JavaScript. */
    var navToggle = document.getElementById("nav-toggle");
    var nav = document.getElementById("site-nav");
    if (navToggle && nav) {
      navToggle.addEventListener("click", function () {
        var open = nav.classList.toggle("is-open");
        navToggle.setAttribute("aria-expanded", String(open));
        /* The drawer is capped at 60vh and scrolls, and the tool list is now
           long enough that the page you are on can sit below the fold of its
           own menu -- so the open drawer would show no current page at all.
           Bring it into view rather than leaving it to be hunted for. */
        if (open) {
          var current = nav.querySelector('[aria-current="page"]');
          if (current && current.scrollIntoView) {
            try { current.scrollIntoView({ block: "nearest" }); } catch (e) { current.scrollIntoView(); }
          }
        }
      });
    }

    var yr = document.getElementById("year");
    if (yr) yr.textContent = new Date().getFullYear();
  });
})();
