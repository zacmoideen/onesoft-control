// OneSoft Licence Control – zac's private app to manage customers' licences (central switches in Firebase "onesoft-licence").
// Each customer app reads its own record customers/{licenceId} and obeys: status "blocked", until ("YYYY-MM-DD" | "lifetime"),
// trialStart (ISO) and trialDays. Customer apps report: name, app, platform, lastVersion, lastSeen, quotes, appState, appUntil.
(function () {
  "use strict";
  const OWNER = "onesoft.zac@gmail.com";
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAY = 86400000;
  const ls = { get: k => { try { return JSON.parse(localStorage.getItem("lc." + k)); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem("lc." + k, JSON.stringify(v)); } catch (e) {} } };
  const C = MawkebCloud.createClient({ get: async k => ls.get(k), set: async (k, v) => ls.set(k, v) });
  let LIST = [], LOCKED = true;
  const APPV = String(window.APP_VERSION || "");
  const osFooter = () => '<div class="os"><b><svg width="16" height="16" viewBox="0 0 88 88" aria-hidden="true"><rect x="6" y="6" width="36" height="36" rx="12" fill="#1f4e9c"/><rect x="46" y="6" width="36" height="36" rx="18" fill="#c9d7f2"/><rect x="6" y="46" width="36" height="36" rx="18" fill="#c9d7f2"/><rect x="46" y="46" width="36" height="36" rx="12" fill="#f28c28"/></svg> OneSoft</b><small>Powered by Zac' + (APPV ? " · v" + esc(APPV) : "") + '</small></div>';
  // Face ID (native plugin @capgo/capacitor-native-biometric); the PIN always works as well
  const BIO = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeBiometric;
  async function bioReady() { if (!BIO || ls.get("faceid") === false) return false; try { const r = await BIO.isAvailable(); return !!(r && r.isAvailable); } catch (e) { return false; } }
  async function bioUnlock() {
    try { await BIO.verifyIdentity({ reason: "Unlock Licence Control", title: "Licence Control" }); ls.set("pinTries", 0); LOCKED = false; listScreen(); return true; }
    catch (e) { return false; }
  }

  function toast(t, ms) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), ms || 2500); }
  function head(title, sub, btn) { $("#ttl").innerHTML = esc(title) + "<small>" + esc(sub || "") + "</small>"; $("#hbtn").innerHTML = btn || ""; }
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtD = s => { if (!s) return ""; if (String(s).toLowerCase() === "lifetime") return "Lifetime"; const d = new Date(String(s).length === 10 ? s + "T00:00:00Z" : s); return isNaN(d) ? String(s) : String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + d.getUTCFullYear(); };
  function ago(iso) {
    const t = Date.parse(iso || ""); if (!t) return "never";
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 2) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 36) return h + " h ago"; return Math.round(h / 24) + " days ago";
  }
  // what the customer's app shows, as far as zac's switches go (the app also has its own key and trial)
  function state(c) {
    if (String(c.status || "").toLowerCase() === "blocked") return { cls: "bad", text: "Blocked" };
    if (String(c.until || "").toLowerCase() === "lifetime") return { cls: "ok", text: "Lifetime" };
    if (c.until) { const end = Date.parse(c.until + "T23:59:59Z"), left = Math.ceil((end - Date.now()) / DAY);
      if (left > 0) return { cls: left <= 15 ? "tr" : "ok", text: "Until " + fmtD(c.until) + (left <= 15 ? " (" + left + "d)" : "") }; }
    const rep = { trial: ["tr", "Trial"], licensed: ["ok", "Licensed"], expired: ["bad", "Expired"], trialEnded: ["bad", "Trial ended"], blocked: ["bad", "Blocked"] }[c.appState];
    if (rep) return { cls: rep[0], text: rep[1] + (c.appUntil ? " · " + c.appUntil : "") };
    if (c.until) return { cls: "bad", text: "Ended " + fmtD(c.until) };
    return { cls: "na", text: "No report yet" };
  }

  // ---------- sign in ----------
  function loginScreen(msg) {
    head("Licence Control", "OneSoft", "");
    $("#main").innerHTML = '<div class="card"><h3>Sign in</h3><p class="muted" style="margin:0 0 6px">Only ' + esc(OWNER) + ' can manage licences.</p>' +
      '<label>Email</label><input id="l_mail" type="email" autocapitalize="off" autocorrect="off" value="' + esc(OWNER) + '">' +
      '<label>Password</label><input id="l_pw" type="password">' +
      '<div class="err" id="l_err">' + esc(msg || "") + '</div><div class="row" style="margin-top:8px"><button class="p" id="l_in">Sign in</button></div>' +
      '<p class="muted" style="margin-top:14px">First time on this account? <button class="link" id="l_up">Create the login</button></p>' +
      '<p class="muted"><button class="link" id="l_reset">Forgot password</button></p></div>' + osFooter();
    const go = async up => {
      const mail = $("#l_mail").value.trim(), pw = $("#l_pw").value; $("#l_err").textContent = "";
      if (mail.toLowerCase() !== OWNER) return $("#l_err").textContent = "This app is only for " + OWNER + ".";
      try { up ? await C.signUp(mail, pw) : await C.signIn(mail, pw); LOCKED = false; ls.get("pin") ? listScreen() : pinScreen("set"); }
      catch (e) { $("#l_err").textContent = e.message; }
    };
    $("#l_in").onclick = () => go(false); $("#l_up").onclick = () => go(true);
    $("#l_reset").onclick = async () => { try { await C.resetPassword($("#l_mail").value); toast("Password reset email sent."); } catch (e) { $("#l_err").textContent = e.message; } };
  }

  // ---------- PIN lock (6 digits, stored only as a hash on this phone) ----------
  async function hash(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("onesoft:" + s)); return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join(""); }
  function pinScreen(mode, first) {
    // mode: "set" (new PIN), "confirm" (repeat), "unlock"
    head("Licence Control", mode === "unlock" ? "Enter your PIN" : mode === "set" ? "Choose a 6-digit PIN" : "Repeat the PIN", "");
    let v = "";
    $("#main").innerHTML = '<div class="pin" id="dots">' + "<i></i>".repeat(6) + '</div><div class="err center" id="p_err"></div><div class="pad">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map(k => k === "" ? "<span></span>" : '<button data-k="' + k + '">' + k + "</button>").join("") + "</div>" +
      (mode === "unlock" ? '<p class="center"><button class="link" id="p_bio" hidden>Use Face ID</button></p><p class="center"><button class="link" id="p_out">Forgot PIN – sign in again</button></p>' : "") + osFooter();
    if (mode === "unlock") bioReady().then(ok => { if (!ok || !$("#p_bio")) return; $("#p_bio").hidden = false; $("#p_bio").onclick = bioUnlock; if (!document.hidden) bioUnlock(); });
    const dots = () => $("#dots").querySelectorAll("i").forEach((d, i) => d.className = i < v.length ? "f" : "");
    $("#main").querySelectorAll(".pad button").forEach(b => b.onclick = async () => {
      const k = b.dataset.k; if (k === "⌫") v = v.slice(0, -1); else if (v.length < 6) v += k; dots();
      if (v.length < 6) return;
      if (mode === "set") return pinScreen("confirm", v);
      if (mode === "confirm") { if (v !== first) return pinScreen("set"), toast("PINs did not match – try again."); ls.set("pin", await hash(v)); LOCKED = false; return listScreen(); }
      const tries = (ls.get("pinTries") || 0);
      if (await hash(v) === ls.get("pin")) { ls.set("pinTries", 0); LOCKED = false; return listScreen(); }
      ls.set("pinTries", tries + 1); v = ""; dots();
      if (tries + 1 >= 5) { ls.set("pin", null); ls.set("pinTries", 0); await C.signOut(); return loginScreen("Too many wrong PINs – please sign in again."); }
      $("#p_err").textContent = "Wrong PIN (" + (5 - tries - 1) + " tries left)";
    });
    if ($("#p_out")) $("#p_out").onclick = async () => { ls.set("pin", null); await C.signOut(); loginScreen(); };
  }

  // ---------- customers ----------
  async function load() { LIST = (await C.list("customers")).sort((a, b) => (Date.parse(b.lastSeen || 0) || 0) - (Date.parse(a.lastSeen || 0) || 0)); ls.set("cache", LIST); }
  async function listScreen(q) {
    if (LOCKED) return;
    head("Customers", "OneSoft Licence Control", '<button class="link" id="h_add">＋ Add</button>');
    $("#h_add").onclick = addScreen;
    if (!LIST.length) LIST = ls.get("cache") || [];
    const draw = () => {
      const s = ($("#q") ? $("#q").value : q || "").toLowerCase();
      const rows = LIST.filter(c => !s || (c.name + " " + c._id + " " + (c.phone || "")).toLowerCase().includes(s));
      $("#rows").innerHTML = rows.length ? rows.map(c => { const st = state(c);
        return '<div class="card cust" data-id="' + esc(c._id) + '"><div style="flex:1;min-width:0"><div class="n">' + esc(c.name || c._id) + '</div><div class="s">' +
          esc([c.app, c.platform, c.lastVersion && "v" + c.lastVersion].filter(Boolean).join(" · ")) + ' · seen ' + esc(ago(c.lastSeen)) + (c.quotes != null ? " · " + c.quotes + " quotes" : "") + '</div></div><span class="pill ' + st.cls + '">' + esc(st.text) + "</span></div>"; }).join("")
        : '<p class="muted center">No customers yet. They appear here by themselves the first time their app goes online, or tap ＋ Add.</p>';
      $("#rows").querySelectorAll(".cust").forEach(d => d.onclick = () => detailScreen(d.dataset.id));
    };
    $("#main").innerHTML = '<input id="q" placeholder="Search customers" value="' + esc(q || "") + '" style="margin-bottom:12px"><div id="rows"></div>' +
      '<p class="center"><button class="link" id="apps">⬆ App updates</button>' + (BIO ? ' · <button class="link" id="fid">Face ID: ' + (ls.get("faceid") === false ? "off" : "on") + '</button>' : "") + '</p>' +
      '<p class="center"><button class="link" id="refresh">Refresh</button> · <button class="link" id="lock">Lock</button> · <button class="link" id="logout">Sign out</button></p>' + osFooter();
    $("#q").oninput = draw; draw();
    $("#refresh").onclick = async () => { try { await load(); draw(); toast("Updated"); } catch (e) { toast(e.message, 4000); } };
    $("#lock").onclick = () => { LOCKED = true; pinScreen("unlock"); };
    $("#apps").onclick = () => appsScreen();
    if ($("#fid")) $("#fid").onclick = () => { ls.set("faceid", ls.get("faceid") === false); listScreen(); toast("Face ID " + (ls.get("faceid") === false ? "off" : "on")); };
    $("#logout").onclick = async () => { ls.set("pin", null); ls.set("cache", null); LIST = []; await C.signOut(); loginScreen(); };
    try { await load(); draw(); } catch (e) { toast(e.message, 4000); }
  }

  // ---------- app updates: newest version of each app (customer apps read apps/{appId}) ----------
  async function appsScreen() {
    head("App updates", "Newest version of each app", '<button class="link" id="h_back">‹ Back</button>'); $("#h_back").onclick = () => listScreen();
    $("#main").innerHTML = '<p class="muted">Customer apps check this. When the version here is newer than theirs, the admin sees ⬆ Update. PC apps then install it by themselves between 2:30 and 3:00 am.</p><div id="arows"><p class="muted center">Loading…</p></div>' +
      '<button class="p" id="a_new" style="width:100%;margin-top:6px">＋ Add app</button>' + osFooter();
    $("#a_new").onclick = () => appEdit("");
    let A = []; try { A = await C.list("apps"); } catch (e) { toast(e.message, 4000); }
    $("#arows").innerHTML = A.length ? A.map(a => '<div class="card cust" data-id="' + esc(a._id) + '"><div style="flex:1;min-width:0"><div class="n">' + esc(a._id) + '</div><div class="s">' +
      esc(["PC " + (a.winVersion || "–"), "iPhone " + (a.iosVersion || "–")].join(" · ")) + '</div></div><span class="pill na">Edit</span></div>').join("") : '<p class="muted center">No apps yet – tap ＋ Add app.</p>';
    $("#arows").querySelectorAll(".cust").forEach(d => d.onclick = () => appEdit(d.dataset.id, A.find(x => x._id === d.dataset.id)));
  }
  function appEdit(id, a) {
    a = a || {};
    head(id || "Add app", "Update details", '<button class="link" id="h_back">‹ Back</button>'); $("#h_back").onclick = () => appsScreen();
    const f = (k, label, ph) => '<label>' + label + '</label><input id="e_' + k + '" value="' + esc(a[k] || "") + '" placeholder="' + esc(ph || "") + '" autocapitalize="off" autocorrect="off">';
    $("#main").innerHTML = '<div class="card">' + (id ? "" : f("id", "App ID (their Firebase project, e.g. ainalamal-quotation or mawkeb-quotation)", "")) +
      '<h3 style="margin-top:6px">PC (Windows)</h3>' + f("winVersion", "Newest version", "1.3.0") + f("winUrl", "Update file link (.zip, signed by OneSoft)", "https://…/app-1.3.0.zip") +
      '<h3 style="margin-top:12px">iPhone</h3>' + f("iosVersion", "Newest version", "1.1.0") + f("iosUrl", "Link the Update button opens (TestFlight / App Store)", "https://testflight.apple.com/join/…") +
      '<label>What is new (shown to the customer)</label><textarea id="e_notes" rows="3">' + esc(a.notes || "") + '</textarea>' +
      '<div class="err" id="e_err"></div><button class="p" id="e_go" style="width:100%;margin-top:10px">Save</button></div>' + osFooter();
    $("#e_go").onclick = async () => {
      const appId = id || $("#e_id").value.trim().toLowerCase();
      if (!/^[a-z0-9-]{4,40}$/.test(appId)) return $("#e_err").textContent = "Use the app ID exactly (small letters, numbers and -).";
      const v = k => $("#e_" + k).value.trim(), ver = /^$|^\d+(\.\d+){0,3}$/;
      if (!ver.test(v("winVersion")) || !ver.test(v("iosVersion"))) return $("#e_err").textContent = "Versions look like 1.3.0";
      for (const k of ["winUrl", "iosUrl"]) if (v(k) && !/^https:\/\//.test(v(k))) return $("#e_err").textContent = "Links must start with https://";
      try { await C.write("apps", appId, { winVersion: v("winVersion"), winUrl: v("winUrl"), iosVersion: v("iosVersion"), iosUrl: v("iosUrl"), notes: $("#e_notes").value.trim() }, { merge: true }); toast("Saved"); appsScreen(); }
      catch (e) { $("#e_err").textContent = e.message; }
    };
  }

  function addScreen() {
    head("Add customer", "", '<button class="link" id="h_back">‹ Back</button>'); $("#h_back").onclick = () => listScreen();
    $("#main").innerHTML = '<div class="card"><label>Licence ID (their Firebase project, e.g. ainalamal-quotation)</label><input id="a_id" autocapitalize="off" autocorrect="off">' +
      '<label>Company name</label><input id="a_name"><label>App</label><select id="a_app"><option>quotation</option><option>amc</option><option>pos</option><option>other</option></select>' +
      '<div class="err" id="a_err"></div><button class="p" id="a_go" style="margin-top:8px;width:100%">Add</button></div>';
    $("#a_go").onclick = async () => {
      const id = $("#a_id").value.trim().toLowerCase(); if (!/^[a-z0-9-]{4,40}$/.test(id)) return $("#a_err").textContent = "Use the licence ID exactly (small letters, numbers and -).";
      try { await C.write("customers", id, { name: $("#a_name").value.trim() || id, app: $("#a_app").value }, { merge: true }); await load(); detailScreen(id); }
      catch (e) { $("#a_err").textContent = e.message; }
    };
  }

  function detailScreen(id) {
    const c = LIST.find(x => x._id === id); if (!c) return listScreen();
    const st = state(c);
    head(c.name || id, id, '<button class="link" id="h_back">‹ Back</button>'); $("#h_back").onclick = () => listScreen();
    const untilVal = c.until && c.until !== "lifetime" ? c.until : "";
    $("#main").innerHTML =
      '<div class="card"><h3>Status</h3><p style="margin:0 0 10px"><span class="pill ' + st.cls + '">' + esc(st.text) + '</span></p><div class="kv">' +
        "<b>App</b><span>" + esc([c.app, c.platform, c.lastVersion && "v" + c.lastVersion].filter(Boolean).join(" · ") || "–") + "</span>" +
        "<b>Last seen</b><span>" + esc(ago(c.lastSeen)) + (c.lastSeen ? " (" + esc(new Date(c.lastSeen).toLocaleString()) + ")" : "") + "</span>" +
        "<b>Their app says</b><span>" + esc(c.appState ? c.appState + (c.appUntil ? " – " + c.appUntil : "") : "–") + "</span>" +
        "<b>Quotes</b><span>" + esc(c.quotes != null ? c.quotes : "–") + "</span></div>" +
        '<p class="muted" style="margin:10px 0 0">Changes reach their app the next time it opens or within a few minutes while it is open and online.</p></div>' +
      '<div class="card"><h3>Licence</h3><div class="kv" style="margin-bottom:10px"><b>Licence until</b><span id="d_until">' + esc(c.until ? fmtD(c.until) : "– (none from here)") + "</span></div>" +
        '<div class="row"><button id="b_m">+1 month</button><button id="b_y">+1 year</button><button class="g" id="b_l">Lifetime</button></div>' +
        '<label>Or set the end date</label><div class="row"><input type="date" id="d_date" value="' + esc(untilVal) + '"><button class="p" id="b_d" style="flex:0 0 auto">Set</button></div>' +
        '<div class="row" style="margin-top:8px"><button id="b_rm">Remove licence from here</button></div></div>' +
      '<div class="card"><h3>Free trial</h3><div class="kv" style="margin-bottom:10px"><b>Trial restarted</b><span>' + esc(c.trialStart ? fmtD(c.trialStart) : "–") + "</span><b>Trial length</b><span>" + esc((c.trialDays || 7) + " days") + "</span></div>" +
        '<div class="row"><button id="b_t">Restart trial today</button><select id="t_days" style="flex:0 0 110px">' + [7, 14, 30].map(n => "<option" + (Number(c.trialDays || 7) === n ? " selected" : "") + ">" + n + "</option>").join("") + "</select></div></div>" +
      '<div class="card"><h3>Switch off</h3>' + (String(c.status) === "blocked"
        ? '<p class="muted" style="margin:0 0 8px">Blocked. Their app is view-only and shows: “' + esc(c.message || "This app has been switched off.") + '”</p><button class="g" id="b_un" style="width:100%">Unblock</button>'
        : '<label>Message they will see (optional)</label><input id="b_msg" placeholder="This app has been switched off. Please contact your software provider."><button class="r" id="b_bl" style="width:100%;margin-top:10px">Block this app</button>') + "</div>" +
      '<div class="card"><h3>Notes</h3><label>Phone</label><input id="n_phone" value="' + esc(c.phone || "") + '"><label>Price</label><input id="n_price" value="' + esc(c.price || "") + '">' +
        '<label>Paid on</label><input type="date" id="n_paid" value="' + esc(c.paidAt || "") + '"><label>Note</label><textarea id="n_note" rows="3">' + esc(c.note || "") + '</textarea>' +
        '<button class="p" id="b_n" style="width:100%;margin-top:10px">Save notes</button></div>' +
      '<p class="muted center">Licence ID: ' + esc(id) + "</p>";
    const save = async (fields, msg) => {
      try { await C.write("customers", id, fields, { merge: true }); Object.assign(c, fields); toast(msg || "Saved"); detailScreen(id); }
      catch (e) { toast(e.message, 4000); }
    };
    const base = () => { const u = c.until && c.until !== "lifetime" ? Date.parse(c.until + "T00:00:00Z") : 0; return new Date(Math.max(u || 0, Date.parse(today() + "T00:00:00Z"))); };
    const addMonths = n => { const d = base(); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
    $("#b_m").onclick = () => save({ until: addMonths(1) }, "Extended by 1 month");
    $("#b_y").onclick = () => save({ until: addMonths(12) }, "Extended by 1 year");
    $("#b_l").onclick = () => confirm("Give " + (c.name || id) + " a lifetime licence?") && save({ until: "lifetime" }, "Lifetime licence set");
    $("#b_d").onclick = () => { const v = $("#d_date").value; if (!v) return toast("Pick a date first"); save({ until: v }, "Licence until " + fmtD(v)); };
    $("#b_rm").onclick = () => confirm("Remove the licence you gave from here? (A licence key entered in their app still counts.)") && save({ until: "" }, "Removed");
    $("#b_t").onclick = () => confirm("Restart a " + $("#t_days").value + "-day free trial for " + (c.name || id) + " from now?") && save({ trialStart: new Date().toISOString(), trialDays: Number($("#t_days").value) }, "Trial restarted");
    if ($("#b_bl")) $("#b_bl").onclick = () => confirm("Block " + (c.name || id) + "? Their app becomes view-only until you unblock it.") && save({ status: "blocked", message: $("#b_msg").value.trim() }, "Blocked");
    if ($("#b_un")) $("#b_un").onclick = () => save({ status: "ok" }, "Unblocked");
    $("#b_n").onclick = () => save({ phone: $("#n_phone").value.trim(), price: $("#n_price").value.trim(), paidAt: $("#n_paid").value, note: $("#n_note").value.trim() }, "Notes saved");
  }

  // lock again whenever the app goes to the background
  document.addEventListener("visibilitychange", () => { if (document.hidden && C.session && ls.get("pin")) { LOCKED = true; pinScreen("unlock"); } });

  (async () => {
    await C.init();
    if (!C.session) return loginScreen();
    if (!ls.get("pin")) return pinScreen("set");
    pinScreen("unlock");
  })();
})();
