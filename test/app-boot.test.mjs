import test from "node:test";
import assert from "node:assert/strict";

// Boot smoke test: importing the browser entry module (app.js) must evaluate its
// entire top-level body without throwing. The 2026-09 sync shipped a temporal-dead-zone
// ReferenceError (state -> loadDashboardConfig -> defaultDashboardConfig declared later),
// which aborted module evaluation before any button wiring or load() ran, leaving the page
// stuck on "正在载入浏览器数据". node --check only validates syntax, so this test is the guard.

function makeElement() {
  const el = {
    style: {}, dataset: {}, children: [],
    value: "", checked: false, disabled: false, textContent: "", innerHTML: "", placeholder: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {},
    querySelector() { return makeElement(); }, querySelectorAll() { return []; },
    closest() { return null; }, click() {}, focus() {}, showModal() {}, close() {}, show() {},
    scrollIntoView() {},
  };
  return el;
}

function installBrowserShim() {
  let queryCalls = 0;
  const document = {
    body: makeElement(),
    documentElement: makeElement(),
    querySelector(selector) { queryCalls += 1; return makeElement(selector); },
    querySelectorAll() { return []; },
    createElement() { return makeElement(); },
    addEventListener() {}, removeEventListener() {},
  };
  const g = globalThis;
  g.window = g;
  g.document = document;
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.dispatchEvent = () => true;
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.location = { href: "http://localhost/", origin: "http://localhost", protocol: "http:", host: "localhost", pathname: "/", search: "", hash: "" };
  g.history = { pushState() {}, replaceState() {} };
  g.indexedDB = { open() { throw new Error("IndexedDB unavailable in smoke test"); } };
  g.fetch = async () => { throw new Error("network disabled in smoke test"); };
  g.confirm = () => false;
  class ShimResponse {
    constructor(body, init = {}) { this._body = body; this.status = init.status ?? 200; this.ok = this.status >= 200 && this.status < 400; this.headers = new Map(Object.entries(init.headers || {})); }
    async json() { return JSON.parse(this._body); }
    async text() { return String(this._body); }
  }
  g.Response = g.Response || ShimResponse;
  return { get queryCalls() { return queryCalls; } };
}

test("app.js module body evaluates to completion without throwing", async () => {
  const shim = installBrowserShim();
  let evaluationError = null;
  try {
    await import("../app.js");
  } catch (error) {
    evaluationError = error;
  }
  assert.equal(evaluationError, null, `app.js failed to evaluate: ${evaluationError?.message}`);
  // Progressing past the const/state initialisations into DOM wiring proves the module
  // body ran to completion; a top-level ReferenceError (e.g. TDZ) would stop before this.
  assert.ok(shim.queryCalls > 0, "app.js never reached DOM wiring — module body aborted early");
});
