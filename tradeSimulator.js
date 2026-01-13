/**
 * Trade simulator module
 * Simulates trade execution and maintains a virtual trade ledger
 */

// Shared state
let trades = [];
let openPosition = null;
let tradeCounter = 0;

/**
 * Generates a unique trade ID
 */
function generateTradeId() {
  return `trade-${Date.now()}-${++tradeCounter}`;
}

/**
 * Gets the execution price based on slippage buckets
 * Uses PoolPriceTable structure with SlippageBasisPoints and Price fields
 */
function getExecutionPrice(poolData, amount, slippage, direction) {
  const slippageBasisPoints = Math.round(slippage * 10000);
  const buckets = poolData.slippageBuckets || [];

  if (buckets.length === 0) {
    // Fallback to prices object if available
    const prices = poolData.prices || {};
    if (Object.keys(prices).length > 0) {
      const bpKey = slippageBasisPoints.toString();
      return prices[bpKey] || prices[slippageBasisPoints] || null;
    }
    return null;
  }

  // Find bucket matching slippage (field name can be SlippageBasisPoints or slippageBasisPoints)
  let targetBucket = buckets.find(b => {
    const bp = b.SlippageBasisPoints || b.slippageBasisPoints || 0;
    return bp === slippageBasisPoints;
  });
  
  if (!targetBucket) {
    // Find closest bucket
    targetBucket = buckets.reduce((closest, bucket) => {
      const currentBp = bucket.SlippageBasisPoints || bucket.slippageBasisPoints || 0;
      const closestBp = closest.SlippageBasisPoints || closest.slippageBasisPoints || 0;
      const currentDiff = Math.abs(currentBp - slippageBasisPoints);
      const closestDiff = Math.abs(closestBp - slippageBasisPoints);
      return currentDiff < closestDiff ? bucket : closest;
    });
  }

  // Extract price (field name can be Price or price)
  const price = targetBucket.Price || targetBucket.price || null;
  return price;
}

/**
 * Simulates executing a BUY order
 */
function executeBuy(poolData, amount, slippage, strategy) {
  const price = getExecutionPrice(poolData, amount, slippage, 'BUY');
  
  if (!price) {
    throw new Error('Unable to determine execution price for BUY');
  }

  const trade = {
    id: generateTradeId(),
    type: 'BUY',
    amount: amount,
    entryPrice: price,
    exitPrice: null,
    entryTimestamp: Date.now(),
    exitTimestamp: null,
    poolAddress: poolData.poolAddress || poolData.address || 'unknown',
    strategy: strategy,
    slippage: slippage
  };

  trades.push(trade);
  openPosition = trade;

  return trade;
}

/**
 * Simulates executing a SELL order
 */
function executeSell(poolData, amount, slippage, strategy) {
  if (!openPosition) {
    console.warn('[TradeSimulator] No open position to sell');
    return null;
  }

  const price = getExecutionPrice(poolData, amount, slippage, 'SELL');
  
  if (!price) {
    throw new Error('Unable to determine execution price for SELL');
  }

  openPosition.exitPrice = price;
  openPosition.exitTimestamp = Date.now();

  const trade = {
    ...openPosition,
    exitPrice: price,
    exitTimestamp: Date.now()
  };

  openPosition = null;

  return trade;
}

/**
 * Calculates PnL for a closed trade
 */
function calculatePnL(trade) {
  if (!trade.exitPrice) {
    return 0;
  }

  if (trade.type === 'BUY') {
    return (trade.exitPrice - trade.entryPrice) * trade.amount;
  } else {
    return (trade.entryPrice - trade.exitPrice) * trade.amount;
  }
}

/**
 * Gets performance summary
 */
function getPerformanceSummary() {
  const closedTrades = trades.filter(t => t.exitPrice !== null);
  const totalPnL = closedTrades.reduce((sum, trade) => sum + calculatePnL(trade), 0);
  const winRate = closedTrades.length > 0
    ? closedTrades.filter(t => calculatePnL(t) > 0).length / closedTrades.length
    : 0;
  const avgExecutionPrice = closedTrades.length > 0
    ? closedTrades.reduce((sum, t) => sum + t.entryPrice, 0) / closedTrades.length
    : 0;

  return {
    totalTrades: trades.length,
    closedTrades: closedTrades.length,
    openPosition: openPosition ? 1 : 0,
    totalPnL: totalPnL,
    winRate: winRate,
    averageExecutionPrice: avgExecutionPrice,
    trades: trades
  };
}

/**
 * Resets the trade ledger
 */
function resetTrades() {
  trades = [];
  openPosition = null;
  tradeCounter = 0;
}

module.exports = {
  executeBuy,
  executeSell,
  calculatePnL,
  getPerformanceSummary,
  resetTrades
};
