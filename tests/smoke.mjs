import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const root = fileURLToPath(new URL("../", import.meta.url));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const relativePath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const filePath = normalize(join(root, relativePath));
    if (!filePath.startsWith(normalize(root))) throw new Error("Invalid path");
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];

page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("service worker")) consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.route("https://www.gstatic.com/**", (route) => route.fulfill({
  status: 200,
  contentType: "text/javascript",
  body: "/* Firebase is mocked by the smoke test. */",
}));
await page.route("https://api.open-meteo.com/**", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ current: { temperature_2m: 24, relative_humidity_2m: 52, wind_speed_10m: 8, weather_code: 1, is_day: 1 } }),
}));

await page.addInitScript(() => {
  const user = { uid: "smoke-user", email: "chivas11estar@gmail.com" };
  const documentRef = {
    get: async () => ({ exists: false, data: () => null }),
    set: async () => {},
  };
  const auth = () => ({
    onAuthStateChanged: (callback) => queueMicrotask(() => callback(user)),
    signInWithPopup: async () => ({ user }),
    signOut: async () => {},
  });
  auth.GoogleAuthProvider = class GoogleAuthProvider { setCustomParameters() {} };
  const firestore = () => ({ doc: () => documentRef });
  firestore.FieldValue = { serverTimestamp: () => new Date().toISOString() };
  window.firebase = { initializeApp() {}, auth, firestore };
  Object.defineProperty(navigator, "serviceWorker", { value: { register: async () => ({}) } });
});

