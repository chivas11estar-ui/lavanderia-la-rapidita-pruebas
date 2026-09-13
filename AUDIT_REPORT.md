# AUDIT_REPORT — LAVANDERÍA LA RAPIDITA
**Agente 2: Auditor Forense, Firebase/Sync, Rendimiento, Negocio, PWA y UX**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. RESUMEN EJECUTIVO

Se auditó de forma estricta e integral la base de código real de la aplicación web de producción:
- `app.js` (~2750 líneas)
- `sync-v2.js` (~740 líneas)
- `sw.js` (52 líneas)
- `manifest.webmanifest` (34 líneas)
- `supply-learning-v2.js` (144 líneas)
- `index.html` (521 líneas)
- `styles.css` (~940 líneas)

Siguiendo las restricciones fijas del proyecto, cada hallazgo cuenta con evidencia textual exacta en el código, archivo, función y número de línea verificado.

---

## 2. HALLAZGOS AUDITADOS

### HALLAZGO AUD-01: Fuga y duplicación de listeners en `onAuthStateChanged` (Sin guard de idempotencia / re-suscripción)
```
ID: AUD-01
Archivo: app.js
Función/bloque: initializeApp() -> firebase.auth().onAuthStateChanged / initializeSync()
Línea aprox: app.js:2729-2753 y app.js:1022-1053
Evidencia (qué código lo provoca):
En app.js:2729:
firebase.auth().onAuthStateChanged(async (user) => {
  ...
  cloudUser = user;
  if (!user) {
    elements.loginScreen.hidden = false;
    ...
    return;
  }
  ...
  await initializeSync(user);
});

Y en app.js:1022-1026:
async function initializeSync(user) {
  localStore = new RapiditaSyncV2.IndexedDbV2({ dbName: DB_NAME, version: 2 });
  const saved = await localStore.get(DB_STORE, DB_STATE_KEY);
  engine = new RapiditaSyncV2.SyncEngine({ ... });
  const result = await engine.initialize(normalizeState(saved));
  ...
}

Cómo se reproduce:
1. El usuario inicia sesión. Se crea una instancia de SyncEngine y se suscriben 7 colecciones de Firestore vía `onSnapshot`.
2. Firebase renueva el token OAuth en segundo plano (cada ~60 minutos) o se reemite el evento de autenticación por cambio de red, o el usuario cierra sesión y vuelve a iniciar sesión con otra o la misma cuenta.
3. Se invoca de nuevo `initializeSync(user)` sin invocar previamente `engine.stopRealtimeListeners()`.
4. Se crea un nuevo `SyncEngine` que sobreescribe la variable global `engine`, dejando vivos en memoria los 7 listeners anteriores de Firestore del motor previo.
Impacto:
Duplicación de eventos en tiempo real: cada cambio remoto en Firestore ejecuta múltiples veces `onStateChange` y re-renderizados simultáneos. Incremento de uso de memoria y potencial inconsistencia por motores compitiendo.
Severidad: P0
Confianza: CONFIRMED
```

---

### HALLAZGO AUD-02: Carrera de condiciones y falta de serialización/mutex en `mutate()`
```
ID: AUD-02
Archivo: app.js
Función/bloque: mutate(mutator)
Línea aprox: app.js:994-1001
Evidencia (qué código lo provoca):
async function mutate(mutator) {
  if (!engine) return;
  const next = clone(state);
  await mutator(next);
  state = normalizeState(next);
  render();
  await engine.syncState(state);
}

Cómo se reproduce:
1. Una operación asíncrona inicia `mutate(opA)`. Se clona `state` en `next` (valor t0).
2. Antes de que `await engine.syncState(state)` finalice o mientras `mutator` procesa, el usuario interactúa rápidamente (ej. doble clic en registrar abono/pago, o cambio rápido de estatus, o eliminar ítem) disparando `mutate(opB)`.
3. `opB` clona `state` que todavía refleja el estado t0 (o un estado parcial).
4. Ambas operaciones llaman concurrentemente a `engine.syncState()`.
5. En `sync-v2.js:422`, `syncState(nextState)` lee `const previousState = this.currentState || {}` y llama a `this.setCurrentState(nextState)` sin bloqueo mutuo en memoria de la UI.
6. La segunda llamada sobreescribe los cambios de la primera en `state` y puede generar diffs erróneos (`changedFields`), encolando operaciones que deshacen o duplican cambios.
Impacto:
Pérdida silenciosa de actualizaciones en UI o discrepancia entre el estado local y las operaciones encoladas para la nube.
Severidad: P0
Confianza: CONFIRMED
```

