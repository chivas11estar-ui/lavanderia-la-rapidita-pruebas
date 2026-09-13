# CAMBIOS_APLICADOS — LAVANDERÍA LA RAPIDITA
**Agente 5: Programador**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. RESUMEN DE LA INTERVENCIÓN

Se ejecutaron exclusivamente los cambios autorizados en `REPAIR_PLAN.md`, en estricto orden de prioridad (P0 a P2). No se modificó ningún archivo protegido (`sync-v2.js`, `styles.css`, `supply-learning-v2.js`, `manifest.webmanifest`), preservando la regla de intervención mínima y no destructiva.

---

## 2. DETALLE DE CAMBIOS POR ARCHIVO

### 2.1. Archivo: `app.js`

#### Cambio 1 (P0-1): Idempotencia de sesión y limpieza de listeners en `onAuthStateChanged` e `initializeSync`
- **Líneas aprox:** `app.js:1022-1026` y `app.js:2808-2826`
- **Causa raíz atacada:** Múltiples ejecuciones de `onAuthStateChanged` o ciclos de login/logout recreaban el motor `SyncEngine` dejando los `onSnapshot` de Firestore anteriores escuchando en paralelo (7 listeners multiplicados en cada ciclo).
- **Modificación:**
  - En `initializeSync(user)`: Se ejecuta `engine.stopRealtimeListeners()` antes de instanciar uno nuevo.
  - En `onAuthStateChanged(user)`:
    - Al cerrar sesión (`!user`): Si existe `engine`, se detienen los listeners con `engine.stopRealtimeListeners()` y se asigna `engine = null;`.
    - Al renovar token (`user` presente): Si `engine` ya está activo y coincide con `user.uid`, se aborta la reinicialización redundante con `return;`.
- **Prueba que lo valida:**
  - Script de prueba automatizado que simula el ciclo de login inicial → refresh de token → logout → segundo login. Se verificó que `stopRealtimeListeners()` se invoca exactamente en el logout y que el refresh de token no crea instancias duplicadas.

#### Cambio 2 (P0-2): Serialización FIFO (Mutex en memoria) en `mutate()`
- **Líneas aprox:** `app.js:994-1010`
- **Causa raíz atacada:** Las llamadas concurrentes a `mutate(mutator)` no estaban encoladas. Dos mutaciones simultáneas leían el mismo estado base en memoria, sobrescribían cambios de la otra y llamaban desincronizadamente a `engine.syncState(state)`.
- **Modificación:**
  - Se implementó una cola de promesas FIFO `mutationQueue` que encadena secuencialmente cada invocación de `mutate()`, garantizando que cada mutador reciba el estado actualizado resultante de la mutación anterior antes de sincronizar con `SyncEngine`.
- **Prueba que lo valida:**
  - Test de concurrencia con promesas de duración asíncrona variable (50ms vs 10ms). Se comprobó que la ejecución preserva el orden secuencial estricto sin pérdida de incrementos o datos en `state`.

#### Cambio 3 (P1-1 & P1-2): Protección contra doble clic y manejo de errores con retroalimentación al usuario
- **Líneas aprox:**
  - `app.js:382-455` (`elements.orderForm`)
  - `app.js:715-755` (`elements.ordersList` para `statusButton` y `paidButton`)
  - `app.js:800-880` (`elements.editOrderForm` y `elements.editClientForm`)
  - `app.js:935-985` (`elements.clearDayButton`)
- **Causa raíz atacada:** Botones sin atributo `disabled` durante operaciones asíncronas permitían dobles clics rápidos (reversión involuntaria de pago en pedidos, duplicación de cierre de día, envíos múltiples). Además, `orderForm` y `editClientForm` carecían de `try/catch`, generando excepciones silenciosas (Unhandled Promise Rejections) sin avisar al operador.
- **Modificación:**
  - Deshabilitación explícita (`disabled = true`) con restauración en `finally` en `paidButton`, `statusButton`, `submitOrderButton`, botones de submit de modales y `clearDayButton`.
  - Envoltura en bloques `try/catch` con `alert()` informativo al operador para errores de validación y fallos de persistencia.
- **Prueba que lo valida:**
  - Validación del DOM y simulación de clics consecutivos en manejadores con estado `disabled`.

#### Cambio 4 (P2-1): Auto-drenado de la cola de sincronización al reconectar (`online` event)
- **Líneas aprox:** `app.js:2835-2845`
- **Causa raíz atacada:** Cuando se recuperaba el acceso a internet tras una desconexión, la cola quedaba en estado `pending` hasta que el usuario realizara otra acción manual.
- **Modificación:**
  - Se agregó `window.addEventListener("online", () => { if (engine && typeof engine.drain === "function") engine.drain().catch(() => {}); });` al final de `initializeApp`.
- **Prueba que lo valida:**
  - Disparo de evento sintético `online` verificado contra el método `engine.drain()`.

---

### 2.2. Archivos: `index.html` y `sw.js`

#### Cambio 5 (P2-2): Versionado uniforme de scripts en PWA y HTML Shell
- **Archivos:** `index.html:508-509` y `sw.js:12-13`
- **Causa raíz atacada:** `sync-v2.js` y `supply-learning-v2.js` no contaban con versión en query string a diferencia de `app.js?v=33`, arriesgando servir versiones desactualizadas desde la caché estática del Service Worker.
- **Modificación:**
  - En `index.html`: Se actualizó la carga a `sync-v2.js?v=33` y `supply-learning-v2.js?v=33`.
  - En `sw.js`: Se actualizó `APP_SHELL` a `./sync-v2.js?v=33` y `./supply-learning-v2.js?v=33`.
- **Prueba que lo valida:**
  - Verificación de consistencia exacta de URLs entre la plantilla de `index.html` y el array `APP_SHELL` del Service Worker.

---

## 3. VERIFICACIÓN DE SINTAXIS Y CALIDAD
- `node -c app.js`: **EXITOSO (0 errores)**
- `node -c sync-v2.js`: **EXITOSO (0 errores)**
- `node -c sw.js`: **EXITOSO (0 errores)**
- `node -c supply-learning-v2.js`: **EXITOSO (0 errores)**

---
**Fin de CAMBIOS_APLICADOS.md**
