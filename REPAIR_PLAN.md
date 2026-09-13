# REPAIR_PLAN — LAVANDERÍA LA RAPIDITA
**Agente 4: Planificador (Solution Architect)**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. CRITERIOS DE PLANIFICACIÓN
1. Solo se planifican soluciones para hallazgos con veredicto **CONFIRMED** provenientes de `AUDIT_REPORT.md` y `QA_ADVERSARIAL_REPORT.md`.
2. Máxima restricción: cambios **mínimos**, quirúrgicos, que ataquen la causa raíz directa sin refactorización estética ni sobre-ingeniería.
3. Se protegen las áreas críticas del sistema: `sync-v2.js` mantiene su contrato intacto; la lógica se asegura desde la orquestación en `app.js`.

---

## 2. PLAN DE REPARACIÓN ORDENADO POR PRIORIDAD

### [P0-1] Fuga y acumulación de listeners en ciclo de autenticación (`onAuthStateChanged`)
- **Problema:** En cada ciclo de sesión o renovación de token, `initializeSync(user)` crea una nueva instancia de `SyncEngine` sin detener los listeners de Firestore del motor anterior, provocando fugas de memoria y llamadas múltiples de `onStateChange`.
- **Causa raíz:** `app.js:2729-2753` no invoca `engine.stopRealtimeListeners()` en logout (`!user`), no valida si el motor ya está activo para el mismo usuario, y `initializeSync(user)` no detiene una instancia previa antes de crear una nueva.
- **Archivo(s) a modificar:**
  - `app.js` (bloque `initializeApp` y función `initializeSync`)
- **Archivo(s) que NO deben tocarse:**
  - `sync-v2.js`, `styles.css`, `index.html`, `sw.js`
- **Solución propuesta (mínima):**
  1. En `app.js`, en `initializeApp()` dentro de `firebase.auth().onAuthStateChanged(async (user) => { ... })`:
     - Si `!user`: Si existe `engine`, ejecutar `engine.stopRealtimeListeners(); engine = null;`.
     - Si `user`: Verificar si `engine` ya está inicializado y activo para el mismo usuario (`engine && engine.user?.uid === user.uid && engine.listenersActive`). Si es así, omitir la reinicialización.
  2. En `initializeSync(user)`:
     - Si ya existe un `engine` previo, ejecutar `engine.stopRealtimeListeners();` antes de crear `engine = new RapiditaSyncV2.SyncEngine(...)`.
- **Riesgo de la solución:** Mínimo. `stopRealtimeListeners()` ya está implementado en `sync-v2.js:711`.
- **Prioridad:** **P0**
- **Prueba para verificar que quedó arreglado:**
  Simular un evento `onAuthStateChanged` repetido con el mismo usuario autenticado. Verificar que `engine` no se reinstancia innecesariamente. Simular `onAuthStateChanged(null)` y verificar que los listeners se detienen.
- **Riesgo de regresión:** Ninguno; protege la estabilidad de la sesión.

---

### [P0-2] Condiciones de carrera y falta de serialización en `mutate()`
- **Problema:** Múltiples mutaciones concurrentes disparadas por clics rápidos o eventos solapados clonan un estado obsoleto de memoria, sobreescriben cambios locales y provocan diffs erróneos en `engine.syncState()`.
- **Causa raíz:** `app.js:994-1001` ejecuta `mutate(mutator)` de forma asíncrona libre sin una cola FIFO de promesas en memoria.
- **Archivo(s) a modificar:**
  - `app.js` (función `mutate`)
- **Archivo(s) que NO deben tocarse:**
  - `sync-v2.js`, `styles.css`, `index.html`
- **Solución propuesta (mínima):**
  Implementar encadenamiento secuencial mediante una promesa cola (`mutationQueue`):
  ```javascript
  let mutationQueue = Promise.resolve();
  function mutate(mutator) {
    if (!engine) return Promise.resolve();
    const task = mutationQueue.then(async () => {
      const next = clone(state);
      await mutator(next);
      state = normalizeState(next);
      render();
      await engine.syncState(state);
    });
    mutationQueue = task.catch((error) => {
      console.error("Error en cola de mutación:", error);
    });
    return task;
  }
  ```
- **Riesgo de la solución:** Extremadamente bajo. Preserva la compatibilidad exacta (`await mutate(...)`).
- **Prioridad:** **P0**
- **Prueba para verificar que quedó arreglado:**
  Disparar concurrentemente dos mutaciones asíncronas sobre la misma entidad y verificar que se resuelven en serie, de modo que la segunda mutación opera sobre el estado resultante de la primera.
- **Riesgo de regresión:** Ninguno; garantiza consistencia de datos ACID en la memoria de la aplicación.

---

### [P1-1] Botones de acción crítica sin protección contra doble clic (`disabled`)
- **Problema:** En la lista de pedidos, el botón de cobro (`paidButton`), el botón de cierre de día (`clearDayButton`), y los botones de submit de edición (`editOrderForm`, `editClientForm`) no se bloquean mientras la mutación está en curso.
- **Causa raíz:** No existe bloqueo en el elemento del DOM ni bandera en el manejador del clic.
- **Archivo(s) a modificar:**
  - `app.js` (manejadores de `ordersList`, `clearDayButton`, `editOrderForm`, `editClientForm`)
- **Archivo(s) que NO deben tocarse:**
  - `sync-v2.js`, `styles.css`
