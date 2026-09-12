# P0_ORDER_STATE_FORENSICS — CONSISTENCIA DE PEDIDOS
**Agente 2: Especialista en Consistencia de Pedidos**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. MISIÓN Y ALCANCE

Investigar por qué pedidos entregados en la realidad o marcados como entregados aparecen como pendientes, activos o recibidos en la interfaz de usuario (panel diario, métricas de pedidos activos, filtros y tarjetas de pedidos).

---

## 2. MATRIZ DE ESTADOS OBLIGATORIA (CÓDIGO ACTUAL)

Se ejecutó la prueba formal sobre la lógica real de `normalizeStatus()`, `isActiveOrder()`, `isCompletedOrder()` y `isVisibleInOrdersList()`:

| Estado almacenado | Normalizado (`normalizeStatus`) | Activo (`isActiveOrder`) | Completado (`isCompletedOrder`) | Visible en Lista (`isVisibleInOrdersList` hoy) | Veredicto Forense |
|---|---|---|---|---|---|
| `pendiente` | `recibido` | `true` | `false` | `true` | Correcto (legacy recibido) |
| `recibido` | `recibido` | `true` | `false` | `true` | Correcto (flujo inicial) |
| `lavada` | `lavando` | `true` | `false` | `true` | Correcto (legacy femenino) |
| `lavando` | `lavando` | `true` | `false` | `true` | Correcto |
| `secada` | `secando` | `true` | `false` | `true` | Correcto (legacy femenino) |
| `secando` | `secando` | `true` | `false` | `true` | Correcto |
| `doblada` | `doblando` | `true` | `false` | `true` | Correcto (legacy femenino) |
| `doblando` | `doblando` | `true` | `false` | `true` | Correcto |
| `lista` | `listo` | `false` | `true` | `true` | Correcto (legacy femenino) |
| `listo` | `listo` | `false` | `true` | `true` | Correcto |
| `entregado` | `entregado` | `false` | `true` | `isToday(deliveredAt)` | Correcto para minúscula exacta |
| `Entregado` | **`"Entregado"` (sin normalizar)** | **`true` (¡ACTIVO!)** | **`false` (¡NO COMPLETADO!)** | `true` | **FALLA CRÍTICA (Case Sensitive)** |
| `ENTREGADO` | **`"ENTREGADO"` (sin normalizar)** | **`true` (¡ACTIVO!)** | **`false` (¡NO COMPLETADO!)** | `true` | **FALLA CRÍTICA (Mayúsculas)** |
| `entregado ` | **`"entregado "` (sin normalizar)** | **`true` (¡ACTIVO!)** | **`false` (¡NO COMPLETADO!)** | `true` | **FALLA CRÍTICA (Espacios)** |
| ` entregado` | **`" entregado"` (sin normalizar)** | **`true` (¡ACTIVO!)** | **`false` (¡NO COMPLETADO!)** | `true` | **FALLA CRÍTICA (Espacios)** |
| `entregada` | **`"entregada"` (sin normalizar)** | **`true` (¡ACTIVO!)** | **`false` (¡NO COMPLETADO!)** | `true` | **FALLA CRÍTICA (Femenino omitido)** |
| `Entregada` | **`"Entregada"` (sin normalizar)** | **`true` (¡ACTIVO!)** | **`false` (¡NO COMPLETADO!)** | `true` | **FALLA CRÍTICA (Femenino Capital)** |
| `null` | `recibido` | `true` | `false` | `true` | Ocurre si pedido pierde estatus |
| `undefined` | `recibido` | `true` | `false` | `true` | Ocurre si campo status no existe |

---

## 3. HALLAZGOS FORENSES DETALLADOS

### HALLAZGO ORD-01: `normalizeStatus()` no realiza limpieza de mayúsculas, espacios ni variante femenina "entregada"
```
ID: ORD-01
ARCHIVO: app.js
FUNCIÓN: normalizeStatus(status) / normalizeOrder(order, services)
LÍNEA: app.js:2731-2740 y app.js:1260-1279
DATOS DE ENTRADA: status = "Entregado", "ENTREGADO", "entregado ", "entregada", "Entregada"
RESULTADO ACTUAL: Retorna el string sin normalizar (ej. "Entregado", "entregada").
RESULTADO ESPERADO: Debe retornar siempre "entregado".
REPRODUCCIÓN:
1. Ejecutar isActiveOrder({ status: "Entregado" }).
2. Evalúa !["listo", "entregado"].includes("Entregado"), lo cual resulta en true.
3. El pedido se lista en el panel de órdenes activas y muestra botones de flujo en vez del chip de entregado.
CAUSA:
En app.js:2731:
function normalizeStatus(status) {
  const map = {
    pendiente: "recibido",
    lavada: "lavando",
    secada: "secando",
    doblada: "doblando",
    lista: "listo",
  };
  return map[status] || status || "recibido";
}
No aplica .trim().toLowerCase(), y a diferencia de lavada/secada/doblada/lista, omitió el mapeo de "entregada".
CONFIANZA: CONFIRMED
```

