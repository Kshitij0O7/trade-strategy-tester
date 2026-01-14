/**
 * Main entry point for the trading backtesting and monitoring tool
 * 
 * This tool consumes Bitquery DEXPool Protobuf Kafka stream, processes pool data,
 * executes trading strategies, and simulates trades.
 * 
 * Usage:
 *   1. Set environment variables (see .env.example)
 *   2. Run: npm start
 * 
 * Environment Variables:
 *   - KAFKA_USERNAME: Kafka SASL username (required)
 *   - KAFKA_PASSWORD: Kafka SASL password (required)
 *   - KAFKA_TOPIC: Kafka topic (default: ethereum.dexpool.proto)
 *   - TRADE_SIZE: Base trade size (default: 1.0)
 *   - SLIPPAGE_THRESHOLD_A: Slippage for Strategy A (default: 0.01 = 1%)
 *   - SLIPPAGE_THRESHOLD_B: Slippage for Strategy B (default: 0.005 = 0.5%)
 *   - SLOPE_THRESHOLD: Slope threshold for signals (default: -0.001 = -0.1%)
 *   - STRATEGY: Strategy to use 'A' or 'B' (default: 'A')
 */

const kafkaConsumer = require('./kafkaConsumer');
const protobufDecoder = require('./protobufDecoder');
const strategyEngine = require('./strategyEngine');
const tradeSimulator = require('./tradeSimulator');
const { config, validateConfig } = require('./config');

// Application state
let messageCount = 0;
let startTime = Date.now();
let performanceSummaryTimer = null;

// Performance summary interval (ms)
const PERFORMANCE_SUMMARY_INTERVAL = 60000; // 1 minute

/**
 * Handles incoming Kafka messages
 */
async function handleMessage(message) {
  try {
    messageCount++;

    const decodedMessage = protobufDecoder.decodeMessage(message.value);
    
    // Handle timestamp safely - Kafka timestamp can be a string or number
    let timestamp;
    try {
      if (message.timestamp && typeof message.timestamp === 'string') {
        timestamp = new Date(parseInt(message.timestamp)).toISOString();
      } else if (message.timestamp) {
        timestamp = new Date(message.timestamp).toISOString();
      } else {
        timestamp = new Date().toISOString();
      }
    } catch (e) {
      timestamp = new Date().toISOString();
    }

    const strategyResult = strategyEngine.processPoolData(decodedMessage);

    if (!strategyResult) {
      // Message was filtered out (not USDT/WETH pool) or extraction failed
      return;
    }

    const { poolData, slope, deltaSlope, signal } = strategyResult;

    // Only log if we have valid pool data
    if (poolData && poolData.poolAddress !== 'unknown') {
      const directionLabel = poolData.isWETHtoUSDT ? 'WETH->USDT' : (poolData.isUSDTtoWETH ? 'USDT->WETH' : poolData.direction);
      const slopeStr = slope !== null ? slope.toFixed(6) : 'N/A';
      const deltaSlopeStr = deltaSlope !== null ? deltaSlope.toFixed(6) : 'N/A';
      console.log(`[${timestamp}] Pool: ${poolData.poolAddress}, Direction: ${directionLabel}, Slope: ${slopeStr}, ΔSlope: ${deltaSlopeStr}`);
    } else {
      // Debug: Log when pool address is unknown
      console.warn(`[App] Pool address is unknown. Message keys: ${Object.keys(decodedMessage).slice(0, 10).join(', ')}`);
    }

    if (signal) {
      await executeStrategy(signal, poolData, slope, deltaSlope);
    }

  } catch (error) {
    console.error('[App] Error handling message:', error);
  }
}

/**
 * Executes trading strategy based on signal
 */
