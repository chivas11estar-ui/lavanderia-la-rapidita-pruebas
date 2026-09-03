const STORAGE_KEY = "lavanderia-control-v2";
const LEGACY_KEY = "lavanderia-control-v1";
const DB_NAME = "la-rapidita-lavanderia";
const DB_VERSION = 1;
const DB_STORE = "app-data";
const DB_STATE_KEY = "state";
const CLOUD_DOCUMENT = "lavanderias/la-rapidita";
const AUTHORIZED_EMAILS = ["chivas11estar@gmail.com", "karlyanbm@gmail.com"];
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDeVOr_Vvvh8nqYkRg7Zf5_1mN-hmPHh0o",
  authDomain: "inventario-70adf.firebaseapp.com",
  databaseURL: "https://inventario-70adf-default-rtdb.firebaseio.com",
  projectId: "inventario-70adf",
  storageBucket: "inventario-70adf.firebasestorage.app",
  messagingSenderId: "829510239780",
  appId: "1:829510239780:web:2ceb429db22895ef3cbab1",
};

// Inicializar Firebase
firebase.initializeApp(FIREBASE_CONFIG);
const cloudDatabase = firebase.firestore();

const STATUS_FLOW = ["recibido", "lavando", "secando", "doblando", "listo", "entregado"];
const STATUS_LABELS = {
  recibido: "Recibido",
  pendiente: "Recibido",
  lavada: "Lavando",
  lavando: "Lavando",
  secada: "Secando",
  secando: "Secando",
  doblada: "Doblando",
  doblando: "Doblando",
  lista: "Listo",
  listo: "Listo",
  entregado: "Entregado",
};

const DEFAULT_SERVICES = [
  { id: "lavado-secado", name: "Lavado y Secado", price: 22, unit: "kg", description: "Servicio regular de lavado", active: true },
  { id: "express-wash", name: "Express Wash", price: 25, unit: "kg", description: "Servicio express para el mismo dia", active: true },
  { id: "secado", name: "Secado", price: 15, unit: "kg", description: "Solo secado de prendas", active: true },
  { id: "cobertor", name: "Cobertor", price: 70, unit: "pieza", description: "Cobertor o edredon matrimonial", active: true },
  { id: "cobertor-queen", name: "Cobertor 2", price: 90, unit: "pieza", description: "Cobertor o edredon queen size", active: true },
];

const COMMON_EXPENSES = [
  "Detergente",
  "Suavizante",
  "Gas",
  "Luz",
  "Renta",
  "Agua",
  "Bolsas",
  "Limpieza",
  "Sueldos",
  "Mantenimiento",
  "Publicidad",
  "Papelería",
];

const DEFAULT_SUPPLIES = [
  { id: "gas", name: "Gas", unit: "kg", purchaseUnit: "kg", quantity: 0, minimum: 5, averageCost: 0, purchaseUnitPrice: 0, piecesPerPurchaseUnit: 0, kind: "gas", tankSize: 30, usageBasis: "kg", usagePerKg: 0, usagePerOrder: 0 },
  { id: "jabon", name: "Jabon", unit: "litros", purchaseUnit: "litro", quantity: 0, minimum: 2, averageCost: 0, purchaseUnitPrice: 0, piecesPerPurchaseUnit: 0, kind: "supply", usageBasis: "order", usagePerKg: 0.04, usagePerOrder: 0 },
  { id: "suavizante", name: "Suavizante", unit: "litros", purchaseUnit: "litro", quantity: 0, minimum: 2, averageCost: 0, purchaseUnitPrice: 0, piecesPerPurchaseUnit: 0, kind: "supply", usageBasis: "order", usagePerKg: 0.025, usagePerOrder: 0 },
  { id: "bolsas", name: "Bolsas", unit: "kg", purchaseUnit: "kg", quantity: 0, minimum: 0.25, averageCost: 0, purchaseUnitPrice: 80, piecesPerPurchaseUnit: 0, kind: "supply", usageBasis: "order", usagePerKg: 0, usagePerOrder: 0 },
  { id: "etiquetas", name: "Cinta / etiquetas", unit: "rollos", purchaseUnit: "rollo", quantity: 0, minimum: 1, averageCost: 0, purchaseUnitPrice: 0, piecesPerPurchaseUnit: 0, kind: "supply", usageBasis: "order", usagePerKg: 0, usagePerOrder: 0.02 },
];

const EXPENSE_CATEGORIES = {
  insumo: { label: "Compra de insumo", shortLabel: "Insumo", icon: "package-check" },
  gas: { label: "Recarga de gas", shortLabel: "Gas", icon: "flame" },
  luz: { label: "Recibo de luz", shortLabel: "Luz", icon: "zap" },
  operativo: { label: "Gasto operativo", shortLabel: "Operativo", icon: "receipt-text" },
  retiro_personal: { label: "Retiro personal", shortLabel: "Retiro", icon: "hand-coins" },
  inversion_deuda: { label: "Inversion o deuda", shortLabel: "Inversion/deuda", icon: "landmark" },
};

const PAYMENT_METHODS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

const CATEGORY_DEFAULT_CONCEPTS = {
  insumo: "Compra de insumo",
  gas: "Recarga de gas",
  luz: "Recibo de luz",
  operativo: "Gasto operativo",
  retiro_personal: "Retiro personal",
  inversion_deuda: "Inversion o deuda",
};

const moneyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

const dateFormatter = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "full",
});

const EMPTY_STATE = { services: [], customers: [], orders: [], expenses: [], supplies: [], supplyMovements: [], closings: [] };

let state = normalizeState(null);
let cloudUser = null;
let engine = null;
let localStore = null;
let currentFilter = "todos";
let searchTerm = "";
let deferredInstallPrompt = null;
let appendToOrderId = null;
let weatherController = null;
let currentExpenseCategory = "insumo";
let syncState = "synced";

const WEATHER_CACHE_KEY = "la-rapidita-weather-v1";
const WEATHER_DEFAULT_LOCATION = { latitude: 19.4326, longitude: -99.1332, label: "clima de referencia" };
const WEATHER_CODE_MAP = {
  0: { label: "Cielo despejado", type: "clear", phrase: "Perfecto para recibir ropa con energia." },
  1: { label: "Mayormente despejado", type: "clear", phrase: "El dia pinta ligero para La Rapidita." },
  2: { label: "Parcialmente nublado", type: "cloudy", phrase: "Nubes suaves, buen ritmo de trabajo." },
  3: { label: "Nublado", type: "cloudy", phrase: "Dia de nubes, ideal para tener todo bajo control." },
  45: { label: "Neblina", type: "cloudy", phrase: "Ambiente tranquilo; paso firme y ropa impecable." },
  48: { label: "Neblina helada", type: "cloudy", phrase: "Cielo pesado, pero el trabajo sale limpio." },
  51: { label: "Llovizna ligera", type: "rainy", phrase: "Cae poquito; adentro la lavanderia sigue brillando." },
  53: { label: "Llovizna", type: "rainy", phrase: "Dia humedo: buen momento para organizar pedidos." },
  55: { label: "Llovizna fuerte", type: "rainy", phrase: "Afuera llueve, aqui se trabaja bonito." },
  61: { label: "Lluvia ligera", type: "rainy", phrase: "Lluvia suave y lavadoras en movimiento." },
  63: { label: "Lluvia", type: "rainy", phrase: "Que la lluvia no pare el buen servicio." },
  65: { label: "Lluvia fuerte", type: "rainy", phrase: "Dia de lluvia intensa: cuidado con entregas y bolsas." },
  80: { label: "Chubascos ligeros", type: "rainy", phrase: "Chubascos afuera, orden adentro." },
  81: { label: "Chubascos", type: "rainy", phrase: "El cielo se mueve, La Rapidita tambien." },
  82: { label: "Chubascos fuertes", type: "rainy", phrase: "Mucha agua afuera; ropa segura adentro." },
  95: { label: "Tormenta", type: "stormy", phrase: "Tormenta afuera, calma y control en el negocio." },
  96: { label: "Tormenta con granizo", type: "stormy", phrase: "Cielo bravo: hoy conviene cuidar cada entrega." },
  99: { label: "Tormenta fuerte", type: "stormy", phrase: "Relampagos afuera, La Rapidita firme." },
};

const elements = {
  loginScreen: document.querySelector("#loginScreen"),
  loginGoogleButton: document.querySelector("#loginGoogleButton"),
  loginMessage: document.querySelector("#loginMessage"),
  orderForm: document.querySelector("#orderForm"),
  serviceForm: document.querySelector("#serviceForm"),
  expenseForm: document.querySelector("#expenseForm"),
  customerSelect: document.querySelector("#customerSelect"),
  customerName: document.querySelector("#customerName"),
  customerPhone: document.querySelector("#customerPhone"),
  newCustomerContainer: document.querySelector("#newCustomerContainer"),
  serviceSelect: document.querySelector("#serviceSelect"),
  weightKg: document.querySelector("#weightKg"),
  pricePerKg: document.querySelector("#pricePerKg"),
  notes: document.querySelector("#notes"),
  subtotalPreview: document.querySelector("#subtotalPreview"),
  totalPreview: document.querySelector("#totalPreview"),
  salesToday: document.querySelector("#salesToday"),
  expensesToday: document.querySelector("#expensesToday"),
  profitToday: document.querySelector("#profitToday"),
  todayOrders: document.querySelector("#todayOrders"),
  activeOrders: document.querySelector("#activeOrders"),
  motivationalPhrase: document.querySelector("#motivationalPhrase"),
  dashboardOrders: document.querySelector("#dashboardOrders"),
  dashboardServices: document.querySelector("#dashboardServices"),
  dashboardGas: document.querySelector("#dashboardGas"),
  ordersList: document.querySelector("#ordersList"),
  clientsList: document.querySelector("#clientsList"),
  servicesList: document.querySelector("#servicesList"),
  suppliesList: document.querySelector("#suppliesList"),
  supplyForm: document.querySelector("#supplyForm"),
  supplySelect: document.querySelector("#supplySelect"),
  supplyMovementType: document.querySelector("#supplyMovementType"),
  supplyQuantity: document.querySelector("#supplyQuantity"),
  supplyCost: document.querySelector("#supplyCost"),
  supplyUnitPrice: document.querySelector("#supplyUnitPrice"),
  supplyQuantityLabel: document.querySelector("#supplyQuantityLabel"),
  supplyPurchaseCostFields: document.querySelector("#supplyPurchaseCostFields"),
  supplyConversionField: document.querySelector("#supplyConversionField"),
  supplyPiecesPerUnit: document.querySelector("#supplyPiecesPerUnit"),
  supplyFormHelp: document.querySelector("#supplyFormHelp"),
  supplySubmitButton: document.querySelector("#supplySubmitButton"),
  gasInsight: document.querySelector("#gasInsight"),
  reportSales: document.querySelector("#reportSales"),
  reportExpenses: document.querySelector("#reportExpenses"),
  reportProfit: document.querySelector("#reportProfit"),
  reportPending: document.querySelector("#reportPending"),
  weeklyBalance: document.querySelector("#weeklyBalance"),
  monthlyBalance: document.querySelector("#monthlyBalance"),
  yearlyBalance: document.querySelector("#yearlyBalance"),
  weeklyChart: document.querySelector("#weeklyChart"),
  expenseBreakdown: document.querySelector("#expenseBreakdown"),
  recentTransactions: document.querySelector("#recentTransactions"),
  orderReportList: document.querySelector("#orderReportList"),
  serviceReportList: document.querySelector("#serviceReportList"),
  closingsList: document.querySelector("#closingsList"),
  serviceName: document.querySelector("#serviceName"),
  servicePrice: document.querySelector("#servicePrice"),
  serviceUnit: document.querySelector("#serviceUnit"),
  serviceDescription: document.querySelector("#serviceDescription"),
  expenseCategoryButtons: document.querySelectorAll("[data-expense-category]"),
  expenseSelectedType: document.querySelector("#expenseSelectedType"),
  expenseFormHint: document.querySelector("#expenseFormHint"),
  expenseConcept: document.querySelector("#expenseConcept"),
  expensePaymentMethod: document.querySelector("#expensePaymentMethod"),
  expenseDate: document.querySelector("#expenseDate"),
  expenseNotes: document.querySelector("#expenseNotes"),
  expenseSupplyFields: document.querySelector("#expenseSupplyFields"),
  expenseSupplySelect: document.querySelector("#expenseSupplySelect"),
  expensePurchasedQuantity: document.querySelector("#expensePurchasedQuantity"),
  expensePurchasedUnit: document.querySelector("#expensePurchasedUnit"),
  expenseUnitPricePreview: document.querySelector("#expenseUnitPricePreview"),
  expenseGasFields: document.querySelector("#expenseGasFields"),
  expenseGasQuantity: document.querySelector("#expenseGasQuantity"),
  expenseGasTankSize: document.querySelector("#expenseGasTankSize"),
  expenseGasUnitPricePreview: document.querySelector("#expenseGasUnitPricePreview"),
  expenseLightFields: document.querySelector("#expenseLightFields"),
  expenseLightStart: document.querySelector("#expenseLightStart"),
  expenseLightEnd: document.querySelector("#expenseLightEnd"),
  expenseBusinessPercent: document.querySelector("#expenseBusinessPercent"),
  expensePersonalHint: document.querySelector("#expensePersonalHint"),
  expenseInvestmentFields: document.querySelector("#expenseInvestmentFields"),
  expenseInvestmentSubtype: document.querySelector("#expenseInvestmentSubtype"),
  expenseSubmitButton: document.querySelector("#expenseSubmitButton"),
  expenseName: document.querySelector("#expenseName"),
  expenseSelect: document.querySelector("#expenseSelect"),
  newExpenseContainer: document.querySelector("#newExpenseContainer"),
  expenseAmount: document.querySelector("#expenseAmount"),
  expenseList: document.querySelector("#expenseList"),
  currentDate: document.querySelector("#currentDate"),
  selectedServiceName: document.querySelector("#selectedServiceName"),
  selectedServiceUnit: document.querySelector("#selectedServiceUnit"),
  clearDayButton: document.querySelector("#clearDayButton"),
  closingStatus: document.querySelector("#closingStatus"),
  exportButton: document.querySelector("#exportButton"),
  exportReportsButton: document.querySelector("#exportReportsButton"),
  orderSearch: document.querySelector("#orderSearch"),
  newOrderButton: document.querySelector("#newOrderButton"),
  floatingActionLabel: document.querySelector("#floatingActionLabel"),
  installAppButton: document.querySelector("#installAppButton"),
  editOrderDialog: document.querySelector("#editOrderDialog"),
  editOrderForm: document.querySelector("#editOrderForm"),
  editOrderId: document.querySelector("#editOrderId"),
  editOrderItemId: document.querySelector("#editOrderItemId"),
  editOrderCustomer: document.querySelector("#editOrderCustomer"),
  editOrderQuantity: document.querySelector("#editOrderQuantity"),
  editOrderPrice: document.querySelector("#editOrderPrice"),
  editOrderSubtotal: document.querySelector("#editOrderSubtotal"),
  editOrderTotal: document.querySelector("#editOrderTotal"),
  cancelEditOrder: document.querySelector("#cancelEditOrder"),
  cancelEditOrderBottom: document.querySelector("#cancelEditOrderBottom"),
  editClientDialog: document.querySelector("#editClientDialog"),
  editClientForm: document.querySelector("#editClientForm"),
  editClientId: document.querySelector("#editClientId"),
  editClientName: document.querySelector("#editClientName"),
  editClientPhone: document.querySelector("#editClientPhone"),
  cancelEditClient: document.querySelector("#cancelEditClient"),
  cancelEditClientBottom: document.querySelector("#cancelEditClientBottom"),
  orderFormTitle: document.querySelector("#orderFormTitle"),
  orderFormMode: document.querySelector("#orderFormMode"),
  submitOrderButton: document.querySelector("#submitOrderButton"),
  weatherSkyCard: document.querySelector("#weatherSkyCard"),
  weatherTitle: document.querySelector("#weatherTitle"),
  weatherDescription: document.querySelector("#weatherDescription"),
  weatherTemperature: document.querySelector("#weatherTemperature"),
  weatherHumidity: document.querySelector("#weatherHumidity"),
  weatherWind: document.querySelector("#weatherWind"),
  weatherRefreshButton: document.querySelector("#weatherRefreshButton"),
  syncStatus: document.querySelector("#syncStatus"),
};