---

### HALLAZGO ORD-02: Rechazo en segundo plano por conflicto `closedDay` en `sync-v2.js` al entregar pedidos de días anteriores
```
ID: ORD-02
ARCHIVO: sync-v2.js
FUNCIÓN: applyOperation(operation)
LÍNEA: sync-v2.js:540-551
DATOS DE ENTRADA: 
- Pedido creado el lunes (ej. 2026-09-08), el cual fue cerrado en el corte de caja de ese día.
- El cliente recoge la ropa el miércoles (2026-09-10).
- El operador presiona el botón "Entregado".
RESULTADO ACTUAL:
1. Localmente cambia temporalmente a "entregado".
2. SyncEngine encola la operación update hacia Firestore.
3. applyOperation() evalúa:
   dateValue = operation.changes?.createdAt || ... || remote?.createdAt;
   Como changes solo tiene status y deliveredAt, dateValue toma remote.createdAt (lunes).
4. Verifica si el lunes está en closings.
5. El lunes SÍ está cerrado.
6. Ejecuta:
   const conflict = await this.conflictManager.record(operation, remote, ["closedDay"]);
   return { status: "conflict", conflict, reason: "closed-day" };
7. La operación NUNCA se escribe en Firestore.
8. En el siguiente snapshot remoto de Firestore o recarga de la app, Firestore envía el documento intacto (status: "recibido").
9. El pedido entregado REVIERTE a recibido / pendiente.
RESULTADO ESPERADO:
La entrega física de un pedido (status: "entregado", deliveredAt) y el cobro posterior (paid, paidAt) son operaciones legítimas de ciclo de vida que ocurren días después de la recepción y NO alteran el balance contable del día cerrado de recepción. Deben ser permitidas y aplicadas a Firestore.
REPRODUCCIÓN:
Verificada en script de simulación Node.js ejecutando la condición de sync-v2.js:540-551 con un pedido de fecha anterior a un cierre existente.
CAUSA:
La guarda de seguridad contra ediciones de días cerrados bloquea indiscriminadamente cualquier operación sobre pedidos cuya fecha original de creación corresponda a un día cerrado, sin distinguir que un cambio de estatus a entregado es una actualización operativa posterior válida.
CONFIANZA: CONFIRMED
```

---

### HALLAZGO ORD-03: Pedidos con `deliveredAt` válido pero con `status` desincronizado
```
ID: ORD-03
ARCHIVO: app.js
FUNCIÓN: normalizeOrder(order, services)
LÍNEA: app.js:1260-1280
DATOS DE ENTRADA: Pedido en base de datos con deliveredAt = "2026-09-08T15:00:00.000Z", pero con status = "recibido", null o vacío por desincronización previa.
RESULTADO ACTUAL: normalizeOrder asigna status: "recibido", ignorando que el pedido ya cuenta con timestamp de entrega.
RESULTADO ESPERADO: Si un pedido tiene una marca de tiempo de entrega válida (`deliveredAt`), su estado normalizado debe ser indefectiblemente `"entregado"`.
REPRODUCCIÓN: Crear objeto pedido con `{ status: "recibido", deliveredAt: "2026-09-08T15:00:00.000Z" }` y pasarlo por `normalizeOrder`. Queda como activo.
CAUSA: Falta de inferencia de consistencia basada en `deliveredAt`.
CONFIANZA: CONFIRMED
```

---

### HALLAZGO ORD-04: Confusión entre pedidos entregados sin pagar y pedidos pendientes
```
ID: ORD-04
ARCHIVO: app.js
FUNCIÓN: isVisibleInOrdersList(order) / renderOrders()
LÍNEA: app.js:2391-2406 y app.js:1928-1933
DATOS DE ENTRADA: Pedido entregado hace días cuyo pago quedó pendiente (`order.paid = false`).
RESULTADO ACTUAL:
En app.js:2393: `if (!order.paid) return true;` hace que el pedido permanezca visible.
Bajo el filtro predeterminado `currentFilter === "todos"` (index.html:338), el pedido se renderiza en la lista general de pedidos.
Si además sufrió el bug ORD-01 u ORD-02, sus botones de estatus se renderizan activos mostrando "Recibido", induciendo al operador a creer que la ropa no se ha entregado.
RESULTADO ESPERADO:
El estado debe indicar claramente "Pedido entregado", permitiendo únicamente "Registrar pago" sin confundir el avance físico de la prenda.
CAUSA: Coexistencia de la regla de visibilidad de deuda con fallos de normalización de estado.
CONFIANZA: CONFIRMED
```

---
**Fin de P0_ORDER_STATE_FORENSICS.md**
