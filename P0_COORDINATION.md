# P0_COORDINATION — OPERACIÓN CONSISTENCIA DE DATOS
**Agente 1: Coordinador + Guardián de Evidencia**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. ESTADO DE LÍNEA BASE Y GIT

- **BASELINE_COMMIT:** `4189396a2173fddb0db40b3b37941b2c151f0d60` ("Fix data consistency issues and improve order visibility logic")
- **RAMA ACTUAL:** `qwen-code-6be2c37b-dc51-4682-948a-063d23f3c864`
- **WORKTREE_STATUS:**
  - Archivos modificados en el ciclo anterior:
    - `app.js` (incorporó cola de promesas FIFO `mutationQueue`, guards de ciclo de vida de sesión en `onAuthStateChanged`, protecciones `disabled` en botones y manejo de errores).
    - `index.html` (alineó versiones query `?v=33`).
    - `sw.js` (alineó `APP_SHELL` a `v=33`).
  - Artefactos previos generados:
    - `AUDIT_REPORT.md`
    - `QA_ADVERSARIAL_REPORT.md`
    - `REPAIR_PLAN.md`
    - `CAMBIOS_APLICADOS.md`
    - `COORDINACION_RESUMEN.md`
    - `server.js` (servidor de pruebas local)

---

## 2. DIFERENCIACIÓN DE PROBLEMAS

Para evitar mezclar fixes anteriores con la nueva misión, el Coordinador fija las siguientes fronteras estrictas:

1. **Bugs Previos Ya Resueltos (Ciclo 1):**
   - Fuga de listeners en re-autenticación de Firebase (`stopRealtimeListeners`).
   - Carreras en memoria en `mutate()` (resueltas por `mutationQueue`).
   - Doble clic en botones de formulario.
2. **Nuevos Problemas P0 Reportados por el Usuario (Ciclo 2):**
   - **P0-A (Pedidos):** Pedidos entregados que aparecen como pendientes / activos / sin entregar / recibidos.
   - **P0-B (Compras):** Compras de insumos y gas que aparecen duplicadas o triplicadas.

---

## 3. ASIGNACIÓN Y SECUENCIA DE TRABAJO MULTIAGENTE

1. **Agente 2 (Especialista en Pedidos):** Auditoría forense completa del ciclo de vida de pedidos, `normalizeStatus`, `normalizeOrder`, `isActiveOrder`, `isVisibleInOrdersList`, y conflictos de días cerrados.  
   *Entrega:* `P0_ORDER_STATE_FORENSICS.md`.
2. **Agente 3 (Especialista en Compras + Gas):** Mapeo forense de Flujo A (`supplyForm`) y Flujo B (`expenseForm`), diferenciación entre gasto financiero y movimiento de inventario, y causas de duplicación.  
   *Entrega:* `P0_PURCHASE_GAS_FORENSICS.md`.
3. **Agente 4 (Especialista Sync V2 + Replay + Estado Remoto):** Mapeo de `syncState`, `applyOperation`, regla de conflicto `closedDay` (líneas 540-551 de `sync-v2.js`), y reversión de estado remoto al recargar.  
   *Entrega:* `P0_SYNC_REPLAY_FORENSICS.md`.
4. **Agente 5 (Breaker Especializado):** Ejecución adversarial de los tests 1 al 7 para reproducir exactamente las fallas reportadas.  
   *Entrega:* `P0_SPECIALIZED_BREAKER.md`.
5. **Agente 6 (Arquitecto de Solución):** Formulación del plan de reparación quirúrgica mínima sin refactorización destructiva.  
   *Entrega:* `P0_PRECISION_REPAIR_PLAN.md`.
6. **Agente 7 (Implementador Quirúrgico):** Aplicación de los cambios paso a paso, con verificación.  
   *Entrega:* `P0_PRECISION_CHANGES.md`.
7. **Agente 8 (Regression Breaker):** Validación adversarial de no-regresión y confirmación final.  
   *Entrega:* `P0_REGRESSION_RESULT.md`.

---
**Fin de P0_COORDINATION.md**
