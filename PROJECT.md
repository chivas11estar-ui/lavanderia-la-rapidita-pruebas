# Project: Lavandería La Rapidita — Integral Defensive Audit & Hardening

## Architecture
- **Web Frontend**: Vanilla JavaScript PWA (`app.js`, `styles.css`, `index.html`) using DOM template literals, IndexedDB local state store (`localStore` / `idbKeyval`), and Firebase Authentication.
- **Sync Engine**: `sync-v2.js` providing offline mutation queueing (`syncQueue`), distributed lock via Web Locks API (`navigator.locks`), Firestore remote adapter, conflict resolution, and closed-day immutability rules.
- **Supply Learning**: `supply-learning-v2.js` estimating operational costs per kg (gas, electricity, detergents) using historical consumption cycles.
- **Service Worker**: `sw.js` handling offline asset caching (`APP_SHELL`), stale-while-revalidate and network fallbacks.
- **Test Infrastructure**: Native Node.js test runner (`node --test test/stress-e2e.test.js`) with VM-isolated browser environment shim (`test/harness.js`).

## Feature & Audit Findings Inventory
| # | Finding / Feature | Severity | Target File(s) | Assigned Milestone | Source |
|---|-------------------|----------|----------------|-------------------|--------|
| 1 | `F-SEC-01`: Stored XSS in `statusLabel` & `normalizeStatus` whitelist | Alta | `app.js` | M1: Remediation | Survey (Exp 2) |
| 2 | `F-SEC-02`: Stored/DOM XSS in `service.unit` and `service.id` | Alta | `app.js` | M1: Remediation | Survey (Exp 2) |
| 3 | `F-SEC-03`: Attribute breakout in entity IDs across DOM templates | Media | `app.js` | M1: Remediation | Survey (Exp 2) |
| 4 | `F-SEC-05`: CSV Formula Injection (CWE-1236) in `csvCell()` | Baja | `app.js` | M1: Remediation | Survey (Exp 2) |
| 5 | `F-SEC-07/08/09`: Auth hardening, `emailVerified`, generic unauthorized message | Alta/Media | `app.js` | M1: Remediation | Survey (Exp 2) |
| 6 | `F-SEC-10`: SW Cache Poisoning prevention (filter `response.status === 200`) | Alta | `sw.js` | M1: Remediation | Survey (Exp 2) |
| 7 | `F-SEC-11/12`: SW unhandled rejection on offline fetch & robust install | Alta/Media | `sw.js` | M1: Remediation | Survey (Exp 2) |
| 8 | `F-SEC-15/16/19`: Async error boundaries (`catch` blocks in listeners, global unhandledRejection) | Alta/Media | `app.js` | M1: Remediation | Survey (Exp 2) |
| 9 | `LOGIC-01`: State persistence in IndexedDB `app-data` on mutation/sync | Crítica | `app.js` | M1: Remediation | Survey (Exp 1) |
| 10 | `FIN-01`: Prevent debt evaporation for delivered orders > 7 days in `renderClients` | Crítica | `app.js` | M1: Remediation | Survey (Exp 1) |
| 11 | `CONCUR-01`: Clear `inFlightEntities` after process in `drainQueue()` | Crítica | `sync-v2.js` | M1: Remediation | Survey (Exp 1) |
| 12 | `LOGIC-02`: Handle pending delete operations in `applyRemoteCollection` | Alta | `sync-v2.js` | M1: Remediation | Survey (Exp 1) |
| 13 | `LOGIC-03`: Preserve `failed` operations in `mergeRemoteWithLocal` | Alta | `sync-v2.js` | M1: Remediation | Survey (Exp 1) |
| 14 | `GAS-02`: Exclude deleted movements (`deletedAt`) in `getSupplyStats` | Media | `supply-learning-v2.js` | M1: Remediation | Survey (Exp 1) |
| 15 | `GAS-03`: Fix Simpson's Paradox in `getLightStats` (weighted cost/kg) | Media | `supply-learning-v2.js` | M1: Remediation | Survey (Exp 1) |
| 16 | `VOL-01`: Sync queue compaction policy in `sync-v2.js` | Alta | `sync-v2.js` | M1: Remediation | Survey (Exp 1) |
| 17 | `VOL-02`: Linear customer rendering optimization ($O(N+M)$) | Alta | `app.js` | M1: Remediation | Survey (Exp 1) |
| 18 | `F-SEC-20`: GlobalThis compatibility in IIFE headers | Baja | `sync-v2.js`, `supply-learning-v2.js` | M1: Remediation | Survey (Exp 2) |
| 19 | R3 E2E Test Suite 100% Pass (137/137 tests without regression) | Invariant | `test/stress-e2e.test.js` | M2: Verification | Survey (Exp 3) |
| 20 | R4 Style Immutability (exact SHA256 & 38,951 bytes on `styles.css`) | Invariant | `styles.css` | M2: Verification | Survey (Exp 3) |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Defensive Remediation Implementation | Patch `app.js`, `sync-v2.js`, `supply-learning-v2.js`, `sw.js` with defensive fixes for R1 and R2 | Survey complete | DONE |
| 2 | Multi-Agent Review & Adversarial Stress Verification | Reviewers + Challengers + Forensic Auditor gating; 100% pass on 137 E2E tests, styles.css checksum intact | M1 | DONE |
| 3 | Final Acceptance & Human Reporting | Formulate comprehensive findings matrix, summarize outcome, report to Sentinel | M2 | IN_PROGRESS |

## Interface Contracts & Invariants
- **`calculateExpenseTotals(expenses)`**: MUST NOT clamp negative amounts inside this function. `T2.B3.3` explicitly asserts `totals.total === -50`. Clamping/validation belongs at user input level.
- **`styles.css`**: MUST NOT be touched. Checksum `2ee721bc181824bfd0ec2284d8c141c56e26d371ade4c2ed366ac89e16329d1f`, size 38,951 bytes.
- **SyncEngine operations return format**: Must return `{ status: "applied", ... }` or `{ status: "conflict", conflict, reason: "..." }`.

## Code Layout
- `app.js`: Core UI logic, state mutations, calculations, rendering templates. Owned by Worker in M1.
- `sync-v2.js`: SyncEngine, IndexedDbV2, queue processing. Owned by Worker in M1.
- `supply-learning-v2.js`: Cost learning and statistical metrics. Owned by Worker in M1.
- `sw.js`: Service worker caching and offline fetch handler. Owned by Worker in M1.
- `styles.css`: IMMUTABLE. Read-only by all agents.
- `test/stress-e2e.test.js`: Read-only test suite executed for verification.