---

### HALLAZGO AUD-03: Botones de acción crítica sin protección contra doble clic (`disabled`)
```
ID: AUD-03
Archivo: app.js
Función/bloque: elements.ordersList (paidButton), elements.clearDayButton, elements.editOrderForm, elements.editClientForm
Línea aprox: app.js:725-736 (pago), app.js:890-925 (cierre de día), app.js:783-809 (edición pedido), app.js:811-840 (edición cliente)
Evidencia (qué código lo provoca):
1) En toggle pago (app.js:725-735):
if (paidButton) {
  const orderId = paidButton.dataset.paid;
  await mutate((next) => {
    ...
    order.paid = !order.paid;
    order.paidAt = order.paid ? new Date().toISOString() : null;
  });
  return;
}
No hay bandera de bloqueo ni se deshabilita el botón durante el guardado. Un doble clic rápido invierte `order.paid` a true y de inmediato a false.

2) En cierre de día (app.js:890):
elements.clearDayButton.addEventListener("click", async () => { ... await mutate(...) });
No hay `disabled = true`, no hay confirmación modal ni guard contra doble clic.

3) En edición de pedidos y clientes (app.js:783, 811):
Los formularios `editOrderForm` y `editClientForm` no deshabilitan su botón `submit` al iniciar el envío asíncrono.
Cómo se reproduce:
El usuario presiona dos veces rápido el botón de cobrar/pagar pedido o el botón de cierre de día. Ambas promesas corren en paralelo con los efectos descritos en AUD-02.
Impacto:
Cobro revertido involuntariamente, cierres de día ejecutados dos veces en milisegundos, doble mutación en base de datos.
Severidad: P1
Confianza: CONFIRMED
```

---

### HALLAZGO AUD-04: Manejo deficiente de errores en formularios (`orderForm`, `editClientForm`, `clearDayButton`)
```
ID: AUD-04
Archivo: app.js
Función/bloque: elements.orderForm.addEventListener("submit"), elements.editClientForm.addEventListener("submit"), elements.clearDayButton.addEventListener("click")
Línea aprox: app.js:379-453, app.js:811-840, app.js:890-925
Evidencia (qué código lo provoca):
1) En orderForm (app.js:379):
try {
  ...
  if (!typedCustomerName) throw new Error("Por favor selecciona o escribe un cliente.");
  await mutate(...);
  finishOrderForm();
} finally {
  isSubmittingOrder = false;
}
Carece de bloque `catch`. Si se lanza un error de validación o falla IndexedDB/Firestore en la cadena, el error queda como Unhandled Promise Rejection. No hay aviso visual al operador.

2) En editClientForm (app.js:811-840):
Carece de `catch`. Si `duplicate` es detectado, lanza `throw new Error("Ya existe un cliente con ese nombre.")`, el diálogo se queda abierto, no se muestra alerta y el error va a consola.

3) En clearDayButton (app.js:890):
Carece de `try/catch`. Si `mutate` falla, aún así ejecuta:
elements.closingStatus.textContent = "Cierre guardado y sincronizando.";
mostrando éxito falso.
Cómo se reproduce:
Intentar guardar un pedido con un fallo o cliente no seleccionado, o editar un cliente duplicando el nombre.
Impacto:
Confusión del usuario, falta de retroalimentación de errores de negocio, reportes de estado erróneos en pantalla.
Severidad: P1
Confianza: CONFIRMED
```

---

### HALLAZGO AUD-05: Falta de evento `online` para reconexión y drenado automático de cola
```
ID: AUD-05
Archivo: app.js / sync-v2.js
Función/bloque: Global / SyncEngine
Línea aprox: app.js:1003-1053, sync-v2.js:274-725
Evidencia (qué código lo provoca):
En sync-v2.js:513:
operation.status = retryable && (connectionUnavailable || operation.attempts < this.maxAttempts) ? "pending" : "failed";
await this.queue.update(operation);
Cuando se detecta caída de conexión, la operación queda con estatus `"pending"` en IndexedDB.
Sin embargo, ni en `app.js` ni en `sync-v2.js` existe un listener para `window.addEventListener("online", ...)` ni temporizador de reconexión para ejecutar `engine.drain()`.
Cómo se reproduce:
1. El usuario registra una venta u operación sin internet. Queda en cola local como `"pending"`.
2. El dispositivo recupera la conexión a internet.
3. El indicador sigue en "Sin conexión" o la operación permanece en cola hasta que el usuario realice OTRA acción que dispare `mutate()` o recargue manualmente la página.
Impacto:
Retraso innecesario en la sincronización a la nube tras volver a tener internet.
Severidad: P2
Confianza: CONFIRMED
```

