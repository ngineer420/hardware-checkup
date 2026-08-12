/* hardwarecheckup.com — System Information readout
   100% client-side. Every value here is read from the browser on this device;
   nothing is sent anywhere, and no network request is made to obtain any of it.

   The whole value of this page is being *correct*. Browsers are actively
   freezing and reducing the user agent string, WEBGL_debug_renderer_info is
   restricted in several contexts, and deviceMemory does not exist outside
   Chromium — so a readout that guesses is worse than one that says nothing.
   Every field in here degrades to "Not available in this browser" plus the
   reason, and no field is ever inferred from a value that does not support it.

   Structure: everything above the module guard is pure. `buildReport(env)`
   takes a plain snapshot object and returns the finished sections, which means
   the parsing, the labelling and — most importantly — the degradation paths can
   all be tested from Node without a browser. The DOM layer below only reads the
   real values into that snapshot and paints the result. */
(function () {
  "use strict";

  var NOT_AVAILABLE = "Not available in this browser";

  /* ============================ pure helpers ============================ */

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim() !== "";
  }

  function positiveInt(v) {
    return typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v) : null;
  }

  /**
   * Browser detection from the UA string, in strict order.
   *
   * Order is the entire correctness story here: Edge, Opera, Vivaldi, Yandex
   * and Samsung Internet all carry "Chrome/" in their user agent, so testing
   * for Chrome first would report every one of them as Chrome. Safari is last
   * because every WebKit-based browser carries "Safari/" too.
   *
   * Brave is deliberately absent: it ships Chrome's user agent verbatim and
   * cannot be identified from it. Reporting a Brave user as "Chrome" is the
   * honest answer to the question "what does my browser say it is".
   */
  var BROWSER_RULES = [
    { name: "Microsoft Edge", re: /Edg(?:A|iOS)?\/([0-9.]+)/ },
    { name: "Microsoft Edge (legacy)", re: /Edge\/([0-9.]+)/ },
    { name: "Opera", re: /(?:OPR|OPiOS)\/([0-9.]+)/ },
    { name: "Opera", re: /Opera[ /]([0-9.]+)/ },
    { name: "Samsung Internet", re: /SamsungBrowser\/([0-9.]+)/ },
    { name: "Vivaldi", re: /Vivaldi\/([0-9.]+)/ },
    { name: "Yandex Browser", re: /YaBrowser\/([0-9.]+)/ },
    { name: "Firefox", re: /(?:Firefox|FxiOS)\/([0-9.]+)/ },
    { name: "Chrome", re: /(?:Chrome|CriOS)\/([0-9.]+)/ },
    { name: "Safari", re: /Version\/([0-9.]+)[^)]*Safari\// },
  ];

  function browserFromUA(ua) {
    if (!isNonEmptyString(ua)) return null;
    for (var i = 0; i < BROWSER_RULES.length; i++) {
      var m = BROWSER_RULES[i].re.exec(ua);
      if (m) {
        return {
          name: BROWSER_RULES[i].name,
          version: m[1],
          major: parseInt(m[1], 10) || null,
        };
      }
    }
    return null;
  }

  /**
   * The rendering engine. On iOS this is not a matter of which browser you
   * chose: every browser on iOS is required to use the system WebKit, and
   * saying "Gecko" for Firefox on an iPhone would be plainly false.
   */
  function engineFromUA(ua) {
    if (!isNonEmptyString(ua)) return null;
    if (/(?:CriOS|FxiOS|EdgiOS|OPiOS)\//.test(ua)) return "WebKit (every browser on iOS uses the system engine)";
    if (/Edge\/[0-9]/.test(ua) && !/Edg\//.test(ua)) return "EdgeHTML";
    if (/Firefox\/[0-9]/.test(ua)) return "Gecko";
    if (/(?:Chrome|Chromium)\/[0-9]/.test(ua)) return "Blink";
    if (/AppleWebKit\//.test(ua)) return "WebKit";
    return null;
  }

  var WINDOWS_NT_NAMES = {
    "10.0": "Windows 10 or 11",
    "6.3": "Windows 8.1",
    "6.2": "Windows 8",
    "6.1": "Windows 7",
    "6.0": "Windows Vista",
    "5.1": "Windows XP",
  };

  /**
   * Operating system from the UA string.
   *
   * Two deliberate refusals to guess:
   *   - "Windows NT 10.0" is reported by Windows 10 *and* Windows 11. The UA
   *     string genuinely cannot distinguish them, so this returns "Windows 10
   *     or 11" rather than picking the likelier one and sounding certain.
   *   - macOS has reported "10_15_7" from every version since Big Sur, in both
   *     Safari and Chrome, on purpose. Printing "macOS 10.15" for a machine on
   *     macOS 26 would be a confidently wrong answer.
   * User-Agent Client Hints can resolve both, and buildReport prefers them
   * when the browser offers them.
   */
  function osFromUA(ua) {
    if (!isNonEmptyString(ua)) return null;
    var m;

    if (/Windows NT/.test(ua)) {
      m = /Windows NT ([0-9.]+)/.exec(ua);
      var nt = m ? m[1] : null;
      return {
        name: (nt && WINDOWS_NT_NAMES[nt]) || "Windows",
        version: nt,
        note: nt === "10.0"
          ? "Windows 11 identifies itself as Windows NT 10.0, exactly as Windows 10 does. The user agent string cannot tell the two apart."
          : null,
      };
    }
    if (/CrOS/.test(ua)) {
      m = /CrOS [^)]*?([0-9.]+)\)/.exec(ua);
      return { name: "ChromeOS", version: m ? m[1] : null, note: null };
    }
    if (/Android/.test(ua)) {
      m = /Android ([0-9.]+)/.exec(ua);
      return { name: m ? "Android " + m[1] : "Android", version: m ? m[1] : null, note: null };
    }
    if (/(iPhone|iPod)/.test(ua) || /iPad/.test(ua)) {
      m = /OS ([0-9_]+) like Mac OS X/.exec(ua);
      var iv = m ? m[1].replace(/_/g, ".") : null;
      var iname = /iPad/.test(ua) ? "iPadOS" : "iOS";
      return { name: iv ? iname + " " + iv : iname, version: iv, note: null };
    }
    if (/Mac OS X/.test(ua)) {
      m = /Mac OS X ([0-9_.]+)/.exec(ua);
      var mv = m ? m[1].replace(/_/g, ".") : null;
      var frozen = mv !== null && /^10\.15/.test(mv);
      return {
        name: "macOS",
        version: mv,
        note: frozen
          ? "Every macOS release since Big Sur reports itself as 10.15.7 in the user agent string, so the real version is hidden here."
          : null,
      };
    }
    if (/Macintosh/.test(ua)) return { name: "macOS", version: null, note: null };
    if (/Linux/.test(ua)) return { name: "Linux", version: null, note: null };
    return null;
  }

  function parseUserAgent(ua) {
    return {
      browser: browserFromUA(ua),
      engine: engineFromUA(ua),
      os: osFromUA(ua),
    };
  }

  /**
   * Client Hints deliberately include a fake "GREASE" brand — a randomly
   * punctuated variant of "Not A Brand" — precisely so that code which picks
   * the first entry breaks loudly instead of hard-coding an assumption. Strip
   * every non-letter and compare, because the punctuation is the part that
   * changes between releases.
   */
  function isGreaseBrand(brand) {
    if (!isNonEmptyString(brand)) return true;
    var letters = brand.toLowerCase().replace(/[^a-z]/g, "");
    return letters === "" || letters.indexOf("notabrand") !== -1;
  }

  /**
   * The brand a person would call their browser. Chromium is real but it is
   * the platform, not the product: Chrome, Edge and Opera all list it, so it
   * is only used when nothing else is offered.
   */
  function pickBrand(brands) {
    if (!brands || typeof brands.length !== "number" || !brands.length) return null;
    var real = [];
    for (var i = 0; i < brands.length; i++) {
      var b = brands[i];
      if (b && !isGreaseBrand(b.brand)) real.push(b);
    }
    if (!real.length) return null;
    var chosen = null;
    for (var j = 0; j < real.length; j++) {
      if (!/^chromium$/i.test(real[j].brand)) { chosen = real[j]; break; }
    }
    if (!chosen) chosen = real[0];
    var version = chosen.version === null || chosen.version === undefined ? null : String(chosen.version);
    return {
      name: chosen.brand,
      version: isNonEmptyString(version) ? version : null,
      major: version ? parseInt(version, 10) || null : null,
    };
  }

  /**
   * Windows versions over Client Hints, using Microsoft's published mapping.
   * Platform version 13 and above is Windows 11; 1 to 10 is Windows 10; the
   * 0.x range is 7, 8 and 8.1. 11 and 12 are not assigned to either, so they
   * report the ambiguity rather than being rounded into a version.
   */
  function windowsFromPlatformVersion(platformVersion) {
    if (!isNonEmptyString(platformVersion)) return "Windows";
    var parts = String(platformVersion).split(".");
    var major = parseInt(parts[0], 10);
    var minor = parseInt(parts[1], 10);
    if (!isFinite(major)) return "Windows";
    if (major >= 13) return "Windows 11";
    if (major >= 11) return "Windows 10 or 11";
    if (major >= 1) return "Windows 10";
    if (minor === 1) return "Windows 7";
    if (minor === 2) return "Windows 8";
    if (minor === 3) return "Windows 8.1";
    return "Windows (before 10)";
  }

  /** "14.5.0" -> "14.5", "13.0.0" -> "13". Trailing zeroes read as noise. */
  function trimVersion(version) {
    if (!isNonEmptyString(version)) return null;
    var parts = String(version).split(".");
    while (parts.length > 1 && parts[parts.length - 1] === "0") parts.pop();
    return parts.join(".");
  }

  /**
   * The OS from Client Hints, which is the only client-side source that can
   * separate Windows 10 from 11 or report a real macOS version.
   */
  function osFromClientHints(platform, platformVersion) {
    if (!isNonEmptyString(platform)) return null;
    var v = trimVersion(platformVersion);
    if (/^windows$/i.test(platform)) {
      return { name: windowsFromPlatformVersion(platformVersion), version: platformVersion || null, note: null };
    }
    if (/^mac ?os ?x?$/i.test(platform)) {
      return { name: v ? "macOS " + v : "macOS", version: v, note: null };
    }
    if (/^android$/i.test(platform)) {
      return { name: v ? "Android " + v : "Android", version: v, note: null };
    }
    if (/^chrome ?os$/i.test(platform) || /^cros$/i.test(platform)) {
      return { name: v ? "ChromeOS " + v : "ChromeOS", version: v, note: null };
    }
    if (/^linux$/i.test(platform)) {
      return { name: "Linux", version: v, note: null };
    }
    if (/^unknown$/i.test(platform)) return null;
    return { name: v ? platform + " " + v : platform, version: v, note: null };
  }

  /* ---------------------------- formatters ---------------------------- */

  /** "1920 × 1080", or null when the browser did not give two real numbers. */
  function formatDimensions(width, height) {
    var w = positiveInt(width);
    var h = positiveInt(height);
    if (w === null || h === null) return null;
    return w + " × " + h;
  }

  function formatPixelRatio(dpr) {
    if (typeof dpr !== "number" || !isFinite(dpr) || dpr <= 0) return null;
    // 2 and 1 should not print as "2.00"; 1.5 and 2.625 must keep their detail.
    var rounded = Math.round(dpr * 1000) / 1000;
    return String(rounded);
  }

  /** Physical pixels behind a CSS-pixel measurement, when the ratio is known. */
  function physicalPixels(width, height, dpr) {
    var w = positiveInt(width);
    var h = positiveInt(height);
    if (w === null || h === null) return null;
    if (typeof dpr !== "number" || !isFinite(dpr) || dpr <= 0) return null;
    return Math.round(w * dpr) + " × " + Math.round(h * dpr);
  }

  function formatColourDepth(bits) {
    var b = positiveInt(bits);
    return b === null ? null : b + "-bit";
  }

  function formatCores(n) {
    var c = positiveInt(n);
    return c === null ? null : c + (c === 1 ? " logical processor" : " logical processors");
  }

  /**
   * deviceMemory is reported in coarse steps and capped at 8, deliberately, so
   * that it cannot be used as a precise fingerprint. A 64GB workstation reads
   * "8". Saying "8 GB or more" is the true statement; saying "8 GB" is not.
   */
  function formatDeviceMemory(gb) {
    if (typeof gb !== "number" || !isFinite(gb) || gb <= 0) return null;
    if (gb >= 8) return "8 GB or more";
    return gb + " GB";
  }

  /**
   * Values every browser hands out when it is *not* telling you the GPU.
   * Reporting "WebKit WebGL" as a graphics card would be exactly the kind of
   * confident nonsense this page exists to avoid.
   */
  var MASKED_GPU_VALUES = ["", "webkit", "webkit webgl", "mozilla", "generic renderer", "unknown", "unknown renderer", "google inc."];

  function isMaskedGpuValue(value) {
    if (!isNonEmptyString(value)) return true;
    return MASKED_GPU_VALUES.indexOf(value.trim().toLowerCase()) !== -1;
  }

  /**
   * The GPU pair, or null. Both halves are checked independently because
   * Chrome reports a useful renderer with a vendor of "Google Inc. (Apple)",
   * while a locked-down context returns generic strings for both.
   */
  function describeGpu(vendor, renderer) {
    var v = isMaskedGpuValue(vendor) ? null : String(vendor).trim();
    var r = isMaskedGpuValue(renderer) ? null : String(renderer).trim();
    if (v === null && r === null) return null;
    return { vendor: v, renderer: r };
  }

  /**
   * Touch, without claiming a desktop has a touchscreen. Chrome exposes touch
   * events on machines with none, so the number of touch points is the honest
   * signal and the event support is reported as what it is.
   */
  function describeTouch(maxTouchPoints, touchEventsSupported) {
    var points = typeof maxTouchPoints === "number" && isFinite(maxTouchPoints) && maxTouchPoints >= 0
      ? Math.round(maxTouchPoints)
      : null;
    if (points === null) {
      return touchEventsSupported
        ? { supported: true, text: "Touch events are supported, but the browser does not report how many touch points" }
        : null;
    }
    if (points > 0) {
      return { supported: true, points: points, text: "Yes — up to " + points + (points === 1 ? " touch point" : " simultaneous touch points") };
    }
    return {
      supported: false,
      points: 0,
      text: touchEventsSupported
        ? "No touchscreen detected (the browser supports touch events, but reports 0 touch points)"
        : "No touchscreen detected",
    };
  }

  /** "+01:00" from the minutes-behind-UTC figure getTimezoneOffset returns. */
  function formatUtcOffset(offsetMinutes) {
    if (typeof offsetMinutes !== "number" || !isFinite(offsetMinutes)) return null;
    // getTimezoneOffset is inverted by design: UTC+1 reports -60.
    var total = -Math.round(offsetMinutes);
    var sign = total < 0 ? "-" : "+";
    var abs = Math.abs(total);
    var hh = Math.floor(abs / 60);
    var mm = abs % 60;
    return "UTC" + sign + (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
  }

  function formatLanguages(languages) {
    if (!languages || typeof languages.length !== "number" || !languages.length) return null;
    var out = [];
    for (var i = 0; i < languages.length; i++) {
      if (isNonEmptyString(languages[i])) out.push(languages[i]);
    }
    return out.length ? out.join(", ") : null;
  }

  function formatRefreshRate(hz) {
    if (typeof hz !== "number" || !isFinite(hz) || hz <= 0) return null;
    return hz.toFixed(1) + " Hz";
  }

  /* ------------------------------ the report ------------------------------ */

  /**
   * One field of the readout. A null value is not an error — it is the answer,
   * and `hint` carries the reason so the page never shows a bare blank.
   */
  function field(id, label, value, opts) {
    opts = opts || {};
    var available = value !== null && value !== undefined && value !== "";
    // A field that is missing because nobody has pressed a button yet is not
    // the same as one the browser refuses to provide, and saying "not available
    // in this browser" for the first would be its own small lie.
    var missingText = isNonEmptyString(opts.unavailable) ? opts.unavailable : NOT_AVAILABLE;
    return {
      id: id,
      label: label,
      value: available ? String(value) : missingText,
      available: available,
      note: available ? (opts.note || null) : null,
      hint: available ? null : (opts.hint || null),
    };
  }

  /**
   * Resolve the browser name and version, preferring Client Hints because the
   * UA string is being frozen and reduced by the browsers themselves.
   */
  function resolveBrowser(env) {
    var hints = env.userAgentData || null;
    var high = env.highEntropyValues || null;
    var brand = pickBrand(hints && hints.brands);
    var fullBrand = pickBrand(high && high.fullVersionList);
    var parsed = browserFromUA(env.userAgent);

    if (brand) {
      var version = (fullBrand && fullBrand.version) ||
        (isNonEmptyString(high && high.uaFullVersion) ? high.uaFullVersion : null) ||
        brand.version;
      return {
        name: brand.name,
        version: version,
        major: parseInt(version, 10) || brand.major,
        source: "client hints",
      };
    }
    if (parsed) {
      return { name: parsed.name, version: parsed.version, major: parsed.major, source: "user agent" };
    }
    return null;
  }

  function resolveOs(env) {
    var hints = env.userAgentData || null;
    var high = env.highEntropyValues || null;
    var fromHints = osFromClientHints(hints && hints.platform, high && high.platformVersion);
    // The platform alone (no version yet) is still better than nothing, but it
    // is not better than a UA string that carries a version.
    if (fromHints && (fromHints.version || !osFromUA(env.userAgent))) return fromHints;
    return osFromUA(env.userAgent) || fromHints;
  }

  /**
   * The whole readout, as ordered sections of fields. Takes a plain snapshot
   * so that every branch — including every "not available" path — is reachable
   * from a test without a browser.
   */
  function buildReport(env) {
    env = env || {};
    var screenInfo = env.screen || {};
    var dpr = env.devicePixelRatio;
    var browser = resolveBrowser(env);
    var os = resolveOs(env);
    var engine = engineFromUA(env.userAgent);
    var gpu = describeGpu(env.gpuVendor, env.gpuRenderer);
    var touch = describeTouch(env.maxTouchPoints, env.touchEventsSupported);

    var screenLogical = formatDimensions(screenInfo.width, screenInfo.height);
    var screenPhysical = physicalPixels(screenInfo.width, screenInfo.height, dpr);

    // An iPad in "Request Desktop Website" mode sends a Mac user agent, and no
    // string in it says otherwise. Ten touch points on a "Mac" is the tell, and
    // flagging it as a possibility is more useful than reporting a desktop.
    var looksLikeDesktopModeTablet = !!(os && /^macOS/.test(os.name) && touch && touch.points > 1);

    // Both things can be true of the same machine — a frozen macOS version and
    // an iPad wearing it — so they are joined rather than one shadowing the
    // other. That shadowing is a real bug: the iPad warning is the more useful
    // of the two and it is the one that would have been dropped.
    var osNotes = [];
    if (os && os.note) osNotes.push(os.note);
    if (looksLikeDesktopModeTablet) {
      osNotes.push("An iPad with “Request Desktop Website” turned on sends the same user agent as a Mac. The touch points reported below suggest that may be what this is.");
    }

    var displayFields = [
      field("resolution", "Screen resolution", screenLogical, {
        note: "In CSS pixels — the figure your operating system's display settings usually call the resolution.",
        hint: "This browser did not report a screen size.",
      }),
      field("physical", "Physical pixels", screenPhysical, {
        note: "Calculated from the reported size and the pixel ratio. On a display running at a scaled resolution this can differ from the panel's native pixel count.",
        hint: "Needs both a screen size and a device pixel ratio, and one of them is missing.",
      }),
      field("available", "Available screen area", formatDimensions(screenInfo.availWidth, screenInfo.availHeight), {
        note: "The screen minus space the system keeps for itself, such as a taskbar, dock or menu bar.",
      }),
      field("pixel-ratio", "Device pixel ratio", formatPixelRatio(dpr), {
        note: "How many physical pixels the display uses for one CSS pixel. 1 is a standard display, 2 is a Retina or HiDPI display.",
      }),
      field("viewport", "Browser window (viewport)", formatDimensions(env.innerWidth, env.innerHeight), {
        note: "The visible page area in CSS pixels. Resize the window and this updates.",
      }),
      field("viewport-physical", "Viewport in physical pixels", physicalPixels(env.innerWidth, env.innerHeight, dpr)),
      field("colour-depth", "Colour depth", formatColourDepth(screenInfo.colorDepth), {
        note: "Bits used for one pixel across all channels. 24-bit is 8 bits each of red, green and blue.",
      }),
      field("refresh-rate", "Refresh rate", formatRefreshRate(env.refreshRateHz), {
        note: "Measured from real frame timings on this page.",
        unavailable: "Not measured yet",
        hint: "The only figure here that has to be measured rather than read. Press “Measure refresh rate” on this page; it takes five seconds.",
      }),
    ];

    var systemFields = [
      field("os", "Operating system", os && os.name, {
        note: osNotes.length ? osNotes.join(" ") : null,
        hint: "The user agent string does not identify an operating system this browser knows about.",
      }),
      field("browser", "Browser", browser && (browser.major ? browser.name + " " + browser.major : browser.name), {
        note: browser && browser.source === "client hints"
          ? "Reported through User-Agent Client Hints, which browsers keep accurate as the old user agent string is frozen."
          : "Read from the user agent string. Browsers are steadily reducing what that string contains.",
        hint: "This browser's user agent does not match any browser this page knows how to name, and it does not offer Client Hints.",
      }),
      field("browser-version", "Full browser version", browser && browser.version, {
        note: "Chrome-based browsers zero out the minor version in the user agent string, so a version like 138.0.0.0 is expected there.",
      }),
      field("engine", "Rendering engine", engine, {
        hint: "The user agent string does not name a recognisable engine.",
      }),
      field("cores", "CPU cores", formatCores(env.hardwareConcurrency), {
        note: "Logical processors, so a 6-core CPU with hyper-threading normally reports 12. Some browsers cap or round this figure to make it less identifying.",
        hint: "This browser does not expose navigator.hardwareConcurrency.",
      }),
      field("memory", "Device memory", formatDeviceMemory(env.deviceMemory), {
        note: "Reported in coarse steps and capped at 8 GB on purpose, so a machine with 32 GB also reads “8 GB or more”.",
        hint: "Only Chromium-based browsers expose navigator.deviceMemory. Safari and Firefox do not, so there is no figure to show here.",
      }),
      field("gpu", "Graphics card", gpu && gpu.renderer, {
        note: "Read through the WebGL debug renderer extension.",
        hint: "This browser does not hand out the real GPU name. The WEBGL_debug_renderer_info extension is blocked or masked here, which Firefox does by default and other browsers do in private or embedded contexts.",
      }),
      field("gpu-vendor", "Graphics vendor", gpu && gpu.vendor),
      field("touch", "Touch support", touch && touch.text, {
        hint: "This browser does not report touch capability.",
      }),
      field("max-touch-points", "Maximum touch points", touch && typeof touch.points === "number" ? String(touch.points) : null),
    ];

    var localeFields = [
      field("language", "Language", isNonEmptyString(env.language) ? env.language : null, {
        note: "The language this browser asks websites for.",
      }),
      field("languages", "Accepted languages", formatLanguages(env.languages)),
      field("timezone", "Time zone", isNonEmptyString(env.timeZone) ? env.timeZone : null, {
        note: "Your device's own time zone setting, read locally. It is not a location lookup.",
        hint: "This browser does not report a named time zone.",
      }),
      field("utc-offset", "UTC offset", formatUtcOffset(env.timezoneOffsetMinutes)),
    ];

    var rawFields = [
      field("user-agent", "User agent string", isNonEmptyString(env.userAgent) ? env.userAgent : null, {
        hint: "This browser did not provide a user agent string.",
      }),
    ];

    return [
      { id: "display", title: "Display and screen", fields: displayFields },
      { id: "system", title: "System, browser and hardware", fields: systemFields },
      { id: "locale", title: "Language and time", fields: localeFields },
      { id: "raw", title: "Raw user agent", fields: rawFields },
    ];
  }

  /** Every field in the report, flattened, for lookups by id. */
  function fieldsById(sections) {
    var map = {};
    for (var i = 0; i < sections.length; i++) {
      for (var j = 0; j < sections[i].fields.length; j++) {
        map[sections[i].fields[j].id] = sections[i].fields[j];
      }
    }
    return map;
  }

  /**
   * The one-line answer each focused page leads with, and the sentence under
   * it. Returns "Not available" rather than an empty headline, because a page
   * whose entire job is to print one number must still say something true when
   * it cannot get that number.
   */
  function headline(kind, env) {
    var sections = buildReport(env);
    var f = fieldsById(sections);
    var browser = resolveBrowser(env || {});
    var os = resolveOs(env || {});

    if (kind === "resolution") {
      if (!f.resolution.available) {
        return {
          value: "Not available",
          sub: "This browser did not report a screen size, which is unusual — it normally means the page is running somewhere with the screen API restricted.",
        };
      }
      var sub = "That is what your screen reports in CSS pixels.";
      if (f["pixel-ratio"].available && f.physical.available) {
        sub += " At a device pixel ratio of " + f["pixel-ratio"].value + ", the panel itself is about " +
          f.physical.value + " physical pixels.";
      }
      return { value: f.resolution.value, sub: sub };
    }

    if (kind === "browser") {
      if (!browser) {
        return {
          value: "Not available",
          sub: "This browser's user agent does not match anything this page can name with confidence, and it does not offer Client Hints. Rather than guess, it says nothing.",
        };
      }
      var name = browser.major ? browser.name + " " + browser.major : browser.name;
      var parts = [];
      if (os && os.name) parts.push("on " + os.name);
      if (f.engine.available) parts.push("using the " + f.engine.value + " engine");
      return { value: name, sub: parts.length ? parts.join(", ") + "." : "Reported by your browser." };
    }

    if (kind === "user-agent") {
      if (!f["user-agent"].available) {
        return { value: "Not available", sub: "This browser did not provide a user agent string at all." };
      }
      var who = [];
      if (browser) who.push(browser.major ? browser.name + " " + browser.major : browser.name);
      if (os && os.name) who.push(os.name);
      return {
        value: f["user-agent"].value,
        sub: who.length ? "Which this page reads as " + who.join(" on ") + "." : "This page cannot confidently identify a browser from that string.",
      };
    }

    return { value: "Not available", sub: "" };
  }

  /**
   * The copy-all text. This is most of the point of the page: people paste it
   * into support tickets and forum posts, so it has to survive a plain-text
   * box — no box drawing, no alignment that falls apart when the font changes,
   * and an ASCII "x" instead of the × the page displays, because plenty of
   * ticket systems and terminals still mangle it.
   *
   * Unavailable fields are printed too, not dropped: "deviceMemory: not
   * available" is a genuinely useful line in a bug report.
   */
  function buildReportText(sections, meta) {
    meta = meta || {};
    var lines = [];
    lines.push("System information (hardwarecheckup.com)");
    if (isNonEmptyString(meta.generatedAt)) lines.push("Collected: " + meta.generatedAt);
    lines.push("");

    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      lines.push(section.title);
      lines.push(new Array(section.title.length + 1).join("-"));
      for (var j = 0; j < section.fields.length; j++) {
        var fl = section.fields[j];
        lines.push(fl.label + ": " + fl.value);
      }
      lines.push("");
    }

    lines.push("Reported by the browser on this device. It does not include IP address,");
    lines.push("internet provider or location, none of which a web page can read locally.");

    return lines.join("\n").replace(/×/g, "x");
  }

  /* Exported for Node so the parsing, labelling and degradation paths can be
     tested without a browser. */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      NOT_AVAILABLE: NOT_AVAILABLE,
      parseUserAgent: parseUserAgent,
      browserFromUA: browserFromUA,
      engineFromUA: engineFromUA,
      osFromUA: osFromUA,
      osFromClientHints: osFromClientHints,
      windowsFromPlatformVersion: windowsFromPlatformVersion,
      trimVersion: trimVersion,
      isGreaseBrand: isGreaseBrand,
      pickBrand: pickBrand,
      formatDimensions: formatDimensions,
      formatPixelRatio: formatPixelRatio,
      physicalPixels: physicalPixels,
      formatColourDepth: formatColourDepth,
      formatCores: formatCores,
      formatDeviceMemory: formatDeviceMemory,
      isMaskedGpuValue: isMaskedGpuValue,
      describeGpu: describeGpu,
      describeTouch: describeTouch,
      formatUtcOffset: formatUtcOffset,
      formatLanguages: formatLanguages,
      formatRefreshRate: formatRefreshRate,
      buildReport: buildReport,
      fieldsById: fieldsById,
      headline: headline,
      buildReportText: buildReportText,
    };
  }

  if (typeof document === "undefined") return;

  /* ------------------------------ DOM wiring ------------------------------ */

  var reportHost = document.querySelector("[data-si-report]");
  var fieldHosts = document.querySelectorAll("[data-si-fields]");
  var bigHosts = document.querySelectorAll("[data-si-big]");
  if (!reportHost && !fieldHosts.length && !bigHosts.length) return;

  /* The GPU query is read once and cached. Each call creates a WebGL context,
     and re-running it on every window resize would leak contexts until the
     browser starts dropping them. */
  var gpuReading = null;

  function readGpu() {
    if (gpuReading) return gpuReading;
    gpuReading = { vendor: null, renderer: null };
    try {
      var canvas = document.createElement("canvas");
      var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        var ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          gpuReading.vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
          gpuReading.renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        }
        var lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
    } catch (e) {
      // Blocked contexts throw rather than returning null in some builds.
      gpuReading = { vendor: null, renderer: null };
    }
    return gpuReading;
  }

  var highEntropyValues = null;

  function readEnvironment() {
    var gpu = readGpu();
    var timeZone = null;
    try {
      if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      }
    } catch (e) { timeZone = null; }

    var hzText = document.getElementById("f-hz");
    var measuredHz = null;
    if (hzText) {
      var parsedHz = parseFloat(hzText.textContent);
      if (isFinite(parsedHz) && parsedHz > 0) measuredHz = parsedHz;
    }

    return {
      userAgent: navigator.userAgent,
      userAgentData: navigator.userAgentData || null,
      highEntropyValues: highEntropyValues,
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
      },
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
      touchEventsSupported: "ontouchstart" in window || (window.TouchEvent !== undefined),
      language: navigator.language,
      languages: navigator.languages,
      timeZone: timeZone,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      gpuVendor: gpu.vendor,
      gpuRenderer: gpu.renderer,
      refreshRateHz: measuredHz,
    };
  }

  function makeRow(f) {
    var row = document.createElement("div");
    row.className = "si-row" + (f.available ? "" : " is-unavailable");

    var label = document.createElement("span");
    label.className = "si-label";
    label.textContent = f.label;

    var body = document.createElement("span");
    body.className = "si-body";

    var value = document.createElement("span");
    value.className = "si-value";
    value.textContent = f.value;
    body.appendChild(value);

    var extra = f.hint || f.note;
    if (extra) {
      var note = document.createElement("span");
      note.className = "si-note";
      note.textContent = extra;
      body.appendChild(note);
    }

    row.appendChild(label);
    row.appendChild(body);
    return row;
  }

  function renderReport(host, sections) {
    host.textContent = "";
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var wrap = document.createElement("section");
      wrap.className = "si-section";

      var h = document.createElement("h2");
      h.textContent = section.title;
      wrap.appendChild(h);

      var rows = document.createElement("div");
      rows.className = "si-rows";
      for (var j = 0; j < section.fields.length; j++) {
        rows.appendChild(makeRow(section.fields[j]));
      }
      wrap.appendChild(rows);
      host.appendChild(wrap);
    }
  }

  function renderPickedFields(host, byId) {
    var wanted = String(host.getAttribute("data-si-fields") || "").split(",");
    host.textContent = "";
    var rows = document.createElement("div");
    rows.className = "si-rows";
    for (var i = 0; i < wanted.length; i++) {
      var id = wanted[i].trim();
      if (id && byId[id]) rows.appendChild(makeRow(byId[id]));
    }
    host.appendChild(rows);
  }

  var lastText = "";
  var lastFields = {};

  function render() {
    var env = readEnvironment();
    var sections = buildReport(env);
    var byId = fieldsById(sections);
    lastFields = byId;

    if (reportHost) renderReport(reportHost, sections);
    for (var i = 0; i < fieldHosts.length; i++) renderPickedFields(fieldHosts[i], byId);

    for (var j = 0; j < bigHosts.length; j++) {
      var host = bigHosts[j];
      var answer = headline(host.getAttribute("data-si-big"), env);
      var valueEl = host.querySelector("[data-si-big-value]");
      var subEl = host.querySelector("[data-si-big-sub]");
      if (valueEl) valueEl.textContent = answer.value;
      if (subEl) subEl.textContent = answer.sub;
      host.classList.toggle("is-unavailable", answer.value === "Not available");
    }

    lastText = buildReportText(sections, { generatedAt: new Date().toISOString() });
    var textArea = document.getElementById("si-text");
    if (textArea) textArea.value = lastText;
  }

  /* Client Hints arrive asynchronously. Paint what is already known first, then
     upgrade — a page that waits on a promise before showing anything looks
     broken on the browsers that will never resolve it. */
  function requestHighEntropy() {
    var uaData = navigator.userAgentData;
    if (!uaData || typeof uaData.getHighEntropyValues !== "function") return;
    try {
      uaData.getHighEntropyValues(["platformVersion", "fullVersionList", "uaFullVersion", "architecture", "bitness", "model"])
        .then(function (values) {
          highEntropyValues = values;
          render();
        })
        .catch(function () { /* Permissions-Policy can refuse these; keep the UA reading. */ });
    } catch (e) { /* older implementations throw on unknown hints */ }
  }

  /* ------------------------------ copy button ------------------------------ */

  var copyBtn = document.getElementById("copy-btn");
  var copyStatus = document.getElementById("copy-status");
  var textArea = document.getElementById("si-text");

  function setCopyStatus(msg, kind) {
    if (!copyStatus) return;
    copyStatus.textContent = msg;
    copyStatus.className = "status-msg" + (kind ? " " + kind : "");
  }

  var showTextBtn = document.getElementById("show-text-btn");

  /* One place decides whether the box is showing, so the button label cannot
     drift out of step with it — which it does the moment the clipboard failure
     path reveals the box on its own. */
  function setTextVisible(visible) {
    if (!textArea) return;
    textArea.hidden = !visible;
    if (showTextBtn) showTextBtn.textContent = visible ? "Hide text" : "Show as text";
  }

  function fallbackCopy(text) {
    if (!textArea) return false;
    setTextVisible(true);
    textArea.focus();
    textArea.select();
    try {
      return document.execCommand("copy");
    } catch (e) {
      return false;
    }
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      render(); // copy exactly what is on screen right now, including the viewport size
      var text = lastText;
      var done = function () {
        setCopyStatus("Copied. Paste it wherever you need it — it is plain text.", "ok");
      };
      var failed = function () {
        if (fallbackCopy(text)) { done(); return; }
        setTextVisible(true);
        setCopyStatus("This browser blocked the clipboard. The full text is in the box below — select it and copy manually.", "error");
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, failed);
      } else {
        failed();
      }
    });
  }

  /* Copy one field rather than the whole report — the user agent page exists
     because somebody was asked to paste their user agent somewhere, and
     selecting a wrapped 130-character string by hand on a phone is miserable. */
  var singleCopyButtons = document.querySelectorAll("[data-si-copy]");
  for (var s = 0; s < singleCopyButtons.length; s++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var target = lastFields[btn.getAttribute("data-si-copy")];
        if (!target || !target.available) {
          setCopyStatus("There is nothing to copy — this browser did not provide that value.", "error");
          return;
        }
        var ok = function () { setCopyStatus("Copied.", "ok"); };
        var no = function () { setCopyStatus("This browser blocked the clipboard. Select the text above and copy it manually.", "error"); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(target.value).then(ok, no);
        } else {
          no();
        }
      });
    })(singleCopyButtons[s]);
  }

  if (showTextBtn && textArea) {
    showTextBtn.addEventListener("click", function () {
      var showing = textArea.hidden;
      setTextVisible(showing);
      if (showing) textArea.select();
    });
  }

  /* ------------------------------ live values ------------------------------ */

  var resizePending = false;
  window.addEventListener("resize", function () {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(function () {
      resizePending = false;
      render();
    });
  });

  /* The refresh rate is measured by refreshrate.js, which owns that panel and
     emits no event. Watching its output cell is cheaper and less brittle than
     polling, and it means the row in the table below stops saying "not
     measured yet" the moment the five-second run finishes. */
  var hzCell = document.getElementById("f-hz");
  if (hzCell && typeof MutationObserver === "function") {
    new MutationObserver(function () { render(); })
      .observe(hzCell, { childList: true, characterData: true, subtree: true });
  }

  /* Moving a window between a Retina and a non-Retina display changes the
     pixel ratio without firing a resize on every browser, so watch for it. */
  if (window.matchMedia) {
    try {
      var mq = matchMedia("(resolution: " + window.devicePixelRatio + "dppx)");
      var onChange = function () { render(); };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (e) { /* the resolution media feature is not everywhere */ }
  }

  render();
  requestHighEntropy();
})();
