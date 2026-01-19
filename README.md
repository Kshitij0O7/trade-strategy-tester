# Strategy Tester - Real-time Trading Forwardtesting Tool

A real-time trading backtesting and monitoring tool that consumes Bitquery DEXPool Protobuf Kafka streams, processes pool data, and executes trading strategies based on slope calculations from slippage buckets.

## Features

- **Real-time Kafka Stream Consumption**: Connects to Bitquery Kafka streams using non-SSL authentication
- **Protobuf Message Decoding**: Decodes DEXPool messages from Bitquery streams
- **USDT/WETH Pool Filtering**: Only processes pools containing USDT and WETH pairs
- **Direction-aware Trading**: Uses direction information (AtoB/BtoA) to select appropriate price tables
- **Trading Strategies**: Implements two trading strategies based on slope calculations
  - **Strategy A**: Single large trade at a fixed slippage (default: 1%)
  - **Strategy B**: Split trade into chunks at smaller slippage (default: 0.5%)
- **Virtual Trade Simulation**: Simulates trades and maintains a virtual trade ledger
- **Performance Metrics**: Tracks PnL, win rate, and execution prices
- **Slope-based Signals**: Generates BUY/SELL signals based on price slope calculations

## Prerequisites

- **Node.js**: Version 14.x or higher (recommended: 18.x or higher)
- **npm**: Comes with Node.js
- **Bitquery Kafka Credentials**: Username and password from Bitquery
- **Bitquery Topic Access**: Access to the DEXPool Protobuf topic (e.g., `eth.dexpools.proto`)

## Installation

1. **Clone or download the project**

   ```bash
   cd strategy-tester
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

   This will install all required packages including:
   - `kafkajs` - Kafka client library
   - `bitquery-protobuf-schema` - Protobuf schema definitions
   - `kafkajs-lz4` - LZ4 compression support
   - `uuid` - UUID generation
   - `dotenv` - Environment variable management

## Configuration

1. **Create environment file**

   Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. **Configure your credentials**

   Edit the `.env` file with your Bitquery credentials:

   ```env
   # Kafka Configuration (REQUIRED)
   KAFKA_USERNAME=your_kafka_username
   KAFKA_PASSWORD=your_kafka_password
   KAFKA_TOPIC=eth.dexpools.proto

   # Trading Configuration (Optional - defaults shown)
   TRADE_SIZE=1.0
   SLIPPAGE_THRESHOLD_A=0.01
   SLIPPAGE_THRESHOLD_B=0.005
   SLOPE_THRESHOLD=-0.001
   STRATEGY=A
   ```

### Configuration Options

#### Kafka Configuration

- **KAFKA_USERNAME** (required): Your Bitquery Kafka SASL username
- **KAFKA_PASSWORD** (required): Your Bitquery Kafka SASL password
- **KAFKA_TOPIC** (required): Kafka topic name (e.g., `eth.dexpools.proto`)

#### Trading Configuration

- **TRADE_SIZE** (default: `1.0`): Base trade size in token units
- **SLIPPAGE_THRESHOLD_A** (default: `0.01`): Slippage tolerance for Strategy A (1% = 0.01)
- **SLIPPAGE_THRESHOLD_B** (default: `0.005`): Slippage tolerance for Strategy B (0.5% = 0.005)
- **SLOPE_THRESHOLD** (default: `-0.001`): Slope threshold for BUY/SELL signals (-0.1% = -0.001)
- **STRATEGY** (default: `A`): Strategy to use (`A` or `B`)

## Usage

### Starting the Application

1. **Ensure your `.env` file is configured** with your Kafka credentials

2. **Start the application**

   ```bash
   npm start
   ```

   The application will:
   - Validate configuration
   - Connect to Bitquery Kafka brokers
   - Load the Protobuf schema
   - Subscribe to the configured topic
   - Start consuming and processing messages

### What You'll See

The application logs:
- **Connection status**: Kafka connection and subscription confirmation
- **Pool data**: Real-time pool address, slope, and delta slope calculations
- **Trading signals**: BUY/SELL signals when detected
- **Trade execution**: Simulated trade execution details
- **Performance summary**: Periodic summary (every 60 seconds) showing:
  - Uptime
  - Messages processed
  - Total and closed trades
  - Total PnL
  - Win rate
  - Average execution price

### Example Output

```
[App] Configuration validated
[ProtobufDecoder] Loaded schema for topic: eth.dexpools.proto
[KafkaConsumer] Initialized with consumer group ID: username-uuid
[KafkaConsumer] Connected to Kafka
[KafkaConsumer] Subscribed to topic: eth.dexpools.proto
[App] Started consuming messages