document.body.classList.add("cloud-locked");

elements.loginGoogleButton.addEventListener("click", async () => {
  elements.loginGoogleButton.disabled = true;
  elements.loginMessage.textContent = "Conectando...";

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await firebase.auth().signInWithPopup(provider);
  } catch (error) {
    console.error("No se pudo iniciar sesion.", error);
    elements.loginMessage.textContent = "No se pudo iniciar con Google. Intenta de nuevo.";
    elements.loginGoogleButton.disabled = false;
  }
});

elements.currentDate.textContent = dateFormatter.format(new Date());

elements.serviceSelect.addEventListener("change", () => {
  syncSelectedServicePrice();
  updatePreview();
});
elements.weightKg.addEventListener("input", updatePreview);
elements.pricePerKg.addEventListener("input", updatePreview);

elements.customerSelect.addEventListener("change", () => {
  const isNew = elements.customerSelect.value === "NEW_CUSTOMER";
  elements.newCustomerContainer.hidden = !isNew;
  if (isNew) {
    elements.customerName.required = true;
    elements.customerName.focus();
  } else {
    elements.customerName.required = false;
    elements.customerName.value = "";
    elements.customerPhone.value = "";
  }
});

elements.expenseSelect?.addEventListener("change", () => {
  const isNew = elements.expenseSelect.value === "NEW_EXPENSE";
  elements.newExpenseContainer.hidden = !isNew;
  if (isNew) {
    elements.expenseName.required = true;
    elements.expenseName.focus();
  } else {
    elements.expenseName.required = false;
    elements.expenseName.value = "";
  }
});

elements.expenseCategoryButtons?.forEach((button) => {
  button.addEventListener("click", () => setExpenseCategory(button.dataset.expenseCategory));
});
elements.expenseAmount?.addEventListener("input", updateExpenseUnitPreviews);
elements.expensePurchasedQuantity?.addEventListener("input", updateExpenseUnitPreviews);
elements.expenseGasQuantity?.addEventListener("input", updateExpenseUnitPreviews);
elements.expenseSupplySelect?.addEventListener("change", syncExpenseSupplyFields);

elements.orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const service = getSelectedService();
  const quantity = Number(elements.weightKg.value);
  const price = Number(elements.pricePerKg.value);
  const subtotal = quantity * price;
  const total = roundUpToPeso(subtotal);
  const item = {
    id: createId(), serviceId: service.id, serviceName: service.name, unit: service.unit,
    weightKg: quantity, pricePerKg: price, subtotal, total,
  };

  await mutate((next) => {
    if (appendToOrderId) {
      const order = next.orders.find((entry) => entry.id === appendToOrderId);
      if (order && normalizeStatus(order.status) !== "entregado") {
        order.items = [...getOrderItems(order), item];
        syncOrderTotalsFromItems(order);
        const extraNotes = elements.notes.value.trim();
        if (extraNotes) order.notes = [order.notes, extraNotes].filter(Boolean).join(" · ");
        order.paid = false;
        order.paidAt = null;
        order.updatedAt = new Date().toISOString();
      }
      return;
    }

    let typedCustomerName = "";
    if (elements.customerSelect.value === "NEW_CUSTOMER") {
      typedCustomerName = elements.customerName.value.trim().replace(/\s+/g, " ");
    } else {
      typedCustomerName = elements.customerSelect.value;
    }

    if (!typedCustomerName) {
      throw new Error("Por favor selecciona o escribe un cliente.");
    }

    let customer = next.customers.find((item) => normalizeCustomerKey(item.name) === normalizeCustomerKey(typedCustomerName));
    if (!customer) {
      customer = { id: createId(), name: typedCustomerName, phone: normalizePhone(elements.customerPhone.value), createdAt: new Date().toISOString() };
      next.customers.unshift(customer);
    }

    next.orders.unshift({
      id: createId(),
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone || "",
      serviceId: service.id,
      serviceName: service.name,
      unit: service.unit,
      weightKg: quantity,
      pricePerKg: price,
      subtotal,
      total,
      items: [item],
      status: "recibido",
      paid: false,
      notes: elements.notes.value.trim(),
      createdAt: new Date().toISOString(),
    });
  });

  finishOrderForm();
});

function finishOrderForm() {
  elements.orderForm.reset();
  elements.newCustomerContainer.hidden = true;
  elements.customerName.required = false;
  appendToOrderId = null;
  setOrderFormMode();
  renderServicesSelect();
  renderCustomerSelect();
  updatePreview();
  render();
  showView("ordersView");
}

elements.serviceForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  await mutate((next) => {
    next.services.unshift({
      id: createId(),
      name: elements.serviceName.value.trim(),
      price: Number(elements.servicePrice.value),
      unit: elements.serviceUnit.value,
      description: elements.serviceDescription.value.trim() || "Servicio de lavanderia",
      active: true,
    });
  });

  elements.serviceForm.reset();
});

elements.expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const expense = buildExpenseFromForm();
  if (!expense) return;

  elements.expenseSubmitButton.disabled = true;
  elements.expenseSubmitButton.textContent = "Guardando...";

  await mutate((next) => {
    next.expenses.unshift(expense);
    applyInventoryFromExpense(next, expense);
  });

  elements.expenseForm.reset();
  elements.newExpenseContainer.hidden = true;
  setExpenseCategory(currentExpenseCategory);
  renderCustomerSelect();
  renderExpenseSelect();
  elements.expenseSubmitButton.disabled = false;
  elements.expenseSubmitButton.innerHTML = '<i data-lucide="plus"></i>Guardar salida';
  renderIcons();
});

elements.supplyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  await mutate((next) => {
    const supply = next.supplies.find((item) => item.id === elements.supplySelect.value);
    const type = elements.supplyMovementType.value === "usage" ? "usage" : "purchase";
    const cost = Number(elements.supplyCost.value || 0);
    const typedQuantity = Number(elements.supplyQuantity.value || 0);
    const unitPrice = type === "purchase" && cost > 0 && typedQuantity > 0
      ? cost / typedQuantity
      : Number(elements.supplyUnitPrice.value || 0);
    const piecesPerUnit = Number(elements.supplyPiecesPerUnit.value || 0);
    const quantity = calculateSupplyMovementQuantity(supply, {
      rawQuantity: elements.supplyQuantity.value,
      cost,
      unitPrice,
      piecesPerUnit,
      type,
    });
    if (!supply || !Number.isFinite(quantity) || quantity <= 0) return;

    if (type === "purchase") {
      if (unitPrice > 0) supply.purchaseUnitPrice = unitPrice;
      if (piecesPerUnit > 0) supply.piecesPerPurchaseUnit = piecesPerUnit;
    }

    const movementId = createId();
    next.supplyMovements.unshift({
      id: movementId,
      supplyId: supply.id,
      type,
      quantity,
      cost: type === "purchase" ? cost : 0,
      unitPrice: type === "purchase" ? unitPrice : 0,
      piecesPerUnit: type === "purchase" ? piecesPerUnit : 0,
      createdAt: new Date().toISOString(),
      note: type === "purchase" ? "Compra registrada desde inventario" : "Uso registrado desde inventario",
    });

    if (type === "purchase") {
      const previousValue = Number(supply.quantity || 0) * Number(supply.averageCost || 0);
      const nextQuantity = Number(supply.quantity || 0) + quantity;
      supply.quantity = nextQuantity;
      if (cost > 0 && nextQuantity > 0) supply.averageCost = (previousValue + cost) / nextQuantity;
      if (cost > 0) {
        const expenseId = createId();
        next.expenses.unshift({
          id: expenseId,
          name: `Compra de ${supply.name}`,
          concept: `Compra de ${supply.name}`,
          amount: cost,
          category: supply.id === "gas" ? "gas" : "insumo",
          paymentMethod: "efectivo",
          supplyId: supply.id,
          purchasedQuantity: quantity,
          purchasedUnit: supply.unit,
          notes: "Registrado desde inventario",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        next.supplyMovements[0].expenseId = expenseId;
      }
    } else {
      supply.quantity = Math.max(0, Number(supply.quantity || 0) - quantity);
    }
  });

  elements.supplyForm.reset();
});

elements.supplySelect?.addEventListener("change", syncSupplyPurchaseFields);
elements.supplyMovementType?.addEventListener("change", syncSupplyPurchaseFields);
elements.supplyQuantity?.addEventListener("input", syncSupplyUnitPriceFromTotals);
elements.supplyCost?.addEventListener("input", syncSupplyUnitPriceFromTotals);

elements.suppliesList?.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-supply-action]");
  if (!actionButton) return;

  const supply = state.supplies.find((item) => item.id === actionButton.dataset.supplyId);
  if (!supply) return;

  elements.supplySelect.value = supply.id;
  elements.supplyMovementType.value = actionButton.dataset.supplyAction === "usage" ? "usage" : "purchase";
  syncSupplyPurchaseFields();
  elements.supplyForm.scrollIntoView({ behavior: "smooth", block: "center" });
  elements.supplyQuantity.focus({ preventScroll: true });
});

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    renderOrders();
  });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.view !== "newOrderView") resetOrderFormContext();
    showView(button.dataset.view);
  });
});

elements.orderSearch.addEventListener("input", () => {
  searchTerm = elements.orderSearch.value.trim().toLowerCase();
  renderOrders();
});