- **Solución propuesta (mínima):**
  1. En `ordersList` para `paidButton`: deshabilitar temporalmente el botón durante el `await mutate(...)`.
  2. En `clearDayButton`: deshabilitar el botón `elements.clearDayButton.disabled = true;` y restaurarlo tras el guardado.
  3. En `editOrderForm` y `editClientForm`: deshabilitar el botón submit al inicio y restaurarlo en `finally`.
- **Riesgo de la solución:** Mínimo.
- **Prioridad:** **P1**
- **Prueba para verificar que quedó arreglado:**
  Hacer doble clic rápido en "Registrar pago" y en "Cerrar día". Verificar que el botón queda deshabilitado tras el primer clic y no se procesa un segundo evento.
- **Riesgo de regresión:** Ninguno.

---

### [P1-2] Manejo deficiente de errores en formularios (`orderForm`, `editClientForm`, `clearDayButton`)
- **Problema:** Si ocurre un error de validación o fallo de IndexedDB al guardar un pedido o cliente, se genera un Unhandled Promise Rejection y el usuario no recibe ningún aviso. En cierre de día se reporta éxito incluso si falla.
- **Causa raíz:** Falta de bloque `catch` con retroalimentación al usuario en `elements.orderForm`, `elements.editClientForm` y `elements.clearDayButton`.
- **Archivo(s) a modificar:**
  - `app.js`
- **Archivo(s) que NO deben tocarse:**
  - `sync-v2.js`, `styles.css`
- **Solución propuesta (mínima):**
  1. En `orderForm`: envolver en `catch (error) { alert(error.message || "No se pudo guardar el pedido."); }`.
  2. En `editClientForm`: envolver en `catch (error) { alert(error.message || "Error al actualizar el cliente."); }`.
  3. En `clearDayButton`: mover el mensaje de éxito dentro del bloque try tras el `await mutate`, y en catch mostrar alerta y restaurar el mensaje previo.
- **Riesgo de la solución:** Mínimo.
- **Prioridad:** **P1**
- **Prueba para verificar que quedó arreglado:**
  Intentar enviar el formulario provocando un error y validar que el usuario recibe una alerta informativa en vez de una pantalla estancada sin aviso.
- **Riesgo de regresión:** Ninguno.

---

### [P2-1] Reconexión automática de la cola al volver el internet (`online` event)
- **Problema:** Tras un periodo sin conexión, cuando vuelve internet la app no drena la cola hasta que el usuario realiza otra acción o recarga.
- **Causa raíz:** Falta el listener de `window.addEventListener("online")`.
- **Archivo(s) a modificar:**
  - `app.js` (en `initializeApp`)
- **Archivo(s) que NO deben tocarse:**
  - `sync-v2.js`, `styles.css`
- **Solución propuesta (mínima):**
  En `initializeApp()`:
  ```javascript
  window.addEventListener("online", () => {
    if (engine && typeof engine.drain === "function") {
      engine.drain().catch(() => {});
    }
  });
  ```
- **Riesgo de la solución:** Mínimo. `engine.drain()` es seguro y con bloqueo de cola.
- **Prioridad:** **P2**
- **Prueba para verificar que quedó arreglado:**
  Disparar el evento `online` en `window` y verificar que `engine.drain()` se ejecuta.
- **Riesgo de regresión:** Ninguno.

---

### [P2-2] Versionado coherente de scripts en Service Worker y HTML
- **Problema:** `sync-v2.js` y `supply-learning-v2.js` carecen de query param de versión, arriesgando servir versiones viejas de caché en deploys.
- **Causa raíz:** Inconsistencia entre el versionado de `app.js?v=33` y los scripts auxiliares.
- **Archivo(s) a modificar:**
  - `index.html`
  - `sw.js`
- **Archivo(s) que NO deben tocarse:**
  - `styles.css`, `sync-v2.js`
- **Solución propuesta (mínima):**
  Actualizar en `index.html` y `sw.js` las referencias a `./sync-v2.js?v=33` y `./supply-learning-v2.js?v=33`.
- **Riesgo de la solución:** Mínimo.
- **Prioridad:** **P2**
- **Prueba para verificar que quedó arreglado:**
  Verificar que las URLs en `APP_SHELL` coinciden con los scripts cargados en `index.html`.
- **Riesgo de regresión:** Ninguno.

---

## 3. ORDEN DE IMPLEMENTACIÓN PARA EL PROGRAMADOR (AGENTE 5)
1. **Fix 1 [P0-1]:** Idempotencia y limpieza de listeners en `onAuthStateChanged` y `initializeSync` (`app.js`).
2. **Fix 2 [P0-2]:** Cola secuencial (mutex en memoria) en `mutate()` (`app.js`).
3. **Fix 3 [P1-1]:** Bloqueo contra doble clic (`disabled`) en `paidButton`, `clearDayButton`, `editOrderForm`, `editClientForm` (`app.js`).
4. **Fix 4 [P1-2]:** Captura de errores con aviso al usuario en `orderForm`, `editClientForm`, `clearDayButton` (`app.js`).
5. **Fix 5 [P2-1]:** Evento `online` para reconexión automática (`app.js`).
6. **Fix 6 [P2-2]:** Versionado coherente en `index.html` y `sw.js`.

---
**Fin de REPAIR_PLAN.md**
