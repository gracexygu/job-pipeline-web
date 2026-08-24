import { createWebState, normalizeWebImport, assertWebState, isoNow } from "./data-contract.js";

const DB_NAME = "job-pipeline-web";
const STORE_NAME = "state";
const ROOT_KEY = "root";

export class RevisionConflictError extends Error {
  constructor() { super("数据已在另一标签页更新。"); this.name = "RevisionConflictError"; }
}

export class ApiStore {
  fetch(...args) { return globalThis.fetch(...args); }
  async request(path, options = {}) {
    const response = await this.fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "请求失败");
    return data;
  }
  loadDashboard() { return Promise.all([this.request("./api/bootstrap"), this.request("./api/sources"), this.request("./api/intents"), this.request("./api/interview-pipelines")]); }
}

export class IndexedDBStore {
  constructor(indexedDB = globalThis.indexedDB, dbName = DB_NAME) { this.indexedDB = indexedDB; this.dbName = dbName; this.db = null; }
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }
  async read() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(ROOT_KEY);
      request.onsuccess = () => resolve(request.result ? assertWebState(request.result) : null);
      request.onerror = () => reject(request.error);
    });
  }
  async initialize() {
    const existing = await this.read();
    return existing || this.write(createWebState(), null);
  }
  async write(value, expectedRevision) {
    const db = await this.open();
    const candidate = normalizeWebImport(value);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const get = store.get(ROOT_KEY);
      let conflict = false;
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const actual = get.result?.metadata?.revision ?? null;
        if (expectedRevision !== null && actual !== expectedRevision) { conflict = true; transaction.abort(); return; }
        candidate.metadata.revision = (actual ?? -1) + 1;
        candidate.metadata.updatedAt = isoNow();
        store.put(candidate, ROOT_KEY);
      };
      transaction.oncomplete = () => resolve(candidate);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(conflict ? new RevisionConflictError() : transaction.error);
    });
  }
  async clear() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }
}
