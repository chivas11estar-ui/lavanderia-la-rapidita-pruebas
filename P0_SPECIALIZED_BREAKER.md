# P0_SPECIALIZED_BREAKER — PRUEBAS ADVERSARIALES
**Agente 5: Breaker Especializado**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. MISIÓN
Intentar romper activamente la lógica del sistema bajo los 7 escenarios específicos exigidos en la misión, documentando el resultado real con la línea de código exacta que produce el fallo o la resistencia.

---

## 2. RESULTADOS DE LOS 7 TESTS ADVERSARIALES

### TEST 1: Ciclo completo de pedido con día cerrado intermedio
```text
Recibido → Lavando → Secando → Doblando → Listo → Entregado
```
- **Condición Adversarial:** El pedido fue recibido y lavado en fecha `T0`. En `T0` se hizo cierre de día (`closings`). En fecha `T1` el operador presiona "Entregado". Luego se recarga la página o se reconecta.
- **Resultado Código Actual:** **ROMPE.**
- **Evidencia:** `sync-v2.js:540-551`. Al intentar sincronizar `status: "entregado"`, `applyOperation` detecta que la fecha original del pedido (`remote.createdAt`) corresponde a un día cerrado. Lanza conflicto `closedDay`. La actualización se descarta y nunca llega a Firestore. Al recargar (`sync-v2.js:360`), se carga el documento no actualizado de Firestore.
- **Veredicto:** El pedido vuelve a aparecer como pendiente / recibido.

---

### TEST 2: Ingesta de pedidos con variantes de texto legadas
```text
"Entregado", "ENTREGADO", "entregado ", "entregada", "Entregada"
```
- **Condición Adversarial:** Un pedido existente en base de datos tiene `status` con mayúscula inicial, todo mayúsculas o espacios.
- **Resultado Código Actual:** **ROMPE.**
- **Evidencia:** `app.js:2731-2748` y `app.js:1260-1279`.
  - `normalizeStatus("Entregado")` devuelve `"Entregado"` (sin cambios).
  - `isActiveOrder()` evalúa `!["listo", "entregado"].includes("Entregado")` → devuelve `true`.
  - En `renderOrderCard()`, `isDone = status === "entregado"` es `false`.
- **Veredicto:** El pedido entregado se muestra con botones de proceso como si estuviera pendiente y suma al contador de pedidos activos.

---

### TEST 3: Gas — Registro de UNA sola compra (30 kg, $500)
- **Condición:** Capturar una compra en `expenseForm` y verificar la integridad en todos los módulos.
- **Resultado Código Actual:** **FUNCIONA SI NO SE USA EL OTRO FORMULARIO.**
- **Evidencia:** `app.js:514` añade `1 expense` y `app.js:1396` añade `1 supplyMovement` vinculado con `expenseId`.
  - En `state.expenses`: 1 elemento de $500.
  - En `state.supplyMovements`: 1 elemento de 30 kg.
  - En `state.supplies/gas`: cantidad suma +30 kg.
  - En `supply-learning-v2.js`: se registra 1 compra para el ciclo actual.

---

### TEST 4: Gas — Registrar y recargar inmediatamente
- **Condición:** Capturar compra de gas y refrescar el navegador a los 100ms.
- **Resultado Código Actual:** **PREVIENE (Seguro).**
- **Evidencia:** `app.js:1058` (`mutationQueue`) y `sync-v2.js:457` (`queue.enqueue`). La operación se persiste primero en IndexedDB antes de enviarse a la red. Al recargar, `engine.initialize` drena la cola pendiente de forma idempotente con `operationId`.

---

### TEST 5: Gas — Registrar en modo offline y reconectar
- **Condición:** Desconectar red, registrar compra de gas, reconectar red.
- **Resultado Código Actual:** **PREVIENE (Gracias al fix online del Ciclo 1).**
- **Evidencia:** `app.js:2839` escucha `window.addEventListener("online")` y ejecuta `engine.drain()`. La compra encolada en IndexedDB se envía automáticamente sin duplicarse.

---

### TEST 6: Gas — Doble clic rápido en botón de guardado
- **Condición:** Presionar dos veces en menos de 200ms el botón de guardar compra.
- **Resultado Código Actual:** **PREVIENE (Gracias a disabled y mutationQueue).**
- **Evidencia:** `elements.expenseSubmitButton.disabled = true` en `app.js:511` bloquea el segundo clic de inmediato en el DOM, y `mutationQueue` serializa el procesamiento en memoria.

---

### TEST 7: Gas — Registrar en `supplyForm` y luego en `expenseForm`
- **Condición:** Un operador registra la compra en `supplyForm` (Insumos) y luego él mismo u otro operador la registra en `expenseForm` (Gastos).
- **Resultado Código Actual:** **ROMPE (Duplicación garantizada).**
- **Evidencia:** `app.js:589` crea un gasto automático cuando se guarda desde `supplyForm`, y `app.js:516` crea un movimiento automático cuando se guarda desde `expenseForm`. No existe guarda de desduplicación temporal entre ambos formularios.
- **Veredicto:** Se generan 2 gastos de $500 ($1,000 total) y 2 movimientos de 30 kg (60 kg en tanque).

---
**Fin de P0_SPECIALIZED_BREAKER.md**
