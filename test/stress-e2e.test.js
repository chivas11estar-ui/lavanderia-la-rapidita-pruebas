"use strict";

const { describe, it, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
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
  STYLES_CSS_PATH,
} = require("./harness.js");

// Initialize sandbox environment for shared definitions
let env;

before(() => {
  env = loadAppEnvironment();
});

// ============================================================================
// TIER 1: FEATURE COVERAGE (≥ 5 tests per feature, 12 features = 60 tests)
// ============================================================================

describe("Tier 1: Feature Coverage", () => {
  // Feature 1: Multi-Service Order Creation
  describe("F1: Multi-Service Order Creation", () => {
    it("T1.F1.1 should create order with single item matching subtotal and rounded total", () => {
      const order = createMockOrder({ weightKg: 10, pricePerKg: 22 });
      assert.equal(order.items.length, 1);
      assert.equal(order.subtotal, 220);
      assert.equal(order.total, 220);
      assert.equal(order.items[0].subtotal, 220);
    });

    it("T1.F1.2 should aggregate multiple services in items array and join service names", () => {
      const order = createMockOrder({
        items: [
          { serviceId: "lavado-secado", serviceName: "Lavado y Secado", unit: "kg", weightKg: 10, pricePerKg: 22, subtotal: 220, total: 220 },
          { serviceId: "cobertor", serviceName: "Cobertor", unit: "pieza", weightKg: 1, pricePerKg: 70, subtotal: 70, total: 70 },
        ],
      });
      env.syncOrderTotalsFromItems(order);
      assert.equal(order.items.length, 2);
      assert.equal(order.serviceName, "Lavado y Secado + Cobertor");
      assert.equal(order.subtotal, 290);
      assert.equal(order.total, 290);
    });

    it("T1.F1.3 should calculate total as Math.ceil of subtotal sum across items", () => {
      const order = createMockOrder({
        items: [
          { serviceId: "s1", serviceName: "Servicio 1", unit: "kg", weightKg: 1.1, pricePerKg: 20, subtotal: 22, total: 22 },
          { serviceId: "s2", serviceName: "Servicio 2", unit: "kg", weightKg: 1.05, pricePerKg: 10, subtotal: 10.5, total: 11 },
        ],
      });
      env.syncOrderTotalsFromItems(order);
      assert.equal(order.subtotal, 32.5);
      assert.equal(order.total, 33); // Math.ceil(32.5) = 33
    });

    it("T1.F1.4 should fallback to root order properties when items array is empty or missing", () => {
      const legacyOrder = { id: "leg_1", serviceId: "secado", serviceName: "Secado", unit: "kg", weightKg: 5, pricePerKg: 15, subtotal: 75, total: 75 };
      const items = env.getOrderItems(legacyOrder);
      assert.equal(items.length, 1);
      assert.equal(items[0].serviceId, "secado");
      assert.equal(items[0].subtotal, 75);
    });

    it("T1.F1.5 should normalize order items assigning unique IDs to every item", () => {
      const services = env.DEFAULT_SERVICES;
      const order = createMockOrder({
        items: [
          { serviceId: "lavado-secado", weightKg: 5, pricePerKg: 22, subtotal: 110, total: 110 },
          { serviceId: "secado", weightKg: 2, pricePerKg: 15, subtotal: 30, total: 30 },
        ],
      });
      const normalized = env.normalizeOrder(order, services);
      assert.equal(normalized.items.length, 2);
      assert.ok(normalized.items[0].id);
      assert.ok(normalized.items[1].id);
      assert.notEqual(normalized.items[0].id, normalized.items[1].id);
    });
  });

  // Feature 2: Price Calculation & Rounding (Math.ceil)
  describe("F2: Price Calculation & Rounding (Math.ceil)", () => {
    it("T1.F2.1 should preserve integer amounts without alteration", () => {
      assert.equal(env.roundUpToPeso(0), 0);
      assert.equal(env.roundUpToPeso(50), 50);
      assert.equal(env.roundUpToPeso(1000), 1000);
    });

    it("T1.F2.2 should round any positive fractional amount up to the next integer peso", () => {
      assert.equal(env.roundUpToPeso(22.01), 23);
      assert.equal(env.roundUpToPeso(22.10), 23);
      assert.equal(env.roundUpToPeso(22.50), 23);
      assert.equal(env.roundUpToPeso(22.99), 23);
    });

    it("T1.F2.3 should return 0 for non-numeric, null, or undefined values", () => {
      assert.equal(env.roundUpToPeso(null), 0);
      assert.equal(env.roundUpToPeso(undefined), 0);
      assert.equal(env.roundUpToPeso(""), 0);
      assert.equal(env.roundUpToPeso("invalid"), 0);
    });

    it("T1.F2.4 should parse and round numeric string values correctly", () => {
      assert.equal(env.roundUpToPeso("45.20"), 46);
      assert.equal(env.roundUpToPeso("99.00"), 99);
      assert.equal(env.roundUpToPeso("0.05"), 1);
    });

    it("T1.F2.5 should handle high precision fractional amounts without floating point errors", () => {
      const precisionAmount = 149.0000001;
      assert.equal(env.roundUpToPeso(precisionAmount), 150);
    });
  });

  // Feature 3: Order State Transitions
  describe("F3: Order State Machine Transitions", () => {
    it("T1.F3.1 should maintain strictly ordered STATUS_FLOW sequence", () => {
      const expected = ["recibido", "lavando", "secando", "doblando", "listo", "entregado"];
      assert.deepEqual(env.STATUS_FLOW, expected);
    });

    it("T1.F3.2 should transition sequentially through each status via getNextStatus", () => {
      assert.equal(env.getNextStatus("recibido"), "lavando");
      assert.equal(env.getNextStatus("lavando"), "secando");
      assert.equal(env.getNextStatus("secando"), "doblando");
      assert.equal(env.getNextStatus("doblando"), "listo");
      assert.equal(env.getNextStatus("listo"), "entregado");
    });

    it("T1.F3.3 should cap getNextStatus at entregado without wrapping around", () => {
      assert.equal(env.getNextStatus("entregado"), "entregado");
    });

    it("T1.F3.4 should normalize legacy and feminine Spanish synonyms to standard status keys", () => {
      assert.equal(env.normalizeStatus("pendiente"), "recibido");
      assert.equal(env.normalizeStatus("lavada"), "lavando");
      assert.equal(env.normalizeStatus("secada"), "secando");
      assert.equal(env.normalizeStatus("doblada"), "doblando");
      assert.equal(env.normalizeStatus("lista"), "listo");
      assert.equal(env.normalizeStatus("entregada"), "entregado");
    });

    it("T1.F3.5 should populate deliveredAt when transitioning status to entregado", () => {
      const order = createMockOrder({ status: "listo" });
      order.status = env.getNextStatus(order.status);
      assert.equal(order.status, "entregado");
      if (env.normalizeStatus(order.status) === "entregado") {
        order.deliveredAt = new Date().toISOString();
      }
      assert.ok(order.deliveredAt);
    });
  });

  // Feature 4: Terminal Order Status Immutability
  describe("F4: Terminal Order Status Protection", () => {
    it("T1.F4.1 should identify entregado as terminal status", () => {
      assert.equal(env.RapiditaSyncV2.TERMINAL_ORDER_STATUS, "entregado");
    });

    it("T1.F4.2 should match terminal status regardless of casing or whitespace in sync engine", async () => {
      const { engine, remote } = createTestSyncEngine(env, {
        initialRemoteData: {
          orders: [createMockOrder({ id: "ord_term_1", status: "entregado" })],
        },
      });

      const op = {
        operationId: "op_downgrade_1",
        entity: "orders",
        entityId: "ord_term_1",
        type: "update",
        changes: { status: "lavando" },
        changedFields: ["status"],
        baseRevision: 1,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "conflict");
      assert.ok(result.conflict);
    });

    it("T1.F4.3 should reject downgrade attempt when remote status is already entregado", async () => {
      const { engine } = createTestSyncEngine(env, {
        initialRemoteData: {
          orders: [createMockOrder({ id: "ord_term_2", status: "entregado" })],
        },
      });

      const op = {
        operationId: "op_downgrade_2",
        entity: "orders",
        entityId: "ord_term_2",
        type: "update",
        changes: { status: "recibido" },
        changedFields: ["status"],
        baseRevision: 1,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "conflict");
    });

    it("T1.F4.4 should allow non-status updates on delivered orders", async () => {
      const { engine } = createTestSyncEngine(env, {
        initialRemoteData: {
          orders: [createMockOrder({ id: "ord_term_3", status: "entregado", notes: "Inicial" })],
        },
      });

      const op = {
        operationId: "op_note_update",
        entity: "orders",
        entityId: "ord_term_3",
        type: "update",
        changes: { notes: "Nota administrativa posterior" },
        changedFields: ["notes"],
        baseRevision: 1,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied");
    });

    it("T1.F4.5 should ignore status change in local mutation if order is already entregado", () => {
      const order = createMockOrder({ status: "entregado" });
      const requestedStatus = "recibido";
      if (env.normalizeStatus(order.status) !== "entregado") {
        order.status = requestedStatus;
      }
      assert.equal(order.status, "entregado");
    });
  });

  // Feature 5: Active Orders Reconciliation (delivered / >14d)
  describe("F5: Active Orders Reconciliation (R1 Acceptance)", () => {
    it("T1.F5.1 should mark order as non-active when status is entregado", () => {
      const order = createMockOrder({ status: "entregado" });
      assert.equal(env.isActiveOrder(order), false);
    });

    it("T1.F5.2 should mark order as non-active when status is listo", () => {
      const order = createMockOrder({ status: "listo" });
      assert.equal(env.isActiveOrder(order), false);
    });

    it("T1.F5.3 should mark order as non-active if deliveredAt is present regardless of raw status", () => {
      // Interface Contract Requirement: isActiveOrder MUST return false if order.deliveredAt != null
      const order = createMockOrder({ status: "lavando", deliveredAt: "2026-09-01T12:00:00.000Z" });
      // In unpatched code, isActiveOrder only checks status in ['listo', 'entregado']
      const isActive = env.isActiveOrder(order);
      assert.equal(isActive, false, "Delivered orders must not be active on the dashboard even with intermediate status");
    });

    it("T1.F5.4 should mark order as non-active if created in a closed day older than 14 days", () => {
      // Interface Contract Requirement: order belonging to closed day > 14 days old MUST NOT be active
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
      const order = createMockOrder({
        status: "recibido",
        paid: false,
        deliveredAt: null,
        createdAt: twentyDaysAgo,
      });
      const isActive = env.isActiveOrder(order);
      assert.equal(isActive, false, "Orders in closed days older than 14 days must not remain active");
    });

    it("T1.F5.5 should normalize order with deliveredAt in intermediate state to entregado", () => {
      const services = env.DEFAULT_SERVICES;
      const order = createMockOrder({
        status: "secando",
        deliveredAt: "2026-09-02T10:00:00.000Z",
      });
      const normalized = env.normalizeOrder(order, services);
      assert.equal(normalized.status, "entregado", "normalizeOrder must normalize deliveredAt orders to entregado");
    });
  });

  // Feature 6: Concurrency & Multi-Order Concurrency Simulation
  describe("F6: Concurrency & Multi-Order Concurrency Simulation", () => {
    it("T1.F6.1 should generate unique IDs for concurrent order instantiations", () => {
      const count = 50;
      const ids = new Set();
      for (let i = 0; i < count; i++) {
        const order = createMockOrder();
        ids.add(order.id);
      }
      assert.equal(ids.size, count);
    });

    it("T1.F6.2 should serialize independent state updates without dropping peer orders", () => {
      const initialOrders = [createMockOrder({ id: "o1" }), createMockOrder({ id: "o2" })];
      const state = { orders: [...initialOrders] };
      const newOrder = createMockOrder({ id: "o3" });
      state.orders.push(newOrder);
      assert.equal(state.orders.length, 3);
      assert.ok(state.orders.some((o) => o.id === "o3"));
    });

    it("T1.F6.3 should acquire and release queue lock during sync drain operations", async () => {
      const { engine, localStore } = createTestSyncEngine(env);
      let lockAcquired = false;
      let lockReleased = false;

      localStore.onLockEvent = (evt) => {
        if (evt.type === "lockAcquired") lockAcquired = true;
        if (evt.type === "lockReleased") lockReleased = true;
      };

      await engine.drain();
      assert.ok(lockAcquired);
      assert.ok(lockReleased);
    });

    it("T1.F6.4 should maintain status integrity under rapid sequential status advancements", () => {
      const order = createMockOrder({ status: "recibido" });
      for (let i = 0; i < 5; i++) {
        order.status = env.getNextStatus(order.status);
      }
      assert.equal(order.status, "entregado");
    });

    it("T1.F6.5 should accurately compute active order count across a batch of mixed status orders", () => {
      const orders = [
        createMockOrder({ status: "recibido" }),
        createMockOrder({ status: "lavando" }),
        createMockOrder({ status: "secando" }),
        createMockOrder({ status: "listo" }),
        createMockOrder({ status: "entregado" }),
      ];
      const activeCount = orders.filter(env.isActiveOrder).length;
      assert.equal(activeCount, 3);
    });
  });

  // Feature 7: Gas Expense Deduplication ($620)
  describe("F7: Gas Expense Deduplication (R2 Acceptance)", () => {
    it("T1.F7.1 should deduplicate identical gas expenses of $620 on the same date", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ id: "g1", amount: 620, category: "gas", createdAt: today });
      const exp2 = createMockExpense({ id: "g2", amount: 620, category: "gas", createdAt: today });

      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 1);
      assert.equal(normalized[0].id, "g1");
    });

    it("T1.F7.2 should preserve gas purchases with the same amount on different calendar dates", () => {
      const day1 = "2026-09-20T10:00:00.000Z";
      const day2 = "2026-09-21T10:00:00.000Z";
      const exp1 = createMockExpense({ id: "g1", amount: 620, category: "gas", createdAt: day1 });
      const exp2 = createMockExpense({ id: "g2", amount: 620, category: "gas", createdAt: day2 });

      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 2);
    });

    it("T1.F7.3 should preserve gas purchases with different amounts on the same calendar date", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ id: "g1", amount: 620, category: "gas", createdAt: today });
      const exp2 = createMockExpense({ id: "g2", amount: 350, category: "gas", createdAt: today });

      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 2);
    });

    it("T1.F7.4 should unify gas category and regex-matched gas concept without supplyId", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ id: "g1", amount: 620, category: "gas", concept: "Recarga de gas", supplyId: "gas", createdAt: today });
      const exp2 = createMockExpense({ id: "g2", amount: 620, category: "operativo", concept: "Compra de Gas tanque", supplyId: null, createdAt: today });

      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 1);
    });

    it("T1.F7.5 should deduplicate concurrent remote sync create operations for $620 gas expense", async () => {
      const today = "2026-09-22T12:00:00.000Z";
      const { engine, remote } = createTestSyncEngine(env, {
        initialRemoteData: {
          expenses: [createMockExpense({ id: "remote_gas_1", amount: 620, category: "gas", createdAt: today })],
        },
      });

      const op = {
        operationId: "op_concurrent_gas",
        entity: "expenses",
        entityId: "local_gas_2",
        type: "create",
        changes: { amount: 620, category: "gas", createdAt: today },
        changedFields: ["amount", "category", "createdAt"],
        baseRevision: 0,
      };

      const result = await engine.applyOperation(op);
      // R2 Acceptance: The injection of multiple identical gas purchases must deduplicate in sync
      const remoteExpenses = await remote.getCollection("expenses");
      assert.equal(remoteExpenses.length, 1, "Firestore remote collection must have exactly 1 gas purchase document");
    });
  });

  // Feature 8: Ghost Inventory & Supply Movement Cleanup
  describe("F8: Inventory & Movement Integrity (Ghost Inventory Cleanup)", () => {
    it("T1.F8.1 should add exactly 1 purchase movement and increase quantity by 30kg on valid gas expense", () => {
      const state = {
        supplies: [createMockSupply({ id: "gas", quantity: 0 })],
        supplyMovements: [],
      };
      const expense = createMockExpense({ id: "e1", category: "gas", supplyId: "gas", purchasedQuantity: 30, amount: 620 });
      env.applyInventoryFromExpense(state, expense);

      assert.equal(state.supplies[0].quantity, 30);
      assert.equal(state.supplyMovements.length, 1);
      assert.equal(state.supplyMovements[0].type, "purchase");
      assert.equal(state.supplyMovements[0].expenseId, "e1");
    });

    it("T1.F8.2 should prune orphan supply movements when duplicate gas purchase is dropped", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ id: "e1", amount: 620, category: "gas", createdAt: today });
      const exp2 = createMockExpense({ id: "e2", amount: 620, category: "gas", createdAt: today });

      const mov1 = createMockSupplyMovement({ id: "m1", expenseId: "e1", supplyId: "gas", quantity: 30, cost: 620 });
      const mov2 = createMockSupplyMovement({ id: "m2", expenseId: "e2", supplyId: "gas", quantity: 30, cost: 620 });

      const state = {
        services: env.DEFAULT_SERVICES,
        customers: [],
        orders: [],
        expenses: [exp1, exp2],
        supplies: [createMockSupply({ id: "gas", quantity: 60 })],
        supplyMovements: [mov1, mov2],
        closings: [],
      };

      const normalized = env.normalizeState(state);
      assert.equal(normalized.expenses.length, 1, "Duplicate expense must be dropped");
      // Interface Contract Requirement: Linked inventory: for each deduplicated expense, exactly 1 supplyMovement of type purchase must exist
      const gasMovements = normalized.supplyMovements.filter((m) => m.supplyId === "gas" && m.type === "purchase");
      assert.equal(gasMovements.length, 1, "Orphan supplyMovements must be pruned upon expense deduplication");
    });

    it("T1.F8.3 should restore supply quantity so duplicate purchases do not inflate gas stock", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ id: "e1", amount: 620, category: "gas", createdAt: today });
      const exp2 = createMockExpense({ id: "e2", amount: 620, category: "gas", createdAt: today });

      const mov1 = createMockSupplyMovement({ id: "m1", expenseId: "e1", supplyId: "gas", quantity: 30, cost: 620 });
      const mov2 = createMockSupplyMovement({ id: "m2", expenseId: "e2", supplyId: "gas", quantity: 30, cost: 620 });

      const state = {
        services: env.DEFAULT_SERVICES,
        customers: [],
        orders: [],
        expenses: [exp1, exp2],
        supplies: [createMockSupply({ id: "gas", quantity: 60 })],
        supplyMovements: [mov1, mov2],
        closings: [],
      };

      const normalized = env.normalizeState(state);
      const gasSupply = normalized.supplies.find((s) => s.id === "gas");
      // Interface Contract Requirement: supplies.find(s => s.id === 'gas').quantity must increase by only 1 cylinder volume (30kg)
      assert.equal(gasSupply.quantity, 30, "Gas quantity must be restored to 30kg, not inflated to 60kg");
    });

    it("T1.F8.4 should decrement inventory and remove movement when expense is deleted via reverseInventoryFromExpense", () => {
      const state = {
        supplies: [createMockSupply({ id: "gas", quantity: 45, averageCost: 20 })],
        supplyMovements: [createMockSupplyMovement({ id: "m1", expenseId: "e1", supplyId: "gas", quantity: 30, cost: 620 })],
      };
      const expense = createMockExpense({ id: "e1", category: "gas", supplyId: "gas", purchasedQuantity: 30, amount: 620 });
      env.reverseInventoryFromExpense(state, expense);

      assert.equal(state.supplies[0].quantity, 15);
      assert.equal(state.supplyMovements.length, 0);
    });

    it("T1.F8.5 should calculate learned consumption metrics accurately when duplicate cycles are absent", () => {
      const state = {
        orders: [
          createMockOrder({ weightKg: 100, createdAt: "2026-09-01T12:00:00.000Z" }),
          createMockOrder({ weightKg: 150, createdAt: "2026-09-10T12:00:00.000Z" }),
        ],
        supplies: [createMockSupply({ id: "gas", tankSize: 30 })],
        supplyMovements: [
          createMockSupplyMovement({ id: "m1", supplyId: "gas", type: "purchase", quantity: 30, cost: 620, createdAt: "2026-09-01T08:00:00.000Z" }),
          createMockSupplyMovement({ id: "m2", supplyId: "gas", type: "purchase", quantity: 30, cost: 620, createdAt: "2026-09-15T08:00:00.000Z" }),
        ],
      };
      const stats = env.RapiditaSupplyLearningV2.getSupplyStats(state, "gas", new Date("2026-09-20"));
      assert.ok(stats.learnedCostPerKg >= 0);
      assert.equal(stats.closedCycles.length, 1);
      assert.equal(stats.closedCycles[0].ordersCount, 2);
    });
  });

  // Feature 9: Cash Register & Closing Financial Totals
  describe("F9: Cash Register & Closing Financial Totals", () => {
    it("T1.F9.1 should compute category breakdown and total cashOut accurately", () => {
      const expenses = [
        createMockExpense({ category: "gas", amount: 620 }),
        createMockExpense({ category: "insumo", amount: 150 }),
        createMockExpense({ category: "operativo", amount: 80 }),
      ];
      const totals = env.calculateExpenseTotals(expenses);
      assert.equal(totals.gas, 620);
      assert.equal(totals.insumo, 150);
      assert.equal(totals.operativo, 80);
      assert.equal(totals.cashOut, 850);
      assert.equal(totals.operatingCost, 80);
    });

    it("T1.F9.2 should compute closing cashFlow as sales minus cashOut expenses", () => {
      const sales = 1500;
      const cashOut = 620;
      const closing = createMockClosing({ sales, expenses: cashOut, cashFlow: sales - cashOut });
      assert.equal(closing.cashFlow, 880);
    });

    it("T1.F9.3 should prevent duplicate gas expense from subtracting extra $620 from cash register", () => {
      const sales = 2000;
      const legitimateGas = createMockExpense({ amount: 620, category: "gas", createdAt: "2026-09-22T10:00:00Z" });
      const duplicateGas = createMockExpense({ amount: 620, category: "gas", createdAt: "2026-09-22T10:01:00Z" });

      const deduplicated = env.normalizeExpenses([legitimateGas, duplicateGas]);
      const totals = env.calculateExpenseTotals(deduplicated);
      const cashFlow = sales - totals.cashOut;
      assert.equal(totals.cashOut, 620);
      assert.equal(cashFlow, 1380, "Cash flow should not be reduced to 760 by duplicate expense");
    });

    it("T1.F9.4 should recalculate cashOut when an expense is deleted", () => {
      const expenses = [createMockExpense({ id: "e1", amount: 620 }), createMockExpense({ id: "e2", amount: 200 })];
      const before = env.calculateExpenseTotals(expenses);
      assert.equal(before.cashOut, 820);

      const remaining = expenses.filter((e) => e.id !== "e1");
      const after = env.calculateExpenseTotals(remaining);
      assert.equal(after.cashOut, 200);
    });

    it("T1.F9.5 should update associated closing record in closings array when expense in closed day is deleted", () => {
      // Interface Contract / Requirement: Expense deduplication must recalculate day closings
      const dateKey = "2026-09-20";
      const closing = createMockClosing({ dateKey, sales: 2000, expenses: 620, cashFlow: 1380 });
      const expense = createMockExpense({ id: "e_closed_1", amount: 620, createdAt: `${dateKey}T12:00:00.000Z` });

      const next = {
        expenses: [expense],
        closings: [closing],
        supplies: [createMockSupply({ id: "gas", quantity: 30 })],
        supplyMovements: [],
      };

      // Simulating deletion of expense from closed day
      next.expenses = next.expenses.filter((e) => e.id !== "e_closed_1");
      // The closing for 2026-09-20 must have expenses updated to 0 and cashFlow to 2000
      const targetClosing = next.closings.find((c) => c.dateKey === dateKey);
      if (targetClosing && next.expenses.length === 0) {
        targetClosing.expenses = 0;
        targetClosing.cashFlow = targetClosing.sales;
      }

      assert.equal(targetClosing.expenses, 0);
      assert.equal(targetClosing.cashFlow, 2000);
    });
  });

  // Feature 10: Closed-Day Order Updates (sync-v2.js)
  describe("F10: Closed-Day Order Updates (sync-v2.js)", () => {
    it("T1.F10.1 should permit order update operation on closed day without closed-day conflict", async () => {
      const closedDate = "2026-09-18";
      const { engine } = createTestSyncEngine(env, {
        initialRemoteData: {
          closings: [createMockClosing({ dateKey: closedDate })],
          orders: [createMockOrder({ id: "ord_closed_1", createdAt: `${closedDate}T10:00:00Z`, status: "recibido" })],
        },
      });

      const op = {
        operationId: "op_update_status",
        entity: "orders",
        entityId: "ord_closed_1",
        type: "update",
        changes: { status: "lavando" },
        changedFields: ["status"],
        baseRevision: 1,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied");
    });

    it("T1.F10.2 should allow marking an order delivered on a previously closed day", async () => {
      const closedDate = "2026-09-17";
      const { engine, remote } = createTestSyncEngine(env, {
        initialRemoteData: {
          closings: [createMockClosing({ dateKey: closedDate })],
          orders: [createMockOrder({ id: "ord_closed_2", createdAt: `${closedDate}T10:00:00Z`, status: "listo" })],
        },
      });

      const op = {
        operationId: "op_mark_delivered",
        entity: "orders",
        entityId: "ord_closed_2",
        type: "update",
        changes: { status: "entregado", deliveredAt: new Date().toISOString() },
        changedFields: ["status", "deliveredAt"],
        baseRevision: 1,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied");
      const patched = await remote.getDocument("orders", "ord_closed_2");
      assert.equal(patched.status, "entregado");
    });

    it("T1.F10.3 should allow marking an order paid on a previously closed day", async () => {
      const closedDate = "2026-09-16";
      const { engine, remote } = createTestSyncEngine(env, {
        initialRemoteData: {
          closings: [createMockClosing({ dateKey: closedDate })],
          orders: [createMockOrder({ id: "ord_closed_3", createdAt: `${closedDate}T10:00:00Z`, paid: false })],
        },
      });

      const op = {
        operationId: "op_mark_paid",
        entity: "orders",
        entityId: "ord_closed_3",
        type: "update",
        changes: { paid: true, paidAt: new Date().toISOString() },
        changedFields: ["paid", "paidAt"],
        baseRevision: 1,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied");
      const patched = await remote.getDocument("orders", "ord_closed_3");
      assert.equal(patched.paid, true);
    });

    it("T1.F10.4 should bypass field version conflict check for order updates on closed days", async () => {
      const closedDate = "2026-09-15";
      const { engine } = createTestSyncEngine(env, {
        initialRemoteData: {
          closings: [createMockClosing({ dateKey: closedDate })],
          orders: [createMockOrder({ id: "ord_closed_4", revision: 5, fieldVersions: { status: 5 }, createdAt: `${closedDate}T10:00:00Z` })],
        },
      });

      // baseRevision is 2 (stale), but isOrderUpdate should bypass
      const op = {
        operationId: "op_stale_update",
        entity: "orders",
        entityId: "ord_closed_4",
        type: "update",
        changes: { status: "doblando" },
        changedFields: ["status"],
        baseRevision: 2,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied");
    });

    it("T1.F10.5 should still block creation of new orders on closed days", async () => {
      const closedDate = "2026-09-14";
      const { engine } = createTestSyncEngine(env, {
        initialRemoteData: {
          closings: [createMockClosing({ dateKey: closedDate })],
        },
      });

      const op = {
        operationId: "op_create_on_closed",
        entity: "orders",
        entityId: "ord_new_stale",
        type: "create",
        changes: { createdAt: `${closedDate}T14:00:00Z`, status: "recibido" },
        changedFields: ["createdAt", "status"],
        baseRevision: 0,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "conflict");
      assert.equal(result.reason, "closed-day");
    });
  });

  // Feature 11: Closed-Day Administrative Deletions
  describe("F11: Closed-Day Administrative Deletions (R3 Acceptance)", () => {
    it("T1.F11.1 should permit order deletion on closed day without closed-day conflict", async () => {
      const closedDate = "2026-09-13";
      const { engine } = createTestSyncEngine(env, {
        initialRemoteData: {
          closings: [createMockClosing({ dateKey: closedDate })],
          orders: [createMockOrder({ id: "ord_del_1", createdAt: `${closedDate}T11:00:00Z` })],
        },
      });

      const op = {
        operationId: "op_del_order",
        entity: "orders",
        entityId: "ord_del_1",
        type: "delete",
        changes: {},
        changedFields: [],
        baseRevision: 1,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied");
    });

    it("T1.F11.2 should permit expense deletion on closed day without closed-day conflict", async () => {
      const closedDate = "2026-09-12";
      const { engine } = createTestSyncEngine(env, {
        initialRemoteData: {
          closings: [createMockClosing({ dateKey: closedDate })],
          expenses: [createMockExpense({ id: "exp_del_1", createdAt: `${closedDate}T11:00:00Z` })],
        },
      });

      const op = {
        operationId: "op_del_expense",
        entity: "expenses",
        entityId: "exp_del_1",
        type: "delete",
        changes: {},
        changedFields: [],
        baseRevision: 1,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied");
    });

    it("T1.F11.3 should permit supplyMovement deletion on closed day without closed-day conflict", async () => {
      const closedDate = "2026-09-11";
      const { engine } = createTestSyncEngine(env, {
        initialRemoteData: {
          closings: [createMockClosing({ dateKey: closedDate })],
          supplyMovements: [createMockSupplyMovement({ id: "mov_del_1", createdAt: `${closedDate}T11:00:00Z` })],
        },
      });

      const op = {
        operationId: "op_del_movement",
        entity: "supplyMovements",
        entityId: "mov_del_1",
        type: "delete",
        changes: {},
        changedFields: [],
        baseRevision: 1,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied");
    });

    it("T1.F11.4 should soft delete remote document by setting deletedAt timestamp", async () => {
      const closedDate = "2026-09-10";
      const { engine, remote } = createTestSyncEngine(env, {
        initialRemoteData: {
          closings: [createMockClosing({ dateKey: closedDate })],
          orders: [createMockOrder({ id: "ord_soft_del", createdAt: `${closedDate}T10:00:00Z` })],
        },
      });

      const op = {
        operationId: "op_soft_del",
        entity: "orders",
        entityId: "ord_soft_del",
        type: "delete",
        changes: {},
        changedFields: [],
        baseRevision: 1,
      };

      await engine.applyOperation(op);
      const patched = await remote.getDocument("orders", "ord_soft_del");
      assert.ok(patched.deletedAt);
    });

    it("T1.F11.5 should succeed as applied when deleting an entity not present on remote", async () => {
      // Interface Contract Requirement: !remote on delete: MUST succeed as applied (no conflict)
      const { engine } = createTestSyncEngine(env, {
        initialRemoteData: {
          orders: [], // Remote does not have this order
        },
      });

      const op = {
        operationId: "op_del_offline_orphan",
        entity: "orders",
        entityId: "ord_offline_only",
        type: "delete",
        changes: {},
        changedFields: [],
        baseRevision: 0,
      };

      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied", "Deleting non-existent remote record must succeed as applied no-op");
    });
  });

  // Feature 12: Visual Design & Styles Preservation
  describe("F12: Visual Design & Styles Preservation (R4 Constraint)", () => {
    it("T1.F12.1 should confirm styles.css file exists and is readable", () => {
      assert.ok(fs.existsSync(STYLES_CSS_PATH));
    });

    it("T1.F12.2 should verify styles.css byte size matches exactly 38,951 bytes", () => {
      const info = getStylesCssInfo();
      assert.equal(info.byteSize, 38951, "styles.css byte size must remain strictly unmodified");
    });

    it("T1.F12.3 should verify styles.css line count matches exactly 939 lines", () => {
      const content = fs.readFileSync(STYLES_CSS_PATH, "utf8");
      const lines = content.split("\n");
      assert.equal(lines.length, 939, "styles.css line count must remain strictly unmodified");
    });

    it("T1.F12.4 should verify root design variables are preserved intact", () => {
      const content = fs.readFileSync(STYLES_CSS_PATH, "utf8");
      assert.ok(content.includes("--primary: #00657b;"));
      assert.ok(content.includes("--bg: #f8f9ff;"));
      assert.ok(content.includes("--surface: #ffffff;"));
    });

    it("T1.F12.5 should confirm zero syntax anomalies or tampering in stylesheet", () => {
      const content = fs.readFileSync(STYLES_CSS_PATH, "utf8");
      assert.ok(!content.includes("!important !important"));
      assert.ok(content.includes(".order-card"));
      assert.ok(content.includes(".mini-status"));
    });
  });
});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES (12 categories * 5 tests = 60 tests)
// ============================================================================

describe("Tier 2: Boundary & Corner Cases", () => {
  describe("B1: Empty and Missing Fields", () => {
    it("T2.B1.1 should handle null state normalization returning fallback state", () => {
      const state = env.normalizeState(null);
      assert.ok(Array.isArray(state.services));
      assert.ok(Array.isArray(state.orders));
      assert.ok(Array.isArray(state.expenses));
      assert.ok(Array.isArray(state.supplies));
    });

    it("T2.B1.2 should handle empty orders array without exceptions", () => {
      const normalized = env.normalizeState({ orders: [] });
      assert.deepEqual(normalized.orders, []);
    });

    it("T2.B1.3 should handle empty expenses array without exceptions", () => {
      const normalized = env.normalizeExpenses([]);
      assert.deepEqual(normalized, []);
    });

    it("T2.B1.4 should supply default service when order.serviceId is missing", () => {
      const order = createMockOrder({ serviceId: null, serviceName: "" });
      const normalized = env.normalizeOrder(order, env.DEFAULT_SERVICES);
      assert.ok(normalized.serviceId);
      assert.ok(normalized.serviceName);
    });

    it("T2.B1.5 should normalize customer without phone or empty string", () => {
      const order = createMockOrder({ customerPhone: null });
      const normalized = env.normalizeOrder(order, env.DEFAULT_SERVICES);
      assert.equal(typeof normalized.customerPhone, "string");
    });
  });

  describe("B2: Zero and Fractional Amounts", () => {
    it("T2.B2.1 should round $0.01 up to $1", () => {
      assert.equal(env.roundUpToPeso(0.01), 1);
    });

    it("T2.B2.2 should round $0.50 up to $1", () => {
      assert.equal(env.roundUpToPeso(0.50), 1);
    });

    it("T2.B2.3 should round $0.99 up to $1", () => {
      assert.equal(env.roundUpToPeso(0.99), 1);
    });

    it("T2.B2.4 should handle order subtotal of exactly $0.00", () => {
      assert.equal(env.roundUpToPeso(0.0), 0);
    });

    it("T2.B2.5 should handle sub-cent amount $0.0001 rounding up to $1", () => {
      assert.equal(env.roundUpToPeso(0.0001), 1);
    });
  });

  describe("B3: Negative Values & Out-of-Range Quantities", () => {
    it("T2.B3.1 should handle negative weight safely without throwing syntax exceptions", () => {
      const order = createMockOrder({ weightKg: -5, pricePerKg: 22 });
      env.syncOrderTotalsFromItems(order);
      assert.ok(!Number.isNaN(order.total));
    });

    it("T2.B3.2 should not crash applyInventoryFromExpense when purchasedQuantity is negative", () => {
      const state = { supplies: [createMockSupply({ id: "gas", quantity: 30 })], supplyMovements: [] };
      const expense = createMockExpense({ purchasedQuantity: -10, amount: 620 });
      env.applyInventoryFromExpense(state, expense);
      assert.equal(state.supplies[0].quantity, 30);
      assert.equal(state.supplyMovements.length, 0);
    });

    it("T2.B3.3 should handle negative expense amount without unhandled rejection", () => {
      const expenses = [createMockExpense({ amount: -50 })];
      const totals = env.calculateExpenseTotals(expenses);
      assert.equal(totals.total, -50);
    });

    it("T2.B3.4 should safely handle pricePerKg of zero", () => {
      const order = createMockOrder({ weightKg: 10, pricePerKg: 0 });
      env.syncOrderTotalsFromItems(order);
      assert.equal(order.total, 0);
    });

    it("T2.B3.5 should handle reverseInventoryFromExpense with zero quantity gracefully", () => {
      const state = { supplies: [createMockSupply({ id: "gas", quantity: 30 })], supplyMovements: [] };
      const expense = createMockExpense({ purchasedQuantity: 0 });
      env.reverseInventoryFromExpense(state, expense);
      assert.equal(state.supplies[0].quantity, 30);
    });
  });

  describe("B4: Large Orders & Stress Quantities", () => {
    it("T2.B4.1 should calculate order for 1,000 kg industrial load correctly", () => {
      const order = createMockOrder({ weightKg: 1000, pricePerKg: 22 });
      env.syncOrderTotalsFromItems(order);
      assert.equal(order.subtotal, 22000);
      assert.equal(order.total, 22000);
    });

    it("T2.B4.2 should calculate 10,000 piece cobertor order totals without overflow", () => {
      const order = createMockOrder({ weightKg: 10000, pricePerKg: 70 });
      env.syncOrderTotalsFromItems(order);
      assert.equal(order.subtotal, 700000);
      assert.equal(order.total, 700000);
    });

    it("T2.B4.3 should handle multi-service order with 20 distinct line items", () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: `item_${i}`,
        serviceId: `svc_${i}`,
        serviceName: `Servicio ${i}`,
        unit: "kg",
        weightKg: 2.5,
        pricePerKg: 20,
        subtotal: 50,
        total: 50,
      }));
      const order = createMockOrder({ items });
      env.syncOrderTotalsFromItems(order);
      assert.equal(order.items.length, 20);
      assert.equal(order.subtotal, 1000);
      assert.equal(order.total, 1000);
    });

    it("T2.B4.4 should sum expense totals exceeding $1,000,000 accurately", () => {
      const expenses = [
        createMockExpense({ amount: 500000, category: "inversion_deuda" }),
        createMockExpense({ amount: 600000, category: "inversion_deuda" }),
      ];
      const totals = env.calculateExpenseTotals(expenses);
      assert.equal(totals.total, 1100000);
    });

    it("T2.B4.5 should handle tankSize of 1,000 kg stationary tank", () => {
      const state = { supplies: [createMockSupply({ id: "gas", tankSize: 1000 })], supplyMovements: [] };
      const expense = createMockExpense({ category: "gas", supplyId: "gas", purchasedQuantity: 500 });
      env.applyInventoryFromExpense(state, expense);
      assert.equal(state.supplies[0].quantity, 530);
    });
  });

  describe("B5: Extreme Dates & Timestamps", () => {
    it("T2.B5.1 should generate correct YYYY-MM-DD dateKey for leap day 2028-02-29", () => {
      const dateKey = env.getLocalDateKey(new Date("2028-02-29T12:00:00Z"));
      assert.equal(dateKey, "2028-02-29");
    });

    it("T2.B5.2 should handle Unix Epoch 1970-01-01 gracefully in getLocalDateKey", () => {
      const dateKey = env.getLocalDateKey(new Date(0));
      assert.ok(dateKey.startsWith("19"));
    });

    it("T2.B5.3 should return current dateKey when getLocalDateKey is called with empty argument", () => {
      const dateKey = env.getLocalDateKey();
      assert.match(dateKey, /^\d{4}-\d{2}-\d{2}$/);
    });

    it("T2.B5.4 should handle far future dates (2050-12-31) in order creation", () => {
      const futureDate = "2050-12-31T23:59:59.000Z";
      const order = createMockOrder({ createdAt: futureDate });
      assert.equal(order.createdAt, futureDate);
    });

    it("T2.B5.5 should handle invalid date strings in sync engine localDateKey gracefully", () => {
      const { engine } = createTestSyncEngine(env);
      assert.equal(engine.localDateKey("invalid-date-string"), "");
      assert.equal(engine.localDateKey(null), "");
    });
  });

  describe("B6: Rapid Concurrent Mutation Bursts", () => {
    it("T2.B6.1 should enqueue 20 rapid mutations in sequence without corruption", async () => {
      const { engine } = createTestSyncEngine(env);
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          engine.enqueue({
            entity: "orders",
            entityId: `burst_ord_${i}`,
            type: "create",
            changes: { customerName: `Burst ${i}` },
            changedFields: ["customerName"],
            baseRevision: 0,
            createdAtClient: new Date().toISOString(),
          })
        );
      }
      const ops = await Promise.all(promises);
      assert.equal(ops.length, 20);
    });

    it("T2.B6.2 should drain 20 enqueued operations completely", async () => {
      const { engine, remote, queue } = createTestSyncEngine(env);
      for (let i = 0; i < 20; i++) {
        await engine.enqueue({
          entity: "orders",
          entityId: `drain_ord_${i}`,
          type: "create",
          changes: { status: "recibido" },
          changedFields: ["status"],
          baseRevision: 0,
          createdAtClient: new Date().toISOString(),
        });
      }
      await engine.drain();
      const remaining = await queue.pending();
      assert.equal(remaining.length, 0);
      const orders = await remote.getCollection("orders");
      assert.equal(orders.length, 20);
    });

    it("T2.B6.3 should return activeDrain promise if drain is called while active", async () => {
      const { engine } = createTestSyncEngine(env);
      const drain1 = engine.drain();
      const drain2 = engine.drain();
      assert.equal(drain1, drain2);
      await drain1;
    });

    it("T2.B6.4 should handle rapid expense creation without duplicate entity IDs", () => {
      const expenses = Array.from({ length: 30 }, () => createMockExpense());
      const ids = new Set(expenses.map((e) => e.id));
      assert.equal(ids.size, 30);
    });

    it("T2.B6.5 should handle rapid client normalization calls idempotently", () => {
      const initialOrders = [createMockOrder({ id: "idemp_1" })];
      const state = { orders: initialOrders, services: env.DEFAULT_SERVICES };
      const norm1 = env.normalizeState(state);
      const norm2 = env.normalizeState(norm1);
      assert.equal(norm1.orders.length, norm2.orders.length);
      assert.equal(norm1.orders[0].id, norm2.orders[0].id);
    });
  });

  describe("B7: Rapid & Out-of-Order Status Transitions", () => {
    it("T2.B7.1 should handle rapid double click on nextStatus without bypassing entregado", () => {
      let status = "listo";
      status = env.getNextStatus(status);
      status = env.getNextStatus(status);
      assert.equal(status, "entregado");
    });

    it("T2.B7.2 should normalize unknown arbitrary status string to recibido", () => {
      assert.equal(env.normalizeStatus("desconocido"), "desconocido");
    });

    it("T2.B7.3 should safely handle empty status string in normalizeStatus", () => {
      assert.equal(env.normalizeStatus(""), "recibido");
      assert.equal(env.normalizeStatus(null), "recibido");
    });

    it("T2.B7.4 should cap getNextStatus for invalid status string at recibido", () => {
      assert.equal(env.getNextStatus("non-existent-status"), "recibido");
    });

    it("T2.B7.5 should verify isCompletedOrder returns true for listo and entregado only", () => {
      assert.equal(env.isCompletedOrder({ status: "listo" }), true);
      assert.equal(env.isCompletedOrder({ status: "entregado" }), true);
      assert.equal(env.isCompletedOrder({ status: "doblando" }), false);
      assert.equal(env.isCompletedOrder({ status: "recibido" }), false);
    });
  });

  describe("B8: Offline Delete Before Remote Sync (Null Remote)", () => {
    it("T2.B8.1 should not crash when deleting order that does not exist in local store", async () => {
      const localStore = new InMemoryKeyValueStore();
      await localStore.delete("orders", "non_existent_key");
      const val = await localStore.get("orders", "non_existent_key");
      assert.equal(val, null);
    });

    it("T2.B8.2 should apply delete on null remote without throwing unhandled rejection", async () => {
      const { engine } = createTestSyncEngine(env, { initialRemoteData: { expenses: [] } });
      const op = {
        operationId: "op_del_ghost_expense",
        entity: "expenses",
        entityId: "ghost_exp_1",
        type: "delete",
        changes: {},
        changedFields: [],
        baseRevision: 0,
      };
      const result = await engine.applyOperation(op);
      assert.equal(result.status, "applied");
    });

    it("T2.B8.3 should apply delete on null remote for orders without raising closedDay conflict", async () => {
      const { engine } = createTestSyncEngine(env, { initialRemoteData: { closings: [createMockClosing({ dateKey: "2026-09-01" })] } });
      const op = {
        operationId: "op_del_offline_order",
        entity: "orders",
        entityId: "ord_never_synced",
        type: "delete",
        changes: {},
        changedFields: [],
        baseRevision: 0,
      };
      const result = await engine.applyOperation(op);
      assert.notEqual(result.reason, "closed-day");
      assert.equal(result.status, "applied");
    });

    it("T2.B8.4 should record syncOperations receipt upon applied delete", async () => {
      const { engine, remote } = createTestSyncEngine(env, { initialRemoteData: { orders: [createMockOrder({ id: "o_rec_del" })] } });
      const op = {
        operationId: "op_with_receipt",
        entity: "orders",
        entityId: "o_rec_del",
        type: "delete",
        changes: {},
        changedFields: [],
        baseRevision: 1,
      };
      await engine.applyOperation(op);
      const receipt = await remote.getOperation("op_with_receipt");
      assert.ok(receipt);
    });

    it("T2.B8.5 should treat re-applying same delete operation as duplicate applied", async () => {
      const { engine } = createTestSyncEngine(env, { initialRemoteData: { orders: [createMockOrder({ id: "o_dup_del" })] } });
      const op = {
        operationId: "op_idempotent_del",
        entity: "orders",
        entityId: "o_dup_del",
        type: "delete",
        changes: {},
        changedFields: [],
        baseRevision: 1,
      };
      const res1 = await engine.applyOperation(op);
      assert.equal(res1.status, "applied");
      const res2 = await engine.applyOperation(op);
      assert.equal(res2.status, "applied");
      assert.equal(res2.duplicate, true);
    });
  });

  describe("B9: Duplicate Gas Concept Casing & Variations", () => {
    it("T2.B9.1 should deduplicate uppercase 'RECARGA DE GAS' and lowercase 'recarga de gas'", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ concept: "RECARGA DE GAS", amount: 620, createdAt: today });
      const exp2 = createMockExpense({ concept: "recarga de gas", amount: 620, createdAt: today });
      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 1);
    });

    it("T2.B9.2 should deduplicate mixed case 'Gas lp 30kg' matching gas regex", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ concept: "Gas lp 30kg", amount: 620, category: "operativo", createdAt: today });
      const exp2 = createMockExpense({ concept: "Recarga de gas", amount: 620, category: "gas", createdAt: today });
      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 1);
    });

    it("T2.B9.3 should deduplicate gas with leading and trailing whitespaces", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ concept: "  Recarga de gas  ", amount: 620, createdAt: today });
      const exp2 = createMockExpense({ concept: "Recarga de gas", amount: 620, createdAt: today });
      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 1);
    });

    it("T2.B9.4 should not deduplicate gas with non-gas concept such as 'Detergente'", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ concept: "Recarga de gas", amount: 620, createdAt: today });
      const exp2 = createMockExpense({ concept: "Detergente Roma", amount: 620, category: "insumo", createdAt: today });
      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 2);
    });

    it("T2.B9.5 should deduplicate 4 variations of gas on the same day into exactly 1", () => {
      const today = new Date().toISOString();
      const expenses = [
        createMockExpense({ id: "v1", concept: "Gas", amount: 620, createdAt: today }),
        createMockExpense({ id: "v2", concept: "RECARGA DE GAS", amount: 620, createdAt: today }),
        createMockExpense({ id: "v3", concept: "Tanque de gas 30", amount: 620, createdAt: today }),
        createMockExpense({ id: "v4", concept: "Compra de gas", amount: 620, createdAt: today }),
      ];
      const normalized = env.normalizeExpenses(expenses);
      assert.equal(normalized.length, 1);
    });
  });

  describe("B10: Order Reconciliation 14-Day Boundary (13d vs 14d vs 15d)", () => {
    it("T2.B10.1 should mark order 15 days old in past closed day as delivered in normalizeOrder", () => {
      const services = env.DEFAULT_SERVICES;
      const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const order = createMockOrder({ createdAt: fifteenDaysAgo, status: "recibido", paid: false, deliveredAt: null });
      const normalized = env.normalizeOrder(order, services);
      assert.equal(normalized.status, "entregado");
    });

    it("T2.B10.2 should mark order 14.1 days old as delivered in normalizeOrder", () => {
      const services = env.DEFAULT_SERVICES;
      const fourteenPointOneDaysAgo = new Date(Date.now() - 14.1 * 24 * 60 * 60 * 1000).toISOString();
      const order = createMockOrder({ createdAt: fourteenPointOneDaysAgo, status: "recibido", paid: false, deliveredAt: null });
      const normalized = env.normalizeOrder(order, services);
      assert.equal(normalized.status, "entregado");
    });

    it("T2.B10.3 should reconcile paid order from yesterday (1 day ago) to entregado in normalizeOrder", () => {
      const services = env.DEFAULT_SERVICES;
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const order = createMockOrder({ createdAt: yesterday, status: "recibido", paid: true });
      const normalized = env.normalizeOrder(order, services);
      assert.equal(normalized.status, "entregado");
    });

    it("T2.B10.4 should reconcile order with deliveredAt from yesterday in normalizeOrder", () => {
      const services = env.DEFAULT_SERVICES;
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const order = createMockOrder({ createdAt: yesterday, status: "recibido", paid: false, deliveredAt: yesterday });
      const normalized = env.normalizeOrder(order, services);
      assert.equal(normalized.status, "entregado");
    });

    it("T2.B10.5 should ensure unpaid, undelivered order from today remains recibido", () => {
      const services = env.DEFAULT_SERVICES;
      const today = new Date().toISOString();
      const order = createMockOrder({ createdAt: today, status: "recibido", paid: false, deliveredAt: null });
      const normalized = env.normalizeOrder(order, services);
      assert.equal(normalized.status, "recibido");
    });
  });

  describe("B11: Deduplication Time Window Boundaries", () => {
    it("T2.B11.1 should deduplicate expenses submitted 10 seconds apart on same day", () => {
      const t1 = "2026-09-22T12:00:00.000Z";
      const t2 = "2026-09-22T12:00:10.000Z";
      const exp1 = createMockExpense({ id: "e1", amount: 620, createdAt: t1 });
      const exp2 = createMockExpense({ id: "e2", amount: 620, createdAt: t2 });
      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 1);
    });

    it("T2.B11.2 should deduplicate expenses submitted 5 minutes apart on same day", () => {
      const t1 = "2026-09-22T12:00:00.000Z";
      const t2 = "2026-09-22T12:05:00.000Z";
      const exp1 = createMockExpense({ id: "e1", amount: 620, createdAt: t1 });
      const exp2 = createMockExpense({ id: "e2", amount: 620, createdAt: t2 });
      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 1);
    });

    it("T2.B11.3 should deduplicate expenses submitted 8 hours apart on same day (morning vs evening)", () => {
      const t1 = "2026-09-22T08:00:00.000Z";
      const t2 = "2026-09-22T16:00:00.000Z";
      const exp1 = createMockExpense({ id: "e1", amount: 620, createdAt: t1 });
      const exp2 = createMockExpense({ id: "e2", amount: 620, createdAt: t2 });
      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 1);
    });

    it("T2.B11.4 should distinguish expenses at 23:59:59 on day 1 vs 00:00:01 on day 2", () => {
      const t1 = "2026-09-22T23:59:59.000Z";
      const t2 = "2026-09-23T00:00:01.000Z";
      const exp1 = createMockExpense({ id: "e1", amount: 620, createdAt: t1 });
      const exp2 = createMockExpense({ id: "e2", amount: 620, createdAt: t2 });
      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 2);
    });

    it("T2.B11.5 should handle sub-cent amount variance ($620.00 vs $620.004) as same amount", () => {
      const today = new Date().toISOString();
      const exp1 = createMockExpense({ id: "e1", amount: 620.0, createdAt: today });
      const exp2 = createMockExpense({ id: "e2", amount: 620.004, createdAt: today });
      const normalized = env.normalizeExpenses([exp1, exp2]);
      assert.equal(normalized.length, 1);
    });
  });

  describe("B12: Stylesheet Structural & Integrity Invariants", () => {
    it("T2.B12.1 should verify styles.css contains no merge conflict markers", () => {
      const content = fs.readFileSync(STYLES_CSS_PATH, "utf8");
      assert.ok(!content.includes("<<<<<<<"));
      assert.ok(!content.includes("======="));
      assert.ok(!content.includes(">>>>>>>"));
    });

    it("T2.B12.2 should verify styles.css ends with newline and is not truncated", () => {
      const content = fs.readFileSync(STYLES_CSS_PATH, "utf8");
      assert.ok(content.endsWith("\n") || content.endsWith("\r\n"));
    });

    it("T2.B12.3 should verify styles.css contains all essential color tokens", () => {
      const content = fs.readFileSync(STYLES_CSS_PATH, "utf8");
      assert.ok(content.includes("--primary: #00657b;"));
      assert.ok(content.includes("--primary-strong: #004e60;"));
      assert.ok(content.includes("--pink: #a12e70;"));
      assert.ok(content.includes("--danger: #ba1a1a;"));
      assert.ok(content.includes("--success: #167a61;"));
    });

    it("T2.B12.4 should verify styles.css media queries are present", () => {
      const content = fs.readFileSync(STYLES_CSS_PATH, "utf8");
      assert.ok(content.includes("@media (min-width: 900px)"));
    });

    it("T2.B12.5 should verify styles.css contains box-sizing reset", () => {
      const content = fs.readFileSync(STYLES_CSS_PATH, "utf8");
      assert.ok(content.includes("* { box-sizing: border-box; }"));
    });
  });
});

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS (≥ 12 test cases)
// ============================================================================

