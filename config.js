/**
 * Configuration module for the trading backtesting tool
 * Loads configuration from environment variables with sensible defaults
 */

const dotenv = require('dotenv');

dotenv.config();

/**
 * Application configuration object
 * @typedef {Object} Config
 * @property {string} kafkaUsername - Kafka SASL username
 * @property {string} kafkaPassword - Kafka SASL password
 * @property {string[]} kafkaBrokers - Array of Kafka broker addresses
 * @property {string} kafkaTopic - Kafka topic to subscribe to
 * @property {number} tradeSize - Base trade size in token units
 * @property {number} slippageThresholdA - Slippage for Strategy A (as decimal, e.g., 0.01 = 1%)
 * @property {number} slippageThresholdB - Slippage for Strategy B (as decimal, e.g., 0.005 = 0.5%)
 * @property {number} slopeThreshold - Slope threshold for BUY/SELL signals
 * @property {string} strategy - Strategy to use ('A' or 'B')
 */

const config = {
  kafka: {
    username: process.env.KAFKA_USERNAME || '',
    password: process.env.KAFKA_PASSWORD || '',
    brokers: [
          'rpk0.bitquery.io:9092',
          'rpk1.bitquery.io:9092',
          'rpk2.bitquery.io:9092'
        ],
    topic: "eth.dexpools.proto",
    sasl: {
      mechanism: 'scram-sha-512'
    }
  },
  trading: {
    tradeSize: parseFloat('1.0'),
    slippageThresholdA: parseFloat('0.01'), // 1%
    slippageThresholdB: parseFloat('0.005'), // 0.5%
    slopeThreshold: parseFloat('-0.001'), // -0.1%
    strategy: 'A' // 'A' or 'B'
  }
};

/**
 * Validates that required configuration is present
 * @throws {Error} If required configuration is missing
 */
function validateConfig() {
  if (!config.kafka.username || !config.kafka.password) {
    throw new Error('KAFKA_USERNAME and KAFKA_PASSWORD must be set');
  }
  if (!config.kafka.topic) {
    throw new Error('KAFKA_TOPIC must be set');
  }
}

module.exports = {
  config,
  validateConfig
};