try {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await page.locator("#loginScreen").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#panelView").getAttribute("class"), "screen-section active");
  assert.equal(await page.locator("#weatherTemperature").textContent(), "24°C");

  const bagMigration = await page.evaluate(() => {
    const supplies = normalizeSupplies([{
      id: "bolsas",
      unit: "piezas",
      purchaseUnit: "kg",
      quantity: 15,
      minimum: 20,
      averageCost: 40 / 15,
      purchaseUnitPrice: 80,
      piecesPerPurchaseUnit: 30,
    }]);
    const bag = supplies.find((supply) => supply.id === "bolsas");
    const [movement] = normalizeSupplyMovements([{
      id: "legacy-bag-purchase",
      supplyId: "bolsas",
      type: "purchase",
      quantity: 15,
      cost: 40,
      unitPrice: 80,
      piecesPerUnit: 30,
    }], supplies);
    return { bag, movement };
  });
  assert.equal(bagMigration.bag.unit, "kg");
  assert.equal(bagMigration.bag.quantity, 0.5);
  assert.equal(bagMigration.bag.averageCost, 80);
  assert.equal(bagMigration.movement.quantity, 0.5);
  assert.equal(bagMigration.movement.piecesPerUnit, 0);

  const learningStats = await page.evaluate(() => {
    const originalOrders = state.orders;
    const originalMovements = state.supplyMovements;
    try {
      state.orders = [
        { id: "order-1", createdAt: "2026-08-02T12:00:00.000Z", unit: "kg", weightKg: 2 },
        { id: "order-2", createdAt: "2026-08-03T12:00:00.000Z", unit: "kg", weightKg: 3 },
        { id: "order-3", createdAt: "2026-08-04T12:00:00.000Z", unit: "kg", weightKg: 4 },
      ];
      state.supplyMovements = [
        { id: "soap-1", supplyId: "jabon", type: "purchase", quantity: 2, cost: 90, createdAt: "2026-08-01T12:00:00.000Z" },
        { id: "soap-2", supplyId: "jabon", type: "purchase", quantity: 2, cost: 100, createdAt: "2026-08-05T12:00:00.000Z" },
        { id: "gas-1", supplyId: "gas", type: "purchase", quantity: 30, cost: 600, createdAt: "2026-08-01T12:00:00.000Z" },
      ];
      return { soap: getSupplyStats("jabon"), gas: getGasStats() };
    } finally {
      state.orders = originalOrders;
      state.supplyMovements = originalMovements;
    }
  });
  assert.equal(learningStats.soap.closedCycles.length, 1);
  assert.equal(learningStats.soap.learnedUsagePerOrder, 2 / 3);
  assert.equal(learningStats.soap.learnedCostPerOrder, 30);
  assert.equal(learningStats.gas.cycles.length, 1);
  assert.equal(learningStats.gas.preliminary, true);
  assert.equal(learningStats.gas.currentCycle.quantity, 30);

  await page.click('[data-view="newOrderView"]');
  await page.selectOption("#customerSelect", "NEW_CUSTOMER");
  await page.fill("#customerName", "Cliente <Prueba>");
  await page.fill("#customerPhone", "55 1234 5678");
  await page.fill("#weightKg", "3.15");
  await page.fill("#pricePerKg", "22");
  await page.fill("#notes", "Separar blancos");
  await page.click("#submitOrderButton");
  await page.locator("#ordersList .order-card").waitFor();
  assert.match(await page.locator("#ordersList .order-card").textContent(), /Cliente <Prueba>/);
  assert.equal(await page.locator("#ordersList script").count(), 0);

  await page.click("#ordersList [data-add-service]");
  await page.selectOption("#serviceSelect", "cobertor");
  await page.fill("#weightKg", "2");
  await page.fill("#pricePerKg", "70");
  await page.click("#submitOrderButton");
  assert.match(await page.locator("#ordersList .order-card").textContent(), /2 servicios/);
  await page.locator("#ordersList .order-item-row [data-edit-item]").nth(1).click();
  await page.fill("#editOrderQuantity", "3");
  await page.fill("#editOrderPrice", "80");
  await page.click('#editOrderForm button[type="submit"]');
  const orderText = await page.locator("#ordersList .order-card").textContent();
  assert.match(orderText, /Lavado y Secado.*3.15 kg/s);
  assert.match(orderText, /Cobertor.*3 pieza/s);
  assert.match(orderText, /310/);

  await page.click("#ordersList [data-paid]");
  assert.match(await page.locator("#ordersList .order-balance").textContent(), /Pagado/);

  await page.click('.bottom-nav [data-view="expensesView"]');
  await page.click('[data-expense-category="operativo"]');
  await page.fill("#expenseConcept", "Detergente");
  await page.fill("#expenseAmount", "35");
  await page.click('#expenseForm button[type="submit"]');
  await page.locator("#expenseList").getByText("Detergente").waitFor();
  assert.match(await page.locator("#expenseList").textContent(), /Detergente/);
  assert.match(await page.locator("#expenseList").textContent(), /Operativo/);

  await page.click('[data-expense-category="insumo"]');
  await page.selectOption("#expenseSupplySelect", "jabon");
  await page.fill("#expenseConcept", "Compra de jabon");
  await page.fill("#expenseAmount", "160");
  await page.fill("#expensePurchasedQuantity", "2");
  await page.click("#expenseSubmitButton");
  await page.locator("#expenseList").getByText("Compra de jabon").waitFor();
  assert.match(await page.locator("#expenseList").textContent(), /Compra de jabon/);
  assert.match(await page.locator("#expenseList").textContent(), /Insumo/);

  await page.click('.bottom-nav [data-view="suppliesView"]');
  assert.equal(await page.locator("#gasInsight").count(), 1);
  const supplyLayout = await page.evaluate(() => {
    const dashboard = document.querySelector(".supply-dashboard").getBoundingClientRect();
    const learningPanel = document.querySelector("#gasInsight").closest(".panel").getBoundingClientRect();
    const formPanel = document.querySelector("#supplyForm").closest(".panel").getBoundingClientRect();
    return { dashboardWidth: dashboard.width, learningWidth: learningPanel.width, formWidth: formPanel.width };
  });
  assert.ok(supplyLayout.learningWidth > supplyLayout.formWidth);
  assert.ok(supplyLayout.learningWidth + supplyLayout.formWidth >= supplyLayout.dashboardWidth * 0.95);
  assert.match(await page.locator("#suppliesList").textContent(), /Jabon[\s\S]*2 litros/);
  await page.click('#suppliesList [data-supply-id="bolsas"][data-supply-action="purchase"]');
  assert.equal(await page.locator("#supplySelect").inputValue(), "bolsas");
  assert.equal(await page.locator("#supplyMovementType").inputValue(), "purchase");
  assert.equal(await page.locator("#supplyConversionField").isHidden(), true);
  assert.match(await page.locator("#supplyFormHelp").textContent(), /No necesitas contar/);
  await page.fill("#supplyUnitPrice", "");
  await page.fill("#supplyQuantity", "0.5");
  await page.fill("#supplyCost", "40");
  assert.equal(await page.locator("#supplyUnitPrice").inputValue(), "80");
  await page.click('#supplyForm button[type="submit"]');
  assert.match(await page.locator("#suppliesList").textContent(), /Bolsas[\s\S]*0.5 kg/);
  await page.selectOption("#supplySelect", "gas");
  await page.fill("#supplyQuantity", "30");
  await page.fill("#supplyCost", "600");
  await page.click('#supplyForm button[type="submit"]');
  await page.click('#suppliesList [data-supply-id="gas"][data-supply-action="usage"]');
  assert.equal(await page.locator("#supplySelect").inputValue(), "gas");
  assert.equal(await page.locator("#supplyMovementType").inputValue(), "usage");
  assert.equal(await page.locator("#supplyPurchaseCostFields").isHidden(), true);
  assert.match(await page.locator("#supplyFormHelp").textContent(), /resta existencias manualmente/);
  assert.match(await page.locator("#supplySubmitButton").textContent(), /Guardar ajuste/);
  await page.fill("#supplyQuantity", "1");
  await page.click('#supplyForm button[type="submit"]');
  assert.match(await page.locator("#suppliesList").textContent(), /Gas[\s\S]*29 kg/);
  await page.click('.bottom-nav [data-view="panelView"]');
  assert.match(await page.locator("#dashboardGas").textContent(), /Control de gas/);
  assert.match(await page.locator("#dashboardGas").textContent(), /29 kg/);
  await page.click("#dashboardGas [data-view]");
  assert.equal(await page.locator("#suppliesView").getAttribute("class"), "screen-section active");

  await page.click('.bottom-nav [data-view="clientsView"]');
  assert.match(await page.locator("#clientsList").textContent(), /Cliente <Prueba>/);
  await page.click("#clientsList [data-edit-client]");
  await page.fill("#editClientName", "Cliente actualizado");
  assert.equal(await page.locator("#editClientPhone").inputValue(), "55 1234 5678");
  await page.click('#editClientForm button[type="submit"]');
  assert.match(await page.locator("#clientsList").textContent(), /Cliente actualizado/);
  await page.click('.bottom-nav [data-view="ordersView"]');
  assert.match(await page.locator("#ordersList").textContent(), /Cliente actualizado/);
  await page.click('.bottom-nav [data-view="reportsView"]');
  assert.match(await page.locator("#reportSales").textContent(), /310/);
  assert.match(await page.locator("#reportExpenses").textContent(), /835/);

  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ["panelView", "ordersView", "clientsView", "expensesView", "suppliesView", "reportsView"]) {
    await page.click(`.bottom-nav [data-view="${view}"]`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${view} has ${overflow}px of horizontal overflow on mobile`);
  }

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  console.log("Smoke test passed: authentication, weather, orders, expenses, supply shortcuts, kg bags, clients and reports.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
