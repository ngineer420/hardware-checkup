/* hardwarecheckup.com — checkup history, on sch3ma.
   Off until the project below is set. While the two values end in _PENDING,
   this file does nothing: the save box and the history panel stay hidden, and
   no request goes out.

   Nothing reaches sch3ma until the visitor presses "Save to history". That
   press loads the SDK, mints an anonymous identity and creates one row in
   `checkups`. The row holds the machine name, the results map from
   `hc-checkup`, the time the run started, and whether every step has an
   answer. Each result carries its answer, its note, its measurement and the
   time the visitor recorded it. After the press, each finished step updates the
   same row. The visitor deletes a row from the history panel, and signs in with
   an email to see the history on another device.

   Loaded by /full-checkup.html and /signin.html. checkup.js also loads it on a
   step page, but only when `hc-history` holds a saved run. sch3ma is our own
   product, so keep the shapes here the shapes a customer would write.

   `hc-history` stays in this browser:
     on      true once this browser saved a checkup or signed in
     email   the address this browser signed in with, or null
     label   the last machine name, offered again on the next save
     run     the row of the run in `hc-checkup`, or null:
             { started, label, id, version, pushed }
             `started` ties the row to one run. `id` is null until the row
             exists. `pushed` is the results JSON the row last received. */
(function () {
  "use strict";

  var PROJECT = "prj_PENDING";
  var KEY = "pk_live_PENDING"; // publishable: it ships in the page by design
  var SDK = "https://sch3ma.com/sdk/1.js";
  var COLLECTION = "checkups";
  var PAGE_SIZE = 10;

  // The run itself belongs to checkup.js. In Node, the tests load it directly.
  var HC = typeof window !== "undefined" && window.HCCheckup ? window.HCCheckup
    : typeof require === "function" ? require("./checkup.js") : null;

  /** True once the project id and the key are real. */
  function configured() {
    return !/_PENDING$/.test(PROJECT) && !/_PENDING$/.test(KEY);
  }

  function codeOf(err) {
    return (err && (err.code || (err.body && err.body.code))) || "";
  }

  /* ---------------------------- the saved row ---------------------------- */

  /* Copy a saved run to its row. Resolves to { run, results }: the new link,
     and the results the row now holds.

     A link with no id creates the row. A run whose results match the last push
     sends nothing. Otherwise the update carries the version this browser last
     saw. On version_conflict (two tabs, for example) the results merge so the
     most recently recorded step result wins, and the update tries once more.
     sch3ma puts the current row in the conflict body, so the merge needs no
     second read. A body without the row falls back to a get. */
  function pushRun(db, run, local) {
    var results = local.results || {};
    if (!run.id) {
      return db.create(COLLECTION, {
        label: run.label,
        results: results,
        started: local.started,
        complete: HC.isComplete(results),
      }).then(function (row) { return linked(run, row, results); });
    }
    if (JSON.stringify(results) === run.pushed) {
      return Promise.resolve({ run: run, results: results });
    }
    return db.update(COLLECTION, run.id, { results: results, complete: HC.isComplete(results) }, { version: run.version })
      .then(function (row) { return linked(run, row, results); }, function (err) {
        if (codeOf(err) !== "version_conflict") throw err;
        var record = err.body && err.body.record;
        var current = record && record.results ? Promise.resolve(record) : db.get(COLLECTION, run.id);
        return current.then(function (row) {
          var merged = HC.mergeResults(results, row.results);
          return db.update(COLLECTION, run.id, { results: merged, complete: HC.isComplete(merged) }, { version: row.version })
            .then(function (saved) { return linked(run, saved, merged); });
        });
      });
  }

  function linked(run, row, results) {
    return {
      run: {
        started: run.started,
        label: row.label || run.label,
        id: row.id,
        version: row.version,
        pushed: JSON.stringify(results),
      },
      results: results,
    };
  }

  /* Exported for Node, so the conflict path can be tested without a browser. */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { pushRun: pushRun, configured: configured };
  }

  if (typeof document === "undefined") return;

  /* ------------------------------ the store ------------------------------ */

  var HISTORY_KEY = HC ? HC.HISTORY_KEY : null;
  var OFFLINE = "The history service is not reachable right now. Try again in a minute.";

  function readHistory() {
    var data = null;
    try { data = JSON.parse(localStorage.getItem(HISTORY_KEY)); } catch (e) { data = null; }
    if (!data || typeof data !== "object") data = {};
    return { on: !!data.on, email: data.email || null, label: data.label || "", run: data.run || null };
  }

  function writeHistory(data) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
  }

  /** The row of the run in `hc-checkup`, or null when nobody saved that run. */
  function currentRun() {
    var run = readHistory().run;
    var local = HC.load();
    return run && local.started && run.started === local.started ? run : null;
  }

  /* The SDK loads on first use, never on page load, so a visitor who never
     presses Save never contacts sch3ma. */
  var dbPromise = null;
  function client() {
    if (!dbPromise) {
      dbPromise = import(SDK).then(function (m) {
        return m.sch3ma({ project: PROJECT, key: KEY });
      }).catch(function () {
        dbPromise = null;
        return null;
      });
    }
    return dbPromise;
  }

  /* Push the local run to its row when it changed. Resolves to the history
     state and never rejects. A failed push leaves the run unpushed, and the
     next page load tries again. */
  function sync(db) {
    var hist = readHistory();
    var run = hist.run;
    var local = HC.load();
    if (!run) return Promise.resolve(hist);
    if (!local.started || run.started !== local.started) {
      // The local run is a different checkup now: cleared, or started again.
      hist.run = null;
      writeHistory(hist);
      return Promise.resolve(hist);
    }
    return pushRun(db, run, local).then(function (res) {
      var now = readHistory();
      now.run = res.run;
      writeHistory(now);
      if (res.results !== local.results) {
        // The merge brought in answers from another tab. Keep them here too.
        var fresh = HC.load();
        if (fresh.started === local.started) {
          fresh.results = HC.mergeResults(fresh.results, res.results);
          HC.save(fresh);
        }
      }
      return now;
    }, function (err) {
      var code = codeOf(err);
      var now = readHistory();
      if (code === "not_found" || code === "record_not_found") {
        // The row is gone: its owner deleted it on another device.
        now.run = null;
        writeHistory(now);
      }
      return now;
    });
  }

  /* ------------------------------- helpers ------------------------------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(className, text) {
    var node = el("button", className, text);
    node.type = "button";
    return node;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "an unknown date";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function summary(results) {
    var answered = 0;
    var problems = 0;
    for (var i = 0; i < HC.SEQUENCE.length; i++) {
      var r = results && results[HC.SEQUENCE[i].id];
      if (r) answered++;
      if (r && r.state === "fail") problems++;
    }
    return answered + " of " + HC.SEQUENCE.length + " steps" +
      (problems ? " · " + problems + " problem" + (problems === 1 ? "" : "s") : "");
  }

  /* ------------------------------ save box ------------------------------- */

  function status(text, kind) {
    var node = $("history-status");
    node.textContent = text;
    node.className = "status-msg" + (kind ? " " + kind : "");
  }

  function renderSave() {
    var run = currentRun();
    $("history-save-form").hidden = !!run;
    if (!run) {
      status("Name the machine and save. Run the checkup again another day, and the history shows what changed. Nothing is sent until you press the button.", "");
    } else if (run.id) {
      status("Saved to your history as “" + run.label + "”. Each step you finish updates it.", "ok");
    } else {
      status("This new checkup saves to your history as “" + run.label + "” when its first step opens.", "ok");
    }
    relabelStart();
  }

  function saveRun() {
    var input = $("history-label");
    var submit = $("history-save-btn");
    var label = input.value.trim().slice(0, 60);
    if (!label) {
      status("Give this machine a name first.", "error");
      input.focus();
      return;
    }
    submit.disabled = true;
    status("Saving…", "");
    var local = HC.load();
    if (!local.started) {
      // A run with no answers has no start time yet. The row needs one to belong to.
      local.started = new Date().toISOString();
      HC.save(local);
    }
    client().then(function (db) {
      if (!db) throw new Error(OFFLINE);
      var run = { started: local.started, label: label, id: null, version: null, pushed: null };
      return pushRun(db, run, local).then(function (res) {
        var hist = readHistory();
        hist.on = true;
        hist.label = label;
        hist.run = res.run;
        writeHistory(hist);
        renderSave();
        renderAccount("idle");
        return showHistory(db, res.run.id);
      });
    }).catch(function (err) {
      status(err && err.message ? err.message : "The checkup was not saved. Try again.", "error");
    }).then(function () {
      submit.disabled = false;
    });
  }

  /** A finished, saved run whose row already holds every answer. */
  function finishedAndSaved() {
    var run = currentRun();
    var local = HC.load();
    return run && run.id && HC.isComplete(local.results) && JSON.stringify(local.results) === run.pushed ? run : null;
  }

  function relabelStart() {
    var start = $("checkup-start");
    if (start && finishedAndSaved()) start.textContent = "Run it again as a new checkup";
  }

  /* A finished, saved run is a record. Running it again starts a new checkup
     of the same machine in a new row, so the old row stays to compare against.
     The link then goes on to the first step, and that page creates the row. */
  function bindStart() {
    var start = $("checkup-start");
    if (!start) return;
    start.addEventListener("click", function () {
      var run = finishedAndSaved();
      if (!run) return;
      var fresh = { v: 1, started: new Date().toISOString(), results: {} };
      HC.save(fresh);
      var hist = readHistory();
      hist.run = { started: fresh.started, label: run.label, id: null, version: null, pushed: null };
      writeHistory(hist);
    });
  }

  /* ------------------------------- account ------------------------------- */

  function renderAccount(state, note) {
    var host = $("history-account");
    var hist = readHistory();
    host.textContent = "";
    var text = el("span", "ha-text");
    host.appendChild(text);

    if (state === "form") {
      text.textContent = "Sign in with an email, and your checkup history follows you to any device.";
      var form = el("form", "ha-form");
      var input = el("input", "history-input");
      input.type = "email";
      input.required = true;
      input.autocomplete = "email";
      input.placeholder = "you@example.com";
      input.setAttribute("aria-label", "Email address");
      var send = el("button", null, "Send sign-in link");
      send.type = "submit";
      var cancel = button("hr-action", "Cancel");
      cancel.addEventListener("click", function () { renderAccount("idle"); });
      form.appendChild(input);
      form.appendChild(send);
      form.appendChild(cancel);
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        send.disabled = true;
        client().then(function (db) {
          if (!db) throw new Error(OFFLINE);
          return db.requestSignIn(input.value.trim());
        }).then(function () {
          renderAccount("sent");
        }, function (err) {
          renderAccount("form", err && err.message ? err.message : "The link was not sent. Try again in a few minutes.");
        });
      });
      host.appendChild(form);
      input.focus();
    } else if (state === "sent") {
      text.textContent = "Check your inbox. Open the link on any device, and your checkup history is there.";
    } else if (hist.email) {
      text.textContent = "Signed in as " + hist.email + ". Your history follows that email to any device.";
      var out = button("hr-action", "Sign out here");
      out.addEventListener("click", signOut);
      host.appendChild(out);
    } else if (hist.on) {
      text.textContent = "This history belongs to this browser. If you clear its data, the history is lost.";
      var keep = button("hr-action", "Keep this history on every device");
      keep.addEventListener("click", function () { renderAccount("form"); });
      host.appendChild(keep);
    } else {
      text.textContent = "Saved checkups on another device?";
      var signin = button("hr-action", "Sign in to see them");
      signin.addEventListener("click", function () { renderAccount("form"); });
      host.appendChild(signin);
    }
    if (note) host.appendChild(el("p", "ha-note", note));
  }

  function signOut() {
    client().then(function (db) {
      if (db) return db.session().then(function (s) { return s.signOut(); });
    }).catch(function () {
      /* the local state below is what this browser shows */
    }).then(function () {
      var hist = readHistory();
      writeHistory({ on: false, email: null, label: hist.label, run: null });
      $("checkup-history").hidden = true;
      $("history-list").textContent = "";
      renderSave();
      renderAccount("idle");
    });
  }

  /* Landing from a sign-in link: the code rides in the hash, and the SDK reads
     it. An anonymous identity that already saved checkups merges into the
     signed-in one, so its rows come along. Resolves to a note, or null. */
  function completeSignIn(db) {
    return db.completeSignIn().then(function (s) {
      if (s.orphan && s.orphan.mergeable) return s.merge(s.orphan.identity);
      return s;
    }).then(function (s) {
      var hist = readHistory();
      hist.on = true;
      hist.email = s.email || hist.email;
      writeHistory(hist);
      return null;
    }, function () {
      return "That sign-in link did not work. It is used or expired. Ask for a new one.";
    });
  }

  /* ------------------------------- history ------------------------------- */

  var view = { label: null, cursor: null, generation: 0 };

  /* Page two must repeat the filter and the sort exactly, so one function
     builds the options for every page. */
  function listOptions(cursor) {
    var options = { sort: "-created_at", limit: PAGE_SIZE };
    if (view.label) options.filter = { label: view.label };
    if (cursor) options.cursor = cursor;
    return options;
  }

  function showHistory(db, openId) {
    view.generation++;
    view.cursor = null;
    $("checkup-history").hidden = false;
    $("history-list").textContent = "";
    $("history-note").textContent = "";
    $("history-empty").hidden = true;
    $("history-older").onclick = function () { loadPage(db, null); };
    renderFilter(db);
    return loadPage(db, openId);
  }

  function loadPage(db, openId) {
    var generation = view.generation;
    var older = $("history-older");
    var list = $("history-list");
    older.disabled = true;
    return db.list(COLLECTION, listOptions(view.cursor)).then(function (page) {
      if (generation !== view.generation) return;
      for (var i = 0; i < page.data.length; i++) list.appendChild(historyRow(db, page.data[i]));
      view.cursor = page.has_more ? page.cursor : null;
      older.hidden = !view.cursor;
      $("history-empty").hidden = list.children.length > 0;
      for (var j = 0; openId && j < list.children.length; j++) {
        if (list.children[j].getAttribute("data-id") === openId) {
          list.children[j].querySelector(".hr-open").click();
        }
      }
    }, function () {
      $("history-note").textContent = "The history did not load. Reload the page to try again.";
    }).then(function () {
      older.disabled = false;
    });
  }

  function renderFilter(db) {
    var host = $("history-filter");
    host.textContent = "";
    host.hidden = !view.label;
    if (!view.label) return;
    host.appendChild(el("span", null, "Only “" + view.label + "”."));
    var all = button("hr-action", "Show every machine");
    all.addEventListener("click", function () {
      view.label = null;
      showHistory(db, null);
    });
    host.appendChild(all);
  }

  function historyRow(db, row) {
    var item = el("li", "history-row");
    item.setAttribute("data-id", row.id);

    var head = el("div", "hr-head");
    var open = button("hr-open");
    open.setAttribute("aria-expanded", "false");
    open.appendChild(el("span", "hr-label", row.label));
    open.appendChild(el("span", "hr-meta", formatDate(row.started || row.created_at) + " · " + summary(row.results)));
    head.appendChild(open);

    var actions = el("div", "hr-actions");
    if (!view.label) {
      var only = button("hr-action", "Only this machine");
      only.addEventListener("click", function () {
        view.label = row.label;
        showHistory(db, null);
      });
      actions.appendChild(only);
    }
    var del = button("hr-action hr-delete", "Delete");
    actions.appendChild(del);
    head.appendChild(actions);
    item.appendChild(head);

    var panel = el("div", "hr-compare");
    panel.hidden = true;
    item.appendChild(panel);

    open.addEventListener("click", function () {
      var expanded = open.getAttribute("aria-expanded") === "true";
      open.setAttribute("aria-expanded", expanded ? "false" : "true");
      panel.hidden = expanded;
      if (!expanded && !panel.hasAttribute("data-loaded")) {
        panel.setAttribute("data-loaded", "");
        compare(db, row, panel);
      }
    });

    // Two presses, so one slip of the finger does not remove a record.
    var armed = null;
    function disarm() {
      clearTimeout(armed);
      armed = null;
      del.textContent = "Delete";
      del.classList.remove("is-armed");
    }
    del.addEventListener("click", function () {
      if (!armed) {
        del.textContent = "Delete for good?";
        del.classList.add("is-armed");
        armed = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      del.disabled = true;
      db.delete(COLLECTION, row.id).then(function () {
        var hist = readHistory();
        if (hist.run && hist.run.id === row.id) {
          hist.run = null;
          writeHistory(hist);
          renderSave();
        }
        // Comparisons can point at the deleted row, so the list loads again.
        var expanded = document.querySelector("#history-list .hr-open[aria-expanded='true']");
        var keepOpen = expanded && expanded.closest(".history-row").getAttribute("data-id");
        showHistory(db, keepOpen === row.id ? null : keepOpen);
      }, function () {
        del.disabled = false;
        $("history-note").textContent = "That checkup was not deleted. Try again.";
      });
    });

    return item;
  }

  /* Compare a checkup with the checkup before it of the same machine. */
  function compare(db, row, panel) {
    panel.textContent = "";
    panel.appendChild(el("p", "hx-note", "Looking for the checkup before this one…"));
    db.list(COLLECTION, {
      filter: { label: row.label, created_at: { lt: row.created_at } },
      sort: "-created_at",
      limit: 1,
    }).then(function (page) {
      panel.textContent = "";
      var prev = page.data[0];
      if (!prev) {
        panel.appendChild(el("p", "hx-note",
          "This is the first saved checkup of “" + row.label + "”. Save the next checkup under the same name, and its changes show here."));
        return;
      }
      var when = formatDate(prev.started || prev.created_at);
      var changes = HC.compareResults(prev.results, row.results);
      if (!changes.length) {
        panel.appendChild(el("p", "hx-note", "Nothing changed since the checkup of " + when + "."));
        return;
      }
      panel.appendChild(el("p", "hx-note",
        changes.length + " step" + (changes.length === 1 ? "" : "s") + " changed since the checkup of " + when + "."));
      var list = el("ul", "hx-list");
      for (var i = 0; i < changes.length; i++) list.appendChild(changeItem(changes[i], prev, row));
      panel.appendChild(list);
    }, function () {
      panel.removeAttribute("data-loaded");
      panel.textContent = "";
      panel.appendChild(el("p", "hx-note", "The comparison did not load. Close it and try again."));
    });
  }

  var PARTS = { state: "answer", note: "note", measure: "measurement" };

  function changeItem(change, prev, row) {
    var words = [];
    for (var i = 0; i < change.changed.length; i++) words.push(PARTS[change.changed[i]]);
    var what = words.length > 1 ? words.slice(0, -1).join(", ") + " and " + words[words.length - 1] : words[0];

    var item = el("li", "hx-item");
    var head = el("p", "hx-head");
    head.appendChild(el("span", "hx-step", change.name));
    head.appendChild(el("span", "hx-what", what.charAt(0).toUpperCase() + what.slice(1) + " changed"));
    item.appendChild(head);

    var sides = el("div", "hx-sides");
    sides.appendChild(side(change.before, prev));
    sides.appendChild(side(change.after, row));
    item.appendChild(sides);
    return item;
  }

  function side(result, checkup) {
    var box = el("div", "hx-side " + (result ? "is-" + result.state : "is-none"));
    box.appendChild(el("span", "hx-date", formatDate((result && result.ts) || checkup.started || checkup.created_at)));
    box.appendChild(el("span", "hx-state", result ? HC.STATES[result.state] || result.state : "Not run"));
    if (result && result.measure) box.appendChild(el("span", "hx-detail", result.measure.label + ": " + result.measure.value));
    if (result && result.note) box.appendChild(el("span", "hx-detail", "“" + result.note + "”"));
    return box;
  }

  /* ------------------------------- the hub ------------------------------- */

  function bootHub() {
    $("history-save").hidden = false;
    var hist = readHistory();
    if (hist.label) $("history-label").value = hist.label;
    renderSave();
    renderAccount("idle");
    bindStart();

    var clear = $("checkup-clear");
    if (clear) {
      clear.addEventListener("click", function () {
        var now = readHistory();
        if (now.run) {
          now.run = null;
          writeHistory(now);
        }
        renderSave();
      });
    }

    $("history-save-form").addEventListener("submit", function (e) {
      e.preventDefault();
      saveRun();
    });

    // Nothing loads on page load unless this browser saved before, or the page
    // is the landing of a sign-in link.
    var landing = /(?:^#|&)sch3ma_code=/.test(location.hash);
    if (!landing && !hist.on) return;
    client().then(function (db) {
      if (!db) {
        status(OFFLINE, "error");
        return;
      }
      return (landing ? completeSignIn(db) : Promise.resolve(null)).then(function (note) {
        if (!readHistory().on) {
          if (note) renderAccount("idle", note);
          return;
        }
        return sync(db).then(function () {
          HC.renderHub();
          renderSave();
          renderAccount("idle", note);
          var run = currentRun();
          return showHistory(db, run && run.id);
        });
      });
    });
  }

  /* The sign-in mail links to /signin.html. That page hands the token back to
     sch3ma, which sends the visitor on to the page that asked for the link. */
  function bootSignIn() {
    function say(head, note) {
      $("signin-head").textContent = head;
      $("signin-note").textContent = note;
    }
    if (!configured()) {
      say("Nothing to sign in with", "This page finishes a sign-in link from your email.");
      return;
    }
    client().then(function (db) {
      if (!db) say("That did not work", "Ask for a new sign-in link on the Full Checkup page.");
      // handleSignInLink is true when this load is a sign-in link and the browser is already leaving.
      else if (!db.handleSignInLink()) say("Nothing to sign in with", "This page finishes a sign-in link from your email. Open the link from the email again.");
    });
  }

  /* --------------------------------- go --------------------------------- */

  if (/\/signin(\.html)?$/.test(location.pathname)) {
    if ($("signin-head")) bootSignIn();
    return;
  }
  if (!configured() || !HC) return;
  if ($("history-save")) {
    bootHub();
  } else if (readHistory().run) {
    client().then(function (db) { if (db) return sync(db); });
  }
})();
