#!/usr/bin/env node
/* One-time project setup on sch3ma. Run it by hand with the project's secret key:

     SCH3MA_PROJECT=prj_… SCH3MA_SECRET=sk_live_… node tools/sch3ma_setup.mjs

   It is safe to run again. A collection PUT creates a collection and never replaces one,
   so a second run reports `checkups: exists` and goes on. Every run rewrites the origins
   and the identity settings below.

   One collection. `checkups` holds one row for each checkup a visitor saves: the machine
   name, the results map from `hc-checkup`, the time the run started, and whether every
   step has an answer. The owner alone reads, updates and deletes a row. A visitor with an
   identity creates one, and the first "Save to history" press mints that identity.

   It also sets the sign-in mail: the sender name, the wording and the link. The link
   points at /signin.html, so a person who opens the mail sees hardwarecheckup.com.

   After the run, put the project id and the publishable key in assets/js/sch3ma.js. They
   are the only two placeholders on the site. */

const project = process.env.SCH3MA_PROJECT;
const secret = process.env.SCH3MA_SECRET;
if (!project || !secret) {
  console.error("Set SCH3MA_PROJECT and SCH3MA_SECRET.");
  process.exit(1);
}
const base = `https://admin.sch3ma.com/${project}`;

const CHECKUPS = {
  prefix: "chk",
  rules: { read: "owner:visitor", create: "authenticated", update: "owner:visitor", delete: "owner:visitor" },
  fields: {
    label: { type: "text", required: true, maxLength: 60 },
    // The `hc-checkup` results map: { testId: { state, note, ts, measure } }. Nine short
    // entries, far below the 128 KB a json field holds.
    results: { type: "json", required: true },
    started: { type: "timestamp" },
    complete: { type: "boolean", default: false },
    // The owner. sch3ma fills it with the caller's identity on create.
    visitor: { type: "reference", to: "users" },
  },
};
const ORIGINS = ["https://hardwarecheckup.com"];
const IDENTITY = {
  anonymous: true,
  on_email_conflict: "signin",
  landing_url: "https://hardwarecheckup.com/full-checkup.html",
  // The name needs no DNS work: the address stays sch3ma's own. The site has no support
  // inbox, so reply_to stays null.
  sender: { name: "Hardware Checkup", reply_to: null },
  // Copy, never markup: sch3ma escapes every value into the message.
  template: {
    product: "Hardware Checkup",
    subject: "Your Hardware Checkup sign-in link",
    activation_subject: "Confirm your email for Hardware Checkup",
    body: "Open this link to sign in and see your checkup history on this device. It works once and expires in an hour.",
    activation_body: "Open this link to confirm your email and keep your checkup history on every device. It works once and is good for seven days.",
    button: "Sign in to Hardware Checkup",
    color: "#0d8f81",
    logo_url: null,
  },
  // The token rides the URL fragment. A browser never sends a fragment to a server, so the
  // token reaches only the host that issued it.
  callback_url: "https://hardwarecheckup.com/signin.html",
};

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

// The two-call rule: the first call answers with a report and a token, the second commits.
async function twoCall(method, path, body, made) {
  const first = made ?? (await call(method, path, body));
  if (first.status === 201) return first;
  if (first.status !== 200 || !first.json || !first.json.report) throw new Error(`${method} ${path}: ${first.status} ${first.text}`);
  const second = await call(method, `${path}?_confirm=${encodeURIComponent(first.json.report.confirm_token)}`, body);
  if (second.status !== 200) throw new Error(`${method} ${path} (confirm): ${second.status} ${second.text}`);
  return second;
}

// A 409 collection_exists is the collection already where this script wants it.
const first = await call("PUT", "/_schemas/checkups", CHECKUPS);
if (first.status === 409 && first.json?.error?.code === "collection_exists") {
  console.log("checkups: exists");
} else {
  console.log(`checkups: ${(await twoCall("PUT", "/_schemas/checkups", CHECKUPS, first)).status}`);
}
console.log(`origins: ${(await twoCall("PUT", "/_origins", { origins: ORIGINS })).status}`);
const identity = await call("PATCH", "/_identity", IDENTITY);
console.log(`identity: ${identity.status} ${identity.text}`);
