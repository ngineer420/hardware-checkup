/* hardwarecheckup.com — shared theme toggle + toolbar + footer year.
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
  /* ================================================================== *
   * toolbar v1 — the portfolio navigation pattern.                      *
   * Spec: github.com/ngineer420/ngineer420.github.io/issues/13          *
   *                                                                     *
   * Copied verbatim from the photoshrink pilot. Pure enhancement: with  *
   * JS off, <details>/<summary> still discloses the sheet, the rail is  *
   * still a native scroll container of real links, the edge fades are   *
   * still CSS and the scrim is still CSS. Only the active-chip          *
   * centring, Escape and click-outside are lost.                        *
   * ================================================================== */
  (function toolbar() {
    var bar = document.querySelector('.toolbar');
    if (!bar) return;
    var rail = bar.querySelector('.tb-rail');
    var menu = bar.querySelector('details.tb-menu');

    if (rail) {
      /* js-on hands the right-hand fade over to measurement. Until then the
         CSS keeps it on, so a JS-disabled visitor never gets a chip clipped
         mid-word with nothing to say there is more of the row. */
      rail.classList.add('js-on');
      var fades = function () {
        var max = rail.scrollWidth - rail.clientWidth;
        rail.classList.toggle('can-l', rail.scrollLeft > 1);
        rail.classList.toggle('can-r', rail.scrollLeft < max - 1);
      };
      /* Centre the current chip, measured from the rail's own box rather than
         through offsetLeft. The chips' offsetParent is .toolbar — the rail
         itself is not positioned — so offsetLeft carries the trigger's width
         with it, and centring on that number lands the active chip a whole
         trigger-width left of centre, half under the left fade at 320px. This
         is still a direct scrollLeft assignment and never scrollIntoView,
         which would also scroll every ancestor and the document and so drop a
         phone visitor below the header on arrival. */
      var current = rail.querySelector('[aria-current]');
      if (current) {
        var cbox = current.getBoundingClientRect();
        var rbox = rail.getBoundingClientRect();
        rail.scrollLeft += (cbox.left - rbox.left) - (rbox.width - cbox.width) / 2;
      }
      rail.addEventListener('scroll', fades, { passive: true });
      window.addEventListener('resize', fades);
      fades();
    }

    if (menu) {
      /* A disclosure, not a modal: focus is deliberately not trapped, Tab
         walks the links and straight out the other side. */
      window.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' || !menu.open) return;
        menu.open = false;
        var summary = menu.querySelector('summary');
        if (summary) summary.focus();
      });
      document.addEventListener('click', function (e) {
        if (menu.open && !menu.contains(e.target)) menu.open = false;
      });
    }
  })();

    var yr = document.getElementById("year");
    if (yr) yr.textContent = new Date().getFullYear();
  });
})();