elements.newOrderButton.addEventListener("click", () => {
  const activeView = document.querySelector(".screen-section.active")?.id;
  if (activeView === "servicesView") {
    elements.serviceName.focus();
    elements.serviceForm.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (activeView === "expensesView") {
    elements.expenseName.focus();
    elements.expenseForm.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (activeView === "suppliesView") {
    elements.supplySelect.focus();
    elements.supplyForm.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  resetOrderFormContext();
  showView("newOrderView");
});

elements.ordersList.addEventListener("click", async (event) => {
  const statusButton = event.target.closest("[data-status]");
  const paidButton = event.target.closest("[data-paid]");
  const editButton = event.target.closest("[data-edit-order]");
  const deleteButton = event.target.closest("[data-delete-order]");
  const addServiceButton = event.target.closest("[data-add-service]");
  const whatsappButton = event.target.closest("[data-whatsapp-order]");

  if (whatsappButton) {
    const order = state.orders.find((item) => item.id === whatsappButton.dataset.whatsappOrder);
    if (!order) return;
    openWhatsAppForOrder(order);
    return;
  }

  if (addServiceButton) {
    const order = state.orders.find((item) => item.id === addServiceButton.dataset.addService);
    if (!order || normalizeStatus(order.status) === "entregado") return;
    appendToOrderId = order.id;
    elements.orderForm.reset();
    renderServicesSelect();
    renderCustomerSelect();
    elements.customerSelect.value = order.customerName;
    elements.customerSelect.disabled = true;
    elements.newCustomerContainer.hidden = true;
    elements.customerName.required = false;
    elements.customerName.value = "";
    elements.customerPhone.value = "";
    setOrderFormMode(order);
    updatePreview();
    showView("newOrderView");
    setTimeout(() => elements.serviceSelect.focus(), 80);
    return;
  }

  if (statusButton) {
    const orderId = statusButton.dataset.orderId;
    const nextStatus = statusButton.dataset.status;
    await mutate((next) => {
      const order = next.orders.find((item) => item.id === orderId);
      if (!order) return;
      if (normalizeStatus(order.status) === "entregado") return;
      order.status = nextStatus;
      order.updatedAt = new Date().toISOString();
      if (normalizeStatus(order.status) === "entregado") order.deliveredAt = order.updatedAt;
    });
    return;
  }

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

  if (editButton) {
    openOrderEditor(editButton.dataset.editOrder, editButton.dataset.editItem);
  }

  if (deleteButton) {
    const orderId = deleteButton.dataset.deleteOrder;
    await mutate((next) => {
      const order = next.orders.find((item) => item.id === orderId);
      if (!order) return;
      if (normalizeStatus(order.status) === "entregado") return;
      if (isRecordLocked(order.createdAt)) return;
      next.orders = next.orders.filter((item) => item.id !== orderId);
    });
  }
});

elements.clientsList.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-client]");
  if (editButton) {
    openClientEditor(editButton.dataset.editClient);
    return;
  }

  const newOrderButton = event.target.closest("[data-new-order-customer]");
  if (!newOrderButton) return;
  const customer = state.customers.find((item) => item.id === newOrderButton.dataset.newOrderCustomer);
  if (!customer) return;
  resetOrderFormContext();
  elements.orderForm.reset();
  renderServicesSelect();
  renderCustomerSelect();
  elements.customerSelect.value = customer.name;
  elements.newCustomerContainer.hidden = true;
  updatePreview();
  showView("newOrderView");
  setTimeout(() => elements.serviceSelect.focus(), 80);
});

elements.editOrderQuantity.addEventListener("input", updateEditOrderPreview);
elements.editOrderPrice.addEventListener("input", updateEditOrderPreview);
elements.cancelEditOrder.addEventListener("click", closeOrderEditor);
elements.cancelEditOrderBottom.addEventListener("click", closeOrderEditor);
elements.cancelEditClient.addEventListener("click", closeClientEditor);
elements.cancelEditClientBottom.addEventListener("click", closeClientEditor);

elements.editOrderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const orderId = elements.editOrderId.value;
  const itemId = elements.editOrderItemId.value;
  const quantity = Number(elements.editOrderQuantity.value);
  const price = Number(elements.editOrderPrice.value);

  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) return;

  await mutate((next) => {
    const order = next.orders.find((item) => item.id === orderId);
    if (!order) return;
    if (normalizeStatus(order.status) === "entregado") return;

    const items = getOrderItems(order);
    const item = items.find((entry) => entry.id === itemId) || items[0];
    if (!item) return;
    item.weightKg = quantity;
    item.pricePerKg = price;
    item.subtotal = quantity * price;
    item.total = roundUpToPeso(item.subtotal);
    syncOrderTotalsFromItems(order);
    order.updatedAt = new Date().toISOString();
  });

  closeOrderEditor();
});

elements.editClientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const clientId = elements.editClientId.value;
  const name = elements.editClientName.value.trim().replace(/\s+/g, " ");
  const phone = normalizePhone(elements.editClientPhone.value);
  if (!name) return;

  await mutate((next) => {
    const client = next.customers.find((item) => item.id === clientId);
    if (!client) return;

    const duplicate = next.customers.find((item) => item.id !== client.id && normalizeCustomerKey(item.name) === normalizeCustomerKey(name));
    if (duplicate) {
      throw new Error("Ya existe un cliente con ese nombre.");
    }

    client.name = name;
    client.phone = phone;
    client.updatedAt = new Date().toISOString();
    next.orders.forEach((order) => {
      if (order.customerId === client.id) {
        order.customerName = name;
        order.customerPhone = phone;
        order.updatedAt = client.updatedAt;
      }
    });
  });

  closeClientEditor();
});

elements.servicesList.addEventListener("click", async (event) => {
  const toggleButton = event.target.closest("[data-toggle-service]");
  const priceButton = event.target.closest("[data-service-price]");

  if (toggleButton) {
    const serviceId = toggleButton.dataset.toggleService;
    await mutate((next) => {
      const service = next.services.find((item) => item.id === serviceId);
      if (!service) return;
      service.active = !service.active;
    });
    return;
  }

  if (priceButton) {
    const serviceId = priceButton.dataset.servicePrice;
    const service = state.services.find((item) => item.id === serviceId);
    if (!service) return;
    const nextPrice = prompt(`Nuevo precio para ${service.name}`, service.price);
    if (nextPrice === null) return;
    const price = Number(nextPrice);
    if (!Number.isFinite(price) || price <= 0) return;

    await mutate((next) => {
      const service = next.services.find((item) => item.id === serviceId);
      if (!service) return;
      service.price = price;
    });
  }
});

elements.expenseList.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-expense]");
  if (!deleteButton) return;

  const expenseId = deleteButton.dataset.deleteExpense;
  const expense = state.expenses.find((item) => item.id === expenseId);
  if (!expense) return;
  if (isRecordLocked(expense.createdAt)) return;

  await mutate((next) => {
    const targetExpense = next.expenses.find((item) => item.id === expenseId);
    if (!targetExpense) return;
    reverseInventoryFromExpense(next, targetExpense);
    next.expenses = next.expenses.filter((item) => item.id !== expenseId);
  });
});

elements.clearDayButton.addEventListener("click", async () => {
  const todayOrders = state.orders.filter((order) => isToday(order.createdAt));
  const paidTodayOrders = state.orders.filter((order) => order.paid && isToday(order.paidAt || order.createdAt));
  const todayExpenses = state.expenses.filter((expense) => isToday(expense.createdAt));
  const sales = paidTodayOrders.reduce((sum, order) => sum + order.total, 0);
  const expenseTotals = calculateExpenseTotals(todayExpenses);
  const dateKeyStr = getLocalDateKey();

  await mutate((next) => {
    const closing = {
      id: dateKeyStr,
      dateKey: dateKeyStr,
      closedAt: new Date().toISOString(),
      ordersCount: todayOrders.length,
      sales,
      expenses: expenseTotals.cashOut,
      operatingExpenses: expenseTotals.operativo,
      supplyPurchases: expenseTotals.insumo,
      gasPurchases: expenseTotals.gas,
      lightExpenses: expenseTotals.luz,
      personalWithdrawals: expenseTotals.retiro_personal,
      investmentDebt: expenseTotals.inversion_deuda,
      cashFlow: sales - expenseTotals.cashOut,
      profit: sales - expenseTotals.operatingCost,
    };
    const existingIndex = next.closings.findIndex((item) => item.dateKey === dateKeyStr);

    if (existingIndex >= 0) {
      next.closings[existingIndex] = closing;
    } else {
      next.closings.unshift(closing);
    }
  });

  elements.closingStatus.textContent = "Cierre guardado y sincronizando.";
});

elements.exportButton.addEventListener("click", exportCsv);
elements.exportReportsButton.addEventListener("click", exportCsv);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.installAppButton.hidden = false;
});

elements.installAppButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  elements.installAppButton.hidden = true;
});

elements.weatherRefreshButton?.addEventListener("click", () => {
  updateLiveWeather({ forceLocation: true });
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  elements.installAppButton.hidden = true;
});