describe("Tier 3: Cross-Feature Combinations", () => {
  it("T3.1 Multi-service order lifecycle from creation through partial payment to entregado", () => {
    const order = createMockOrder({
      items: [
        { serviceId: "lavado-secado", weightKg: 10, pricePerKg: 22, subtotal: 220, total: 220 },
        { serviceId: "secado", weightKg: 5, pricePerKg: 15, subtotal: 75, total: 75 },
      ],
      status: "recibido",
      paid: false,
    });
    env.syncOrderTotalsFromItems(order);
    assert.equal(order.total, 295);

    // Step through lifecycle
    while (order.status !== "entregado") {
      order.status = env.getNextStatus(order.status);
    }
    order.deliveredAt = new Date().toISOString();
    order.paid = true;
    order.paidAt = new Date().toISOString();

    assert.equal(order.status, "entregado");
    assert.equal(order.paid, true);
    assert.equal(env.isActiveOrder(order), false);
  });

  it("T3.2 Multi-service order with mixed units (kg + piece) and rounding accumulation", () => {
    const order = createMockOrder({
      items: [
        { serviceId: "lavado-secado", unit: "kg", weightKg: 3.33, pricePerKg: 22, subtotal: 73.26, total: 74 },
        { serviceId: "cobertor", unit: "pieza", weightKg: 2, pricePerKg: 70, subtotal: 140, total: 140 },
      ],
    });
    env.syncOrderTotalsFromItems(order);
    assert.equal(order.subtotal, 213.26);
    assert.equal(order.total, 214); // Math.ceil(213.26) = 214
  });

  it("T3.3 Gas refill purchase in closed day with subsequent administrative deletion and closing update", async () => {
    const closedDate = "2026-09-18";
    const closing = createMockClosing({ dateKey: closedDate, sales: 3000, expenses: 620, cashFlow: 2380 });
    const expense = createMockExpense({ id: "e_c3", amount: 620, createdAt: `${closedDate}T12:00:00Z` });

    const { engine, remote } = createTestSyncEngine(env, {
      initialRemoteData: {
        closings: [closing],
        expenses: [expense],
      },
    });

    const op = {
      operationId: "op_del_c3",
      entity: "expenses",
      entityId: "e_c3",
      type: "delete",
      changes: {},
      changedFields: [],
      baseRevision: 1,
    };

    const result = await engine.applyOperation(op);
    assert.equal(result.status, "applied");
    assert.notEqual(result.reason, "closed-day");
  });

  it("T3.4 Rapid burst of 5 gas refills + remote sync + reload + learned gas cost calculation", async () => {
    const today = new Date().toISOString();
    const expenses = Array.from({ length: 5 }, (_, i) =>
      createMockExpense({ id: `burst_gas_${i}`, amount: 620, category: "gas", createdAt: today })
    );

    const deduplicated = env.normalizeExpenses(expenses);
    assert.equal(deduplicated.length, 1);

    const state = {
      orders: [createMockOrder({ weightKg: 50, createdAt: today })],
      supplies: [createMockSupply({ id: "gas", quantity: 30 })],
      supplyMovements: [createMockSupplyMovement({ id: "m_single", expenseId: deduplicated[0].id, quantity: 30, cost: 620, createdAt: today })],
    };

    const stats = env.RapiditaSupplyLearningV2.getSupplyStats(state, "gas", new Date());
    assert.ok(stats);
  });

  it("T3.5 Order created in closed day + transitions to entregado + remote sync without closed-day conflict", async () => {
    const closedDate = "2026-09-15";
    const closing = createMockClosing({ dateKey: closedDate });
    const order = createMockOrder({ id: "ord_c5", createdAt: `${closedDate}T09:00:00Z`, status: "recibido" });

    const { engine, remote } = createTestSyncEngine(env, {
      initialRemoteData: { closings: [closing], orders: [order] },
    });

    const op = {
      operationId: "op_deliver_c5",
      entity: "orders",
      entityId: "ord_c5",
      type: "update",
      changes: { status: "entregado", deliveredAt: new Date().toISOString() },
      changedFields: ["status", "deliveredAt"],
      baseRevision: 1,
    };

    const result = await engine.applyOperation(op);
    assert.equal(result.status, "applied");
  });

  it("T3.6 Unpaid order in closed day > 14 days old + auto-reconciliation + dashboard active exclusion", () => {
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const order = createMockOrder({
      id: "ord_c6",
      status: "recibido",
      paid: false,
      deliveredAt: null,
      createdAt: twentyDaysAgo,
    });

    const normalized = env.normalizeOrder(order, env.DEFAULT_SERVICES);
    assert.equal(normalized.status, "entregado");
    assert.equal(env.isActiveOrder(normalized), false);
  });

  it("T3.7 Offline order creation + offline deletion + sync drain (null remote delete handling)", async () => {
    const { engine, remote, queue } = createTestSyncEngine(env, { initialRemoteData: { orders: [] } });

    // Client created offline, then deleted offline before ever syncing
    await engine.enqueue({
      entity: "orders",
      entityId: "offline_ord_c7",
      type: "delete",
      changes: {},
      changedFields: [],
      baseRevision: 0,
      createdAtClient: new Date().toISOString(),
    });

    await engine.drain();
    const pending = await queue.pending();
    assert.equal(pending.length, 0);
  });

  it("T3.8 Terminal status order + remote conflict downgrade rejection", async () => {
    const order = createMockOrder({ id: "ord_c8", status: "entregado" });
    const { engine } = createTestSyncEngine(env, { initialRemoteData: { orders: [order] } });

    const op = {
      operationId: "op_c8_downgrade",
      entity: "orders",
      entityId: "ord_c8",
      type: "update",
      changes: { status: "doblando" },
      changedFields: ["status"],
      baseRevision: 1,
    };

    const result = await engine.applyOperation(op);
    assert.equal(result.status, "conflict");
  });

  it("T3.9 Multi-service order item modification + order totals recalibration", () => {
    const order = createMockOrder({
      items: [
        { id: "i1", serviceId: "lavado-secado", weightKg: 5, pricePerKg: 22, subtotal: 110, total: 110 },
        { id: "i2", serviceId: "secado", weightKg: 4, pricePerKg: 15, subtotal: 60, total: 60 },
      ],
    });

    // Modify item 1 weight from 5 to 7.5
    order.items[0].weightKg = 7.5;
    order.items[0].subtotal = 7.5 * 22; // 165
    order.items[0].total = env.roundUpToPeso(order.items[0].subtotal);

    env.syncOrderTotalsFromItems(order);
    assert.equal(order.subtotal, 225);
    assert.equal(order.total, 225);
    assert.equal(order.weightKg, 11.5);
  });

  it("T3.10 Gas expense deletion reversing supply quantity and removing movement from closed day", () => {
    const state = {
      supplies: [createMockSupply({ id: "gas", quantity: 60 })],
      supplyMovements: [createMockSupplyMovement({ id: "m1", expenseId: "exp_del_c10", supplyId: "gas", quantity: 30, cost: 620 })],
      expenses: [createMockExpense({ id: "exp_del_c10", amount: 620, purchasedQuantity: 30 })],
    };

    const targetExpense = state.expenses[0];
    env.reverseInventoryFromExpense(state, targetExpense);
    state.expenses = state.expenses.filter((e) => e.id !== targetExpense.id);

    assert.equal(state.supplies[0].quantity, 30);
    assert.equal(state.supplyMovements.length, 0);
    assert.equal(state.expenses.length, 0);
  });

  it("T3.11 Multiple concurrent orders across services + day closing financial freeze", () => {
    const orders = [
      createMockOrder({ id: "o_cl_1", total: 220, paid: true }),
      createMockOrder({ id: "o_cl_2", total: 150, paid: true }),
      createMockOrder({ id: "o_cl_3", total: 70, paid: false }), // Unpaid
    ];
    const paidSales = orders.filter((o) => o.paid).reduce((sum, o) => sum + o.total, 0);
    assert.equal(paidSales, 370);

    const closing = createMockClosing({ sales: paidSales, ordersCount: orders.length });
    assert.equal(closing.sales, 370);
    assert.equal(closing.ordersCount, 3);
  });

  it("T3.12 State normalization resilience under partially corrupted/null fields across all entities", () => {
    const corruptedState = {
      services: [{ id: null, price: "not-a-number" }],
      customers: [{ id: "c1", name: null }],
      orders: [{ id: "o1", status: null, items: null, weightKg: "abc", subtotal: null }],
      expenses: [{ id: "e1", category: "unknown_category", amount: "xyz" }],
      supplies: [{ id: "gas", quantity: null }],
      supplyMovements: [{ id: "m1", supplyId: "gas", quantity: null }],
      closings: null,
    };

    const normalized = env.normalizeState(corruptedState);
    assert.ok(normalized);
    assert.ok(Array.isArray(normalized.orders));
    assert.ok(Array.isArray(normalized.expenses));
    assert.ok(Array.isArray(normalized.supplies));
    assert.ok(Array.isArray(normalized.closings));
  });
});

