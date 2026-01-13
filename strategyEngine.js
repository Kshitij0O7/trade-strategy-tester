/**
 * Strategy engine module
 * Implements trading strategies based on slope calculations from DEXPool data
 */

// Shared state
const priceHistory = new Map();
const slopeHistory = new Map();
const maxHistorySize = 100;
let config = null;

/**
 * Initializes the strategy engine with configuration
 */
function initializeStrategy(cfg) {
  config = cfg;
}

/**
 * Extracts relevant pool data from decoded Protobuf message
 * Based on actual message structure:
 * - Pool.SmartContract (pool address)
 * - PoolPriceTable.AtoBPrices (array of price buckets)
 * - TransactionHeader.Time (timestamp)
 */
function extractPoolData(decodedMessage) {
  try {
    // Extract pool address from Pool.SmartContract
    const poolAddress = decodedMessage.Pool?.SmartContract || 
                       decodedMessage.pool?.smartContract ||
                       decodedMessage.poolAddress || 
                       'unknown';

    // Extract timestamp from TransactionHeader.Time
    let timestamp = Date.now();
    if (decodedMessage.TransactionHeader?.Time) {
      const timeObj = decodedMessage.TransactionHeader.Time;
      // Handle long integer format with low and high
      if (timeObj.low !== undefined && timeObj.high !== undefined) {
        // Combine low and high to get full timestamp (milliseconds since epoch)
        // High part is multiplied by 2^32 (4294967296)
        timestamp = timeObj.low + (timeObj.high * 4294967296);
      } else if (typeof timeObj === 'string' || typeof timeObj === 'number') {
        timestamp = typeof timeObj === 'string' ? parseInt(timeObj) : timeObj;
      }
    }

    // Extract liquidity
    const liquidity = decodedMessage.Liquidity?.AmountCurrencyA || 
                     decodedMessage.liquidity?.amountCurrencyA ||
                     0;

    // Extract price table - use AtoBPrices for A->B direction
    const priceTable = decodedMessage.PoolPriceTable || decodedMessage.poolPriceTable || {};
    const atoBPrices = priceTable.AtoBPrices || priceTable.atoBPrices || [];
    const btoAPrices = priceTable.BtoAPrices || priceTable.btoAPrices || [];

    // Build prices object from AtoBPrices array
    const prices = {};
    atoBPrices.forEach(bucket => {
      const bp = bucket.SlippageBasisPoints || bucket.slippageBasisPoints || 0;
      const price = bucket.Price || bucket.price || null;
      if (price !== null && price !== undefined) {
        prices[bp] = price;
      }
    });

    const poolData = {
      poolAddress: poolAddress,
      token0: decodedMessage.Pool?.CurrencyA || decodedMessage.pool?.currencyA || {},
      token1: decodedMessage.Pool?.CurrencyB || decodedMessage.pool?.currencyB || {},
      liquidity: liquidity,
      timestamp: timestamp,
      slippageBuckets: atoBPrices, // Use AtoBPrices as slippage buckets
      prices: prices
    };

    return poolData;
  } catch (error) {
    console.error('[StrategyEngine] Error extracting pool data:', error);
    return null;
  }
}

/**
 * Calculates slope from slippage buckets
 * slope = (Price_1% − Price_0.1%) / Price_0.1%
 */
function calculateSlope(poolData) {
  const prices = poolData.prices || {};
  
  const price01 = prices[10] || prices['10'];
  const price1 = prices[100] || prices['100'];

  let price01Value = price01;
  let price1Value = price1;

  if (!price01Value || !price1Value) {
    const basisPoints = Object.keys(prices).map(k => parseInt(k)).sort((a, b) => a - b);
    
    if (!price01Value && basisPoints.length > 0) {
      const closest01 = basisPoints.reduce((closest, bp) => 
        Math.abs(bp - 10) < Math.abs(closest - 10) ? bp : closest
      );
      price01Value = prices[closest01];
    }

    if (!price1Value && basisPoints.length > 0) {
      const closest1 = basisPoints.reduce((closest, bp) => 
        Math.abs(bp - 100) < Math.abs(closest - 100) ? bp : closest
      );
      price1Value = prices[closest1];
    }
  }

  if (!price01Value || !price1Value || price01Value === 0) {
    return null;
  }

  const slope = (price1Value - price01Value) / price01Value;
  return slope;
}

/**
 * Calculates delta slope (change in slope over time)
 */
function calculateDeltaSlope(poolAddress, currentSlope) {
  const history = slopeHistory.get(poolAddress) || [];
  
  if (history.length === 0) {
    return null;
  }

  const lastSlope = history[history.length - 1].slope;
  return currentSlope - lastSlope;
}

/**
 * Updates price and slope history for a pool
 */
function updateHistory(poolData, slope) {
  const poolAddress = poolData.poolAddress;
  const timestamp = poolData.timestamp || Date.now();

  if (!slopeHistory.has(poolAddress)) {
    slopeHistory.set(poolAddress, []);
  }

  const history = slopeHistory.get(poolAddress);
  const deltaSlope = history.length > 0 
    ? slope - history[history.length - 1].slope
    : 0;

  history.push({
    timestamp,
    slope,
    deltaSlope
  });

  if (history.length > maxHistorySize) {
    history.shift();
  }
}

/**
 * Generates trading signal based on slope and delta slope
 */
function generateSignal(slope, deltaSlope) {
  if (slope === null || deltaSlope === null) {
    return null;
  }

  const threshold = config.trading.slopeThreshold;

  // BUY when slope decreases AND slope below threshold
  if (deltaSlope < 0 && slope < threshold) {
    return 'BUY';
  }

  // SELL when slope increases OR slope above threshold
  if (deltaSlope > 0 || slope > threshold) {
    return 'SELL';
  }

  return null;
}

/**
 * Processes pool data and generates trading signal
 */
function processPoolData(decodedMessage) {
  const poolData = extractPoolData(decodedMessage);
  
  if (!poolData) {
    return null;
  }

  const slope = calculateSlope(poolData);
  
  if (slope === null) {
    return {
      poolData,
      slope: null,
      deltaSlope: null,
      signal: null
    };
  }

  const deltaSlope = calculateDeltaSlope(poolData.poolAddress, slope);
  updateHistory(poolData, slope);

  const signal = generateSignal(slope, deltaSlope);

  return {
    poolData,
    slope,
    deltaSlope,
    signal
  };
}

/**
 * Gets the slippage threshold for a strategy
 */
function getSlippageThreshold(strategy) {
  if (strategy === 'B') {
    return config.trading.slippageThresholdB;
  }
  return config.trading.slippageThresholdA;
}

/**
 * Gets the number of chunks for Strategy B
 */
function getChunkCount() {
  return 2;
}

module.exports = {
  initializeStrategy,
  processPoolData,
  getSlippageThreshold,
  getChunkCount
};