function createFallbackState() {
  return {
    services: DEFAULT_SERVICES.map((service) => ({ ...service })),
    settings: { pricePerKg: 22 },
    orders: [],
    customers: [],
    expenses: [],
    supplies: DEFAULT_SUPPLIES.map((supply) => ({ ...supply })),
    supplyMovements: [],
    closings: [],
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeState(saved) {
  const fallback = createFallbackState();
  if (!saved) return fallback;

  const services = normalizeServices(saved.services);
  const orders = (saved.orders || []).map((order) => normalizeOrder(order, services));
  const customers = normalizeCustomers(saved.customers, orders);
  const supplies = normalizeSupplies(saved.supplies);
  const supplyMovements = normalizeSupplyMovements(saved.supplyMovements, supplies);
  const expenses = normalizeExpenses(saved.expenses);
  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const customersByName = new Map(customers.map((customer) => [normalizeCustomerKey(customer.name), customer]));

  orders.forEach((order) => {
    const customer = customersById.get(order.customerId) || customersByName.get(normalizeCustomerKey(order.customerName));
    if (!customer) return;
    order.customerId = customer.id;
    order.customerName = customer.name;
    order.customerPhone = customer.phone || order.customerPhone || "";
  });

  return { ...fallback, ...saved, services, customers, orders, expenses, supplies, supplyMovements, closings: saved.closings || [] };
}

async function mutate(mutator) {
  if (!engine) return;
  const next = clone(state);
  await mutator(next);
  state = normalizeState(next);
  render();
  await engine.syncState(state);
}

function handleSyncEvent(event) {
  if (["operationSending"].includes(event.type)) {
    setSyncStatusUI("pending");
  } else if (["operationApplied", "remoteUpdate"].includes(event.type)) {
    setSyncStatusUI("synced");
  } else if (["operationFailed"].includes(event.type)) {
    setSyncStatusUI("offline");
  } else if (["conflict"].includes(event.type)) {
    setSyncStatusUI("conflict");
  }
}

function setSyncStatusUI(status) {
  syncState = status;
  if (!elements.syncStatus) return;
  elements.syncStatus.className = `sync-status ${status}`;
  elements.syncStatus.title = status === "pending" ? "Sincronizando..." : status === "synced" ? "Sincronizado" : status === "offline" ? "Sin conexión" : "Conflicto detectado";
}

async function initializeSync(user) {
  localStore = new RapiditaSyncV2.IndexedDbV2({ dbName: DB_NAME, version: 2 });
  const saved = await localStore.get(DB_STORE, DB_STATE_KEY);

  engine = new RapiditaSyncV2.SyncEngine({
    firestore: cloudDatabase,
    user,
    laundryId: "la-rapidita",
    localStore,
    listenerOrderFix: true,
    realtime: true,
    autoDrain: true,
    onEvent: handleSyncEvent,
    onStateChange: (nextState) => {
      state = normalizeState(nextState);
      render();
    },
  });

  const result = await engine.initialize(normalizeState(saved));
  state = normalizeState(result.state);

  elements.loginScreen.hidden = true;
  document.body.classList.remove("cloud-locked");
  showView("panelView");
  render();
  setExpenseCategory(currentExpenseCategory);
  updatePreview();
  updateLiveWeather();
}

function normalizeExpenses(expenses) {
  return (Array.isArray(expenses) ? expenses : []).map((expense) => {
    const category = EXPENSE_CATEGORIES[expense.category] ? expense.category : "operativo";
    const paymentMethod = PAYMENT_METHODS[expense.paymentMethod] ? expense.paymentMethod : "efectivo";
    const concept = String(expense.concept || expense.name || CATEGORY_DEFAULT_CONCEPTS[category] || "Gasto").trim();
    return {
      ...expense,
      id: expense.id || createId(),
      name: expense.name || concept,
      concept,
      amount: Number(expense.amount || 0),
      category,
      paymentMethod,
      supplyId: expense.supplyId || null,
      purchasedQuantity: expense.purchasedQuantity == null ? null : Number(expense.purchasedQuantity || 0),
      purchasedUnit: expense.purchasedUnit || null,
      notes: expense.notes || "",
      createdAt: expense.createdAt || new Date().toISOString(),
      updatedAt: expense.updatedAt || expense.createdAt || new Date().toISOString(),
    };
  });
}

function normalizeSupplies(supplies) {
  const saved = Array.isArray(supplies) ? supplies : [];
  const byId = new Map(saved.map((supply) => [supply.id, supply]));

  return DEFAULT_SUPPLIES.map((fallback) => {
    const supply = byId.get(fallback.id) || {};
    const isLegacyBags = fallback.id === "bolsas" && supply.unit && supply.unit !== "kg";
    const inferredBagConversion = Number(supply.piecesPerPurchaseUnit || 0)
      || (Number(supply.averageCost || 0) > 0 && Number(supply.purchaseUnitPrice || 0) > 0
        ? Number(supply.purchaseUnitPrice) / Number(supply.averageCost)
        : 0);
    const unit = ["gas", "bolsas"].includes(fallback.id) ? "kg" : (supply.unit || fallback.unit);
    const storedQuantity = Number(supply.quantity ?? fallback.quantity ?? 0);
    const storedMinimum = Number(supply.minimum ?? fallback.minimum ?? 0);
    const storedAverageCost = Number(supply.averageCost ?? fallback.averageCost ?? 0);
    const canConvertBags = isLegacyBags && inferredBagConversion > 0;
    const quantity = canConvertBags ? storedQuantity / inferredBagConversion : (isLegacyBags ? 0 : storedQuantity);
    const minimum = fallback.id === "gas"
      ? 5
      : canConvertBags
        ? storedMinimum / inferredBagConversion
        : fallback.id === "bolsas"
          ? Number(supply.minimum && supply.unit === "kg" ? supply.minimum : fallback.minimum)
          : storedMinimum;
    const averageCost = canConvertBags
      ? storedAverageCost * inferredBagConversion
      : isLegacyBags
        ? Number(supply.purchaseUnitPrice || fallback.purchaseUnitPrice || 0)
        : storedAverageCost;
    return {
      ...fallback,
      ...supply,
      unit,
      purchaseUnit: supply.purchaseUnit || fallback.purchaseUnit || unit,
      quantity,
      minimum,
      averageCost,
      purchaseUnitPrice: Number(supply.purchaseUnitPrice ?? fallback.purchaseUnitPrice ?? 0),
      piecesPerPurchaseUnit: fallback.id === "bolsas" ? 0 : Number(supply.piecesPerPurchaseUnit ?? fallback.piecesPerPurchaseUnit ?? 0),
      tankSize: Number(supply.tankSize ?? fallback.tankSize ?? 0),
      usageBasis: fallback.usageBasis,
      usagePerKg: fallback.id === "bolsas" ? 0 : Number(supply.usagePerKg ?? fallback.usagePerKg ?? 0),
      usagePerOrder: fallback.id === "bolsas" ? 0 : Number(supply.usagePerOrder ?? fallback.usagePerOrder ?? 0),
    };
  });
}

function normalizeSupplyMovements(movements, supplies) {
  const supplyIds = new Set(supplies.map((supply) => supply.id));
  return (Array.isArray(movements) ? movements : [])
    .filter((movement) => supplyIds.has(movement.supplyId))
    .map((movement) => {
      const supply = supplies.find((item) => item.id === movement.supplyId);
      const legacyBagPurchase = supply?.id === "bolsas"
        && movement.type !== "usage"
        && Number(movement.cost || 0) > 0
        && Number(movement.unitPrice || 0) > 0;
      const legacyBagConversion = supply?.id === "bolsas" ? Number(movement.piecesPerUnit || 0) : 0;
      const quantity = legacyBagPurchase
        ? Number(movement.cost) / Number(movement.unitPrice)
        : legacyBagConversion > 0
          ? Number(movement.quantity || 0) / legacyBagConversion
          : Number(movement.quantity || 0);
      return {
      id: movement.id || createId(),
      expenseId: movement.expenseId || null,
      supplyId: movement.supplyId,
      type: movement.type === "usage" ? "usage" : "purchase",
      quantity,
      cost: Number(movement.cost || 0),
      unitPrice: Number(movement.unitPrice || 0),
      piecesPerUnit: supply?.id === "bolsas" ? 0 : Number(movement.piecesPerUnit || 0),
      createdAt: movement.createdAt || new Date().toISOString(),
      note: movement.note || "",
      };
    });
}

function normalizeCustomers(savedCustomers, orders) {
  const customers = [];
  const byKey = new Map();

  [...(Array.isArray(savedCustomers) ? savedCustomers : []), ...orders.map((order) => ({
    id: order.customerId,
    name: order.customerName,
    phone: order.customerPhone,
    createdAt: order.createdAt,
  }))].forEach((customer) => {
    const name = String(customer.name || "").trim().replace(/\s+/g, " ");
    const key = normalizeCustomerKey(name);
    if (!key || byKey.has(key)) return;
    const normalized = { id: customer.id || createId(), name, phone: normalizePhone(customer.phone), createdAt: customer.createdAt || new Date().toISOString() };
    byKey.set(key, normalized);
    customers.push(normalized);
  });

  return customers;
}

function normalizeServices(services) {
  if (!Array.isArray(services) || !services.length) return DEFAULT_SERVICES;
  return services.map((service) => ({
    id: service.id || createId(),
    name: service.name || "Servicio",
    price: Number(service.price || service.pricePerKg || 22),
    unit: service.unit || "kg",
    description: service.description || "Servicio de lavanderia",
    active: service.active !== false,
  }));
}

function normalizeOrder(order, services) {
  const statusMap = {
    pendiente: "recibido",
    lavada: "lavando",
    secada: "secando",
    doblada: "doblando",
    lista: "listo",
  };
  const service = services.find((item) => item.id === order.serviceId) || services[0];

  const normalized = {
    ...order,
    serviceId: order.serviceId || service.id,
    serviceName: order.serviceName || service.name,
    unit: order.unit || service.unit,
    status: statusMap[order.status] || order.status || "recibido",
    paid: Boolean(order.paid),
    paidAt: order.paidAt || null,
    deliveredAt: order.deliveredAt || null,
  };
  const rawItems = Array.isArray(order.items) && order.items.length
    ? order.items
    : [{
        serviceId: normalized.serviceId, serviceName: normalized.serviceName,
        unit: normalized.unit, weightKg: normalized.weightKg, pricePerKg: normalized.pricePerKg,
        subtotal: normalized.subtotal, total: normalized.total,
      }];
  normalized.items = rawItems.map((item) => ({ ...item, id: item.id || createId() }));
  syncOrderTotalsFromItems(normalized);
  return normalized;
}

function render() {
  renderServicesSelect();
  renderCustomerSelect();
  renderExpenseSelect();
  renderExpenseSupplySelect();
  renderSummary();
  renderOrders();
  renderExpenses();
  renderClients();
  renderServices();
  renderSupplies();
  renderReports();
  renderClosingState();
  renderIcons();
  renderMotivationalPhrase();
}

function setExpenseCategory(category) {
  currentExpenseCategory = EXPENSE_CATEGORIES[category] ? category : "operativo";
  const config = EXPENSE_CATEGORIES[currentExpenseCategory];
  elements.expenseCategoryButtons?.forEach((button) => {
    button.classList.toggle("active", button.dataset.expenseCategory === currentExpenseCategory);
  });
  if (elements.expenseSelectedType) elements.expenseSelectedType.textContent = config.label;
  if (elements.expenseConcept && (!elements.expenseConcept.value || Object.values(CATEGORY_DEFAULT_CONCEPTS).includes(elements.expenseConcept.value))) {
    elements.expenseConcept.value = CATEGORY_DEFAULT_CONCEPTS[currentExpenseCategory];
  }
  if (elements.expenseFormHint) {
    elements.expenseFormHint.textContent = currentExpenseCategory === "insumo"
      ? "Registra una sola salida de dinero y actualiza el inventario."
      : currentExpenseCategory === "gas"
        ? "La recarga entra al inventario de gas y queda separada de otros gastos."
        : currentExpenseCategory === "luz"
          ? "La luz se guarda por periodo; el costo por kg se calculara despues con actividad del periodo."
          : currentExpenseCategory === "retiro_personal"
            ? "Sale de caja, pero no reduce la utilidad operativa."
            : currentExpenseCategory === "inversion_deuda"
              ? "Se separa de la operacion diaria para no confundir la utilidad."
              : "Gastos necesarios para operar la lavanderia.";
  }

  elements.expenseSupplyFields.hidden = currentExpenseCategory !== "insumo";
  elements.expenseGasFields.hidden = currentExpenseCategory !== "gas";
  elements.expenseLightFields.hidden = currentExpenseCategory !== "luz";
  elements.expensePersonalHint.hidden = currentExpenseCategory !== "retiro_personal";
  elements.expenseInvestmentFields.hidden = currentExpenseCategory !== "inversion_deuda";
  if (currentExpenseCategory === "gas" && !elements.expenseConcept.value) elements.expenseConcept.value = "Recarga de gas";
  syncExpenseSupplyFields();
  updateExpenseUnitPreviews();
}

function buildExpenseFromForm() {
  const category = currentExpenseCategory;
  const amount = Number(elements.expenseAmount.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const supply = category === "gas"
    ? state.supplies.find((item) => item.id === "gas")
    : state.supplies.find((item) => item.id === elements.expenseSupplySelect?.value);
  const createdAt = createDateTimeFromInput(elements.expenseDate?.value);
  const concept = (elements.expenseConcept.value || CATEGORY_DEFAULT_CONCEPTS[category] || "Gasto").trim();
  const purchasedQuantity = category === "gas"
    ? Number(elements.expenseGasQuantity.value || elements.expenseGasTankSize.value || supply?.tankSize || 30)
    : category === "insumo"
      ? Number(elements.expensePurchasedQuantity.value || 0)
      : null;
  const purchasedUnit = category === "gas" ? "kg" : category === "insumo" ? (elements.expensePurchasedUnit.value || supply?.unit || null) : null;

  if ((category === "insumo" || category === "gas") && (!supply || !Number.isFinite(purchasedQuantity) || purchasedQuantity <= 0)) return null;

  const id = createId();
  return {
    id,
    name: concept,
    concept,
    amount,
    category,
    paymentMethod: PAYMENT_METHODS[elements.expensePaymentMethod.value] ? elements.expensePaymentMethod.value : "efectivo",
    supplyId: category === "insumo" || category === "gas" ? supply.id : null,
    purchasedQuantity: purchasedQuantity == null ? null : purchasedQuantity,
    purchasedUnit,
    lightPeriodStart: category === "luz" ? elements.expenseLightStart.value || null : null,
    lightPeriodEnd: category === "luz" ? elements.expenseLightEnd.value || null : null,
    businessPercent: category === "luz" ? Number(elements.expenseBusinessPercent.value || 100) : null,
    investmentSubtype: category === "inversion_deuda" ? elements.expenseInvestmentSubtype.value : null,
    notes: elements.expenseNotes.value.trim(),
    createdAt,
    updatedAt: new Date().toISOString(),
  };
}

function applyInventoryFromExpense(targetState, expense) {
  if (!["insumo", "gas"].includes(expense.category) || !expense.supplyId) return;
  const supply = targetState.supplies.find((item) => item.id === expense.supplyId);
  const quantity = Number(expense.purchasedQuantity || 0);
  const cost = Number(expense.amount || 0);
  if (!supply || quantity <= 0) return;

  const previousValue = Number(supply.quantity || 0) * Number(supply.averageCost || 0);
  const nextQuantity = Number(supply.quantity || 0) + quantity;
  supply.quantity = nextQuantity;
  if (cost > 0 && nextQuantity > 0) supply.averageCost = (previousValue + cost) / nextQuantity;
  if (expense.category === "gas") supply.tankSize = Number(elements.expenseGasTankSize.value || supply.tankSize || 30);

  targetState.supplyMovements.unshift({
    id: createId(),
    expenseId: expense.id,
    supplyId: supply.id,
    type: "purchase",
    quantity,
    cost,
    unitPrice: quantity > 0 ? cost / quantity : 0,
    piecesPerUnit: 0,
    createdAt: expense.createdAt,
    note: `Compra registrada desde gastos: ${expense.concept}`,
  });
}

function reverseInventoryFromExpense(targetState, expense) {
  const linkedMovements = targetState.supplyMovements.filter((movement) => movement.expenseId === expense.id);
  if (!linkedMovements.length) return;

  linkedMovements.forEach((movement) => {
    const supply = targetState.supplies.find((item) => item.id === movement.supplyId);
    if (!supply || movement.type !== "purchase") return;
    supply.quantity = Math.max(0, Number(supply.quantity || 0) - Number(movement.quantity || 0));
  });
  targetState.supplyMovements = targetState.supplyMovements.filter((movement) => movement.expenseId !== expense.id);
}

function renderExpenseSupplySelect() {
  if (!elements.expenseSupplySelect) return;
  elements.expenseSupplySelect.innerHTML = state.supplies
    .filter((supply) => supply.id !== "gas")
    .map((supply) => `<option value="${supply.id}">${escapeHtml(supply.name)} (${escapeHtml(supply.unit)})</option>`)
    .join("");
  syncExpenseSupplyFields();
}

function syncExpenseSupplyFields() {
  const supply = state.supplies.find((item) => item.id === elements.expenseSupplySelect?.value);
  if (supply && elements.expensePurchasedUnit) elements.expensePurchasedUnit.value = supply.unit;
  updateExpenseUnitPreviews();
}

function updateExpenseUnitPreviews() {
  const amount = Number(elements.expenseAmount?.value || 0);
  const supplyQuantity = Number(elements.expensePurchasedQuantity?.value || 0);
  const gasQuantity = Number(elements.expenseGasQuantity?.value || elements.expenseGasTankSize?.value || 0);
  if (elements.expenseUnitPricePreview) {
    elements.expenseUnitPricePreview.textContent = amount > 0 && supplyQuantity > 0
      ? `Precio unitario: ${moneyFormatter.format(amount / supplyQuantity)} por ${elements.expensePurchasedUnit.value || "unidad"}.`
      : "Precio unitario: pendiente.";
  }
  if (elements.expenseGasUnitPricePreview) {
    elements.expenseGasUnitPricePreview.textContent = amount > 0 && gasQuantity > 0
      ? `Precio por kg: ${moneyFormatter.format(amount / gasQuantity)}.`
      : "Precio por kg: pendiente.";
  }
}

function createDateTimeFromInput(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function getExpenseCategory(expense) {
  return EXPENSE_CATEGORIES[expense.category] ? expense.category : "operativo";
}

function calculateExpenseTotals(expenses) {
  const totals = {
    insumo: 0,
    gas: 0,
    luz: 0,
    operativo: 0,
    retiro_personal: 0,
    inversion_deuda: 0,
    total: 0,
    operatingCost: 0,
    cashOut: 0,
  };
  expenses.forEach((expense) => {
    const category = getExpenseCategory(expense);
    const amount = Number(expense.amount || 0);
    totals[category] += amount;
    totals.total += amount;
    totals.cashOut += amount;
    if (["operativo", "luz"].includes(category)) totals.operatingCost += amount;
  });
  return totals;
}

function renderMotivationalPhrase() {
  if (!elements.motivationalPhrase) return;

  const phrases = [
    "¡Vamos Karla! Deja todo impecable, eres el orgullo de Pepe y Jesús.",
    "Karla, cada prenda que lavas cuenta una historia. Pepe y Jesús te aman cada día más.",
    "La magia ocurre entre el jabón y tu esfuerzo, Karla. Eres el tesoro de nuestra familia.",
    "Tus manos transforman el caos en orden, Karla. Pepe te agradece por ser nuestra compañera.",
    "Eres la experta quitando manchas y la dueña del corazón de Pepe y del pequeño Jesús.",
    "Karla, tu dedicación hace que La Rapidita brille, igual que tu sonrisa que nos enamora.",
    "Un cliente feliz es la recompensa, pero el amor de Pepe y Jesús es tu mayor premio.",
    "Ropa limpia, corazón contento... ¡y nuestra amada Karla al mando!",
    "Tu esfuerzo hoy será el éxito de mañana, Karla. Pepe y Jesús siempre estarán a tu lado.",
    "Karla, cada burbuja de jabón me recuerda lo mucho que Pepe te ama.",
    "Eres la reina de La Rapidita y la única dueña de la vida de Pepe, Karla.",
    "Gracias por trabajar tan duro por nosotros, Karla. Eres la mujer de los sueños de Pepe.",
    "Haces que hasta el trabajo más pesado parezca fácil, ¡Pepe y Jesús te aman mucho!",
    "Karla, eres la mejor mamá para Jesús y la mejor esposa para Pepe. ¡A darle con todo!",
    "Que hoy sea un día increíble, Karla. Pepe y Jesús te esperan con los brazos abiertos.",
    "Tu fuerza nos inspira a Pepe y a Jesús todos los días. ¡Te amamos!",
    "Karla, recuerda que Pepe siempre está orgulloso de la mujer trabajadora que eres.",
    "Cada pedido listo es un paso más hacia nuestros sueños. ¡Te ama tu Pepe!",
    "Para la mamá más trabajadora: Jesús y Pepe te mandan un beso gigante hoy.",
    "Karla, tu alegría es el motor de nuestro hogar. ¡Te amamos, Pepe y Jesús!",
    "Eres la pieza que une a esta familia, Karla. Pepe te adora.",
    "Hoy La Rapidita brillará más porque tiene a Karla al frente. ¡Con todo, mi amor!",
    "Jesús tiene a la mejor mamá del mundo y Pepe a la esposa más increíble.",
    "No hay mancha que se resista a Karla ni día que Pepe no te ame.",
    "Karla, gracias por construir este futuro con Pepe. ¡Te amamos!",
    "Eres nuestra campeona, Karla. Pepe y Jesús te echan porras hoy.",
    "Que tu día sea tan hermoso como el amor que Pepe siente por ti.",
    "Trabaja feliz, Karla, sabiendo que Pepe y Jesús son tus fans número uno.",
    "Eres el ejemplo de esfuerzo para Jesús y el amor eterno de Pepe.",
    "¡Ánimo Karla! Pepe y Jesús estamos muy orgullosos de ti.",
    "Un día más siendo la mejor. ¡Te amamos con todo el corazón, Pepe y Jesús!"
  ];

  const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const phrase = phrases[dayOfYear % phrases.length];
  elements.motivationalPhrase.textContent = `"${phrase}"`;
}

async function updateLiveWeather(options = {}) {
  if (!elements.weatherSkyCard) return;
  const { forceLocation = false } = options;

  setWeatherLoading(true);

  try {
    const location = await getWeatherLocation(forceLocation);
    const weather = await fetchWeather(location);
    cacheWeather(weather);
    renderWeather(weather);
  } catch (error) {
    console.warn("No se pudo actualizar el clima.", error);
    const cached = readCachedWeather();
    if (cached) {
      renderWeather(cached, "Mostrando el ultimo clima guardado.");
    } else {
      renderWeather(createFallbackWeather(), "Sin permiso de ubicacion o conexion; cielo por hora.");
    }
  } finally {
    setWeatherLoading(false);
  }
}

async function getWeatherLocation(forceLocation = false) {
  const cached = readCachedWeather();
  if (!forceLocation && cached?.location) return cached.location;
  if (!navigator.geolocation) return WEATHER_DEFAULT_LOCATION;

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        maximumAge: 1000 * 60 * 30,
        timeout: 9000,
      });
    });

    return {
      latitude: Number(position.coords.latitude.toFixed(4)),
      longitude: Number(position.coords.longitude.toFixed(4)),
      label: "tu zona",
    };
  } catch (error) {
    if (cached?.location) return cached.location;
    return WEATHER_DEFAULT_LOCATION;
  }
}

