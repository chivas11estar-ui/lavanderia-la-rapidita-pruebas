# P0_PURCHASE_GAS_FORENSICS — COMPRAS Y GAS DUPLICADOS
**Agente 3: Especialista en Compras + Gas**  
**Fecha:** 2026-09-10  
**Repositorio:** Lavandería La Rapidita  

---

## 1. MISIÓN Y ALCANCE
Investigar la causa raíz por la cual compras de gas e insumos (jabón, suavizante, bolsas, etc.) aparecen multiplicadas (2 o hasta 3 veces) en la aplicación, diferenciando estrictamente la duplicación real de datos de la representación legítima (gasto financiero + movimiento de inventario).

---

## 2. MAPEO DE LOS DOS FLUJOS REALES EXISTENTES

### FLUJO A: Formulario de Insumos (`supplyForm`)
```text
Usuario en pestaña Insumos (suppliesView)
↓
Selecciona Insumo (ej. Gas) + Tipo "Compra" + Cantidad (ej. 30 kg) + Costo (ej. $500)
↓
Click en "Guardar movimiento" (elements.supplySubmitButton)
↓
app.js:546: mutate((next) => { ... })
↓
1) next.supplyMovements.unshift({ id: movementId, supplyId: "gas", type: "purchase", quantity: 30, cost: 500, note: "Compra registrada desde inventario" })
2) supply.quantity = (supply.quantity || 0) + 30
3) if (cost > 0) {
     const expenseId = createId();
     next.expenses.unshift({
       id: expenseId,
       name: "Compra de Gas",
       concept: "Compra de Gas",
       amount: 500,
       category: "gas",
       supplyId: "gas",
       purchasedQuantity: 30,
       ...
     });
     next.supplyMovements[0].expenseId = expenseId;
   }
↓
syncState(state) → Encola: 1 create expense + 1 create supplyMovement + 1 update supply
```

### FLUJO B: Formulario de Gastos (`expenseForm`)
```text
Usuario en pestaña Gastos (expensesView)
↓
Click en botón de categoría "Recarga de gas" (data-expense-category="gas")
↓
Captura: Concepto ("Recarga de gas") + Monto ($500) + Cantidad (30 kg)
↓
Click en "Guardar salida" (elements.expenseSubmitButton)
↓
app.js:514: mutate((next) => { ... })
↓
1) const expense = buildExpenseFromForm() → { id: expenseId, category: "gas", supplyId: "gas", amount: 500, purchasedQuantity: 30, ... }
2) next.expenses.unshift(expense);
3) applyInventoryFromExpense(next, expense):
   - supply.quantity = (supply.quantity || 0) + 30
   - next.supplyMovements.unshift({
       id: createId(),
       expenseId: expense.id,
       supplyId: "gas",
       type: "purchase",
       quantity: 30,
       cost: 500,
       note: "Compra registrada desde gastos: Recarga de gas"
     });
↓
syncState(state) → Encola: 1 create expense + 1 create supplyMovement + 1 update supply
```

---

## 3. RESPUESTA A LA PREGUNTA CRÍTICA

### ¿Qué representa la multiplicación observada por el usuario?
**Veredicto:** Combinación de **E + B + C**:
1. **Representación Legítima (No es bug):**  
   Una sola compra completa consta legítimamente de:
   - `1 expense` (en `state.expenses` para el flujo de caja / libro contable de salidas).
   - `1 supplyMovement` (en `state.supplyMovements` para el historial de compras y cálculo de ciclos en `supply-learning-v2.js`).
   - `+30 kg` en `state.supplies` (en el stock actual del tanque/inventario).
2. **Duplicación Real por Doble Entrada de UI (Causa Primaria de "2 compras"):**  
   Al existir dos formularios independientes en dos pestañas distintas ("Gastos" e "Insumos"), el operador registra el dinero en "Gastos" (crea 1 expense + 1 movement + suma +30kg) y luego va a "Insumos", ve el formulario de "Registrar compra" y vuelve a ingresar la misma compra creyendo que debe registrar la llegada física (crea un 2do expense + un 2do movement + suma otros +30kg).
   Resultado: En Gastos aparecen 2 salidas ($1,000 en vez de $500), en Insumos aparecen 60 kg en vez de 30 kg, y en Aprendizaje aparecen "2 compras".
3. **Triplicación Real por Doble Clic / Desconexión Previa (Causa de la 3ra compra):**  
   En dispositivos móviles de baja respuesta o con conexión inestable, antes de la introducción de `mutationQueue` y el `disabled` de botones, un doble toque en "Guardar salida" o el re-envío de formulario tras ver pantalla sin respuesta generaba un 3er `createId()`, produciendo 3 gastos reales en Firestore y +90 kg en inventario.

---

## 4. IMPACTO EN EL MÓDULO DE APRENDIZAJE (`supply-learning-v2.js`)

En `supply-learning-v2.js:13-26`:
```javascript
const purchases = (state?.supplyMovements || [])
  .filter((movement) => movement.supplyId === supplyId && movement.type === "purchase" && movement.quantity > 0)
  .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
```
Cada `supplyMovement` de compra cierra el ciclo anterior y abre un nuevo ciclo de cálculo de rendimiento.
- Si una sola compra de gas de 30 kg se registra 3 veces:
  - Se generan 3 compras con timestamps idénticos o separados por segundos.
  - El ciclo intermedio entre la compra 1 y la compra 2 tiene `ordersCount = 0` y `kg = 0`.
  - `usagePerKg` y `learnedCostPerKg` se distorsionan, afectando el cálculo de rentabilidad de los pedidos (`calculateOrderProfitability`).
  - El stock de gas muestra 90 kg en un tanque de 30 kg.

---

## 5. RECOMENDACIÓN DE ARQUITECTURA DE DATOS

1. **Idempotencia / Desduplicación en la captura:**  
   Ambos formularios deben verificar si existe una compra idéntica registrada recientemente (mismo `supplyId`, mismo monto, misma fecha en una ventana de pocos minutos) para prevenir dobles registros accidentales entre "Gastos" e "Insumos".
2. **Claridad de Interfaz:**  
   Indicar en `supplyForm` que si el gasto ya fue capturado en la pestaña "Gastos", no debe volver a registrarse como compra en "Insumos".
3. **Conservación:**  
   NO eliminar compras pasadas de forma destructiva masiva; proteger la relación 1 compra = 1 expense + 1 movement.

---
**Fin de P0_PURCHASE_GAS_FORENSICS.md**
