"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const APP_JS_PATH = path.join(ROOT_DIR, "app.js");
const SYNC_JS_PATH = path.join(ROOT_DIR, "sync-v2.js");
const SUPPLY_JS_PATH = path.join(ROOT_DIR, "supply-learning-v2.js");
const STYLES_CSS_PATH = path.join(ROOT_DIR, "styles.css");

/**
 * In-Memory KeyValue Store replacing IndexedDbV2 for fast, deterministic unit/E2E testing.
 */
class InMemoryKeyValueStore {
  constructor() {
    this.stores = new Map();
    this.onLockEvent = null;
  }

  _getStore(name) {
    if (!this.stores.has(name)) {
      this.stores.set(name, new Map());
    }
    return this.stores.get(name);
  }

  async open() {
    return this;
  }

  async put(storeName, value, key) {
    const store = this._getStore(storeName);
    const k = key !== undefined ? key : (value?.operationId || value?.conflictId || value?.key || value?.id);
    store.set(k, JSON.parse(JSON.stringify(value)));
    return value;
  }

  async get(storeName, key) {
    const store = this._getStore(storeName);
    const item = store.get(key);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  async getAll(storeName) {
    const store = this._getStore(storeName);
    return Array.from(store.values()).map((v) => JSON.parse(JSON.stringify(v)));
  }

  async delete(storeName, key) {
    const store = this._getStore(storeName);
    store.delete(key);
  }

  async withQueueLock(work) {
    this.onLockEvent?.({ type: "lockAcquired", owner: "test-device", acquiredAt: new Date().toISOString() });
    try {
      return await work();
    } finally {
      this.onLockEvent?.({ type: "lockReleased", owner: "test-device", releasedAt: new Date().toISOString() });
    }
  }
}

/**
 * In-Memory Remote Adapter replacing FirestoreV2 for fast, deterministic Firestore testing.
 */
class InMemoryRemoteAdapter {
  constructor(initialData = {}) {
    this.collections = new Map();
    this.operations = new Map();
    this.subscribers = new Map();

    for (const [entity, docs] of Object.entries(initialData)) {
      const col = new Map();
      if (Array.isArray(docs)) {
        for (const doc of docs) {
          col.set(doc.id, JSON.parse(JSON.stringify(doc)));
        }
      }
      this.collections.set(entity, col);
    }
  }

  _getCollection(entity) {
    if (!this.collections.has(entity)) {
      this.collections.set(entity, new Map());
    }
    return this.collections.get(entity);
  }

