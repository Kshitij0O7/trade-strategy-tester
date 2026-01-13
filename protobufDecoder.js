/**
 * Protobuf decoder module for Bitquery DEXPool messages
 * Handles loading and decoding Protobuf schemas from bitquery-protobuf-schema
 * 
 * Based on official Bitquery documentation:
 * https://docs.bitquery.io/docs/streams/protobuf/kafka-protobuf-js/
 */

const { loadProto } = require('bitquery-protobuf-schema');

// Shared state
let messageType = null;
let initialized = false;

/**
 * Converts a buffer to a hex string with 0x prefix (for EVM chains)
 */
function bufferToHex(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return '';
  }
  return '0x' + buffer.toString('hex');
}

/**
 * Initializes the decoder by loading the Protobuf schema
 */
async function initializeDecoder(topic) {
  try {
    messageType = await loadProto(topic);
    initialized = true;
    console.log(`[ProtobufDecoder] Loaded schema for topic: ${topic}`);
  } catch (error) {
    throw new Error(`Failed to load Protobuf schema for topic ${topic}: ${error.message}`);
  }
}

/**
 * Recursively converts bytes fields (Buffers) to hex strings with 0x prefix
 */
function convertBytesToHex(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => convertBytesToHex(item));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Buffer.isBuffer(value)) {
      result[key] = bufferToHex(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = convertBytesToHex(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Decodes a Kafka message buffer into a JavaScript object
 */
function decodeMessage(messageBuffer) {
  if (!initialized) {
    throw new Error('Decoder not initialized. Call initializeDecoder() first.');
  }

  try {
    // Step 1: Decode the buffer
    const decoded = messageType.decode(messageBuffer);
    
    // Step 2: Convert to object, keeping bytes as Buffer
    const obj = messageType.toObject(decoded, {
      bytes: Buffer,
      longs: String,
      enums: String,
      defaults: true,
      arrays: true,
      objects: true,
      oneofs: true
    });

    // Step 3: Convert Buffer fields to hex strings (with 0x prefix for EVM)
    return convertBytesToHex(obj);
  } catch (error) {
    throw new Error(`Failed to decode Protobuf message: ${error.message}`);
  }
}

module.exports = {
  initializeDecoder,
  decodeMessage
};
