# TEST_READY: Lavandería La Rapidita — E2E Stress Test Suite

**Date**: 2026-09-23T04:20:00Z  
**Author**: Test Writer Agent (`teamwork_preview_test_writer_1`)  
**Parent Orchestrator**: `df9b6d7e-32d4-4271-9f57-0f457a3e73b4`  
**Test Command**: `node --test test/stress-e2e.test.js`  
**Architecture**: Native Node.js 24 (`node:test`, `node:assert`, `node:vm`). Zero third-party npm dependencies.  
**Integrity Status**: `styles.css` is verified 100% UNMODIFIED (38,951 bytes, 939 lines).  

---

## 1. Executive Summary & Baseline Results

The comprehensive, opaque-box, requirement-driven E2E stress test suite has been implemented under `test/` spanning Tiers 1 through 4. It exercises the application against the authoritative specifications from `ORIGINAL_REQUEST.md` and `PROJECT.md`.

### Baseline Execution Summary (Unpatched Codebase)

| Metric | Value |
|---|---|
| **Total Test Cases** | **137** |
| **Passing Tests** | **124** |
| **Failing Tests (Known Defect Baseline)** | **13** |
| **Execution Time** | ~1.2s |
| **Target Milestone Coverage** | M1, M2, M3, M4 |

The 13 baseline failures are **authentic specification-driven tests** that precisely detect and isolate the pre-existing bugs discovered during code surveys. They establish the red-to-green verification baseline for implementing agents across Milestones M1, M2, and M3.

---

## 2. Test Suite Matrix & Tier Inventory

| Tier | Category | Tests Implemented | Passing | Failing | Target Milestone |
|---|---|:---:|:---:|:---:|:---:|
| **Tier 1** | **F1: Multi-Service Order Creation** | 5 | 5 | 0 | M1 |
| **Tier 1** | **F2: Price Calculation & Rounding (Math.ceil)** | 5 | 5 | 0 | M1 |
| **Tier 1** | **F3: Order State Machine Transitions** | 5 | 5 | 0 | M1 |
| **Tier 1** | **F4: Terminal Order Status Protection** | 5 | 5 | 0 | M1 |
| **Tier 1** | **F5: Active Orders Reconciliation** | 5 | 2 | 3 | M1 |
| **Tier 1** | **F6: Concurrency & Order Stress** | 5 | 5 | 0 | M1 / M4 |
| **Tier 1** | **F7: Gas Expense Deduplication ($620)** | 5 | 4 | 1 | M2 |
| **Tier 1** | **F8: Ghost Inventory & Movement Cleanup** | 5 | 3 | 2 | M2 |
| **Tier 1** | **F9: Cash Register & Closing Totals** | 5 | 5 | 0 | M2 |
| **Tier 1** | **F10: Closed-Day Order Updates (sync-v2.js)** | 5 | 5 | 0 | M3 |
| **Tier 1** | **F11: Closed-Day Administrative Deletions** | 5 | 4 | 1 | M3 |
| **Tier 1** | **F12: Visual Design & Styles Preservation** | 5 | 5 | 0 | All |
| **Tier 2** | **B1–B12: Boundary & Corner Cases** | 60 | 57 | 3 | M1, M2, M3 |
| **Tier 3** | **C1–C12: Cross-Feature Combinations** | 12 | 11 | 1 | M1, M2, M3 |
| **Tier 4** | **S1–S5: Real-World Scenarios** | 5 | 3 | 2 | M4 |
| **Total** | | **137** | **124** | **13** | |

---

## 3. Defect Escalation & Failure Root Cause Analysis

The 13 failing test cases map to 3 specific areas of the unpatched codebase:

### Group A: Order Lifecycle & Dashboard Active Reconciliation (Milestone M1)
- **Failing Tests**:
  - `T1.F5.3`: `isActiveOrder` must return `false` if `order.deliveredAt != null`.
  - `T1.F5.4`: `isActiveOrder` must return `false` if order was created in a closed day > 14 days old.
  - `T1.F5.5`: `normalizeOrder` must normalize orders with `deliveredAt` in intermediate states (`lavando`, `secando`, `doblando`) to `"entregado"`.
  - `T4.S4`: Historical zombie order sweep: delivered or closed orders > 14 days old remain visible on active dashboard.