  async getDocument(entity, entityId) {
    const col = this._getCollection(entity);
    const doc = col.get(entityId);
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  async getCollection(entity) {
    const col = this._getCollection(entity);
    return Array.from(col.values()).map((d) => JSON.parse(JSON.stringify(d)));
  }

  async create(entity, entityId, data) {
    const col = this._getCollection(entity);
    const doc = { id: entityId, ...JSON.parse(JSON.stringify(data)) };
    col.set(entityId, doc);
    this._notify(entity);
    return doc;
  }

  async patch(entity, entityId, changes) {
    const col = this._getCollection(entity);
    const existing = col.get(entityId) || { id: entityId };
    const updated = { ...existing, ...JSON.parse(JSON.stringify(changes)) };
    col.set(entityId, updated);
    this._notify(entity);
    return updated;
  }

  async remove(entity, entityId) {
    const col = this._getCollection(entity);
    col.delete(entityId);
    this._notify(entity);
  }

  async recordOperation(operation) {
    this.operations.set(operation.operationId, JSON.parse(JSON.stringify(operation)));
  }

  async getOperation(operationId) {
    const op = this.operations.get(operationId);
    return op ? JSON.parse(JSON.stringify(op)) : null;
  }

  async subscribe(entity, callback) {
    if (!this.subscribers.has(entity)) {
      this.subscribers.set(entity, new Set());
    }
    this.subscribers.get(entity).add(callback);
    const col = await this.getCollection(entity);
    callback(col);
    return () => {
      this.subscribers.get(entity)?.delete(callback);
    };
  }

  _notify(entity) {
    const callbacks = this.subscribers.get(entity);
    if (!callbacks || !callbacks.size) return;
    const col = Array.from(this._getCollection(entity).values()).map((d) => JSON.parse(JSON.stringify(d)));
    for (const cb of callbacks) {
      try {
        cb(col);
      } catch {}
    }
  }
}

/**
 * Creates a mock DOM element for the sandbox environment.
 */
function createMockElement(id = "", tagName = "div") {
  const listeners = new Map();
  return {
    id,
    tagName: tagName.toUpperCase(),
    value: "",
    textContent: "",
    innerText: "",
    innerHTML: "",
    disabled: false,
    hidden: false,
    checked: false,
    dataset: {},
    classList: {
      classes: new Set(),
      add(...cls) { cls.forEach((c) => this.classes.add(c)); },
      remove(...cls) { cls.forEach((c) => this.classes.delete(c)); },
      toggle(c) { if (this.classes.has(c)) this.classes.delete(c); else this.classes.add(c); },
      contains(c) { return this.classes.has(c); },
    },
    style: {},
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    removeEventListener(event, fn) {
      const arr = listeners.get(event) || [];
      listeners.set(event, arr.filter((f) => f !== fn));
    },
    async dispatchEvent(event) {
      const type = event?.type || event;
      const fns = listeners.get(type) || [];
      for (const fn of fns) {
        await fn(event);
      }
    },
    querySelector: () => createMockElement(),
    querySelectorAll: () => [],
    appendChild: (child) => child,
    removeChild: (child) => child,
    cloneNode: () => createMockElement(id, tagName),
    closest: () => null,
    focus: () => {},
    reset: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
  };
}

/**
 * Loads the complete application environment (sync-v2.js, supply-learning-v2.js, app.js)
 * inside a secure, headless Node.js vm context.
 */
function loadAppEnvironment(options = {}) {
  const syncCode = fs.readFileSync(SYNC_JS_PATH, "utf8");
  const supplyCode = fs.readFileSync(SUPPLY_JS_PATH, "utf8");
  const appCode = fs.readFileSync(APP_JS_PATH, "utf8");

  const mockStorageMap = new Map();
  const mockLocalStorage = {
    getItem: (key) => mockStorageMap.get(key) || null,
    setItem: (key, val) => mockStorageMap.set(key, String(val)),
    removeItem: (key) => mockStorageMap.delete(key),
    clear: () => mockStorageMap.clear(),
  };

  const mockFirebase = {
    apps: [],
    initializeApp: (config) => {
      mockFirebase.apps.push(config);
      return {};
    },
    firestore: () => ({
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false, data: () => null }),
          set: async () => {},
        }),
      }),
    }),
    auth: () => ({
      onAuthStateChanged: (callback) => {
        if (options.initialUser) callback(options.initialUser);
      },
      signOut: async () => {},
    }),
  };

  const sandbox = {
    console: {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Intl,
    Error,
    TypeError,
    crypto: {
      randomUUID: () => crypto.randomUUID(),
    },
    localStorage: mockLocalStorage,
    indexedDB: {
      open: () => ({
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      }),
    },
    firebase: mockFirebase,
    navigator: {
      onLine: true,
      storage: { persist: async () => true },
      locks: {
        request: async (name, opts, fn) => {
          if (typeof opts === "function") return opts();
          return fn();
        },
      },
    },
    document: {
      querySelector: (selector) => createMockElement(selector),
      querySelectorAll: () => [],
      createElement: (tag) => createMockElement("", tag),
      body: createMockElement("body", "body"),
    },
    window: null, // Self-reference attached below
    alert: () => {},
    confirm: () => true,
    prompt: () => "",
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };

  sandbox.window = sandbox;
  sandbox.global = sandbox;

  const context = vm.createContext(sandbox);

  // Execute sync-v2.js
  vm.runInContext(syncCode, context, { filename: "sync-v2.js" });

  // Execute supply-learning-v2.js
  vm.runInContext(supplyCode, context, { filename: "supply-learning-v2.js" });

  // Execute app.js
  vm.runInContext(appCode, context, { filename: "app.js" });

  // Expose module constants to sandbox context if not explicitly attached
  if (typeof context.STATUS_FLOW === "undefined") {
    context.STATUS_FLOW = ["recibido", "lavando", "secando", "doblando", "listo", "entregado"];
  }
  if (typeof context.DEFAULT_SERVICES === "undefined") {
    context.DEFAULT_SERVICES = [
      { id: "lavado-secado", name: "Lavado y Secado", price: 22, unit: "kg", description: "Servicio regular de lavado", active: true },
      { id: "express-wash", name: "Express Wash", price: 25, unit: "kg", description: "Servicio express para el mismo dia", active: true },
      { id: "secado", name: "Secado", price: 15, unit: "kg", description: "Solo secado de prendas", active: true },
      { id: "cobertor", name: "Cobertor", price: 70, unit: "pieza", description: "Cobertor o edredon matrimonial", active: true },
      { id: "cobertor-queen", name: "Cobertor 2", price: 90, unit: "pieza", description: "Cobertor o edredon queen size", active: true },
    ];
  }

  return context;
}

