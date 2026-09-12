# QA_ADVERSARIAL_REPORT — LAVANDERÍA LA RAPIDITA
**Agente 3: Breaker / QA Adversarial**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. OBJETIVO DEL ROL
Intentar romper la aplicación evaluando rigurosamente el comportamiento real del código bajo 8 escenarios adversos críticos.  
Para cada escenario se analiza si el código actual lo **previene**, lo **ignora** o lo **rompe**, con la cita textual de la línea de código exacta que lo demuestra.

---

## 2. MATRIZ DE ESCENARIOS ADVERSARIALES

| # | Escenario Adversarial | Veredicto Código Actual | Archivo y Línea Exacta | Nivel de Riesgo |
|---|------------------------|-------------------------|------------------------|-----------------|
| 1 | Login → reload inmediato | **PREVIENE** (Parcialmente seguro) | `sync-v2.js:96-103, 356-366` | P3 (Bajo) |
| 2 | Logout → login → logout → login | **ROMPE** (Fuga y acumulación de listeners) | `app.js:2729-2753`, `app.js:1022-1039`, `sync-v2.js:711` | **P0 (Crítico)** |
| 3 | Doble clic rápido en botón guardar venta / abono / cierre de día | **ROMPE** (Carrera en `mutate()`, toggle erróneo) | `app.js:994-1001`, `app.js:725-736`, `app.js:890-925` | **P0 (Crítico)** |
| 4 | Cambiar de pantalla mientras una escritura a Firebase está en curso | **PREVIENE** (Arquitectura SPA) | `app.js:2390-2405` | Seguro |
| 5 | Conexión lenta / intermitente durante una operación | **IGNORA** (Falta reconexión automática `online`) | `sync-v2.js:513-520` | **P2 (Medio)** |
| 6 | Refresh a mitad de apertura o cierre de día | **PREVIENE** (Idempotencia de cola IndexedDB) | `app.js:898-922`, `sync-v2.js:528-535` | Seguro |
| 7 | Varias pestañas abiertas al mismo tiempo con la misma sesión | **PREVIENE** (Web Locks API / `withQueueLock`) | `sync-v2.js:135-141`, `sync-v2.js:472` | Seguro |
| 8 | Cache / Service Worker viejo después de deploy nuevo | **IGNORA / ROMPE** (Cache-First sin versión en scripts auxiliares) | `sw.js:12-14, 46-51`, `index.html:508-509` | **P2 (Medio)** |

---

## 3. ANÁLISIS DETALLADO POR ESCENARIO

### Escenario 1: Login → reload inmediato
- **Veredicto:** **PREVIENE**
- **Evidencia en código:**
  - En `app.js:2729`, `onAuthStateChanged` arranca `initializeSync(user)`.
  - En `sync-v2.js:357`, `this.localStore.open()` abre la base de datos IndexedDB. Las transacciones de IndexedDB (`sync-v2.js:97`) son atómicas por especificación del navegador.
  - Si el usuario recarga durante la llamada a Firestore `readRemoteState()` (`sync-v2.js:360`), la promesa se descarta por el ciclo de vida de la ventana. Al recargar, la sesión persiste en Firebase Auth y la inicialización arranca limpiamente desde el estado guardado en IndexedDB (`app.js:1024`).
- **Punto débil menor:** Si una escritura en IndexedDB no concluyó, la transacción se aborta sin corrupción (`tx.onabort` en `sync-v2.js:102`).

---