- **Root Cause in `app.js`**:
  1. `app.js:2866-2868`: `isActiveOrder` only checks `!["listo", "entregado"].includes(normalizeStatus(order.status))`. It omits checking `order.deliveredAt` or whether the order belongs to a closed day / > 14 days old.
  2. `app.js:1377`: `(order.deliveredAt && rawStatus === "recibido") ? "entregado" : rawStatus`. If `rawStatus` is `"lavando"`, `"secando"`, or `"doblando"`, it is NOT normalized to `"entregado"`.

### Group B: Financial & Gas Deduplication, Ghost Inventory (Milestone M2)
- **Failing Tests**:
  - `T1.F7.5`: Concurrent create operations for gas expense on same day in `sync-v2.js` should deduplicate in remote collection.
  - `T1.F8.2`: `normalizeState` must prune orphan `supplyMovements` when duplicate gas purchase is dropped.
  - `T1.F8.3`: `normalizeState` must restore `supplies.gas.quantity` (30kg, not 60kg).
  - `T4.S2`: 5 concurrent operators submitting $620 gas refill produces inflated inventory (+150kg) and 5 supplyMovements.
- **Root Cause in `app.js` and `sync-v2.js`**:
  1. `app.js:1239-1260`: `normalizeExpenses` removes the duplicate expense from `expenses`, but `normalizeSupplyMovements` (lines 1310-1339) and `normalizeSupplies` (lines 1263-1308) do not prune orphan movements or revert `supplies.gas.quantity`.
  2. `sync-v2.js:576-585`: `applyOperation` checks only for document existence by `entityId`, lacking semantic duplicate checking for identical gas purchases on the same day (`gas_${amount}_${dateKey}`).

### Group C: Sync Resilience & Offline Purge (Milestone M3)
- **Failing Tests**:
  - `T1.F11.5`: Deleting an entity that does not exist in remote Firestore (offline purge) must succeed as applied without conflict.
  - `T2.B8.2`: Apply delete on null remote without throwing conflict.
  - `T2.B8.3`: Apply delete on null remote for orders without raising closedDay conflict.
  - `T3.7`: Offline order creation followed by offline deletion.
- **Root Cause in `sync-v2.js`**:
  1. `sync-v2.js:587-590`:
     ```javascript
     if (!remote) {
       const conflict = await this.conflictManager.record(operation, null, operation.changedFields);
       return { status: "conflict", conflict };
     }
     ```
     This check occurs *before* `if (operation.type === "delete")` at line 592! Deleting a locally-created record that was never synced remotely triggers an invalid conflict instead of succeeding as a no-op delete.

---

## 4. Test Harness Architecture (`test/harness.js`)

The test suite runs with zero npm packages via Node.js native primitives:
1. **VM Isolation**: `loadAppEnvironment()` evaluates `sync-v2.js`, `supply-learning-v2.js`, and `app.js` in a sandboxed `node:vm` context.
2. **In-Memory KeyValue Store**: `InMemoryKeyValueStore` replaces browser IndexedDB with deterministic Map storage and queue locking.
3. **In-Memory Remote Adapter**: `InMemoryRemoteAdapter` replaces live Google Cloud Firestore with zero network latency, collections, documents, patches, soft deletes, and subscription hooks.
4. **Style Integrity Validator**: `getStylesCssInfo()` continuously validates `styles.css` byte length and SHA-256 hash.

---

## 5. How to Run the Tests

To run the full suite:
```bash
node --test test/stress-e2e.test.js
```

To run with verbose reporter:
```bash
node --test --test-reporter=spec test/stress-e2e.test.js
```

---

## 6. Milestone Handoff Readiness

The test suite is **100% complete and ready**. Implementing agents can now execute Milestones M1, M2, and M3 sequentially. Each milestone will turn its assigned subset of the 13 failing tests green until 137/137 tests pass in Milestone M4.
