/**
 * Strategy engine module
 * Implements trading strategies based on slope calculations from DEXPool data
 */

// Shared state
const priceHistory = new Map();
const slopeHistory = new Map();
const maxHistorySize = 100;
let config = null;

// Supported token addresses (USDT and WETH)
const USDT_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

/**
 * Checks if a token address matches USDT or WETH
 */
function isSupportedToken(address) {
  if (!address) return false;
  const addr = address.toLowerCase();
  return addr === USDT_ADDRESS.toLowerCase() || addr === WETH_ADDRESS.toLowerCase();
}

/**
 * Initializes the strategy engine with configuration
 */
function initializeStrategy(cfg) {
  config = cfg;
}

/**
 * Extracts relevant pool data from decoded Protobuf message
 * Filters for USDT/WETH pools only
 * Based on actual message structure:
 * - Pool.SmartContract (pool address)
 * - Pool.CurrencyA and CurrencyB (token addresses)
 * - PoolPriceTable.AtoBPrices and BtoAPrices (direction-specific price buckets)
 * - TransactionHeader.Time (timestamp)
 */
function extractPoolData(decodedMessage) {
  try {
    // Extract pool currencies - try different possible field names (avoid optional chaining for compatibility)
    const pool = decodedMessage.Pool || decodedMessage.pool || {};
    const currencyA = pool.CurrencyA || pool.currencyA || {};
    const currencyB = pool.CurrencyB || pool.currencyB || {};
    
    const addressA = currencyA.SmartContract || currencyA.smartContract || (typeof currencyA === 'string' ? currencyA : '');
    const addressB = currencyB.SmartContract || currencyB.smartContract || (typeof currencyB === 'string' ? currencyB : '');

    // Filter: Only process pools with USDT/WETH pairs
    if (!isSupportedToken(addressA) || !isSupportedToken(addressB)) {
      return null; // Skip this pool - not USDT/WETH
    }

    // Determine direction based on token addresses
    // If A is WETH and B is USDT, we're trading WETH->USDT (AtoB)
    // If A is USDT and B is WETH, we're trading USDT->WETH (AtoB) but might want BtoA
    const isWETHtoUSDT = addressA.toLowerCase() === WETH_ADDRESS.toLowerCase() && 
                          addressB.toLowerCase() === USDT_ADDRESS.toLowerCase();
    const isUSDTtoWETH = addressA.toLowerCase() === USDT_ADDRESS.toLowerCase() && 
                          addressB.toLowerCase() === WETH_ADDRESS.toLowerCase();
    
    // Extract pool address from Pool.SmartContract
    const poolAddress = pool.SmartContract || pool.smartContract || decodedMessage.poolAddress || 'unknown';

    // Extract timestamp from TransactionHeader.Time
    let timestamp = Date.now();
    const txHeader = decodedMessage.TransactionHeader || decodedMessage.transactionHeader;
    if (txHeader && txHeader.Time) {
      const timeObj = txHeader.Time;
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
    const liquidity = (decodedMessage.Liquidity && decodedMessage.Liquidity.AmountCurrencyA) ||
                     (decodedMessage.liquidity && decodedMessage.liquidity.amountCurrencyA) ||
                     0;

    // Extract price table
    const priceTable = decodedMessage.PoolPriceTable || decodedMessage.poolPriceTable || {};
    const atoBPrices = priceTable.AtoBPrices || priceTable.atoBPrices || [];
    const btoAPrices = priceTable.BtoAPrices || priceTable.btoAPrices || [];

    // Determine direction and use appropriate price table
    // For WETH->USDT: use AtoBPrices
    // For USDT->WETH: use BtoAPrices (reverse direction)
    let direction = 'AtoB';
    let slippageBuckets = atoBPrices;
    
    if (isUSDTtoWETH) {
      direction = 'BtoA'; // We want WETH price in terms of USDT, so use BtoA
      slippageBuckets = btoAPrices;
    } else if (isWETHtoUSDT) {
      direction = 'AtoB'; // We want USDT price in terms of WETH, so use AtoB
      slippageBuckets = atoBPrices;
    }

    // Build prices object from the appropriate price array
    const prices = {};
    slippageBuckets.forEach(bucket => {
      const bp = bucket.SlippageBasisPoints || bucket.slippageBasisPoints || 0;
      const price = bucket.Price || bucket.price || null;
      if (price !== null && price !== undefined) {
        prices[bp] = price;
      }
    });

    const poolData = {
      poolAddress: poolAddress,
      tokenA: currencyA,
      tokenB: currencyB,
      addressA: addressA,
      addressB: addressB,
      liquidity: liquidity,
      timestamp: timestamp,
      direction: direction,
      slippageBuckets: slippageBuckets,
      prices: prices,
      isWETHtoUSDT: isWETHtoUSDT,
      isUSDTtoWETH: isUSDTtoWETH
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
    // Debug: Log why slope is null
    const priceCount = Object.keys(poolData.prices || {}).length;
    const bucketCount = (poolData.slippageBuckets || []).length;
    if (priceCount === 0 && bucketCount > 0) {
      console.warn(`[StrategyEngine] Slope is null: Found ${bucketCount} buckets but 0 prices extracted. Pool: ${poolData.poolAddress}`);
    } else if (bucketCount === 0) {
      console.warn(`[StrategyEngine] Slope is null: No slippage buckets found. Pool: ${poolData.poolAddress}`);
    }
    
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