---

### HALLAZGO AUD-06: Riesgo de estancamiento en Cache-First para scripts del Service Worker
```
ID: AUD-06
Archivo: sw.js, index.html
Función/bloque: CACHE_NAME, APP_SHELL, fetch event listener
Línea aprox: sw.js:1-14, sw.js:46-51, index.html:508-519
Evidencia (qué código lo provoca):
En sw.js:12-13:
const APP_SHELL = [
  ...
  "./sync-v2.js",
  "./supply-learning-v2.js",
];
En index.html:508-509:
<script src="sync-v2.js"></script>
<script src="supply-learning-v2.js"></script>

Y en sw.js:46-51:
event.respondWith(
  caches.match(event.request).then((cached) => cached || fetch(event.request).then(...))
);
El Service Worker usa Cache-First para todos los assets que coinciden con su origen.
A diferencia de `app.js?v=33` y `styles.css?v=32`, los archivos `sync-v2.js` y `supply-learning-v2.js` no tienen query string de versión.
Si se actualiza `sync-v2.js` sin incrementar `CACHE_NAME`, el cliente continuará cargando la versión vieja desde la caché indefinidamente.
Además, en `index.html`, la activación del nuevo Service Worker (vía `clients.claim()`) no notifica al usuario ni refresca la aplicación.
Cómo se reproduce:
Deploy con cambios en `sync-v2.js` donde un usuario tiene abierta la app o abre la app con caché previa.
Impacto:
Usuarios atrapados en versiones de script desincronizadas con el backend.
Severidad: P2
Confianza: CONFIRMED
```

---

### HALLAZGO AUD-07: Ausencia de purga de operaciones con estatus "applied" en IndexedDB
```
ID: AUD-07
Archivo: sync-v2.js
Función/bloque: SyncQueue.pending()
Línea aprox: sync-v2.js:176-179, sync-v2.js:502-506
Evidencia (qué código lo provoca):
async pending() {
  const operations = await this.localStore.getAll("syncQueue");
  return operations.filter((operation) => ["pending", "sending"].includes(operation.status)).sort(...);
}
Cada operación completada se marca como `applied`, pero nunca se elimina de `syncQueue`.
Con el paso de meses y miles de pedidos y gastos, `this.localStore.getAll("syncQueue")` debe deserializar miles de objetos cada vez que se evalúa la cola o se sincroniza.
Impacto:
Degradación progresiva de rendimiento en dispositivos móviles de gama baja tras meses de uso continuo.
Severidad: P3
Confianza: CONFIRMED
```

---

## 3. COMPONENTES AUDITADOS SIN DEFECTO (`YA_ESTABA_BIEN`)

1. **Resolución de conflictos y validación de cierres en `sync-v2.js`**:
   `applyOperation` (líneas 536-551) valida correctamente que si un día ya fue cerrado remotamente, no sobreescribe pedidos u operaciones rezagadas de forma ciega; las envía a `conflictManager`.
2. **Idempotencia de operaciones remotas (`lastOperationId` / `syncOperations`)**:
   Líneas 529-535 previenen la duplicación en Firestore si una petición de red sufrió un corte o reload a mitad del envío.
3. **Bloqueo concurrente entre pestañas (`withQueueLock`)**:
   Líneas 135-156 usan `navigator.locks.request` exclusivo por base de datos, evitando colisiones entre pestañas al drenar la cola.
4. **Modo fuera de línea para navegación (`sw.js`)**:
   Líneas 36-41 implementan Network-First con fallback a caché (`./index.html`) para peticiones de tipo `navigate`, lo que garantiza que la navegación cargue la versión más reciente cuando hay red.
5. **Cálculos matemáticos de costo y punto de equilibrio (`supply-learning-v2.js`)**:
   Funciones puras, inmutables, sin efectos secundarios ni llamadas globales no controladas.
6. **Diseño visual y layout (`styles.css` e `index.html`)**:
   No se encontraron superposiciones destructivas ni bugs de maquetación en móvil; las clases utilitarias y responsivas preservan la jerarquía visual de la marca.

---
**Fin de AUDIT_REPORT.md**
