# P0_SYNC_REPLAY_FORENSICS — SINCRONIZACIÓN Y ESTADO REMOTO
**Agente 4: Especialista Sync V2 + Replay + Estado Remoto**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. MISIÓN Y ALCANCE

Analizar el comportamiento del motor `RapiditaSyncV2.SyncEngine` (`sync-v2.js`), sus interacciones con Firestore, la cola en IndexedDB (`syncQueue`) y las transiciones de estado remoto que provocan reversión de pedidos entregados a pendientes o ecos/duplicaciones.

---

## 2. MAPEO DEL FLUJO DE SINCRONIZACIÓN REAL

```text
[UI: Click en acción / Formulario]
       │
       ▼
app.js: mutate(mutator) ── (Serializado por mutationQueue)
       │
       ├─► mutator(next) ── Modifica copia local en memoria
       ├─► state = normalizeState(next) ── Normaliza UI local
       ├─► render() ── Actualiza pantalla de inmediato (Optimistic UI)
       │
       ▼
sync-v2.js: engine.syncState(nextState)
       │
       ├─► Compara previousState vs nextState para cada entidad (ENTITY_KEYS)
       ├─► Detecta diferencias con changedFields(before, item)
       ├─► Encola en IndexedDB: enqueue({ entity, entityId, type, changes, changedFields, ... })
       │
       ▼
sync-v2.js: drain() ── (Protegido por Web Locks API navigator.locks)
       │
       ├─► drainQueue() ── Serializa por entity:entityId
       ├─► process(operation) ── status: "sending"
       │
       ▼
sync-v2.js: applyOperation(operation)
       │
       ├─► Líneas 540-551: Guarda de día cerrado (closedDay check)  <── [PUNTO DE FALLA CRÍTICO]
       ├─► Si pasa guarda: FirestoreV2.patch() / create()
       ├─► recordOperation(operation)
       └─► operation.status = "applied"
       │
       ▼
[Firebase Firestore: Emite onSnapshot a todos los clientes]
       │
       ▼
sync-v2.js: applyRemoteCollection(entity, items, generation)
       │
       ├─► remoteItems = items.filter(!deletedAt)
       ├─► pending = queue.pending()
       ├─► nextState[entity] = [...remoteItems, ...localPendingSinRemotos]
       ├─► this.setCurrentState(nextState)
       └─► this.onStateChange(nextState)
              │
              ▼
       app.js: onStateChange -> normalizeState() -> render()
```

---

## 3. ANÁLISIS FORENSE DE LA CAUSA RAÍZ EN `sync-v2.js` (LÍNEAS 540-551)

En `sync-v2.js:540-551`:
```javascript
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
```

### ¿Por qué rompe los pedidos entregados?
1. Un cliente deja su ropa el lunes. `remote.createdAt` = `2026-09-08`.
2. El lunes por la noche se hace el corte de caja ("Cerrar día"). En Firestore se crea el documento en la colección `closings` con `dateKey: "2026-09-08"`.
3. El cliente va a recoger su ropa el miércoles `2026-09-10`.
4. El operador presiona "Entregado" en la app.
5. Se encola la operación:
   - `entity: "orders"`
   - `type: "update"`
   - `changes: { status: "entregado", deliveredAt: "2026-09-10T18:00:00Z" }`
   - `changedFields: ["status", "deliveredAt"]`
6. `drain()` ejecuta `applyOperation`.
7. `dateValue` toma `remote.createdAt` (lunes `2026-09-08`).
8. `closings.find()` encuentra el cierre del lunes.
9. **`applyOperation` RECHAZA la actualización y la marca como CONFLICTO `closedDay`**.
10. La escritura en Firestore **NUNCA se realiza**. En Firestore el pedido sigue teniendo `status: "recibido"`.
11. Cuando Firestore envía el snapshot de actualización o el usuario recarga la página, `applyRemoteCollection` sobrescribe el estado local con el documento de Firestore (`status: "recibido"`).
12. **El pedido que el usuario marcó como "Entregado" reaparece como "Recibido" / pendiente.**

### ¿Afecta también el cobro posterior?
**SÍ.** Si el cliente paga su pedido días después de creado, `operation.changes = { paid: true, paidAt: ... }`. La guarda `closedDay` también bloquea el cobro por la misma causa raíz.

---

## 4. CASO SIMULADO 1: PEDIDO ENTREGADO

- **Flujo Esperado:**
  1. Pedido creado día 1 (`status: "recibido"`).
  2. Día 1 cerrado en caja (`closings` contiene día 1).
  3. Día 2: Operador cambia a `status: "entregado"`.
  4. `SyncEngine` debe detectar que los campos modificados son de ciclo de vida (`["status", "deliveredAt"]` o `["paid", "paidAt"]`), los cuales **no alteran las ventas del día 1**, y por ende **NO deben ser bloqueados por `closedDay`**.
  5. Operación se aplica en Firestore.
  6. Al recargar o recibir snapshot: el pedido **permanece entregado**.

---

## 5. CASO SIMULADO 2: COMPRA DE GAS

- **Flujo Esperado:**
  1. Compra de gas $500 por 30 kg.
  2. Genera:
     - 1 documento en `expenses` con ID único.
     - 1 documento en `supplyMovements` con ID único vinculado por `expenseId`.
     - 1 actualización en `supplies/gas` (`quantity += 30`).
  3. `SyncEngine` envía los 3 documentos a Firestore con sus IDs exactos.
  4. Snapshot remoto emite la colección.
  5. `applyRemoteCollection` fusiona por ID existente en `remoteItems`.
  6. Al recargar: los IDs se mantienen y **sigue siendo exactamente una sola compra**.

---
**Fin de P0_SYNC_REPLAY_FORENSICS.md**
