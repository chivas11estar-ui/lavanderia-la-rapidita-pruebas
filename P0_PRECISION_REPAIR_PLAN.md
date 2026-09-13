# P0_PRECISION_REPAIR_PLAN — PLAN DE REPARACIÓN QUIRÚRGICA
**Agente 6: Arquitecto de Solución**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. PRINCIPIOS DE DISEÑO Y RESTRICCIONES
- Solo se atacan las causas raíz con evidencia directa confirmada por el Auditor y el Breaker.
- **PROHIBIDO** reescribir `sync-v2.js` por completo. Solo se modifica la condición de guarda en `applyOperation` donde se demostró la causa del bloqueo de pedidos.
- **PROHIBIDO** borrar datos históricos o hacer migraciones ciegas.
- **PROHIBIDO** tocar `supply-learning-v2.js` ni alterar sus fórmulas.

---

## 2. PLAN DE REPARACIÓN DETALLADO

### FIX 1: [PREC-01] Normalización robusta de estados (Case-insensitive + Trim + Femenino + `deliveredAt`)
- **ID:** PREC-01
- **SÍNTOMA:** Pedidos con estado "Entregado", "ENTREGADO", "entregada" o con marca `deliveredAt` aparecen como activos / pendientes en el panel y en los filtros.
- **CAUSA RAÍZ:** `app.js:2731-2740` y `app.js:1260-1280` no normalizan mayúsculas ni espacios, carecen del mapeo para la variante femenina "entregada" e ignoran `deliveredAt` si el campo `status` quedó vacío o desfasado.
- **EVIDENCIA:** `normalizeStatus("Entregado")` devuelve `"Entregado"`, provocando que `isActiveOrder()` retorne `true`.
- **ARCHIVO:** `app.js`
- **LÍNEAS APROX:** `app.js:2731-2740` y `app.js:1270-1285`
- **FIX MÍNIMO:**
  1. En `normalizeStatus(status)`:
     ```javascript
     function normalizeStatus(status) {
       const clean = String(status || "").trim().toLowerCase();
       const map = {
         pendiente: "recibido",
         lavada: "lavando",
         secada: "secando",
         doblada: "doblando",
         lista: "listo",
         entregada: "entregado",
       };
       return map[clean] || clean || "recibido";
     }
     ```
  2. En `normalizeOrder(order, services)`:
     Asegurar que si `order.deliveredAt` contiene una fecha válida, su estado normalizado sea `"entregado"`.
- **QUÉ NO TOCAR:** No modificar el flujo de estados `STATUS_FLOW` ni las etiquetas `STATUS_LABELS`.
- **RIESGO:** Mínimo.
- **TEST:** Probar `"Entregado"`, `"ENTREGADO"`, `" entregado "`, `"entregada"`. Todos deben normalizar a `"entregado"` y `isActiveOrder()` debe ser `false`.
- **REGRESIÓN:** Cero. Los estados regulares `"recibido"`, `"lavando"`, `"listo"` se conservan intactos.

---

### FIX 2: [PREC-02] Exención de guarda `closedDay` para actualizaciones de ciclo de vida (`status`, `deliveredAt`, `paid`, `paidAt`) en `sync-v2.js`
- **ID:** PREC-02
- **SÍNTOMA:** El operador marca "Entregado" un pedido de un día anterior ya cerrado en caja; al sincronizar o recargar, el pedido revierte a "recibido" / pendiente.
- **CAUSA RAÍZ:** `sync-v2.js:540-551` rechaza indiscriminadamente cualquier operación sobre pedidos cuya fecha original de creación esté en un día cerrado, impidiendo que pedidos de días anteriores puedan entregarse o cobrarse en días posteriores.
- **EVIDENCIA:** En `applyOperation`, la condición de guarda lanza conflicto `closedDay` y aborta la escritura en Firestore.
- **ARCHIVO:** `sync-v2.js`
- **LÍNEAS APROX:** `sync-v2.js:540-552`
- **FIX MÍNIMO:**
  Modificar la condición de guarda en `sync-v2.js:540` para que, en el caso de la entidad `orders`, si se trata de una actualización operativa de ciclo de vida (campos modificados son exclusivamente `status`, `deliveredAt`, `paid`, `paidAt`), la operación **NO sea bloqueada por día cerrado**, permitiendo que se aplique limpiamente en Firestore:
  ```javascript
  const isLifecycleOrderUpdate = entity === "orders" && operation.type === "update" && (operation.changedFields || []).every((field) => ["status", "deliveredAt", "paid", "paidAt", "notes"].includes(field));
  if (!isLifecycleOrderUpdate && ["orders", "expenses", "supplyMovements"].includes(entity)) { ... }
  ```
- **QUÉ NO TOCAR:** No tocar la resolución de conflictos generales ni los protocolos de reintento o sincronización de `SyncEngine`. No permitir crear nuevos pedidos ni gastos retroactivos en días cerrados.
- **RIESGO:** Extremadamente bajo. Protege las finanzas del día cerrado (no permite alterar importes, cantidades ni servicios del pedido cerrado), pero desbloquea la entrega física y el cobro.
- **TEST:** Simular actualización de estado de un pedido con fecha en un día cerrado. Debe retornar `{ status: "applied" }` y no `{ status: "conflict", reason: "closed-day" }`.
- **REGRESIÓN:** Verificada con script adversarial.

---

### FIX 3: [PREC-03] Prevención de compras duplicadas entre `expenseForm` y `supplyForm`
- **ID:** PREC-03
- **SÍNTOMA:** Una compra de gas o insumos aparece 2 o 3 veces en gastos y multiplica el inventario.
- **CAUSA RAÍZ:** Coexistencia de dos formularios independientes en pestañas distintas ("Gastos" e "Insumos"), ambos creando un gasto y un movimiento de inventario sin verificar si la compra ya fue ingresada en el otro formulario.
- **EVIDENCIA:** `supplyForm` (app.js:589) crea un gasto automático y `expenseForm` (app.js:516) crea un movimiento automático.
- **ARCHIVO:** `app.js`
- **LÍNEAS APROX:** `app.js:505-520` y `app.js:540-565`
- **FIX MÍNIMO:**
  Incorporar una verificación de idempotencia en `expenseForm` y en `supplyForm`: si ya existe un gasto o movimiento para el mismo `supplyId`, mismo monto/costo y registrado en los últimos 5 minutos, alertar al operador: *"Esta compra ya fue registrada hace unos momentos. No es necesario volver a ingresarla."* y abortar el envío duplicado.
- **QUÉ NO TOCAR:** No alterar la estructura legítima 1 compra = 1 expense + 1 supplyMovement. No borrar compras históricas.
- **RIESGO:** Mínimo.
- **TEST:** Intentar registrar dos veces consecutivas la misma compra en `expenseForm` o en `supplyForm`. El segundo intento es rechazado con mensaje preventivo.
- **REGRESIÓN:** Compras legítimas en momentos distintos o con montos distintos se permiten normalmente.

---
**Fin de P0_PRECISION_REPAIR_PLAN.md**