async function fetchWeather(location) {
  if (weatherController) weatherController.abort();
  weatherController = new AbortController();

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", location.latitude);
  url.searchParams.set("longitude", location.longitude);
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");

  const response = await fetch(url, { signal: weatherController.signal });
  if (!response.ok) throw new Error(`Clima no disponible: ${response.status}`);
  const payload = await response.json();
  const current = payload.current || {};

  return {
    location,
    temperature: Math.round(Number(current.temperature_2m)),
    humidity: Math.round(Number(current.relative_humidity_2m)),
    wind: Math.round(Number(current.wind_speed_10m)),
    weatherCode: Number(current.weather_code),
    isDay: current.is_day === 1,
    updatedAt: new Date().toISOString(),
  };
}

function renderWeather(weather, notice = "") {
  if (!elements.weatherSkyCard) return;

  const visual = getWeatherVisual(weather.weatherCode);
  const nightClass = weather.isDay ? "" : " sky-night";
  const title = `${visual.label}${Number.isFinite(weather.temperature) ? `, ${weather.temperature}°C` : ""}`;
  const detail = notice || `${visual.phrase} Actualizado ${formatWeatherTime(weather.updatedAt)}.`;

  elements.weatherSkyCard.className = `weather-sky-card sky-${visual.type}${nightClass}`;
  elements.weatherTitle.textContent = title;
  elements.weatherDescription.textContent = detail;
  elements.weatherTemperature.textContent = Number.isFinite(weather.temperature) ? `${weather.temperature}°C` : "--°";
  elements.weatherHumidity.textContent = Number.isFinite(weather.humidity) ? `${weather.humidity}%` : "--%";
  elements.weatherWind.textContent = Number.isFinite(weather.wind) ? `${weather.wind} km/h` : "-- km/h";
}

function getWeatherVisual(code) {
  return WEATHER_CODE_MAP[code] || { label: "Cielo cambiante", type: "cloudy", phrase: "El cielo esta movido, pero la lavanderia sigue al cien." };
}

function createFallbackWeather() {
  const hour = new Date().getHours();
  return {
    location: WEATHER_DEFAULT_LOCATION,
    temperature: NaN,
    humidity: NaN,
    wind: NaN,
    weatherCode: hour >= 7 && hour < 18 ? 1 : 0,
    isDay: hour >= 7 && hour < 19,
    updatedAt: new Date().toISOString(),
  };
}

function cacheWeather(weather) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weather));
  } catch (error) {
    console.warn("No se pudo guardar el clima local.", error);
  }
}

function readCachedWeather() {
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || "null");
    if (!cached?.updatedAt) return null;
    const age = Date.now() - new Date(cached.updatedAt).getTime();
    return age < 1000 * 60 * 60 * 3 ? cached : null;
  } catch {
    return null;
  }
}

function setWeatherLoading(isLoading) {
  elements.weatherRefreshButton?.classList.toggle("loading", isLoading);
  if (elements.weatherRefreshButton) elements.weatherRefreshButton.disabled = isLoading;
}

