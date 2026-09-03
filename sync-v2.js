(function attachRapiditaSyncV2(global) {
  "use strict";

  const ENTITY_KEYS = ["services", "customers", "orders", "expenses", "supplies", "supplyMovements", "closings"];
  const TERMINAL_ORDER_STATUS = "entregado";
  const RETRYABLE_CODES = new Set(["unavailable", "deadline-exceeded", "resource-exhausted", "aborted", "failed-precondition"]);

  function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function uuid(prefix) {
    const value = global.crypto?.randomUUID ? global.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
    return prefix ? `${prefix}_${value}` : value;
  }

  function getDeviceId() {
    const key = "la-rapidita-device-id-v2";
    try {
      const existing = global.localStorage?.getItem(key);
      if (existing) return existing;
      const value = uuid("device");
      global.localStorage?.setItem(key, value);
      return value;
    } catch {
      return uuid("device");
    }
  }

  function changedFields(previous, next) {
    const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
    keys.delete("updatedAt");
    keys.delete("updatedBy");
    keys.delete("revision");
    keys.delete("schemaVersion");
    keys.delete("lastOperationId");
    keys.delete("lastDeviceId");
    keys.delete("fieldVersions");
    return [...keys].filter((key) => JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key]));
  }

  function changedValues(previous, next, fields) {
    return fields.reduce((result, field) => {
      result[field] = clone(next?.[field]);
      return result;
    }, {});
  }

  function isTerminalStatus(status) {
    return String(status || "").toLowerCase() === TERMINAL_ORDER_STATUS;
  }

  function normalizeEntityKey(entity) {
    return ENTITY_KEYS.includes(entity) ? entity : null;
  }

  function collectionPath(laundryId, entity) {
    return `lavanderias/${laundryId}/${entity}`;
  }

  class IndexedDbV2 {
    constructor({ dbName = "la-rapidita-lavanderia", version = 2, queueStore = "syncQueue", metadataStore = "syncMetadata", conflictStore = "conflicts" } = {}) {
      this.dbName = dbName;
      this.version = version;
      this.queueStore = queueStore;
      this.metadataStore = metadataStore;
      this.conflictStore = conflictStore;
      this.databasePromise = null;
      this.onLockEvent = null;
    }

    open() {
      if (this.databasePromise) return this.databasePromise;
      this.databasePromise = new Promise((resolve, reject) => {
        const request = global.indexedDB.open(this.dbName, this.version);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("app-data")) db.createObjectStore("app-data");
          if (!db.objectStoreNames.contains(this.queueStore)) db.createObjectStore(this.queueStore, { keyPath: "operationId" });
          if (!db.objectStoreNames.contains(this.metadataStore)) db.createObjectStore(this.metadataStore);
          if (!db.objectStoreNames.contains(this.conflictStore)) db.createObjectStore(this.conflictStore, { keyPath: "conflictId" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return this.databasePromise;
    }

    async put(storeName, value, key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        if (key === undefined) store.put(value); else store.put(value, key);
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

    async get(storeName, key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    async getAll(storeName) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    }

    async delete(storeName, key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

    async withQueueLock(work) {
      if (global.navigator?.locks?.request) {
        return global.navigator.locks.request(`la-rapidita-sync-queue-${this.dbName}`, { mode: "exclusive" }, async () => {
          this.onLockEvent?.({ type: "lockAcquired", owner: getDeviceId(), acquiredAt: nowIso() });
          try { return await work(); } finally { this.onLockEvent?.({ type: "lockReleased", owner: getDeviceId(), releasedAt: nowIso() }); }
        });
      }
      const lockKey = "queue-lock";
      const current = await this.get(this.metadataStore, lockKey);
      const now = Date.now();
      if (current && current.expiresAt > now) return { skipped: true };
      const token = uuid("lock");
      await this.put(this.metadataStore, { key: lockKey, token, expiresAt: now + 15000 }, lockKey);
      this.onLockEvent?.({ type: "lockAcquired", owner: getDeviceId(), acquiredAt: nowIso(), expiresAt: new Date(now + 15000).toISOString() });
      try {
        return await work();
      } finally {
        const latest = await this.get(this.metadataStore, lockKey);
        if (latest?.token === token) await this.delete(this.metadataStore, lockKey);
        this.onLockEvent?.({ type: "lockReleased", owner: getDeviceId(), releasedAt: nowIso() });
      }
    }
  }

  class SyncQueue {
    constructor(localStore) {
      this.localStore = localStore;
    }

    async enqueue(operation) {
      return this.localStore.put("syncQueue", { ...clone(operation), status: operation.status || "pending" });
    }

    async get(operationId) {
      return this.localStore.get("syncQueue", operationId);
    }

    async update(operation) {
      return this.localStore.put("syncQueue", operation);
    }

    async pending() {
      const operations = await this.localStore.getAll("syncQueue");
      return operations.filter((operation) => ["pending", "sending"].includes(operation.status)).sort((a, b) => String(a.createdAtClient).localeCompare(String(b.createdAtClient)));
    }
  }

  class FirestoreV2 {
    constructor({ firestore, laundryId = "la-rapidita" }) {
      this.firestore = firestore;
      this.laundryId = laundryId;
    }

    collection(entity) {
      return this.firestore.collection(collectionPath(this.laundryId, entity));
    }

    document(entity, entityId) {
      return this.collection(entity).doc(entityId);
    }

    async getDocument(entity, entityId) {
      const snapshot = await this.document(entity, entityId).get();
      return snapshot?.exists ? { id: snapshot.id || entityId, ...clone(snapshot.data()) } : null;
    }

    async getCollection(entity) {
      const snapshot = await this.collection(entity).get();
      const documents = snapshot?.docs || [];
      return documents.map((document) => ({ id: document.id, ...clone(document.data()) }));
    }

    async create(entity, entityId, value) {
      await this.document(entity, entityId).set(clone(value));
    }

    async patch(entity, entityId, changes) {
      const ref = this.document(entity, entityId);
      if (typeof ref.update === "function") return ref.update(clone(changes));
      return ref.set(clone(changes), { merge: true });
    }

    async remove(entity, entityId) {
      const ref = this.document(entity, entityId);
      if (typeof ref.delete === "function") return ref.delete();
      return ref.set({ deletedAt: new Date().toISOString() }, { merge: true });
    }

    async getOperation(operationId) {
      return this.getDocument("syncOperations", operationId);
    }

    async recordOperation(operation) {
      await this.create("syncOperations", operation.operationId, {
        operationId: operation.operationId,
        entity: operation.entity,
        entityId: operation.entityId,
        userId: operation.userId,
        deviceId: operation.deviceId,
        appliedAt: nowIso(),
        schemaVersion: 2,
      });
    }

    async subscribe(entity, callback, onError) {
      const ref = this.collection(entity);
      if (typeof ref.onSnapshot !== "function") return () => {};
      return ref.onSnapshot((snapshot) => {
        const documents = snapshot?.docs || [];
        callback(documents.map((document) => ({ id: document.id, ...clone(document.data()) })));
      }, onError);
    }
  }

  class ConflictManager {
    constructor(localStore) {
      this.localStore = localStore;
    }

    async record(operation, remoteDocument, conflictingFields) {
      const conflict = {
        conflictId: uuid("conflict"),
        operationId: operation.operationId,
        entity: operation.entity,
        entityId: operation.entityId,
        conflictingFields,
        localChanges: clone(operation.changes),
        remoteChanges: conflictingFields.reduce((result, field) => {
          result[field] = clone(remoteDocument?.[field]);
          return result;
        }, {}),
        status: "pending_review",
        createdAt: nowIso(),
      };
      await this.localStore.put("conflicts", conflict);
      return conflict;
    }
  }

  class SyncEngine {
    constructor({ firestore, user, laundryId = "la-rapidita", localStore, remote, queue, conflictManager, deviceId = getDeviceId(), retryBaseMs = 250, maxAttempts = 8, onStateChange = null, onEvent = null, realtime = true, autoDrain = true, listenerOrderFix = false } = {}) {
      this.firestore = firestore;
      this.user = user || { uid: "anonymous" };
      this.laundryId = laundryId;
      this.localStore = localStore || new IndexedDbV2();
      this.remote = remote || new FirestoreV2({ firestore, laundryId });
      this.queue = queue || new SyncQueue(this.localStore);
      this.conflictManager = conflictManager || new ConflictManager(this.localStore);
      this.deviceId = deviceId;
      this.retryBaseMs = retryBaseMs;
      this.maxAttempts = maxAttempts;
      this.onStateChange = onStateChange;
      this.onEvent = onEvent;
      this.realtime = realtime;
      this.autoDrain = autoDrain;
      this.listenerOrderFix = listenerOrderFix;
      this.connectionState = "INITIALIZING";
      this.listenerGeneration = 0;
      this.listenerSubscriptions = new Map();
      this.listenerStarts = new Map();
      this.initialSnapshotEntities = new Set();
      this.realtimeReady = !realtime;
      this.realtimeReadyPromise = Promise.resolve();
      this.listenerStartPromise = null;
      this.initialized = false;
      this.currentState = null;
      this.stateByEntity = new Map();
      this.activeDrain = null;
      this.unsubscribe = [];
      this.listenersActive = false;
      this.localStore.onLockEvent = (event) => this.emit(event);
    }

    emit(event) {
      if (typeof this.onEvent === "function") this.onEvent({ ...event, at: nowIso() });
    }

    setConnectionState(nextState, details = {}) {
      this.connectionState = nextState;
      this.emit({ type: "connectionState", state: nextState, ...details });
    }

    getRealtimeDiagnostics() {
      return {
        lifecycle: this.connectionState,
        listenerOrderFix: this.listenerOrderFix,
        listenerGeneration: this.listenerGeneration,
        listenersActive: this.listenersActive,
        activeListenerEntities: [...this.listenerSubscriptions.keys()],
        activeListenerCount: this.listenerSubscriptions.size,
        initialSnapshots: [...this.initialSnapshotEntities],
        realtimeReady: this.realtimeReady,
      };
    }

    async enableNetwork() {
      this.setConnectionState("CONNECTING");
      if (typeof this.firestore?.enableNetwork === "function") await this.firestore.enableNetwork();
      this.setConnectionState("NETWORK_READY");
      return this.getRealtimeDiagnostics();
    }

    async disableNetwork() {
      if (typeof this.firestore?.disableNetwork === "function") await this.firestore.disableNetwork();
      this.setConnectionState("OFFLINE");
      return this.getRealtimeDiagnostics();
    }

    async reconnectRealtime() {
      this.stopRealtimeListeners();
      await this.enableNetwork();
      if (this.realtime) await this.startRealtimeListeners({ waitForInitialSnapshots: true });
      if (this.autoDrain) await this.drain();
      return this.getRealtimeDiagnostics();
    }

    async waitForRealtimeReady() {
      await this.realtimeReadyPromise;
      return this.getRealtimeDiagnostics();
    }

    async initialize(localState) {
      await this.localStore.open();
      this.setConnectionState("LOCAL_READY");
      if (this.listenerOrderFix) await this.enableNetwork();
      const remoteState = await this.readRemoteState();
      const hasRemoteData = ENTITY_KEYS.some((key) => remoteState[key].length);
      const initialState = hasRemoteData ? this.mergeRemoteWithLocal(remoteState, localState) : clone(localState);
      if (!hasRemoteData) await this.seedRemote(initialState);
      this.setCurrentState(initialState);
      await this.localStore.put("syncMetadata", { key: "device", deviceId: this.deviceId, schemaVersion: 2 }, "device");
      this.initialized = true;
      if (this.realtime) {
        if (this.listenerOrderFix) await this.startRealtimeListeners({ waitForInitialSnapshots: true });
        else this.startRealtimeListeners();
      } else {
        this.realtimeReady = true;
        this.setConnectionState("REALTIME_READY");
      }
      if (this.autoDrain) await this.drain();
      return { state: clone(initialState), deviceId: this.deviceId, realtime: this.getRealtimeDiagnostics() };
    }

    setCurrentState(nextState) {
      this.currentState = clone(nextState);
      ENTITY_KEYS.forEach((key) => this.stateByEntity.set(key, new Map((nextState?.[key] || []).map((item) => [item.id, clone(item)]))));
    }

    mergeRemoteWithLocal(remoteState, localState) {
      const merged = clone(remoteState);
      ENTITY_KEYS.forEach((key) => {
        const byId = new Map((merged[key] || []).map((item) => [item.id, item]));
        (localState?.[key] || []).forEach((item) => { if (!byId.has(item.id)) byId.set(item.id, clone(item)); });
        merged[key] = [...byId.values()];
      });
      return merged;
    }

    async readRemoteState() {
      const state = {};
      for (const key of ENTITY_KEYS) state[key] = await this.remote.getCollection(key);
      return state;
    }

    async seedRemote(sourceState) {
      for (const entity of ENTITY_KEYS) {
        for (const item of sourceState?.[entity] || []) {
          const value = this.withMetadata(item, { revision: Number(item.revision || 1), createdAt: item.createdAt || nowIso(), createdBy: item.createdBy || this.user.uid });
          await this.remote.create(entity, item.id, value);
        }
      }
    }

    withMetadata(value, metadata = {}) {
      return {
        ...clone(value),
        ...metadata,
        schemaVersion: 2,
        updatedBy: metadata.updatedBy || this.user.uid,
        updatedAt: metadata.updatedAt || nowIso(),
        fieldVersions: metadata.fieldVersions || value?.fieldVersions || {},
      };
    }

    async syncState(nextState) {
      if (!this.initialized) return;
      const previousState = this.currentState || {};
      this.setCurrentState(nextState);
      for (const entity of ENTITY_KEYS) {
        const previous = new Map((previousState[entity] || []).map((item) => [item.id, item]));
        const next = new Map((nextState[entity] || []).map((item) => [item.id, item]));
        for (const [id, item] of next) {
          const before = previous.get(id);
          const fields = before ? changedFields(before, item) : Object.keys(item).filter((field) => !["id", "createdAt", "updatedAt"].includes(field));
          if (!fields.length) continue;
          await this.enqueue({ entity, entityId: id, type: before ? "update" : "create", changes: changedValues(before || {}, item, fields), changedFields: fields, baseRevision: Number(before?.revision || 0), createdAtClient: nowIso() });
        }
        for (const [id, item] of previous) {
          if (!next.has(id)) await this.enqueue({ entity, entityId: id, type: "delete", changes: {}, changedFields: [], baseRevision: Number(item?.revision || 0), createdAtClient: nowIso() });
        }
      }
      if (this.autoDrain) await this.drain();
    }

    async enqueue({ entity, entityId, type, changes, changedFields, baseRevision, createdAtClient }) {
      const operation = {
        operationId: uuid("op"),
        entity,
        entityId,
        type,
        changes: clone(changes),
        changedFields: [...changedFields],
        baseRevision,
        deviceId: this.deviceId,
        userId: this.user.uid,
        createdAtClient,
        attempts: 0,
        status: "pending",
      };
      await this.queue.enqueue(operation);
      this.emit({ type: "operationEnqueued", operation: clone(operation) });
      return operation;
    }

    async drain() {
      if (this.activeDrain) {
        await this.activeDrain;
        // A local write can be queued while the previous drain is still
        // enumerating the queue. Re-check after it settles so that the new
        // operation is not left pending until another user action occurs.
        if (await this.queue.pending().then((items) => items.length)) return this.drain();
        return;
      }
      const run = () => this.drainQueue();
      const withLock = typeof this.localStore.withQueueLock === "function" ? this.localStore.withQueueLock(run.bind(this)) : run();
      this.activeDrain = Promise.resolve(withLock).finally(() => { this.activeDrain = null; });
      return this.activeDrain;
    }

    async drainQueue() {
      const pending = await this.queue.pending();
      const inFlightEntities = new Set();
      for (const operation of pending) {
        if (inFlightEntities.has(`${operation.entity}:${operation.entityId}`)) continue;
        inFlightEntities.add(`${operation.entity}:${operation.entityId}`);
        await this.process(operation);
      }
    }

    async process(operation) {
      if (operation.status === "sending") operation.status = "pending";
      operation.status = "sending";
      operation.attempts = Number(operation.attempts || 0) + 1;
      this.emit({ type: "operationSending", operation: clone(operation) });
      await this.queue.update(operation);
      try {
        const result = await this.applyOperation(operation);
        if (result.status === "conflict") {
          operation.status = "conflict";
          operation.lastError = "Conflicto de campos";
          await this.queue.update(operation);
          this.emit({ type: "conflict", operation: clone(operation), conflict: result.conflict });
          return result;
        }
        operation.status = "applied";
        operation.appliedAt = nowIso();
        operation.lastError = null;
        await this.queue.update(operation);
        this.emit({ type: "operationApplied", operation: clone(operation), result });
        return result;
      } catch (error) {
        operation.lastError = error?.message || String(error);
        const code = error?.code || "";
        const retryable = RETRYABLE_CODES.has(code) || /offline|network|temporar|cloud/i.test(operation.lastError);
        const connectionUnavailable = /offline|network/i.test(operation.lastError);
        operation.status = retryable && (connectionUnavailable || operation.attempts < this.maxAttempts) ? "pending" : "failed";
        await this.queue.update(operation);
        this.emit({ type: "operationFailed", operation: clone(operation), error: operation.lastError });
        if (operation.status === "pending" && !connectionUnavailable) {
          const delay = Math.min(this.retryBaseMs * (2 ** Math.max(0, operation.attempts - 1)), this.retryBaseMs * 8);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return this.process(operation);
        }
        return { status: operation.status, error };
      }
    }

    async applyOperation(operation) {
      const entity = normalizeEntityKey(operation.entity);
      if (!entity) throw new Error(`Entidad no soportada: ${operation.entity}`);
      if (typeof this.remote.getOperation === "function") {
        const receipt = await this.remote.getOperation(operation.operationId);
        if (receipt) return { status: "applied", duplicate: true };
      }
      const remote = await this.remote.getDocument(entity, operation.entityId);

      if (remote?.lastOperationId === operation.operationId) return { status: "applied", duplicate: true };

      // A device can enqueue a valid local edit while it is offline, before
      // another device closes that business day. Once reconnected, never
      // apply that stale operation silently over the closing. Keep it in the
      // conflict queue for explicit review instead.
      if (["orders", "expenses", "supplyMovements"].includes(entity)) {
        const dateValue = operation.changes?.createdAt || operation.changes?.date || remote?.createdAt || remote?.date || operation.createdAtClient;
        const dateKey = this.localDateKey(dateValue);
        if (dateKey) {
          const closings = await this.remote.getCollection("closings");
          const closing = closings.find((item) => String(item.dateKey || item.date || "") === dateKey);
          if (closing) {
            const conflict = await this.conflictManager.record(operation, remote, ["closedDay"]);
            return { status: "conflict", conflict, reason: "closed-day" };
          }
        }
      }

      if (operation.type === "create") {
        if (remote) {
          if (remote.lastOperationId === operation.operationId || remote.sourceOperationId === operation.operationId) return { status: "applied", duplicate: true };
          const conflict = await this.conflictManager.record(operation, remote, operation.changedFields);
          return { status: "conflict", conflict };
        }
        await this.remote.create(entity, operation.entityId, this.operationDocument(operation, null));
        await this.recordOperation(operation);
        return { status: "applied" };
      }

      if (!remote) {
        const conflict = await this.conflictManager.record(operation, null, operation.changedFields);
        return { status: "conflict", conflict };
      }

      if (operation.type === "delete") {
        if (remote.lastOperationId === operation.operationId) return { status: "applied", duplicate: true };
        await this.remote.patch(entity, operation.entityId, this.operationDocument(operation, remote));
        await this.recordOperation(operation);
        return { status: "applied" };
      }

      const remoteChangedFields = operation.changedFields.filter((field) => Number(remote.fieldVersions?.[field] || 0) > Number(operation.baseRevision || 0));
      if (remoteChangedFields.length) {
        const conflict = await this.conflictManager.record(operation, remote, remoteChangedFields);
        return { status: "conflict", conflict };
      }
      if (isTerminalStatus(remote.status) && operation.changes.status && operation.changes.status !== remote.status) {
        const conflict = await this.conflictManager.record(operation, remote, ["status"]);
        return { status: "conflict", conflict };
      }
      await this.remote.patch(entity, operation.entityId, this.operationDocument(operation, remote));
      await this.recordOperation(operation);
      return { status: "applied" };
    }

    localDateKey(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    async recordOperation(operation) {
      if (typeof this.remote.recordOperation === "function") await this.remote.recordOperation(operation);
    }

    operationDocument(operation, remote) {
      const nextRevision = Number(remote?.revision || operation.baseRevision || 0) + 1;
      const fieldVersions = { ...(remote?.fieldVersions || {}) };
      operation.changedFields.forEach((field) => { fieldVersions[field] = nextRevision; });
      const document = {
        ...clone(operation.changes),
        revision: nextRevision,
        schemaVersion: 2,
        lastOperationId: operation.operationId,
        lastDeviceId: operation.deviceId,
        updatedBy: operation.userId,
        updatedAt: nowIso(),
        fieldVersions,
      };
      if (!remote) {
        document.createdAt = operation.createdAtClient || nowIso();
        document.createdBy = operation.userId;
        document.sourceOperationId = operation.operationId;
      }
      if (operation.type === "delete") document.deletedAt = nowIso();
      return document;
    }

    async startRealtimeListeners({ waitForInitialSnapshots = true } = {}) {
      if (!this.realtime) {
        this.realtimeReady = true;
        this.setConnectionState("REALTIME_READY", { listeners: 0 });
        return this.getRealtimeDiagnostics();
      }
      if (this.listenersActive && this.listenerStartPromise) return this.listenerStartPromise;
      if (this.listenersActive && this.realtimeReady) return this.getRealtimeDiagnostics();
      const generation = ++this.listenerGeneration;
      this.listenersActive = true;
      this.realtimeReady = false;
      this.initialSnapshotEntities = new Set();
      this.setConnectionState("ATTACHING_LISTENERS", { generation });
      this.listenerStartPromise = this.attachAllRealtimeListeners(generation, waitForInitialSnapshots)
        .catch((error) => {
          if (generation === this.listenerGeneration) {
            this.realtimeReady = false;
            this.setConnectionState("CONNECTING", { generation, error: error?.message || String(error) });
            this.emit({ type: "listenerStartFailed", generation, error: error?.message || String(error) });
          }
          throw error;
        })
        .finally(() => { if (generation === this.listenerGeneration) this.listenerStartPromise = null; });
      this.realtimeReadyPromise = this.listenerStartPromise;
      return this.listenerStartPromise;
    }
    async attachAllRealtimeListeners(generation, waitForInitialSnapshots) {
      for (const entity of ENTITY_KEYS) await this.attachRealtimeListener(entity, generation);
      if (generation !== this.listenerGeneration || !this.listenersActive) return this.getRealtimeDiagnostics();
      if (waitForInitialSnapshots && this.initialSnapshotEntities.size !== ENTITY_KEYS.length) {
        throw new Error("Snapshots iniciales incompletos: " + this.initialSnapshotEntities.size + "/" + ENTITY_KEYS.length);
      }
      this.realtimeReady = true;
      this.setConnectionState("REALTIME_READY", { generation, listeners: this.listenerSubscriptions.size, initialSnapshots: this.initialSnapshotEntities.size });
      return this.getRealtimeDiagnostics();
    }

    async attachRealtimeListener(entity, generation) {
      if (this.listenerSubscriptions.has(entity)) return;
      if (this.listenerStarts.has(entity)) return this.listenerStarts.get(entity);
      const task = (async () => {
        await new Promise((resolve, reject) => {
          let settled = false;
          let initialReceived = false;
          const finish = () => { if (settled) return; settled = true; resolve(); };
          const onSnapshot = (items) => {
            if (generation !== this.listenerGeneration || !this.listenersActive) { finish(); return; }
            Promise.resolve(this.applyRemoteCollection(entity, items, generation))
              .catch((error) => this.emit({ type: "listenerApplyFailed", entity, generation, error: error?.message || String(error) }))
              .finally(() => {
                if (!initialReceived) { initialReceived = true; this.initialSnapshotEntities.add(entity); }
                finish();
              });
          };
          const onError = (error) => {
            if (generation === this.listenerGeneration) this.emit({ type: "listenerError", entity, generation, error: error?.message || String(error) });
            finish();
          };
          Promise.resolve(this.remote.subscribe(entity, onSnapshot, onError)).then((unsubscribe) => {
            if (typeof unsubscribe !== "function") { finish(); return; }
            if (generation !== this.listenerGeneration || !this.listenersActive) { try { unsubscribe(); } catch {} finish(); return; }
            if (this.listenerSubscriptions.has(entity)) { try { unsubscribe(); } catch {} finish(); return; }
            this.listenerSubscriptions.set(entity, { generation, unsubscribe });
            this.unsubscribe.push(unsubscribe);
          }).catch(reject);
        });
      })();
      this.listenerStarts.set(entity, task);
      try { return await task; }
      finally { if (this.listenerStarts.get(entity) === task) this.listenerStarts.delete(entity); }
    }
    async applyRemoteCollection(entity, items, generation = this.listenerGeneration) {
      if (!this.currentState || generation !== this.listenerGeneration || !this.listenersActive) return;
      const nextState = clone(this.currentState);
      const remoteItems = items.filter((item) => !item.deletedAt);
      const remoteIds = new Set(remoteItems.map((item) => item.id));
      const pending = await this.queue.pending();
      if (generation !== this.listenerGeneration || !this.listenersActive) return;
      const pendingIds = new Set(pending.filter((operation) => operation.entity === entity && ["pending", "sending", "conflict"].includes(operation.status)).map((operation) => operation.entityId));
      const localById = new Map((this.currentState[entity] || []).map((item) => [item.id, item]));
      const localPending = [...pendingIds].filter((id) => !remoteIds.has(id) && localById.has(id)).map((id) => clone(localById.get(id)));
      nextState[entity] = [...remoteItems, ...localPending];
      this.setCurrentState(nextState);
      this.emit({ type: "remoteUpdate", entity, count: items.length, generation });
      if (typeof this.onStateChange === "function") this.onStateChange(clone(nextState));
    }

    stopRealtimeListeners() {
      this.listenerGeneration += 1;
      this.listenersActive = false;
      this.realtimeReady = false;
      const uniqueUnsubscribers = new Set(this.unsubscribe);
      this.listenerSubscriptions.forEach(({ unsubscribe }) => uniqueUnsubscribers.add(unsubscribe));
      uniqueUnsubscribers.forEach((unsubscribe) => { try { unsubscribe(); } catch {} });
      this.listenerSubscriptions.clear();
      this.unsubscribe = [];
      this.listenerStarts.clear();
      this.initialSnapshotEntities = new Set();
      this.realtimeReadyPromise = Promise.resolve();
      this.setConnectionState("LOCAL_READY", { reason: "listeners-stopped" });
    }
  }

  global.RapiditaSyncV2 = {
    ENTITY_KEYS,
    IndexedDbV2,
    SyncQueue,
    FirestoreV2,
    ConflictManager,
    SyncEngine,
    createOperationId: () => uuid("op"),
    getDeviceId,
  };
}(window));
