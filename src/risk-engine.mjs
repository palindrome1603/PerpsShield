/**
 * Cross-Asset Correlation Heat, True Net-Equity Buffer,
 * and Post-Payout Drawdown Lock Simulator.
 */

const CORRELATION_CLUSTERS = {
  // Risk-on / Macro beta cluster
  BTC: 'RISK_ON',
  ETH: 'RISK_ON',
  SOL: 'RISK_ON',
  NQ: 'RISK_ON',
  ES: 'RISK_ON',
  NVDA: 'RISK_ON',
  TSLA: 'RISK_ON',
  // Safe-haven / inverse USD cluster
  XAU: 'METALS',
  XAG: 'METALS',
  EURUSD: 'FX_ANTI_USD',
  GBPUSD: 'FX_ANTI_USD',
};

/**
 * Extract normalized cluster key from a MyFundedPerps instrument symbol
 * (e.g. "binance|BTCUSDT" -> "RISK_ON").
 * @param {string} symbol
 */
export function getMacroCluster(symbol) {
  const upper = symbol.toUpperCase();
  for (const [ticker, cluster] of Object.entries(CORRELATION_CLUSTERS)) {
    if (upper.includes(ticker)) return cluster;
  }
  return 'OTHER';
}

/**
 * Compute true net-equity buffer after accrued funding, estimated fees, and slippage.
 * @param {object} account
 * @param {number} [account.equity]
 * @param {number} [account.lossFloor]
 * @param {number} [account.dailyLossLimit]
 * @param {number} [account.startOfDayEquity]
 * @param {number} [account.accruedFunding]
 * @param {number} [account.estimatedExitCosts]
 */
export function computeTrueNetBuffer({
  equity,
  lossFloor,
  dailyLossLimit,
  startOfDayEquity,
  accruedFunding = 0,
  estimatedExitCosts = 0,
}) {
  const trueNetEquity = equity - Math.abs(accruedFunding) - Math.abs(estimatedExitCosts);
  const staticBuffer = trueNetEquity - lossFloor;
  const dailyFloor = startOfDayEquity - dailyLossLimit;
  const dailyBuffer = trueNetEquity - dailyFloor;
  const bindingBuffer = Math.min(staticBuffer, dailyBuffer);
  const dailySafePct = dailyLossLimit > 0 ? Math.max(0, Math.min(100, (dailyBuffer / dailyLossLimit) * 100)) : 100;

  return {
    trueNetEquity: round2(trueNetEquity),
    staticBuffer: round2(staticBuffer),
    dailyBuffer: round2(dailyBuffer),
    bindingBuffer: round2(bindingBuffer),
    dailySafePct: round2(dailySafePct),
  };
}

/**
 * Detect correlated directional exposure across open positions.
 * @param {Array<{ symbol: string, side: 'long' | 'short', notional: number, stopLossRisk: number }>} positions
 * @param {number} bindingBuffer
 */
export function analyzeCorrelationHeat(positions, bindingBuffer) {
  const clusterRisk = new Map();

  for (const pos of positions) {
    const cluster = getMacroCluster(pos.symbol);
    const dir = pos.side === 'short' ? -1 : 1;
    const key = `${cluster}:${dir > 0 ? 'LONG' : 'SHORT'}`;
    const prev = clusterRisk.get(key) || { cluster, direction: dir > 0 ? 'LONG' : 'SHORT', symbols: [], combinedRisk: 0 };
    prev.symbols.push(pos.symbol);
    prev.combinedRisk += Math.abs(pos.stopLossRisk || pos.notional * 0.02);
    clusterRisk.set(key, prev);
  }

  const warnings = [];
  for (const entry of clusterRisk.values()) {
    const bufferRatio = bindingBuffer > 0 ? entry.combinedRisk / bindingBuffer : 1;
    if (entry.symbols.length >= 2 && bufferRatio >= 0.65) {
      warnings.push({
        cluster: entry.cluster,
        direction: entry.direction,
        symbols: entry.symbols,
        combinedRisk: round2(entry.combinedRisk),
        bufferSharePct: round2(bufferRatio * 100),
      });
    }
  }

  return warnings;
}

/**
 * Model safe R-multiple risk before vs. after the first payout permanently
 * locks the drawdown floor to the starting balance.
 * @param {object} params
 * @param {number} params.startingBalance
 * @param {number} params.currentEquity
 * @param {number} params.initialLossFloor
 * @param {number} params.payoutAmount
 * @param {number} [params.riskPerTradePctOfBuffer]
 */
export function simulatePostPayoutLock({
  startingBalance,
  currentEquity,
  initialLossFloor,
  payoutAmount,
  riskPerTradePctOfBuffer = 0.1,
}) {
  const prePayoutBuffer = Math.max(0, currentEquity - initialLossFloor);
  const postPayoutEquity = Math.max(0, currentEquity - payoutAmount);
  const lockedLossFloor = startingBalance;
  const postPayoutBuffer = Math.max(0, postPayoutEquity - lockedLossFloor);

  return {
    prePayoutBuffer: round2(prePayoutBuffer),
    postPayoutEquity: round2(postPayoutEquity),
    lockedLossFloor: round2(lockedLossFloor),
    postPayoutBuffer: round2(postPayoutBuffer),
    prePayoutMaxRiskPerTrade: round2(prePayoutBuffer * riskPerTradePctOfBuffer),
    postPayoutMaxRiskPerTrade: round2(postPayoutBuffer * riskPerTradePctOfBuffer),
    bufferShrinkPct: prePayoutBuffer > 0 ? round2(((prePayoutBuffer - postPayoutBuffer) / prePayoutBuffer) * 100) : 0,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