function formatWeatherTime(value) {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function renderCustomerSelect() {
  if (!elements.customerSelect) return;
  const sorted = [...state.customers].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const options = [
    '<option value="" disabled selected>Selecciona un cliente</option>',
    '<option value="NEW_CUSTOMER">➕ Registrar nuevo cliente...</option>',
    ...sorted.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
  ];
  elements.customerSelect.innerHTML = options.join("");
}

function renderExpenseSelect() {
  if (!elements.expenseSelect) return;

  // Obtener conceptos únicos ya usados
  const usedExpenses = [...new Set(state.expenses.map(e => e.name))];
  const allConcepts = [...new Set([...COMMON_EXPENSES, ...usedExpenses])].sort((a, b) => a.localeCompare(b, "es"));

  const options = [
    '<option value="" disabled selected>Selecciona un concepto</option>',
    '<option value="NEW_EXPENSE">➕ Nuevo concepto...</option>',
    ...allConcepts.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
  ];
  elements.expenseSelect.innerHTML = options.join("");
}

function renderClosingState() {
  const todayIsClosed = state.closings.some((closing) => closing.dateKey === getLocalDateKey());
  elements.clearDayButton.disabled = todayIsClosed;
  elements.clearDayButton.innerHTML = todayIsClosed
    ? '<i data-lucide="lock"></i>Día finalizado'
    : '<i data-lucide="calendar-check"></i>Finalizar día';
}

function renderIcons() {
  document.querySelectorAll("i[data-lucide]").forEach((icon) => {
    const name = icon.dataset.lucide || "circle";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", icon.getAttribute("aria-hidden") || "true");
    svg.classList.add("lucide");
    svg.innerHTML = getIconMarkup(name);
    icon.replaceWith(svg);
  });
}

function getIconMarkup(name) {
  const icons = {
    "badge-dollar-sign": '<path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z"/><path d="M12 8v8"/><path d="M9.5 10.5c.7-1 4.5-1 5 1 1 3-5 1.5-5 4 0 1.5 3.8 2 5 0"/>',
    "calendar-check": '<path d="M7 3v4M17 3v4M4 9h16M5 5h14v15H5z"/><path d="m8 15 2.5 2.5L16 12"/>',
    "calendar-days": '<path d="M7 3v4M17 3v4M4 9h16M5 5h14v15H5z"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01"/>',
    "chart-no-axes-column": '<path d="M6 20V10M12 20V4M18 20v-7"/>',
    "circle-check": '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    "circle-plus": '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    "circle-user": '<circle cx="12" cy="8" r="3"/><path d="M5 20c1.4-4 12.6-4 14 0"/><circle cx="12" cy="12" r="9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    droplet: '<path d="M12 3s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11Z"/>',
    droplets: '<path d="M8 3s4 4.3 4 7a4 4 0 0 1-8 0c0-2.7 4-7 4-7Z"/><path d="M17 11s3 3.2 3 5.2a3 3 0 0 1-6 0C14 14.2 17 11 17 11Z"/>',
    flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-8-5-13-4 3-2 7-6 10-2 1.5-3 3-3 5 0 3 3 5 7 5Z"/><path d="M12 22c2 0 3.5-1.5 3.5-3.5 0-2.5-2.5-4-2.5-6.5-2 1.5-1 3.5-3 5-.8.6-1.5 1.5-1.5 2.5 0 1.5 1.5 2.5 3.5 2.5Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    "layout-dashboard": '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="5" rx="1"/><rect x="13" y="11" width="7" height="9" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    "notebook-pen": '<path d="M6 4h11a2 2 0 0 1 2 2v10l-4 4H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M15 20v-4h4"/><path d="M8 8h6M8 12h4"/>',
    package: '<path d="M12 3 4 7l8 4 8-4-8-4Z"/><path d="M4 7v10l8 4 8-4V7"/><path d="M12 11v10"/>',
    "package-check": '<path d="M12 3 4 7l8 4 8-4-8-4Z"/><path d="M4 7v10l8 4 8-4V7"/><path d="m9 16 2 2 4-5"/>',
    "piggy-bank": '<path d="M5 12a6 6 0 0 1 6-6h4a5 5 0 0 1 5 5v3h-2l-1 4h-3l-.5-2h-5L8 18H5l1-3a5 5 0 0 1-1-3Z"/><path d="M9 6 8 3h4"/><path d="M16 10h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    "receipt-text": '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    "refresh-cw": '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M19 11a7 7 0 0 0-12-4"/><path d="M5 13a7 7 0 0 0 12 4"/>',
    save: '<path d="M5 3h12l2 2v16H5z"/><path d="M8 3v6h8V3"/><path d="M8 21v-7h8v7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    shirt: '<path d="M8 4 5 6l-3 4 4 3v7h12v-7l4-3-3-4-3-2c-1 2-7 2-8 0Z"/>',
    thermometer: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0Z"/><path d="M12 9v7"/>',
    "trending-up": '<path d="M3 17 9 11l4 4 8-8"/><path d="M14 7h7v7"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-5 14.5-5 16 0"/>',
    "user-plus": '<circle cx="10" cy="8" r="4"/><path d="M3 21c1.2-4 10.8-4 12 0"/><path d="M18 8v6M15 11h6"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c1-4 11-4 12 0"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M17 15c2 .5 3.5 2 4 5"/>',
    "wallet-cards": '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M16 15h2"/>',
    "washing-machine": '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M9 7h.01M13 7h2"/>',
    wind: '<path d="M3 8h12a3 3 0 1 0-3-3"/><path d="M3 13h16a3 3 0 1 1-3 3"/><path d="M3 18h8"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  return icons[name] || '<circle cx="12" cy="12" r="9"/>';
}

function renderServicesSelect() {
  const activeServices = state.services.filter((service) => service.active);
  const options = (activeServices.length ? activeServices : state.services).map((service) => {
    return `<option value="${service.id}">${escapeHtml(service.name)} - ${moneyFormatter.format(service.price)} / ${service.unit}</option>`;
  });

  elements.serviceSelect.innerHTML = options.join("");
  syncSelectedServicePrice();
}

function syncSelectedServicePrice() {
  const service = getSelectedService();
  if (!service) return;
  elements.pricePerKg.value = service.price;
  elements.selectedServiceName.textContent = service.name;
  elements.selectedServiceUnit.textContent = service.unit === "kg" ? "Cobro por kilogramo" : "Cobro por pieza";
}

function getSelectedService() {
  return state.services.find((service) => service.id === elements.serviceSelect.value)
    || state.services.find((service) => service.active)
    || state.services[0];
}

function renderSummary() {
  const todayOrders = state.orders.filter((order) => isToday(order.createdAt));
  const paidTodayOrders = state.orders.filter((order) => order.paid && isToday(order.paidAt || order.createdAt));
  const todayExpenses = state.expenses.filter((expense) => isToday(expense.createdAt));
  const sales = paidTodayOrders.reduce((sum, order) => sum + order.total, 0);
  const expenseTotals = calculateExpenseTotals(todayExpenses);
  const activeOrders = state.orders.filter(isActiveOrder).length;

  elements.salesToday.textContent = moneyFormatter.format(sales);
  elements.expensesToday.textContent = moneyFormatter.format(expenseTotals.cashOut);
  elements.profitToday.textContent = moneyFormatter.format(sales - expenseTotals.operatingCost);
  elements.todayOrders.textContent = todayOrders.length;
  elements.activeOrders.textContent = activeOrders;
  renderDashboardGas();
  renderDashboardOrders();
  renderDashboardServices();
}

function renderDashboardGas() {
  if (!elements.dashboardGas) return;
  const gas = getGasStats();
  const current = gas.currentCycle;
  const gasSupply = state.supplies.find((supply) => supply.id === "gas");
  const hasData = gas.learnedCostPerKg > 0;
  const stock = Number(gasSupply?.quantity || 0);
  const minimum = Number(gasSupply?.minimum || 5);
  const status = !hasData
    ? "Registra una recarga para empezar a medir"
    : stock <= minimum
      ? "Nivel bajo: programa una recarga"
      : "Consumo estimado con tus recargas";

  elements.dashboardGas.innerHTML = `
    <div class="gas-pulse-icon" aria-hidden="true"><i data-lucide="flame"></i></div>
    <div class="gas-pulse-main">
      <p class="eyebrow">Control de gas</p>
      <strong>${hasData ? `${moneyFormatter.format(gas.learnedCostPerKg)} / kg` : "Aún sin costo calculado"}</strong>
      <span>${status}</span>
    </div>
    <div class="gas-pulse-stat"><span>En tanque</span><strong>${formatSupplyQuantity(stock)} kg</strong></div>
    <div class="gas-pulse-stat"><span>Ciclo actual</span><strong>${formatSupplyQuantity(current.kg)} kg ropa</strong></div>
    <button class="outline-button gas-pulse-action" data-view="suppliesView" type="button">Ver gas<i data-lucide="arrow-right"></i></button>
  `;
  elements.dashboardGas.querySelector("[data-view]")?.addEventListener("click", () => showView("suppliesView"));
}

function renderDashboardOrders() {
  const active = state.orders
    .filter(isActiveOrder)
    .slice(0, 4);

  if (!active.length) {
    elements.dashboardOrders.innerHTML = '<div class="empty-state"><i data-lucide="circle-check"></i><strong>Todo esta al dia</strong><span>No hay pedidos activos.</span></div>';
    return;
  }

  elements.dashboardOrders.innerHTML = active.map((order) => {
    const status = normalizeStatus(order.status);
    const statusIndex = Math.max(0, STATUS_FLOW.indexOf(status));
    const progress = Math.round(((statusIndex + 1) / STATUS_FLOW.length) * 100);
    return `
      <article class="dashboard-order">
        <div class="dashboard-order-client">
          <i data-lucide="shirt"></i>
          <div>
            <strong>${escapeHtml(order.customerName)}</strong>
            <small>${escapeHtml(createOrderCode(order))}</small>
          </div>
        </div>
        <div class="dashboard-progress">
          <small><span>${STATUS_LABELS[status]}</span><span>${progress}%</span></small>
          <div class="dashboard-progress-bar"><i style="width:${progress}%"></i></div>
        </div>
        <strong class="dashboard-order-total">${moneyFormatter.format(order.total)}</strong>
      </article>
    `;
  }).join("");
}

function renderDashboardServices() {
  const totals = state.orders.reduce((result, order) => {
    getOrderItems(order).forEach((item) => {
      const name = item.serviceName || "Sin servicio";
      result[name] = (result[name] || 0) + 1;
    });
    return result;
  }, {});
  const rows = Object.entries(totals).sort(([, a], [, b]) => b - a).slice(0, 5);
  const totalOrders = Object.values(totals).reduce((sum, count) => sum + count, 0) || 1;

  elements.dashboardServices.innerHTML = rows.length
    ? rows.map(([name, count]) => `
        <div class="service-insight">
          <i data-lucide="droplet"></i>
          <div><strong>${escapeHtml(name)}</strong><small>${count} ${count === 1 ? "pedido" : "pedidos"}</small></div>
          <strong>${Math.round((count / totalOrders) * 100)}%</strong>
        </div>
      `).join("")
    : '<div class="empty-state"><strong>Sin datos todavia</strong><span>Los servicios apareceran con los pedidos.</span></div>';
}

function renderOrders() {
  const orders = state.orders.filter((order) => {
    if (!isVisibleInOrdersList(order)) return false;
    const code = createOrderCode(order).toLowerCase();
    const haystack = [code, order.customerName, ...getOrderItems(order).map((item) => item.serviceName), order.notes].join(" ").toLowerCase();
    const matchesSearch = !searchTerm || haystack.includes(searchTerm);

    if (!matchesSearch) return false;
    if (currentFilter === "todos") return true;
    if (currentFilter === "completado") return isCompletedOrder(order);
    if (currentFilter === "sin-pago") return !order.paid;
    return isActiveOrder(order);
  });

  if (!orders.length) {
    elements.ordersList.innerHTML = document.querySelector("#emptyOrdersTemplate").innerHTML;
    return;
  }

  elements.ordersList.innerHTML = orders.map(renderOrderCard).join("");
}

function renderOrderCard(order) {
  const createdAt = new Date(order.createdAt);
  const code = createOrderCode(order);
  const status = normalizeStatus(order.status);
  const statusLabel = STATUS_LABELS[status] || capitalize(status);
  const isDone = status === "entregado";
  const cardClass = isDone ? " ready" : "";
  const dueDate = formatDueDate(createdAt);
  const nextStatus = getNextStatus(status);
  const progress = renderProgress(status);
  const serviceSummary = getOrderItems(order).map((item) => item.serviceName).join(" + ");
  const notes = order.notes ? `${escapeHtml(serviceSummary)} · ${escapeHtml(order.notes)}` : escapeHtml(serviceSummary);
  const payLabel = order.paid ? "Pagado" : "Sin pago";
  const locked = isRecordLocked(order.createdAt);
  const profitability = calculateOrderProfitability(order);
  const canNotify = ["listo", "entregado"].includes(status);

  return `
    <article class="order-card${cardClass}">
      <div class="order-icon" aria-hidden="true"><i data-lucide="washing-machine"></i></div>
      <div class="order-main">
        <div class="order-top">
          <div>
            <strong class="order-code">${code}</strong>
            <h3>${escapeHtml(order.customerName)}</h3>
            <p class="order-notes">${notes}</p>
          </div>
          <button class="status-pill" data-order-id="${order.id}" data-status="${nextStatus}" type="button" ${isDone ? "disabled" : ""}>${statusLabel}</button>
        </div>
        ${progress}
        <div class="order-divider"></div>
        <div class="order-bottom">
          <div class="order-total">
            <strong>${moneyFormatter.format(order.total)}</strong>
            <span class="order-balance ${order.paid ? "paid" : ""}">${payLabel}</span>
          </div>
          <span class="date-chip"><i data-lucide="calendar-days" aria-hidden="true"></i>${dueDate}</span>
          <span class="item-count">${formatQuantity(order)}</span>
        </div>
        <div class="profit-strip ${profitability.profit < 0 ? "loss" : ""}">
          <span>Costo est. ${moneyFormatter.format(profitability.cost)}</span>
          <strong>${profitability.profit < 0 ? "Perdida est." : "Ganancia est."} ${moneyFormatter.format(profitability.profit)}</strong>
        </div>
        <div class="order-actions-inline">
          ${canNotify ? `<button class="mini-status whatsapp" data-whatsapp-order="${order.id}" type="button">WhatsApp listo</button>` : ""}
          ${isDone
            ? `<span class="date-chip"><i data-lucide="lock" aria-hidden="true"></i>Pedido entregado</span>
              ${order.paid ? "" : `<button class="mini-status" data-paid="${order.id}" type="button">Registrar pago</button>`}`
            : `${STATUS_FLOW.map((item) => `<button class="mini-status ${item === status ? "active" : ""}" data-order-id="${order.id}" data-status="${item}" type="button">${STATUS_LABELS[item]}</button>`).join("")}
              <button class="mini-status active" data-add-service="${order.id}" type="button">Agregar servicio</button>
              ${locked
                ? `<span class="date-chip"><i data-lucide="lock" aria-hidden="true"></i>Día cerrado</span>${order.paid ? "" : `<button class="mini-status" data-paid="${order.id}" type="button">Registrar pago de hoy</button>`}`
                : `<button class="mini-status" data-paid="${order.id}" type="button">${order.paid ? "Marcar sin pago" : "Marcar pagado"}</button>
                   <button class="mini-status danger" data-delete-order="${order.id}" type="button">Eliminar</button>`}`}
        </div>
        ${renderOrderItemEditorList(order)}
      </div>
    </article>
  `;
}

function renderOrderItemEditorList(order) {
  const status = normalizeStatus(order.status);
  if (status === "entregado") return "";
  const items = getOrderItems(order);
  return `
    <div class="order-item-list" aria-label="Servicios del pedido">
      ${items.map((item) => {
        const quantity = item.unit === "kg" ? formatSupplyQuantity(item.weightKg) : Number(item.weightKg).toFixed(0);
        return `
          <div class="order-item-row">
            <span>${escapeHtml(item.serviceName || "Servicio")} · ${quantity} ${item.unit === "kg" ? "kg" : "pieza"}</span>
            <button class="mini-status edit" data-edit-order="${order.id}" data-edit-item="${item.id || ""}" type="button">Editar</button>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderProgress(status) {
  const currentIndex = STATUS_FLOW.indexOf(status);
  return `
    <div class="process-track" aria-label="Proceso de lavado">
      ${STATUS_FLOW.map((item, index) => `
        <span class="process-step ${index <= currentIndex ? "done" : ""} ${item === status ? "current" : ""}">
          <i></i>
          <b>${STATUS_LABELS[item]}</b>
        </span>
      `).join("")}
    </div>
  `;
}

function renderServices() {
  elements.servicesList.innerHTML = state.services.map((service) => `
    <article class="service-card ${service.active ? "" : "off"}">
      <div class="service-icon" aria-hidden="true"><i data-lucide="droplet"></i></div>
      <div class="service-info">
        <h3>${escapeHtml(service.name)}</h3>
        <strong>${moneyFormatter.format(service.price)} <span>/ ${service.unit === "kg" ? "por kg" : "por pieza"}</span></strong>
        <p>${escapeHtml(service.description)}</p>
      </div>
      <div class="service-actions">
        <button class="switch ${service.active ? "on" : ""}" data-toggle-service="${service.id}" type="button" aria-label="Activar servicio"></button>
        <button class="kebab" data-service-price="${service.id}" type="button" aria-label="Editar precio">...</button>
      </div>
    </article>
  `).join("");
}

function renderSupplies() {
  if (!elements.suppliesList) return;

  elements.supplySelect.innerHTML = state.supplies
    .map((supply) => `<option value="${supply.id}">${escapeHtml(supply.name)} (${escapeHtml(supply.unit)})</option>`)
    .join("");
  syncSupplyPurchaseFields({ preserveValues: true });

  renderSupplyInsights();

  elements.suppliesList.innerHTML = state.supplies.map((supply) => {
    const isLow = Number(supply.quantity || 0) <= Number(supply.minimum || 0);
    const lastPurchase = state.supplyMovements
      .filter((movement) => movement.supplyId === supply.id && movement.type === "purchase")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    return `
      <article class="service-card ${isLow ? "supply-low" : ""}">
        <div class="service-icon" aria-hidden="true"><i data-lucide="${supply.kind === "gas" ? "flame" : "package"}"></i></div>
        <div class="service-info">
          <h3>${escapeHtml(supply.name)}</h3>
          <strong>${formatSupplyQuantity(supply.quantity)} <span>${escapeHtml(supply.unit)}</span></strong>
          ${supply.kind === "gas" ? `<p>Tanque normal: ${formatSupplyQuantity(supply.tankSize || 30)} kg. Registra 30 kg cuando lo llenes completo.</p>` : ""}
          ${supply.purchaseUnitPrice ? `<p>Precio compra: ${moneyFormatter.format(supply.purchaseUnitPrice)} / ${escapeHtml(supply.purchaseUnit || supply.unit)}${supply.piecesPerPurchaseUnit ? ` · ${formatSupplyQuantity(supply.piecesPerPurchaseUnit)} ${escapeHtml(supply.unit)} por ${escapeHtml(supply.purchaseUnit || "unidad")}` : ""}</p>` : ""}
          <p>Minimo ${formatSupplyQuantity(supply.minimum)} ${escapeHtml(supply.unit)} · Costo prom. ${moneyFormatter.format(supply.averageCost || 0)} / ${escapeHtml(supply.unit)}</p>
          <p>${lastPurchase ? `Ultima compra: ${formatShortDate(lastPurchase.createdAt)} por ${moneyFormatter.format(lastPurchase.cost || 0)}` : "Sin compras registradas todavia."}</p>
        </div>
        <div class="service-actions">
          <button class="status-pill supply-buy-button" data-supply-id="${supply.id}" data-supply-action="${isLow ? "purchase" : "usage"}" type="button" aria-label="${isLow ? "Registrar compra" : "Ajustar inventario"} de ${escapeHtml(supply.name)}">${isLow ? "Comprar" : "Ajustar"}</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderSupplyInsights() {
  if (!elements.gasInsight) return;
  const learning = RapiditaSupplyLearningV2;

  const suppliesHtml = state.supplies.map((supply) => {
    const stats = supply.id === "gas" ? learning.getGasStats(state) : learning.getSupplyStats(state, supply.id);
    const byOrder = supply.usageBasis === "order";
    const learnedUsage = byOrder ? stats.learnedUsagePerOrder : stats.learnedUsagePerKg;
    const learnedCost = byOrder ? stats.learnedCostPerOrder : stats.learnedCostPerKg;
    const hasPurchases = stats.cycles.length > 0;
    const currentWork = byOrder
      ? `${stats.currentCycle.ordersCount} pedidos desde la ultima compra`
      : `${formatSupplyQuantity(stats.currentCycle.kg)} kg de ropa desde la ultima compra`;
    const basisLabel = byOrder ? "pedido" : "kg de ropa";
    const learningMessage = learnedCost > 0
      ? `${moneyFormatter.format(learnedCost)} por ${basisLabel}${stats.preliminary ? " · estimacion del ciclo actual" : ""}`
      : hasPurchases
        ? `Ciclo actual activo · compra de ${formatSupplyQuantity(stats.currentCycle.quantity)} ${escapeHtml(supply.unit)}`
        : "Registra la primera compra para iniciar";

    return `
      <article class="supply-learning-card">
        <div class="supply-learning-heading">
          <span>${escapeHtml(supply.name)}</span>
          <small>${stats.cycles.length} compras · ${stats.closedCycles.length} ciclos cerrados</small>
        </div>
        <strong>${learnedUsage > 0 ? formatSupplyQuantity(learnedUsage) : "--"} <small>${escapeHtml(supply.unit)} / ${basisLabel}</small></strong>
        <p>${learningMessage}</p>
        <small>${currentWork}</small>
      </article>
    `;
  }).join("");

  const lightStats = learning.getLightStats(state);
  const lightHtml = `
    <article class="supply-learning-card light-learning">
      <div class="supply-learning-heading">
        <span>Electricidad (Luz)</span>
        <small>${lightStats.periods} recibos procesados</small>
      </div>
      <strong>${lightStats.learnedCostPerKg > 0 ? moneyFormatter.format(lightStats.learnedCostPerKg) : "--"} <small>por kg de ropa</small></strong>
      <p>${lightStats.learnedCostPerKg > 0 ? "Costo promedio por kg lavado/secado." : "Registra recibos con periodos para calcular."}</p>
      <small>Basado en el histórico de gastos de luz.</small>
    </article>
  `;

  elements.gasInsight.innerHTML = suppliesHtml + lightHtml;
}

function syncSupplyPurchaseFields(options = {}) {
  if (!elements.supplySelect || !elements.supplyUnitPrice || !elements.supplyPiecesPerUnit) return;
  const { preserveValues = false } = options;
  const supply = state.supplies.find((item) => item.id === elements.supplySelect.value);
  if (!supply) return;
  const isUsage = elements.supplyMovementType?.value === "usage";
  if (!preserveValues || !elements.supplyUnitPrice.value) elements.supplyUnitPrice.value = supply.purchaseUnitPrice || "";
  if (!preserveValues || !elements.supplyPiecesPerUnit.value) elements.supplyPiecesPerUnit.value = supply.piecesPerPurchaseUnit || "";
  elements.supplyUnitPrice.placeholder = supply.purchaseUnit ? `Precio por ${supply.purchaseUnit}` : "Precio por unidad";
  elements.supplyPiecesPerUnit.placeholder = supply.unit === "piezas" ? `Piezas por ${supply.purchaseUnit || "unidad"}` : "Solo si aplica";
  if (elements.supplyQuantityLabel) elements.supplyQuantityLabel.textContent = isUsage ? `Cantidad (${supply.unit}) que se restará` : `Cantidad (${supply.unit}) que entra`;
  if (elements.supplyPurchaseCostFields) elements.supplyPurchaseCostFields.hidden = isUsage;
  if (elements.supplyConversionField) elements.supplyConversionField.hidden = isUsage || supply.unit !== "piezas";
  if (elements.supplySubmitButton) elements.supplySubmitButton.innerHTML = `<i data-lucide="save"></i>${isUsage ? "Guardar ajuste" : "Guardar movimiento"}`;
  if (elements.supplyFormHelp) {
    elements.supplyFormHelp.textContent = isUsage
      ? "El ajuste resta existencias manualmente. Úsalo solo para corregir producto gastado, derramado o perdido; no es necesario para el aprendizaje entre compras."
      : supply.id === "bolsas"
      ? "Para bolsas registra solo los kg comprados, o captura costo total y precio por kg. No necesitas contar las bolsas."
      : supply.id === "gas"
        ? "Para gas, un tanque completo normalmente son 30 kg. La app aprende entre recargas."
        : "La app aprende el rendimiento entre una compra y la siguiente.";
  }
  renderIcons();
}

function syncSupplyUnitPriceFromTotals() {
  if (elements.supplyMovementType?.value === "usage") return;
  const quantity = Number(elements.supplyQuantity?.value || 0);
  const cost = Number(elements.supplyCost?.value || 0);
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost) || cost <= 0) return;
  elements.supplyUnitPrice.value = String(Math.round((cost / quantity) * 100) / 100);
}

function renderClients() {
  const clients = state.customers;

  if (!clients.length) {
    elements.clientsList.innerHTML = '<div class="empty-state"><strong>Sin clientes</strong><span>Registra pedidos para crear la lista.</span></div>';
    return;
  }

  elements.clientsList.innerHTML = clients.map((client) => {
    const orders = state.orders.filter((order) => order.customerId === client.id);
    const currentOrders = orders.filter((order) => isVisibleInOrdersList(order) || !order.paid);
    const active = orders.filter(isActiveOrder).length;
    const total = currentOrders.filter((order) => !order.paid).reduce((sum, order) => sum + order.total, 0);
    return `
      <article class="order-card">
        <div class="order-icon" aria-hidden="true"><i data-lucide="circle-user"></i></div>
        <div class="order-main">
          <div class="order-top">
            <div>
              <strong class="order-code">${active} activos</strong>
              <h3>${escapeHtml(client.name)}</h3>
              <p class="order-notes">${client.phone ? `${formatPhone(client.phone)} · ` : ""}${currentOrders.length} pedidos actuales · ${orders.length} historicos</p>
            </div>
            <span class="status-pill">${total > 0 ? `Debe ${moneyFormatter.format(total)}` : "Al corriente"}</span>
          </div>
          <div class="order-actions-inline">
            <button class="mini-status active" data-new-order-customer="${client.id}" type="button">Nuevo pedido</button>
            <button class="mini-status edit" data-edit-client="${client.id}" type="button">Editar nombre</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderReports() {
  const paidOrders = state.orders.filter((order) => order.paid);
  const currentMonthPaidOrders = paidOrders.filter((order) => isCurrentMonth(order.paidAt || order.createdAt));
  const currentMonthExpenses = state.expenses.filter((expense) => isCurrentMonth(expense.createdAt));
  const sales = currentMonthPaidOrders.reduce((sum, order) => sum + order.total, 0);
  const expenseTotals = calculateExpenseTotals(currentMonthExpenses);
  const pending = state.orders.filter((order) => !order.paid).reduce((sum, order) => sum + order.total, 0);
  const delivered = state.orders.filter((order) => normalizeStatus(order.status) === "entregado").length;
  const active = state.orders.filter(isActiveOrder).length;

  elements.reportSales.textContent = moneyFormatter.format(sales);
  elements.reportExpenses.textContent = moneyFormatter.format(expenseTotals.cashOut);
  elements.reportProfit.textContent = moneyFormatter.format(sales - expenseTotals.operatingCost);
  elements.reportPending.textContent = moneyFormatter.format(pending);
  renderWeeklyChart();
  renderExpenseBreakdown(expenseTotals.cashOut, currentMonthExpenses);
  renderRecentTransactions();
  renderDailyClosings();
  renderPeriodBalances();

  elements.orderReportList.innerHTML = [
    ["Total de pedidos", state.orders.length],
    ["Pedidos activos", active],
    ["Pedidos entregados", delivered],
    ["Pedidos pagados", state.orders.filter((order) => order.paid).length],
    ["Pedidos sin pagar", state.orders.filter((order) => !order.paid).length],
  ].map(renderReportRow).join("");

  const serviceTotals = paidOrders.reduce((totals, order) => {
    getOrderItems(order).forEach((item) => {
      const key = item.serviceName || "Sin servicio";
      totals[key] = totals[key] || { count: 0, total: 0 };
      totals[key].count += 1;
      totals[key].total += Number(item.total || item.subtotal || 0);
    });
    return totals;
  }, {});

  const serviceRows = Object.entries(serviceTotals)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([name, data]) => [name, `${data.count} pedidos - ${moneyFormatter.format(data.total)}`]);

  elements.serviceReportList.innerHTML = serviceRows.length
    ? serviceRows.map(renderReportRow).join("")
    : '<div class="empty-state"><strong>Sin datos</strong><span>Registra pedidos para ver el informe.</span></div>';
}

function renderPeriodBalances() {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  elements.weeklyBalance.innerHTML = renderBalanceRows(calculateBalanceSince(startOfWeek));
  elements.monthlyBalance.innerHTML = renderBalanceRows(calculateBalanceSince(startOfMonth));
  elements.yearlyBalance.innerHTML = renderBalanceRows(calculateBalanceSince(startOfYear));
}

function calculateBalanceSince(startDate) {
  const sales = state.orders
    .filter((order) => order.paid && new Date(order.paidAt || order.createdAt) >= startDate)
    .reduce((sum, order) => sum + order.total, 0);
  const expenses = state.expenses
    .filter((expense) => new Date(expense.createdAt) >= startDate)
  const expenseTotals = calculateExpenseTotals(expenses);
  return { sales, ...expenseTotals, profit: sales - expenseTotals.operatingCost, cashFlow: sales - expenseTotals.cashOut };
}

function renderBalanceRows(balance) {
  return [
    ["Ingresos cobrados", moneyFormatter.format(balance.sales)],
    ["Compras de insumos", moneyFormatter.format(balance.insumo + balance.gas)],
    ["Gastos operativos", moneyFormatter.format(balance.operativo + balance.luz)],
    ["Retiros personales", moneyFormatter.format(balance.retiro_personal)],
    ["Inversion/deuda", moneyFormatter.format(balance.inversion_deuda)],
    ["Flujo neto de caja", moneyFormatter.format(balance.cashFlow)],
    ["Utilidad operativa", moneyFormatter.format(balance.profit)],
  ].map(renderReportRow).join("");
}

function renderWeeklyChart() {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const total = state.orders
      .filter((order) => order.paid && isSameDay(new Date(order.paidAt || order.createdAt), date))
      .reduce((sum, order) => sum + order.total, 0);
    return { date, total };
  });
  const maximum = Math.max(...days.map((day) => day.total), 1);
  const weekdayFormatter = new Intl.DateTimeFormat("es-MX", { weekday: "short" });

  elements.weeklyChart.innerHTML = days.map(({ date, total }) => {
    const height = Math.max(4, Math.round((total / maximum) * 100));
    const label = weekdayFormatter.format(date).replace(".", "");
    return `
      <div class="chart-day" title="${moneyFormatter.format(total)}">
        <div class="chart-bar-wrap"><i class="chart-bar" style="height:${height}%"></i></div>
        <small>${escapeHtml(label)}</small>
      </div>
    `;
  }).join("");
}

function renderExpenseBreakdown(totalExpenses, expenses = state.expenses) {
  const groups = expenses.reduce((result, expense) => {
    const category = getExpenseCategory(expense);
    const name = EXPENSE_CATEGORIES[category].label;
    result[name] = (result[name] || 0) + Number(expense.amount || 0);
    return result;
  }, {});
  const rows = Object.entries(groups).sort(([, a], [, b]) => b - a).slice(0, 6);

  elements.expenseBreakdown.innerHTML = rows.length
    ? rows.map(([name, amount]) => `
        <div class="expense-breakdown-row">
          <i data-lucide="receipt"></i>
          <div><strong>${escapeHtml(name)}</strong><small>${totalExpenses ? Math.round((amount / totalExpenses) * 100) : 0}% del total</small></div>
          <strong>${moneyFormatter.format(amount)}</strong>
        </div>
      `).join("")
    : '<div class="empty-state"><strong>Sin gastos</strong><span>Cuando registres uno aparecera aqui.</span></div>';
}

function renderRecentTransactions() {
  const recent = [...state.orders]
    .filter(isVisibleInOrdersList)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8);

  elements.recentTransactions.innerHTML = recent.length
    ? recent.map((order) => `
        <div class="transaction-row">
          <div><strong>${escapeHtml(createOrderCode(order))}</strong><small>${formatShortDate(order.createdAt)}</small></div>
          <div><strong>${escapeHtml(order.customerName)}</strong><small>${escapeHtml(order.serviceName)}</small></div>
          <span class="transaction-status ${order.paid ? "paid" : ""}">${order.paid ? "Pagado" : "Sin pago"}</span>
          <strong>${moneyFormatter.format(order.total)}</strong>
        </div>
      `).join("")
    : '<div class="empty-state"><strong>Sin transacciones</strong><span>Los pedidos recientes apareceran aqui.</span></div>';
}

function renderDailyClosings() {
  const closings = [...state.closings]
    .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt));

  elements.closingsList.innerHTML = closings.length
    ? closings.map((closing) => `
        <div class="closing-row">
          <div><strong>${formatShortDate(closing.closedAt)}</strong><small>${closing.ordersCount || 0} pedidos registrados</small></div>
          <span>Cobrado ${moneyFormatter.format(closing.sales || 0)} - Salidas ${moneyFormatter.format(closing.expenses || 0)} - Flujo ${moneyFormatter.format(closing.cashFlow ?? ((closing.sales || 0) - (closing.expenses || 0)))}</span>
          <strong>Utilidad ${moneyFormatter.format(closing.profit || 0)}</strong>
        </div>
      `).join("")
    : '<div class="empty-state"><strong>Sin cierres guardados</strong><span>Usa Guardar cierre al terminar el dia.</span></div>';
}

