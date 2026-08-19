"""hardwarecheckup.com navigation data — the single source of truth for the toolbar.

This is the ONLY file that differs between sites. `sync_nav.py` is generic and
copies verbatim. Nothing here is computed at runtime by the browser: sync_nav
renders it into the static HTML of every page.

Tier rule (portfolio spec, ngineer420.github.io#13): a page is tier 1 only if it
answers a *different question*. Every test on this site does — a webcam test and
a mic test are not one tool with a parameter changed — so there is no tier-2
family here, no hub link and no in-tool chips. The whole fix is the rail and the
sheet replacing a fourteen-link block that wrapped to three rows at 1280px and
opened a 506px drawer on a phone.

Hrefs keep the `.html` extension. This site has no directory twins: GitHub Pages
serves `/webcam-test.html` and nothing at `/webcam-test/`, so canonicalising to
the clean form here would 404. `canon()` in sync_nav treats both as the same
destination either way.
"""

# Noun used in the menu trigger: "All 15 tools". The count is derived from
# len(TOOLS) by sync_nav, so it follows this list on its own.
NOUN = "tools"

# Tier-1 tools, in rail order — the first eight are the chips. This is the order
# the previous header nav shipped in, which is the site's own read of its
# traffic; the rail cap is what changed, not the ranking.
#   label -> rail chip text. Terse on purpose: this site's column is 860px,
#            not the 1140px the spec sized its eight chips against, so
#            "Refresh" and "Touch" are what keep the rail from scrolling
#            on a desktop. The sheet carries the full name.
#   long  -> anchor text in the sheet and the related block
#   group -> sheet grouping, from the visitor's vocabulary, not the codebase's
TOOLS = [
    {"href": "/webcam-test.html",        "label": "Webcam",       "long": "Webcam Test",          "group": "av",      "tier": 1},
    {"href": "/mic-test.html",           "label": "Mic",          "long": "Microphone Test",      "group": "av",      "tier": 1},
    {"href": "/speaker-test.html",       "label": "Speakers",     "long": "Speaker Test",         "group": "av",      "tier": 1},
    {"href": "/keyboard-test.html",      "label": "Keyboard",     "long": "Keyboard Test",        "group": "input",   "tier": 1},
    {"href": "/mouse-test.html",         "label": "Mouse",        "long": "Mouse Test",           "group": "input",   "tier": 1},
    {"href": "/dead-pixel-test.html",    "label": "Dead Pixel",   "long": "Dead Pixel Test",      "group": "display", "tier": 1},
    {"href": "/refresh-rate-test.html",  "label": "Refresh",     "long": "Refresh Rate Test",    "group": "display", "tier": 1},
    {"href": "/touchscreen-test.html",   "label": "Touch",        "long": "Touchscreen Test",     "group": "input",   "tier": 1},
    # sheet only from here — the rail is capped at eight
    # Tier 1, not a variant of the mouse test: "how many times a second does my
    # mouse report" is a different question from "do my buttons work", it is
    # searched separately, and the two pages share no code. Sheet-only because
    # all eight rail slots are taken and none of them is worth evicting for a
    # page this new — the mouse test links to it directly instead.
    {"href": "/mouse-polling-rate-test.html", "label": None,      "long": "Mouse Polling Rate",   "group": "input",   "tier": 1},
    {"href": "/battery-test.html",       "label": None,           "long": "Battery Test",         "group": "system",  "tier": 1},
    {"href": "/color-test.html",         "label": None,           "long": "Colour Test",          "group": "display", "tier": 1},
    {"href": "/screen-resolution.html",  "label": None,           "long": "Screen Resolution",    "group": "display", "tier": 1},
    {"href": "/system-info.html",        "label": None,           "long": "System Info",          "group": "system",  "tier": 1},
    {"href": "/what-is-my-browser.html", "label": None,           "long": "What Is My Browser",   "group": "system",  "tier": 1},
    {"href": "/user-agent.html",         "label": None,           "long": "User Agent String",    "group": "system",  "tier": 1},
]

# Sheet groups, in order. Fifteen destinations is past the eight where a flat
# list stops being scannable, so the sheet renders grouped.
GROUPS = [
    ("display", "Display"),
    ("av", "Camera & sound"),
    ("input", "Input"),
    ("system", "System"),
]

# No tier-2 family on this site: every test answers a different question.
HUBS = []
VARIANTS = None

# The footer used to repeat all fourteen destinations on all fourteen pages, so
# a tool page carried twenty-eight identical links. The rail and the sheet now
# carry every one of them as a real <a href> in the served HTML, which is both
# the crawl surface and the no-JavaScript route, so the footer becomes the four
# tools that answer a question like this page's — a topical cluster rather than
# a second copy of the menu.
RELATED = {"limit": 4, "class": "footer-tools",
           "label": "Related", "aria": "Related tools"}

FOOTER = []

# One-time --migrate: what the legacy markup looked like and where the marker
# pairs go. Per-site, because the legacy markup is per-site. Ops run in order.
MIGRATE = [
    # The hamburger and the drawer it opened, both inside .header-inner. Deleted
    # rather than fixed: nothing in the new pattern auto-scrolls the document,
    # and the trigger that replaces this one is labelled, names a count, and
    # does not hide the peers the rail already shows.
    {"op": "strip", "pattern": r'\n    <button id="nav-toggle".*?\n    </nav>'},
    # Skip links were on 15 of 22 files. Adding them is part of the same sweep.
    {"op": "strip", "pattern": r'<body>\n(?!<a class="skip-link")',
     "with": '<body>\n<a class="skip-link" href="#main">Skip to content</a>\n'},
    # ...which needs a #main to skip to on the seven pages that had neither.
    {"op": "strip", "pattern": r'<main class="container-narrow"',
     "with": '<main id="main" class="container-narrow"'},
    # The toolbar is a direct child of <body>, immediately after </header>.
    {"op": "insert_after", "region": "nav", "pattern": r"</header>", "indent": ""},
    # The fourteen-link footer duplicate becomes the four-item related block.
    {"op": "replace", "region": "related", "indent": " " * 2,
     "pattern": r'  <nav class="footer-tools".*?\n  </nav>'},
]