/**
 * Creates an instance of RapiditaSyncV2.SyncEngine connected to in-memory store and remote.
 */
function createTestSyncEngine(env, { initialRemoteData = {}, options = {} } = {}) {
  const localStore = new InMemoryKeyValueStore();
  const remote = new InMemoryRemoteAdapter(initialRemoteData);
  const queue = new env.RapiditaSyncV2.SyncQueue(localStore);
  const conflictManager = new env.RapiditaSyncV2.ConflictManager(localStore);

  const engine = new env.RapiditaSyncV2.SyncEngine({
    localStore,
    remote,
    queue,
    conflictManager,
    realtime: false,
    autoDrain: false,
    ...options,
  });

  return { engine, localStore, remote, queue, conflictManager };
}

/**
 * Entity Factories for deterministic test fixtures.
 */
function createMockOrder(overrides = {}) {
  const id = overrides.id || `order_${crypto.randomUUID().slice(0, 8)}`;
  const now = overrides.createdAt || new Date().toISOString();
  const weightKg = overrides.weightKg !== undefined ? overrides.weightKg : 10;
  const pricePerKg = overrides.pricePerKg !== undefined ? overrides.pricePerKg : 22;
  const subtotal = overrides.subtotal !== undefined ? overrides.subtotal : weightKg * pricePerKg;
  const total = overrides.total !== undefined ? overrides.total : Math.ceil(subtotal);

  const defaultItem = {
    id: `item_${id}`,
    serviceId: overrides.serviceId || "lavado-secado",
    serviceName: overrides.serviceName || "Lavado y Secado",
    unit: overrides.unit || "kg",
    weightKg,
    pricePerKg,
    subtotal,
    total,
  };

  return {
    id,
    customerId: overrides.customerId || "cust_1",
    customerName: overrides.customerName || "Cliente Prueba",
    customerPhone: overrides.customerPhone || "5551234567",
    serviceId: overrides.serviceId || "lavado-secado",
    serviceName: overrides.serviceName || "Lavado y Secado",
    unit: overrides.unit || "kg",
    weightKg,
    pricePerKg,
    subtotal,
    total,
    items: overrides.items || [defaultItem],
    status: overrides.status || "recibido",
    paid: overrides.paid !== undefined ? overrides.paid : false,
    paidAt: overrides.paidAt || null,
    deliveredAt: overrides.deliveredAt || null,
    notes: overrides.notes || "",
    createdAt: now,
    updatedAt: overrides.updatedAt || now,
    ...overrides,
  };
}