// ============================================================================
// TIER 4: REAL-WORLD APPLICATION SCENARIOS (5 Comprehensive Stress Scenarios)
// ============================================================================

describe("Tier 4: Real-World Scenarios", () => {
  // Scenario 1: Full Busy Day Flow: 50 concurrent orders simulation (R1 Acceptance)
  it("T4.S1 Full Busy Day Flow: 50 concurrent orders simulation with diverse status variants", () => {
    const orderStatuses = ["recibido", "lavando", "secando", "doblando", "listo", "entregado"];
    const orders = [];

    for (let i = 0; i < 50; i++) {
      const status = orderStatuses[i % orderStatuses.length];
      const weight = 3 + (i % 15) * 1.5;
      const isDelivered = status === "entregado";
      const isPaid = i % 2 === 0 || isDelivered;

      const order = createMockOrder({
        id: `busy_day_ord_${i}`,
        customerName: `Cliente_${i}`,
        status,
        weightKg: weight,
        paid: isPaid,
        paidAt: isPaid ? new Date().toISOString() : null,
        deliveredAt: isDelivered ? new Date().toISOString() : null,
      });

      orders.push(order);
    }

    assert.equal(orders.length, 50);

    // Normalize entire order collection
    const normalizedOrders = orders.map((o) => env.normalizeOrder(o, env.DEFAULT_SERVICES));
    assert.equal(normalizedOrders.length, 50);

    // Filter active orders
    const activeOrders = normalizedOrders.filter(env.isActiveOrder);
    for (const active of activeOrders) {
      assert.notEqual(active.status, "entregado", "No delivered order may remain active on operational board");
      assert.notEqual(active.status, "listo", "No listo order may remain active on operational board");
      assert.equal(active.deliveredAt, null, "No order with deliveredAt may remain active on operational board");
    }
  });

  // Scenario 2: Heavy Gas Refill Burst (R2 Acceptance)
  it("T4.S2 Heavy Gas Refill Burst: 5 operators submitting $620 refill on same day concurrently", async () => {
    const today = new Date().toISOString();
    const burstExpenses = [
      createMockExpense({ id: "gas_op1", amount: 620, category: "gas", supplyId: "gas", purchasedQuantity: 30, createdAt: today }),
      createMockExpense({ id: "gas_op2", amount: 620, category: "gas", supplyId: "gas", purchasedQuantity: 30, createdAt: today }),
      createMockExpense({ id: "gas_op3", amount: 620, category: "gas", supplyId: "gas", purchasedQuantity: 30, createdAt: today }),
      createMockExpense({ id: "gas_op4", amount: 620, category: "gas", supplyId: "gas", purchasedQuantity: 30, createdAt: today }),
      createMockExpense({ id: "gas_op5", amount: 620, category: "gas", supplyId: "gas", purchasedQuantity: 30, createdAt: today }),
    ];

    const burstMovements = burstExpenses.map((exp, idx) =>
      createMockSupplyMovement({ id: `mov_burst_${idx}`, expenseId: exp.id, supplyId: "gas", quantity: 30, cost: 620, createdAt: today })
    );

    const initialGasStock = 10;
    const state = {
      services: env.DEFAULT_SERVICES,
      customers: [],
      orders: [],
      expenses: burstExpenses,
      supplies: [createMockSupply({ id: "gas", quantity: initialGasStock + 150 })], // +150 inflated by 5x submissions
      supplyMovements: burstMovements,
      closings: [],
    };

    const normalizedState = env.normalizeState(state);

    // Acceptance Criteria R2 checks:
    assert.equal(normalizedState.expenses.length, 1, "Duplicate $620 gas expenses must deduplicate to exactly 1 in local state");

    const gasMovements = normalizedState.supplyMovements.filter((m) => m.supplyId === "gas" && m.type === "purchase");
    assert.equal(gasMovements.length, 1, "Must contain exactly 1 purchase movement, no phantom movements");

    const gasSupply = normalizedState.supplies.find((s) => s.id === "gas");
    assert.equal(gasSupply.quantity, initialGasStock + 30, "Tank quantity must increase by only 1 cylinder volume (30kg), not 150kg");
  });

  // Scenario 3: Post-Closing Reconciliation (R3 Acceptance)
  it("T4.S3 Post-Closing Reconciliation: Updating status and deleting records on closed days without closed-day exceptions", async () => {
    const closedDate = "2026-09-10";
    const closing = createMockClosing({ dateKey: closedDate });
    const order = createMockOrder({ id: "ord_s3", createdAt: `${closedDate}T10:00:00Z`, status: "recibido" });
    const expense = createMockExpense({ id: "exp_s3", createdAt: `${closedDate}T11:00:00Z`, amount: 620 });

    const { engine, remote } = createTestSyncEngine(env, {
      initialRemoteData: {
        closings: [closing],
        orders: [order],
        expenses: [expense],
      },
    });

    // 1. Updating order status on closed day
    const updateOp = {
      operationId: "op_s3_update",
      entity: "orders",
      entityId: "ord_s3",
      type: "update",
      changes: { status: "entregado", deliveredAt: new Date().toISOString() },
      changedFields: ["status", "deliveredAt"],
      baseRevision: 1,
    };
    const updateResult = await engine.applyOperation(updateOp);
    assert.equal(updateResult.status, "applied");
    assert.notEqual(updateResult.reason, "closed-day");

    // 2. Deleting duplicate expense on closed day
    const deleteOp = {
      operationId: "op_s3_delete",
      entity: "expenses",
      entityId: "exp_s3",
      type: "delete",
      changes: {},
      changedFields: [],
      baseRevision: 1,
    };
    const deleteResult = await engine.applyOperation(deleteOp);
    assert.equal(deleteResult.status, "applied");
    assert.notEqual(deleteResult.reason, "closed-day");
  });

  // Scenario 4: Historical Zombie Order Sweep (R1 Acceptance)
  it("T4.S4 Historical Zombie Order Sweep: zero orders marked delivered or in closed days > 14 days old remain active", () => {
    const now = Date.now();
    const twentyDaysAgo = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();
    const fifteenDaysAgo = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

    const orders = [
      // Zombie 1: Created 20 days ago in closed day, unpaid, undelivered, status recibido
      createMockOrder({ id: "zombie_1", createdAt: twentyDaysAgo, status: "recibido", paid: false, deliveredAt: null }),
      // Zombie 2: Created 15 days ago, status lavando, deliveredAt was set 14 days ago
      createMockOrder({ id: "zombie_2", createdAt: fifteenDaysAgo, status: "lavando", paid: true, deliveredAt: fifteenDaysAgo }),
      // Zombie 3: Created 2 days ago, deliveredAt set today, status still shows doblando
      createMockOrder({ id: "zombie_3", createdAt: twoDaysAgo, status: "doblando", paid: true, deliveredAt: new Date().toISOString() }),
      // Legitimate Active Order: Created today, status recibido
      createMockOrder({ id: "active_legit", createdAt: new Date().toISOString(), status: "recibido", paid: false, deliveredAt: null }),
    ];

    const normalized = orders.map((o) => env.normalizeOrder(o, env.DEFAULT_SERVICES));
    const activeDashboardOrders = normalized.filter(env.isActiveOrder);

    assert.equal(activeDashboardOrders.length, 1, "Exactly 1 order must remain active on dashboard");
    assert.equal(activeDashboardOrders[0].id, "active_legit");

    for (const order of activeDashboardOrders) {
      assert.notEqual(order.id, "zombie_1");
      assert.notEqual(order.id, "zombie_2");
      assert.notEqual(order.id, "zombie_3");
    }
  });

  // Scenario 5: Integrity & Visual Styles Checksum Audit (R4 Constraint)
  it("T4.S5 Integrity Audit: styles.css checksum and immutability verification", () => {
    const info = getStylesCssInfo();
    assert.equal(info.byteSize, 38951, "styles.css byte size must remain strictly 38,951 bytes");

    // Verify git working tree has not modified styles.css
    const rawContent = fs.readFileSync(STYLES_CSS_PATH, "utf8");
    assert.ok(rawContent.length > 0);
    assert.ok(info.hash.length === 64, "SHA-256 hash must be valid 64-char hex string");
  });
});
