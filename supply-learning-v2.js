(function supplyLearningV2(global) {
  "use strict";

  function getOrderItems(order) {
    return Array.isArray(order?.items) && order.items.length ? order.items : [order];
  }

  function getOrderKg(order) {
    return getOrderItems(order).reduce((sum, item) => item.unit === "kg" ? sum + Number(item.weightKg || 0) : sum, 0);
  }

  function getSupplyStats(state, supplyId, now = new Date()) {
    const purchases = (state?.supplyMovements || [])
      .filter((movement) => movement.supplyId === supplyId && movement.type === "purchase" && movement.quantity > 0)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const cycles = purchases.map((purchase, index) => {
      const nextPurchase = purchases[index + 1];
      const start = new Date(purchase.createdAt);
      if (index === 0) {
        start.setHours(0, 0, 0, 0);
      }
      const end = nextPurchase ? new Date(nextPurchase.createdAt) : new Date(now);
      const orders = (state?.orders || []).filter((order) => {
        const createdAt = new Date(order.createdAt);
        return createdAt >= start && createdAt < end;
      });
      const kg = orders.reduce((sum, order) => sum + getOrderKg(order), 0);
      const ordersCount = orders.length;
      return {
        purchase,
        start,
        end,
        closed: Boolean(nextPurchase),
        ordersCount,
        kg,
        quantity: Number(purchase.quantity || 0),
        cost: Number(purchase.cost || 0),
        usagePerKg: kg > 0 ? Number(purchase.quantity || 0) / kg : 0,
        usagePerOrder: ordersCount > 0 ? Number(purchase.quantity || 0) / ordersCount : 0,
        costPerKg: kg > 0 ? Number(purchase.cost || 0) / kg : 0,
        costPerOrder: ordersCount > 0 ? Number(purchase.cost || 0) / ordersCount : 0,
      };
    });
    const supply = (state?.supplies || []).find((item) => item.id === supplyId);
    const byOrder = supply?.usageBasis === "order";
    const closedCycles = cycles.filter((cycle) => cycle.closed && (byOrder ? cycle.ordersCount > 0 : cycle.kg > 0));
    const totalKg = closedCycles.reduce((sum, cycle) => sum + cycle.kg, 0);
    const totalOrders = closedCycles.reduce((sum, cycle) => sum + cycle.ordersCount, 0);
    const totalQuantity = closedCycles.reduce((sum, cycle) => sum + cycle.quantity, 0);
    const totalCost = closedCycles.reduce((sum, cycle) => sum + cycle.cost, 0);
    return {
      cycles,
      closedCycles,
      currentCycle: cycles[cycles.length - 1] || { ordersCount: 0, kg: 0, quantity: 0, cost: 0, usagePerKg: 0, usagePerOrder: 0, costPerKg: 0, costPerOrder: 0 },
      learnedUsagePerKg: totalKg > 0 ? totalQuantity / totalKg : 0,
      learnedUsagePerOrder: totalOrders > 0 ? totalQuantity / totalOrders : 0,
      learnedCostPerKg: totalKg > 0 ? totalCost / totalKg : 0,
      learnedCostPerOrder: totalOrders > 0 ? totalCost / totalOrders : 0,
    };
  }

  function getGasStats(state, now = new Date()) {
    const stats = getSupplyStats(state, "gas", now);
    if (stats.closedCycles.length || stats.currentCycle.kg <= 0) return { ...stats, preliminary: false };
    return {
      ...stats,
      preliminary: true,
      learnedUsagePerKg: stats.currentCycle.usagePerKg,
      learnedUsagePerOrder: stats.currentCycle.usagePerOrder,
      learnedCostPerKg: stats.currentCycle.costPerKg,
      learnedCostPerOrder: stats.currentCycle.costPerOrder,
    };
  }

  function getEstimatedSupplyCostPerKg(state, now = new Date()) {
    return (state?.supplies || [])
      .filter((supply) => supply.kind !== "gas" && supply.usageBasis !== "order")
      .reduce((sum, supply) => {
        const learnedCost = getSupplyStats(state, supply.id, now).learnedCostPerKg;
        return sum + (learnedCost > 0 ? learnedCost : Number(supply.averageCost || 0) * Number(supply.usagePerKg || 0));
      }, 0);
  }

  function getEstimatedSupplyCostPerOrder(state, now = new Date()) {
    return (state?.supplies || [])
      .filter((supply) => supply.kind !== "gas" && supply.usageBasis === "order")
      .reduce((sum, supply) => {
        const learnedCost = getSupplyStats(state, supply.id, now).learnedCostPerOrder;
        return sum + (learnedCost > 0 ? learnedCost : Number(supply.averageCost || 0) * Number(supply.usagePerOrder || 0));
      }, 0);
  }

  function getLightStats(state, now = new Date()) {
    const expenses = (state?.expenses || [])
      .filter((e) => e.category === "luz" && e.lightPeriodStart && e.lightPeriodEnd && !e.deletedAt);

    if (!expenses.length) return { learnedCostPerKg: 0, periods: 0 };

    const periods = expenses.map((expense) => {
      const start = new Date(expense.lightPeriodStart);
      const end = new Date(expense.lightPeriodEnd);

      const orders = (state?.orders || []).filter((order) => {
        const createdAt = new Date(order.createdAt);
        return createdAt >= start && createdAt <= end;
      });

      const kg = orders.reduce((sum, order) => sum + getOrderKg(order), 0);
      const amount = Number(expense.amount || 0) * (Number(expense.businessPercent || 100) / 100);

      return {
        expenseId: expense.id,
        kg,
        amount,
        costPerKg: kg > 0 ? amount / kg : 0
      };
    }).filter(p => p.kg > 0);

    const totalCostPerKg = periods.reduce((sum, p) => sum + p.costPerKg, 0);

    return {
      learnedCostPerKg: periods.length > 0 ? totalCostPerKg / periods.length : 0,
      periods: periods.length
    };
  }

  function calculateOrderProfitability(state, order, now = new Date()) {
    const kg = getOrderKg(order);
    const gas = getGasStats(state, now);
    const light = getLightStats(state, now);
    const gasCost = kg * Number(gas.learnedCostPerKg || 0);
    const lightCost = kg * Number(light.learnedCostPerKg || 0);
    const suppliesCost = (kg * getEstimatedSupplyCostPerKg(state, now)) + getEstimatedSupplyCostPerOrder(state, now);
    const cost = gasCost + lightCost + suppliesCost;
    const income = Number(order?.total || 0);
    return { income, cost, profit: income - cost };
  }

  function calculateRecommendedKgPrice(costPerKg, targetMargin = 0.6) {
    const safeCost = Number(costPerKg || 0);
    if (safeCost <= 0 || targetMargin >= 1) return 0;
    return Math.ceil(safeCost / (1 - targetMargin));
  }

  global.RapiditaSupplyLearningV2 = Object.freeze({ getOrderItems, getOrderKg, getSupplyStats, getGasStats, getLightStats, getEstimatedSupplyCostPerKg, getEstimatedSupplyCostPerOrder, calculateOrderProfitability, calculateRecommendedKgPrice });
}(window));