function renderReportRow([label, value]) {
  return `
    <div class="report-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function isSameDay(firstDate, secondDate) {
  return firstDate.getFullYear() === secondDate.getFullYear()
    && firstDate.getMonth() === secondDate.getMonth()
    && firstDate.getDate() === secondDate.getDate();
}

function isCurrentMonth(value, reference = new Date()) {
  const date = new Date(value);
  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth();
}

function isVisibleInOrdersList(order) {
  if (normalizeStatus(order.status) !== "entregado") return true;
  const referenceDate = new Date(order.deliveredAt || order.createdAt);
  const limit = new Date();
  limit.setDate(limit.getDate() - 7);
  limit.setHours(0, 0, 0, 0);
  return referenceDate >= limit;
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function getLocalDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isRecordLocked(createdAt) {
  const recordDateKey = getLocalDateKey(new Date(createdAt));
  return recordDateKey < getLocalDateKey()
    || state.closings.some((closing) => closing.dateKey === recordDateKey);
}

function showLockedDayMessage() {
  elements.closingStatus.textContent = "Ese día ya está cerrado y sus datos no se pueden modificar.";
}

function showDeliveredOrderMessage() {
  elements.closingStatus.textContent = "El pedido ya fue entregado y no se puede editar.";
}

function renderExpenses() {
  const visibleExpenses = state.expenses.filter((expense) => isCurrentMonth(expense.createdAt));

  if (!visibleExpenses.length) {
    elements.expenseList.innerHTML = '<div class="empty-state"><strong>Sin gastos este mes</strong><span>Agrega los gastos conforme salgan. Los meses pasados quedan guardados en informes.</span></div>';
    return;
  }

  elements.expenseList.innerHTML = visibleExpenses.map((expense) => `
    <div class="expense-item">
      <span>
        <strong>${escapeHtml(expense.concept || expense.name)}</strong>
        <small>${escapeHtml(EXPENSE_CATEGORIES[getExpenseCategory(expense)].shortLabel)} · ${escapeHtml(PAYMENT_METHODS[expense.paymentMethod] || "Efectivo")}</small>
      </span>
      <strong>${moneyFormatter.format(expense.amount)}</strong>
      ${isRecordLocked(expense.createdAt)
        ? '<span class="date-chip"><i data-lucide="lock" aria-hidden="true"></i>Día cerrado</span>'
        : `<button class="delete-button" data-delete-expense="${expense.id}" type="button">Quitar</button>`}
    </div>
  `).join("");
}

function showView(viewId) {
  document.querySelectorAll(".screen-section").forEach((section) => {
    section.classList.toggle("active", section.id === viewId);
  });
  window.scrollTo({ top: 0, behavior: "auto" });

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });

  const isOrders = viewId === "ordersView";
  const isServices = viewId === "servicesView";
  const isExpenses = viewId === "expensesView";
  const isSupplies = viewId === "suppliesView";
  const isPanel = viewId === "panelView";
  elements.newOrderButton.style.display = isOrders || isServices || isExpenses || isSupplies || isPanel ? "inline-flex" : "none";
  elements.floatingActionLabel.textContent = isServices ? "Agregar servicio" : isExpenses ? "Agregar gasto" : isSupplies ? "Movimiento" : "Nuevo pedido";

  if (viewId === "newOrderView") {
    if (!appendToOrderId) {
      resetOrderFormContext();
      renderCustomerSelect();
    }
    setTimeout(() => elements.customerSelect.focus(), 80);
  }
}

function setOrderFormMode(order = null) {
  elements.customerSelect.disabled = Boolean(order);
  elements.orderFormTitle.textContent = order ? `Agregar a ${createOrderCode(order)}` : "Resumen del pedido";
  elements.orderFormMode.textContent = order ? "Pedido existente" : "Nuevo";
  elements.submitOrderButton.querySelector("span").textContent = order ? "Agregar al pedido" : "Registrar pedido";
}

function resetOrderFormContext() {
  appendToOrderId = null;
  elements.customerSelect.disabled = false;
  elements.newCustomerContainer.hidden = true;
  elements.customerName.required = false;
  setOrderFormMode();
}

function getOrderItems(order) {
  return Array.isArray(order.items) && order.items.length ? order.items : [order];
}

function syncOrderTotalsFromItems(order) {
  const items = getOrderItems(order);
  order.subtotal = items.reduce((sum, item) => sum + Number(item.subtotal || (item.weightKg * item.pricePerKg) || 0), 0);
  order.total = roundUpToPeso(order.subtotal);
  order.serviceName = items.map((item) => item.serviceName).join(" + ");
  order.weightKg = items.reduce((sum, item) => sum + Number(item.weightKg || 0), 0);
}

function updatePreview() {
  const quantity = Number(elements.weightKg.value) || 0;
  const price = Number(elements.pricePerKg.value) || 0;
  const subtotal = quantity * price;

  elements.subtotalPreview.textContent = moneyFormatter.format(subtotal);
  elements.totalPreview.textContent = moneyFormatter.format(roundUpToPeso(subtotal));
}

function openOrderEditor(orderId, itemId) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  if (normalizeStatus(order.status) === "entregado") return showDeliveredOrderMessage();

  elements.editOrderId.value = order.id;
  elements.editOrderCustomer.textContent = order.customerName;
  const items = getOrderItems(order);
  const item = items.find((entry) => entry.id === itemId) || items[0];
  if (!item) return;
  elements.editOrderItemId.value = item.id || "";
  elements.editOrderCustomer.textContent = `${order.customerName} · ${item.serviceName || "Servicio"}`;
  elements.editOrderQuantity.value = item.weightKg;
  elements.editOrderQuantity.step = item.unit === "kg" ? "0.01" : "1";
  elements.editOrderQuantity.min = item.unit === "kg" ? "0.01" : "1";
  elements.editOrderPrice.value = item.pricePerKg;
  updateEditOrderPreview();
  elements.editOrderDialog.showModal();
  elements.editOrderQuantity.focus();
}

function openClientEditor(clientId) {
  const client = state.customers.find((item) => item.id === clientId);
  if (!client) return;
  elements.editClientId.value = client.id;
  elements.editClientName.value = client.name;
  elements.editClientPhone.value = formatPhone(client.phone);
  elements.editClientDialog.showModal();
  setTimeout(() => elements.editClientName.select(), 0);
}

function closeClientEditor() {
  if (elements.editClientDialog.open) elements.editClientDialog.close();
  elements.editClientForm.reset();
}

function closeOrderEditor() {
  elements.editOrderDialog.close();
  elements.editOrderForm.reset();
}

function updateEditOrderPreview() {
  const quantity = Number(elements.editOrderQuantity.value) || 0;
  const price = Number(elements.editOrderPrice.value) || 0;
  const subtotal = quantity * price;

  elements.editOrderSubtotal.textContent = moneyFormatter.format(subtotal);
  elements.editOrderTotal.textContent = moneyFormatter.format(roundUpToPeso(subtotal));
}

function exportCsv() {
  const rows = [
    ["tipo", "fecha", "cliente/concepto", "categoria", "metodo_pago", "servicio", "cantidad", "unidad", "precio", "subtotal", "total/monto", "estatus", "pagado", "notas"],
    ...state.orders.flatMap((order) => getOrderItems(order).map((item) => [
      "pedido",
      order.createdAt,
      order.customerName,
      "",
      "",
      item.serviceName,
      item.weightKg,
      item.unit,
      item.pricePerKg,
      item.subtotal,
      item.total,
      order.status,
      order.paid ? "si" : "no",
      order.notes,
    ])),
    ...state.expenses.map((expense) => [
      "gasto",
      expense.createdAt,
      expense.concept || expense.name,
      getExpenseCategory(expense),
      expense.paymentMethod || "efectivo",
      "",
      "",
      "",
      "",
      "",
      expense.amount,
      "",
      "",
      expense.notes || "",
    ]),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `la-rapidita-lavanderia-express-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function roundUpToPeso(amount) {
  return Math.ceil(Number(amount) || 0);
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isToday(isoDate) {
  return new Date(isoDate).toDateString() === new Date().toDateString();
}

function createOrderCode(order) {
  const date = new Date(order.createdAt);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  const suffix = String(order.id).replace(/\D/g, "").slice(-4).padStart(4, "0");

  return `LT${stamp}${suffix}`;
}

function formatDueDate(date) {
  const dueDate = new Date(date);
  dueDate.setDate(dueDate.getDate() + 2);

  return dueDate.toLocaleDateString("es-MX", {
    month: "short",
    day: "numeric",
  });
}

function formatQuantity(order) {
  const items = getOrderItems(order);
  if (items.length > 1) return `${items.length} servicios`;
  const item = items[0];
  const quantity = item.unit === "kg" ? formatSupplyQuantity(item.weightKg) : Number(item.weightKg).toFixed(0);
  return `${quantity} ${item.unit === "kg" ? "kg" : "pieza"}`;
}

function formatSupplyQuantity(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function calculateSupplyMovementQuantity(supply, options) {
  if (!supply) return 0;
  const { rawQuantity, cost, unitPrice, piecesPerUnit, type } = options;
  const typedQuantity = Number(rawQuantity);
  if (Number.isFinite(typedQuantity) && typedQuantity > 0) return typedQuantity;
  if (type !== "purchase" || !Number.isFinite(cost) || cost <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) return 0;

  const purchaseUnits = cost / unitPrice;
  const conversion = Number(piecesPerUnit || supply.piecesPerPurchaseUnit || 0);
  if (conversion > 0) return purchaseUnits * conversion;
  return purchaseUnits;
}

function getOrderKg(order) {
  return getOrderItems(order).reduce((sum, item) => {
    if (item.unit !== "kg") return sum;
    return sum + Number(item.weightKg || 0);
  }, 0);
}

function getSupplyStats(supplyId) {
  return RapiditaSupplyLearningV2.getSupplyStats(state, supplyId);
}

function getGasStats() {
  return RapiditaSupplyLearningV2.getGasStats(state);
}

function getEstimatedSupplyCostPerKg() {
  return RapiditaSupplyLearningV2.getEstimatedSupplyCostPerKg(state);
}

function getEstimatedSupplyCostPerOrder() {
  return RapiditaSupplyLearningV2.getEstimatedSupplyCostPerOrder(state);
}

function calculateOrderProfitability(order) {
  return RapiditaSupplyLearningV2.calculateOrderProfitability(state, order);
}

function calculateRecommendedKgPrice(costPerKg, targetMargin = 0.6) {
  return RapiditaSupplyLearningV2.calculateRecommendedKgPrice(costPerKg, targetMargin);
}

function openWhatsAppForOrder(order) {
  const code = createOrderCode(order);
  const pending = order.paid ? "ya esta pagado" : `queda pendiente ${moneyFormatter.format(order.total)}`;
  const message = [
    `Hola ${order.customerName}, tu ropa ya esta lista en La Rapidita.`,
    `Pedido: ${code}`,
    `Servicios: ${getOrderItems(order).map((item) => item.serviceName).join(" + ")}`,
    `Total: ${moneyFormatter.format(order.total)} (${pending}).`,
    "Puedes pasar a recogerla cuando gustes. Gracias por tu preferencia."
  ].join("\n");

  const customer = state.customers.find((item) => item.id === order.customerId);
  const phone = normalizePhone(order.customerPhone || customer?.phone);
  const recipient = phone ? `${phone}?` : "?";
  window.open(`https://wa.me/${recipient}text=${encodeURIComponent(message)}`, "_blank", "noopener");
}

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

function isActiveOrder(order) {
  return !["listo", "entregado"].includes(normalizeStatus(order.status));
}

function isCompletedOrder(order) {
  return ["listo", "entregado"].includes(normalizeStatus(order.status));
}

function normalizeCustomerKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es-MX");
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  return digits;
}

function formatPhone(value) {
  const phone = normalizePhone(value);
  const local = phone.startsWith("52") && phone.length === 12 ? phone.slice(2) : phone;
  if (local.length === 10) return `${local.slice(0, 2)} ${local.slice(2, 6)} ${local.slice(6)}`;
  return local;
}

function getNextStatus(status) {
  const index = STATUS_FLOW.indexOf(normalizeStatus(status));
  return STATUS_FLOW[Math.min(index + 1, STATUS_FLOW.length - 1)] || "recibido";
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function initializeApp() {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user && !AUTHORIZED_EMAILS.includes((user.email || "").toLowerCase())) {
      await firebase.auth().signOut();
      elements.loginMessage.textContent = "Esta cuenta no esta autorizada para entrar.";
      elements.loginGoogleButton.disabled = false;
      return;
    }

    cloudUser = user;
    if (!user) {
      elements.loginScreen.hidden = false;
      document.body.classList.add("cloud-locked");
      elements.loginGoogleButton.disabled = false;
      return;
    }

    try {
      elements.loginMessage.textContent = "Sincronizando datos...";
      await initializeSync(user);
    } catch (error) {
      console.error("No se pudo conectar con Firebase.", error);
      elements.loginMessage.textContent = "No se pudo sincronizar. Revisa la conexion e intenta de nuevo.";
      elements.loginGoogleButton.disabled = false;
    }
  });

  if (navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {});
  }

}

initializeApp();
