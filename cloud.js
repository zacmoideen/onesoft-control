// Mawkeb Quotation – online accounts and shared quotes (Firebase Auth + Cloud Firestore over REST)
// Used by the iPhone/iPad app (browser) and the Windows app (Electron main process).
(function (root) {
  "use strict";
  // another company's copy of the app sets MAWKEB_FIREBASE = { apiKey, projectId } before this file loads
  const CFG = (root.MAWKEB_FIREBASE && root.MAWKEB_FIREBASE.apiKey) ? root.MAWKEB_FIREBASE : { apiKey: "AIzaSyCepz0oHaPenuznusU3UpHryaHvZ3_GPec", projectId: "mawkeb-quotation" };
  const DB_PATH = "projects/" + CFG.projectId + "/databases/(default)/documents";
  // a test server can be used by setting MAWKEB_CLOUD_TEST = "http://127.0.0.1:port" before this file loads
  const TEST = (typeof root.MAWKEB_CLOUD_TEST === "string" && root.MAWKEB_CLOUD_TEST) || (typeof process !== "undefined" && process.env && process.env.MAWKEB_CLOUD_TEST) || "";
  const DOCS = (TEST || "https://firestore.googleapis.com") + "/v1/" + DB_PATH;
  const AUTH = (TEST || "https://identitytoolkit.googleapis.com") + "/v1/accounts:";
  const TOKEN = (TEST || "https://securetoken.googleapis.com") + "/v1/token?key=" + CFG.apiKey;

  // ---------- Firestore value encoding ----------
  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: Number.isFinite(v) ? v : 0 };
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(enc) } : {} };
    if (typeof v === "object") return { mapValue: { fields: encFields(v) } };
    return { stringValue: String(v) };
  }
  function encFields(o) { const f = {}; for (const k of Object.keys(o || {})) if (o[k] !== undefined && typeof o[k] !== "function") f[k] = enc(o[k]); return f; }
  function dec(v) {
    if (!v) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("booleanValue" in v) return v.booleanValue;
    if ("nullValue" in v) return null;
    if ("timestampValue" in v) return v.timestampValue;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
    if ("mapValue" in v) return decFields(v.mapValue.fields || {});
    return null;
  }
  function decFields(f) { const o = {}; for (const k of Object.keys(f || {})) o[k] = dec(f[k]); return o; }
  function decDoc(d) { const o = decFields(d.fields || {}); o._id = d.name.split("/").pop(); return o; }
  const docName = (col, id) => DB_PATH + "/" + col + "/" + id;

  // ---------- friendly errors ----------
  const AUTH_MSG = {
    EMAIL_EXISTS: "This email already has an account. Use Log in instead.",
    INVALID_LOGIN_CREDENTIALS: "Wrong email or password.", INVALID_PASSWORD: "Wrong email or password.", EMAIL_NOT_FOUND: "Wrong email or password.",
    INVALID_EMAIL: "Please enter a valid email address.", MISSING_PASSWORD: "Please enter a password.",
    WEAK_PASSWORD: "Password must be at least 6 characters.", USER_DISABLED: "This account has been switched off.",
    CREDENTIAL_TOO_OLD_LOGIN_AGAIN: "For your security, please log out, log in again and then delete the account.",
    TOO_MANY_ATTEMPTS_TRY_LATER: "Too many tries. Please wait a few minutes and try again.",
    TOKEN_EXPIRED: "Please log in again.", USER_NOT_FOUND: "Please log in again.", INVALID_REFRESH_TOKEN: "Please log in again.",
  };
  class CloudError extends Error { constructor(msg, code, status) { super(msg); this.code = code || ""; this.status = status || 0; } }
  let SERVER = null;
  const serverNow = () => SERVER ? SERVER.s + (Date.now() - SERVER.l) : null;
  async function http(url, opt) {
    let r;
    try { r = await fetch(url, opt); }
    catch (e) { throw new CloudError("No internet connection. Please check Wi-Fi / mobile data and try again.", "OFFLINE"); }
    try { const d = Date.parse(r.headers.get("date") || ""); if (d) SERVER = { s: d, l: Date.now() }; } catch (e) {}   // Google's clock (licence checks)
    let body = null; const txt = await r.text(); try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = null; }
    // the browser may hide the Date header (CORS) – Firestore also sends its own time in query / commit replies
    try { const t = body && (body.commitTime || body.readTime || (Array.isArray(body) && body[0] && body[0].readTime)); const ms = t ? Date.parse(t) : 0; if (ms) SERVER = { s: ms, l: Date.now() }; } catch (e) {}
    if (!r.ok) {
      const err = (body && (Array.isArray(body) ? body[0] && body[0].error : body.error)) || {};
      const code = String(err.message || err.status || r.status).split(/[ :]/)[0];
      let msg = AUTH_MSG[code];
      if (!msg && (err.status === "PERMISSION_DENIED" || r.status === 403)) msg = "Not allowed. Your account may still be waiting for approval, or it was switched off.";
      if (!msg && r.status === 404) msg = "Not found.";
      throw new CloudError(msg || ("Server error: " + (err.message || r.status)), err.status || code, r.status);
    }
    return body;
  }

  // ---------- client ----------
  // storage: { get(key) -> value|null, set(key, value) } (may be async)
  function createClient(storage) {
    let S = null; // session {uid,email,idToken,refreshToken,exp}
    const C = {
      CloudError, enc, dec,
      async init() { S = (await storage.get("session")) || null; return S; },
      get session() { return S; },
      get uid() { return S && S.uid; },
      async _save() { await storage.set("session", S); },
      async _authResult(b) { S = { uid: b.localId, email: b.email, idToken: b.idToken, refreshToken: b.refreshToken, exp: Date.now() + (Number(b.expiresIn) || 3600) * 1000 - 120000 }; await C._save(); return S; },
      async signUp(email, password) {
        return C._authResult(await http(AUTH + "signUp?key=" + CFG.apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: String(email).trim(), password, returnSecureToken: true }) }));
      },
      async signIn(email, password) {
        return C._authResult(await http(AUTH + "signInWithPassword?key=" + CFG.apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: String(email).trim(), password, returnSecureToken: true }) }));
      },
      async resetPassword(email) {
        await http(AUTH + "sendOobCode?key=" + CFG.apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestType: "PASSWORD_RESET", email: String(email).trim() }) });
      },
      async signOut() { S = null; await storage.set("session", null); },
      async deleteAccount() { const t = await C.token(); await http(AUTH + "delete?key=" + CFG.apiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: t }) }); S = null; await storage.set("session", null); },
      async token() {
        if (!S) throw new CloudError("Please log in.", "NO_SESSION", 401);
        if (Date.now() < S.exp) return S.idToken;
        const b = await http(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(S.refreshToken) });
        S.idToken = b.id_token; S.refreshToken = b.refresh_token; S.exp = Date.now() + (Number(b.expires_in) || 3600) * 1000 - 120000; await C._save();
        return S.idToken;
      },
      async req(method, url, body) {
        const t = await C.token();
        return http(url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + t }, body: body === undefined ? undefined : JSON.stringify(body) });
      },
      // documents
      async get(col, id) {
        try { return decDoc(await C.req("GET", DOCS + "/" + col + "/" + encodeURIComponent(id))); }
        catch (e) { if (e.status === 404) return null; throw e; }
      },
      async list(col, pageSize) {
        const out = []; let tok = "";
        do { const b = await C.req("GET", DOCS + "/" + col + "?pageSize=" + (pageSize || 300) + (tok ? "&pageToken=" + encodeURIComponent(tok) : ""));
          for (const d of (b && b.documents) || []) out.push(decDoc(d)); tok = b && b.nextPageToken; } while (tok);
        return out;
      },
      // write: set (or merge with mask) a document and stamp server time into srvAt
      async write(col, id, data, opts) {
        opts = opts || {};
        const w = { update: { name: docName(col, id), fields: encFields(data) }, updateTransforms: [{ fieldPath: "srvAt", setToServerValue: "REQUEST_TIME" }].concat((opts.serverFields || []).map(f => ({ fieldPath: f, setToServerValue: "REQUEST_TIME" }))) };
        if (opts.merge) w.updateMask = { fieldPaths: Object.keys(data).map(k => /^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : "`" + k.replace(/`/g, "\\`") + "`") };
        if (opts.mustNotExist) w.currentDocument = { exists: false };
        const r = await C.req("POST", DOCS + ":commit", { writes: [w] });
        return (r && r.writeResults && r.writeResults[0] && r.writeResults[0].transformResults && dec(r.writeResults[0].transformResults[0])) || null;
      },
      async add(col, data) { const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); await C.write(col, id, data); return id; },
      async remove(col, id) { await C.req("DELETE", DOCS + "/" + col + "/" + encodeURIComponent(id)); },
      // query documents changed after a server time (ISO string) – newest last
      async changedSince(col, since, limit) {
        const q = { from: [{ collectionId: col }], orderBy: [{ field: { fieldPath: "srvAt" }, direction: "ASCENDING" }], limit: limit || 500 };
        if (since) q.where = { fieldFilter: { field: { fieldPath: "srvAt" }, op: "GREATER_THAN", value: { timestampValue: since } } };
        const rows = await C.req("POST", DOCS + ":runQuery", { structuredQuery: q });
        return (rows || []).filter(r => r.document).map(r => decDoc(r.document));
      },
      // documents where field <op> value (op: EQUAL, LESS_THAN …)
      async where(col, field, op, value, limit) {
        const q = { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op, value: enc(value) } }, limit: limit || 1000 };
        const rows = await C.req("POST", DOCS + ":runQuery", { structuredQuery: q });
        return (rows || []).filter(r => r.document).map(r => decDoc(r.document));
      },
      async latest(col, limit) {
        const q = { from: [{ collectionId: col }], orderBy: [{ field: { fieldPath: "srvAt" }, direction: "DESCENDING" }], limit: limit || 200 };
        const rows = await C.req("POST", DOCS + ":runQuery", { structuredQuery: q });
        return (rows || []).filter(r => r.document).map(r => decDoc(r.document));
      },
      // atomic counter: returns the new value (1, 2, 3 …)
      async increment(col, id, field) {
        const r = await C.req("POST", DOCS + ":commit", { writes: [{ transform: { document: docName(col, id), fieldTransforms: [{ fieldPath: field || "n", increment: { integerValue: "1" } }] } }] });
        return dec(r.writeResults[0].transformResults[0]);
      },
    };
    return C;
  }

  const api = { createClient, CloudError, CFG, enc, dec, encFields, decFields, serverNow };
  root.MawkebCloud = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