### Escenario 2: Logout → login → logout → login
- **Veredicto:** **ROMPE**
- **Evidencia en código:**
  - En `app.js:2737-2743`:
    ```javascript
    cloudUser = user;
    if (!user) {
      elements.loginScreen.hidden = false;
      document.body.classList.add("cloud-locked");
      elements.loginGoogleButton.disabled = false;
      return;
    }
    ```
    Cuando el usuario sale o el estado de usuario pasa a nulo, **NO se invoca** `engine.stopRealtimeListeners()`.
  - En `app.js:1026`:
    ```javascript
    engine = new RapiditaSyncV2.SyncEngine({
      firestore: cloudDatabase,
      user,
      ...
    ```
    Al volver a autenticarse, `initializeSync(user)` se ejecuta de nuevo y asigna un **nuevo** `SyncEngine` a la variable `engine`.
  - En `sync-v2.js:682-687`:
    Cada instancia de `SyncEngine` crea suscriptores a Firestore (`remote.subscribe(entity, onSnapshot, onError)`).
  - La instancia anterior nunca recibió `stopRealtimeListeners()` (`sync-v2.js:711`), por lo que sus 7 suscriptores (`orders`, `customers`, `services`, `expenses`, `supplies`, `supplyMovements`, `closings`) siguen vivos en background en el SDK de Firebase.
  - **Consecuencia adversarial:** Tras 2 ciclos de login/logout hay 14 listeners; tras 3 hay 21. Cada cambio remoto dispara múltiples llamadas a `onStateChange` y re-renders desordenados.

---

### Escenario 3: Doble clic rápido en botón de guardar venta / abono / cierre de día
- **Veredicto:** **ROMPE**
- **Evidencia en código:**
  1. **Falta de serialización en `mutate()` (`app.js:994-1001`):**
     ```javascript
     async function mutate(mutator) {
       if (!engine) return;
       const next = clone(state);
       await mutator(next);
       state = normalizeState(next);
       render();
       await engine.syncState(state);
     }
     ```
     `mutate()` no tiene semáforo ni cola FIFO en memoria. Dos ejecuciones concurrentes clonan el mismo `state` inicial. La que termine primero es sobreescrita por la que termine después.
  2. **Botón de cobro/abono (`app.js:725-735`):**
     ```javascript
     if (paidButton) {
       const orderId = paidButton.dataset.paid;
       await mutate((next) => {
         const order = next.orders.find((item) => item.id === orderId);
         if (!order) return;
         if (order.paid && normalizeStatus(order.status) === "entregado") return;
         if (order.paid && isRecordLocked(order.paidAt || order.createdAt)) return;
         order.paid = !order.paid;
         order.paidAt = order.paid ? new Date().toISOString() : null;
       });
       return;
     }
     ```
     No tiene `button.disabled = true`. Si el operador da doble clic en "Registrar pago", el primer clic marca `order.paid = true`, y el segundo clic (milisegundos después) lee o conmuta a `order.paid = false`.
  3. **Botón de cierre de día (`app.js:890`):**
     `elements.clearDayButton.addEventListener("click", async () => { ... await mutate(...) })`
     No se deshabilita durante la ejecución. Un doble clic dispara dos mutaciones consecutivas que generan dos cálculos y dos operaciones de cierre encoladas.
  4. **Formularios de edición (`app.js:783, 811`):**
     `editOrderForm` y `editClientForm` no bloquean el botón submit al enviar.

---

### Escenario 4: Cambiar de pantalla mientras una escritura a Firebase está en curso
- **Veredicto:** **PREVIENE**
- **Evidencia en código:**
  - En `app.js:2390-2405`:
    ```javascript
    function showView(viewId) {
      document.querySelectorAll(".screen-section").forEach((section) => {
        section.classList.toggle("active", section.id === viewId);
      });
      ...
    ```
  - La navegación es 100% visual dentro del mismo DOM (Single Page Application vía clases CSS). No hay descarga de página ni cancelación de promesas ni reinicio de contexto.
  - La mutación y el envío encolado (`engine.drain()`) siguen su curso en el event loop sin afectarse.

---

### Escenario 5: Conexión lenta / intermitente durante una operación
- **Veredicto:** **IGNORA**
- **Evidencia en código:**
  - En `sync-v2.js:511-515`:
    Si la conexión falla, `operation.status` se marca como `"pending"` y se guarda en IndexedDB. La UI pasa a estado offline (`app.js:1009`).
  - Sin embargo, **no existe** ningún listener para el evento del navegador `window.addEventListener("online")` ni en `app.js` ni en `sync-v2.js`.
  - Si la red vuelve después de 5 minutos, la operación pendiente se queda "dormida" en IndexedDB hasta que el usuario intente hacer otra acción que invoque `mutate()` (y por ende `autoDrain`), o recargue la página.
  - **Consecuencia adversarial:** El usuario cree que su venta no se ha subido o no se entera de cuándo se restableció la sincronización.