[2026-01-12T12:15:22.612Z] Pool: 0xc3f5a24690b51857ff87e95586cad632e145555e, Direction: WETH->USDT, Slope: -0.001234, ΔSlope: -0.000045
[Strategy] BUY signal detected (Strategy A, Slope: -0.001234, ΔSlope: -0.000045)
[Trade] BUY executed: ID=trade-1234567890-1, Amount=1.0, Price=0.009650, Slippage=0.01

=== Performance Summary ===
Uptime: 60s
Messages processed: 1250
Total trades: 5
Closed trades: 2
Open position: 1
Total PnL: 0.001234
Win rate: 50.00%
Average execution price: 0.009650
========================
```

### Stopping the Application

Press `Ctrl+C` to gracefully shut down the application. It will:
- Stop consuming messages
- Display final performance summary
- Disconnect from Kafka
- Exit cleanly

## Project Structure

```
strategy-tester/
├── config.js              # Configuration loading and validation
├── kafkaConsumer.js       # Kafka connection and message consumption
├── protobufDecoder.js     # Protobuf message decoding
├── strategyEngine.js      # Trading strategy logic and slope calculations
├── tradeSimulator.js      # Virtual trade execution and ledger
├── index.js               # Main entry point and orchestration
├── package.json           # Dependencies and scripts
├── .env.example           # Example environment variables
├── .env                   # Your configuration (create from .env.example)
└── README.md              # This file
```

## How It Works

### 1. Message Consumption

The application connects to Bitquery Kafka streams and consumes Protobuf-encoded DEXPool messages in real-time.

### 2. Message Decoding

Protobuf messages are decoded into JavaScript objects, with bytes fields converted to hex strings (0x prefix for EVM chains).

### 3. Pool Data Extraction

The strategy engine extracts relevant data from each message:
- Pool address (`Pool.SmartContract`)
- Token addresses (`Pool.CurrencyA` and `CurrencyB`)
- **Filtering**: Only processes pools where both currencies are USDT (0xdac17f958d2ee523a2206206994597c13d831ec7) or WETH (0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2)
- **Direction detection**: Determines if trading WETH->USDT or USDT->WETH
- Liquidity information
- Slippage buckets from appropriate price table (`PoolPriceTable.AtoBPrices` or `BtoAPrices`) based on direction

### 4. Slope Calculation

For each pool, the engine calculates:
- **Slope**: `(Price_1% − Price_0.1%) / Price_0.1%`
- **ΔSlope**: Change in slope over time

### 5. Signal Generation

Trading signals are generated based on:
- **BUY**: When slope decreases AND slope is below threshold
- **SELL**: When slope increases OR slope is above threshold

### 6. Trade Execution

Trades are simulated using the configured strategy:
- **Strategy A**: Single trade at the specified slippage
- **Strategy B**: Trade split into 2 chunks at smaller slippage

## Troubleshooting

### Connection Issues

**Error: "Failed to connect to Kafka"**
- Verify your `KAFKA_USERNAME` and `KAFKA_PASSWORD` are correct
- Check that you have network access to Bitquery brokers
- Ensure the topic name is correct

**Error: "Failed to load Protobuf schema"**
- Verify the topic name matches an available Bitquery topic
- Check that `bitquery-protobuf-schema` package is installed correctly

### Message Processing Issues

**Error: "Invalid time value"**
- This has been fixed in the latest version
- If you still see this, ensure you're using the latest code

**No signals being generated**
- Check that the slope threshold is appropriate for your data
- Verify that pool messages contain valid `PoolPriceTable` data
- Adjust `SLOPE_THRESHOLD` if needed

### Performance Issues

**High memory usage**
- The application maintains price history for pools
- History is automatically limited to the last 100 entries per pool
- Consider reducing message processing if memory is constrained

## Development

### Code Style

The project uses:
- **CommonJS** modules (require/module.exports)
- **Simple functions** (no classes)
- **Async/await** for asynchronous operations

### Adding New Strategies

To add a new trading strategy:

1. Modify `strategyEngine.js` to add strategy-specific logic
2. Update `executeStrategy()` in `index.js` to handle the new strategy
3. Add strategy configuration options to `config.js` and `.env.example`

## License

ISC

## Support

For issues related to:
- **Bitquery Kafka access**: Contact Bitquery support
- **Application bugs**: Open an issue in the project repository
- **Configuration questions**: Review the configuration section above

## References

- [Bitquery Kafka Protobuf Streams Documentation](https://docs.bitquery.io/docs/streams/protobuf/kafka-protobuf-js/)
- [KafkaJS Documentation](https://kafka.js.org/)
- [Bitquery Protobuf Schema Package](https://www.npmjs.com/package/bitquery-protobuf-schema)