function createMockExpense(overrides = {}) {
  const id = overrides.id || `exp_${crypto.randomUUID().slice(0, 8)}`;
  const now = overrides.createdAt || new Date().toISOString();
  return {
    id,
    concept: overrides.concept || "Recarga de gas",
    name: overrides.name || overrides.concept || "Recarga de gas",
    amount: overrides.amount !== undefined ? overrides.amount : 620,
    category: overrides.category || "gas",
    paymentMethod: overrides.paymentMethod || "efectivo",
    supplyId: overrides.supplyId !== undefined ? overrides.supplyId : "gas",
    purchasedQuantity: overrides.purchasedQuantity !== undefined ? overrides.purchasedQuantity : 30,
    purchasedUnit: overrides.purchasedUnit || "kg",
    notes: overrides.notes || "",
    createdAt: now,
    updatedAt: overrides.updatedAt || now,
    ...overrides,
  };
}

function createMockClosing(overrides = {}) {
  const dateKey = overrides.dateKey || overrides.id || "2026-09-20";
  return {
    id: dateKey,
    dateKey,
    closedAt: overrides.closedAt || `${dateKey}T21:00:00.000Z`,
    ordersCount: overrides.ordersCount || 10,
    sales: overrides.sales !== undefined ? overrides.sales : 2500,
    expenses: overrides.expenses !== undefined ? overrides.expenses : 620,
    operatingExpenses: overrides.operatingExpenses || 0,
    supplyPurchases: overrides.supplyPurchases || 0,
    gasPurchases: overrides.gasPurchases !== undefined ? overrides.gasPurchases : 620,
    lightExpenses: overrides.lightExpenses || 0,
    personalWithdrawals: overrides.personalWithdrawals || 0,
    investmentDebt: overrides.investmentDebt || 0,
    cashFlow: overrides.cashFlow !== undefined ? overrides.cashFlow : (2500 - 620),
    profit: overrides.profit !== undefined ? overrides.profit : 2500,
    ...overrides,
  };
}

function createMockSupply(overrides = {}) {
  return {
    id: overrides.id || "gas",
    name: overrides.name || "Gas",
    unit: overrides.unit || "kg",
    purchaseUnit: overrides.purchaseUnit || "kg",
    quantity: overrides.quantity !== undefined ? overrides.quantity : 30,
    minimum: overrides.minimum !== undefined ? overrides.minimum : 5,
    averageCost: overrides.averageCost !== undefined ? overrides.averageCost : 20.67,
    purchaseUnitPrice: overrides.purchaseUnitPrice !== undefined ? overrides.purchaseUnitPrice : 620,
    piecesPerPurchaseUnit: 0,
    kind: overrides.kind || "gas",
    tankSize: overrides.tankSize || 30,
    usageBasis: overrides.usageBasis || "kg",
    usagePerKg: overrides.usagePerKg || 0,
    usagePerOrder: overrides.usagePerOrder || 0,
    ...overrides,
  };
}

function createMockSupplyMovement(overrides = {}) {
  const id = overrides.id || `mov_${crypto.randomUUID().slice(0, 8)}`;
  return {
    id,
    expenseId: overrides.expenseId || null,
    supplyId: overrides.supplyId || "gas",
    type: overrides.type || "purchase",
    quantity: overrides.quantity !== undefined ? overrides.quantity : 30,
    cost: overrides.cost !== undefined ? overrides.cost : 620,
    unitPrice: overrides.unitPrice !== undefined ? overrides.unitPrice : 20.67,
    piecesPerUnit: 0,
    createdAt: overrides.createdAt || new Date().toISOString(),
    note: overrides.note || "Compra registrada",
    ...overrides,
  };
}

/**
 * Returns the exact SHA-256 hash and byte size of styles.css.
 */
function getStylesCssInfo() {
  const content = fs.readFileSync(STYLES_CSS_PATH);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return {
    hash,
    byteSize: content.length,
    path: STYLES_CSS_PATH,
  };
}

module.exports = {
  loadAppEnvironment,
  InMemoryKeyValueStore,
  InMemoryRemoteAdapter,
  createTestSyncEngine,
  createMockOrder,
  createMockExpense,
  createMockClosing,
  createMockSupply,
  createMockSupplyMovement,
  getStylesCssInfo,
  ROOT_DIR,
  STYLES_CSS_PATH,
};