---

### Escenario 6: Refresh a mitad de una apertura o cierre de día
- **Veredicto:** **PREVIENE**
- **Evidencia en código:**
  - No existe modelo de "apertura" separada (el día inicia con el primer pedido del día).
  - Para el cierre de día (`app.js:898`):
    El ID del documento de cierre es determinista: `id: dateKeyStr` (`app.js:900`).
  - En `sync-v2.js:534` y `sync-v2.js:555`:
    ```javascript
    if (remote?.lastOperationId === operation.operationId || remote?.sourceOperationId === operation.operationId)
      return { status: "applied", duplicate: true };
    ```
  - Si el navegador se refresca a mitad del guardado, el ID único de operación (`operationId`) evita duplicaciones en Firestore, y la consulta de colecciones al inicializar (`sync-v2.js:360`) reconstituye el cierre si ya existía en la nube.

---

### Escenario 7: Varias pestañas abiertas al mismo tiempo con la misma sesión
- **Veredicto:** **PREVIENE**
- **Evidencia en código:**
  - En `sync-v2.js:135-141`:
    ```javascript
    async withQueueLock(work) {
      if (global.navigator?.locks?.request) {
        return global.navigator.locks.request(`la-rapidita-sync-queue-${this.dbName}`, { mode: "exclusive" }, async () => {
          this.onLockEvent?.({ type: "lockAcquired", owner: getDeviceId(), acquiredAt: nowIso() });
          try { return await work(); } finally { this.onLockEvent?.({ type: "lockReleased", owner: getDeviceId(), releasedAt: nowIso() }); }
        });
      }
      ...
    ```
  - `IndexedDbV2` implementa Web Locks API con modo `exclusive` para el drenado de la cola (`sync-v2.js:472`). Si la pestaña A está drenando la cola, la pestaña B espera su turno y no colisiona procesando la misma operación simultáneamente.
  - Además, ambas pestañas reciben los eventos de cambio remoto vía `onSnapshot` de Firestore, manteniendo sincronizado el estado visible.

---

### Escenario 8: Cache / Service Worker viejo después de un deploy nuevo
- **Veredicto:** **IGNORA / ROMPE**
- **Evidencia en código:**
  - En `sw.js:1-14`:
    `CACHE_NAME = "la-rapidita-v33"`.
    En `APP_SHELL`:
    `"./sync-v2.js"` y `"./supply-learning-v2.js"` carecen de query string con versión.
  - En `sw.js:46-51`:
    La estrategia para recursos estáticos es estricta **Cache-First**:
    ```javascript
    caches.match(event.request).then((cached) => cached || fetch(event.request)...)
    ```
  - En `index.html:511-519`:
    El registro del Service Worker no incluye detección de `updatefound` ni `controllerchange` para forzar o sugerir actualización.
  - **Consecuencia adversarial:** Si se despliegan cambios en `sync-v2.js` o `supply-learning-v2.js` sin alterar manualmente el string `CACHE_NAME` en `sw.js`, los navegadores de los clientes seguirán sirviendo el JS anterior desde la caché de forma persistente.

---

## 4. RESUMEN DE ROTURAS CONFIRMADAS PARA REPARACIÓN

1. **ROTURA CRÍTICA 1 (P0):** Acumulación de listeners de Firestore en ciclo de sesión (`app.js:2729`, `app.js:1026`).
2. **ROTURA CRÍTICA 2 (P0):** Condiciones de carrera en `mutate()` por falta de cola/mutex (`app.js:994`).
3. **ROTURA ALTA 3 (P1):** Botón de pago, cierre de día y modales sin bloqueo `disabled` contra doble clic (`app.js:725`, `app.js:890`, `app.js:783`, `app.js:811`).
4. **ROTURA MEDIA 4 (P1):** Ausencia de `try/catch` y avisos al usuario en `orderForm` y `editClientForm` (`app.js:379`, `app.js:811`).
5. **ROTURA MEDIA 5 (P2):** Ausencia de auto-drenado al reconectar internet (`online` event) (`app.js:1003`).

---
**Fin de QA_ADVERSARIAL_REPORT.md**
