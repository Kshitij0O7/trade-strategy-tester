/**
 * Kafka consumer module for Bitquery DEXPool stream
 * Handles connection, authentication, and message consumption
 * 
 * Based on official Bitquery documentation:
 * https://docs.bitquery.io/docs/streams/protobuf/kafka-protobuf-js/
 */

const { Kafka } = require("kafkajs");
const bs58 = require("bs58");
const { loadProto } = require("bitquery-protobuf-schema");
const { CompressionTypes, CompressionCodecs } = require("kafkajs");
const LZ4 = require("kafkajs-lz4");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require('events');

CompressionCodecs[CompressionTypes.LZ4] = new LZ4().codec;

// Shared state
let kafka = null;
let consumer = null;
let consumerGroupId = null;
let running = false;
let config = null;
const emitter = new EventEmitter();

/**
 * Initializes the Kafka client and consumer
 */
async function initializeKafka(kafkaConfig) {
  config = kafkaConfig;
  consumerGroupId = `${config.kafka.username}-${uuidv4()}`;
  
  try {
    kafka = new Kafka({
      clientId: config.kafka.username,
      brokers: config.kafka.brokers,
      sasl: {
        mechanism: config.kafka.sasl.mechanism,
        username: config.kafka.username,
        password: config.kafka.password
      },
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });

    consumer = kafka.consumer({groupId: consumerGroupId});

    consumer.on(consumer.events.DISCONNECT, () => {
      console.log('[KafkaConsumer] Disconnected from Kafka');
      emitter.emit('disconnect');
    });

    consumer.on(consumer.events.CONNECT, () => {
      console.log('[KafkaConsumer] Connected to Kafka');
      emitter.emit('connect');
    });

    consumer.on(consumer.events.CRASH, ({ error }) => {
      console.error('[KafkaConsumer] Consumer crashed:', error);
      emitter.emit('error', error);
    });

    console.log(`[KafkaConsumer] Initialized with consumer group ID: ${consumerGroupId}`);
  } catch (error) {
    throw new Error(`Failed to initialize Kafka consumer: ${error.message}`);
  }
}

/**
 * Connects to Kafka and subscribes to the topic
 */
async function connectKafka() {
  if (!consumer) {
    await initializeKafka(config);
  }

  try {
    await consumer.connect();
    console.log(config.kafka.topic);
    await consumer.subscribe({
      topic: config.kafka.topic,
      fromBeginning: false
    });

    console.log(`[KafkaConsumer] Subscribed to topic: ${config.kafka.topic}`);
    running = true;
  } catch (error) {
    throw new Error(`Failed to connect to Kafka: ${error.message}`);
  }
}

/**
 * Starts consuming messages and emits 'message' events
 */
async function startConsuming(onMessage) {
  if (!running) {
    await connectKafka();
  }

  try {
    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const timestamp = message.timestamp;
          const offset = message.offset;
          const value = message.value;

          if (!value) {
            console.warn('[KafkaConsumer] Received message with no value');
            return;
          }

          const msg = {
            topic,
            partition,
            offset,
            timestamp,
            value: value
          };

          emitter.emit('message', msg);
          if (onMessage) {
            onMessage(msg);
          }
        } catch (error) {
          console.error('[KafkaConsumer] Error processing message:', error);
          emitter.emit('error', error);
        }
      }
    });
  } catch (error) {
    throw new Error(`Failed to start consuming messages: ${error.message}`);
  }
}

/**
 * Disconnects from Kafka
 */
async function disconnectKafka() {
  running = false;
  if (consumer) {
    try {
      await consumer.disconnect();
      console.log('[KafkaConsumer] Disconnected from Kafka');
    } catch (error) {
      console.error('[KafkaConsumer] Error disconnecting:', error);
    }
  }
}

/**
 * Gracefully shuts down the consumer
 */
async function shutdownKafka() {
  await disconnectKafka();
}

/**
 * Get the event emitter for listening to events
 */
function getKafkaEmitter() {
  return emitter;
}

module.exports = {
  initializeKafka,
  connectKafka,
  startConsuming,
  disconnectKafka,
  shutdownKafka,
  getKafkaEmitter
};