async function executeStrategy(signal, poolData, slope, deltaSlope) {
  const strategy = config.trading.strategy;
  const slippage = strategyEngine.getSlippageThreshold(strategy);
  const tradeSize = config.trading.tradeSize;

  console.log(`[Strategy] ${signal} signal detected (Strategy ${strategy}, Slope: ${slope?.toFixed(6)}, ΔSlope: ${deltaSlope?.toFixed(6)})`);

  try {
    if (signal === 'BUY') {
      if (strategy === 'A') {
        const trade = tradeSimulator.executeBuy(poolData, tradeSize, slippage, strategy);
        console.log(`[Trade] BUY executed: ID=${trade.id}, Amount=${trade.amount}, Price=${trade.entryPrice?.toFixed(6)}, Slippage=${slippage}`);
      } else if (strategy === 'B') {
        const chunkCount = strategyEngine.getChunkCount();
        const chunkSize = tradeSize / chunkCount;

        for (let i = 0; i < chunkCount; i++) {
          const trade = tradeSimulator.executeBuy(poolData, chunkSize, slippage, strategy);
          console.log(`[Trade] BUY chunk ${i + 1}/${chunkCount}: ID=${trade.id}, Amount=${trade.amount}, Price=${trade.entryPrice?.toFixed(6)}, Slippage=${slippage}`);
        }
      }
    } else if (signal === 'SELL') {
      if (strategy === 'A') {
        const trade = tradeSimulator.executeSell(poolData, tradeSize, slippage, strategy);
        if (trade) {
          const pnl = tradeSimulator.calculatePnL(trade);
          console.log(`[Trade] SELL executed: ID=${trade.id}, Entry=${trade.entryPrice?.toFixed(6)}, Exit=${trade.exitPrice?.toFixed(6)}, PnL=${pnl.toFixed(6)}`);
        }
      } else if (strategy === 'B') {
        const chunkCount = strategyEngine.getChunkCount();
        const chunkSize = tradeSize / chunkCount;

        for (let i = 0; i < chunkCount; i++) {
          const trade = tradeSimulator.executeSell(poolData, chunkSize, slippage, strategy);
          if (trade) {
            const pnl = tradeSimulator.calculatePnL(trade);
            console.log(`[Trade] SELL chunk ${i + 1}/${chunkCount}: ID=${trade.id}, Entry=${trade.entryPrice?.toFixed(6)}, Exit=${trade.exitPrice?.toFixed(6)}, PnL=${pnl.toFixed(6)}`);
          }
        }
      }
    }
  } catch (error) {
    console.error(`[Strategy] Error executing ${signal}:`, error);
  }
}

/**
 * Logs performance summary
 */
function logPerformanceSummary() {
  const summary = tradeSimulator.getPerformanceSummary();
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  console.log('\n=== Performance Summary ===');
  console.log(`Uptime: ${uptime}s`);
  console.log(`Messages processed: ${messageCount}`);
  console.log(`Total trades: ${summary.totalTrades}`);
  console.log(`Closed trades: ${summary.closedTrades}`);
  console.log(`Open position: ${summary.openPosition}`);
  console.log(`Total PnL: ${summary.totalPnL.toFixed(6)}`);
  console.log(`Win rate: ${(summary.winRate * 100).toFixed(2)}%`);
  console.log(`Average execution price: ${summary.averageExecutionPrice.toFixed(6)}`);
  console.log('========================\n');
}

/**
 * Shuts down the application gracefully
 */
async function shutdown() {
  if (performanceSummaryTimer) {
    clearInterval(performanceSummaryTimer);
  }

  logPerformanceSummary();

  await kafkaConsumer.shutdownKafka();

  console.log('[App] Shutdown complete');
}

/**
 * Starts the application
 */
async function start() {
  try {
    validateConfig();
    console.log('[App] Configuration validated');
    // console.log(config.kafka.topic);
    await protobufDecoder.initializeDecoder(config.kafka.topic);
    await kafkaConsumer.initializeKafka(config);
    strategyEngine.initializeStrategy(config);

    console.log('[App] All components initialized');

    const emitter = kafkaConsumer.getKafkaEmitter();
    emitter.on('message', handleMessage);
    emitter.on('error', (error) => {
      console.error('[App] Kafka error:', error);
    });

    await kafkaConsumer.startConsuming();
    console.log('[App] Started consuming messages');

    performanceSummaryTimer = setInterval(() => {
      logPerformanceSummary();
    }, PERFORMANCE_SUMMARY_INTERVAL);

    process.on('SIGINT', async () => {
      console.log('\n[App] Shutting down...');
      await shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n[App] Shutting down...');
      await shutdown();
      process.exit(0);
    });

  } catch (error) {
    console.error('[App] Fatal error:', error);
    await shutdown();
    process.exit(1);
  }
}

// Start the application
start().catch(error => {
  console.error('[App] Failed to start:', error);
  process.exit(1);
});
