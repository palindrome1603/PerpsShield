#!/usr/bin/env node
import { MyFundedPerpsClient } from './client.mjs';
import { getActiveNewsStatus, getDemoMacroEvents } from './news-radar.mjs';
import { analyzeCorrelationHeat, computeTrueNetBuffer, simulatePostPayoutLock } from './risk-engine.mjs';

const command = process.argv[2] || 'demo';

async function sendWebhookAlert(message) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message, text: message }),
  }).catch(() => {});
}

function runDemo() {
  console.log('\n🛡️  PerpShield v0.1.0 — Funded Perp Execution Firewall (Demo Mode)\n');

  const account = {
    equity: 102650,
    startOfDayEquity: 102000,
    lossFloor: 96000,
    dailyLossLimit: 3060,
    accruedFunding: 42.8,
    estimatedExitCosts: 188.6,
  };

  const buffer = computeTrueNetBuffer(account);
  console.log('1) True Net-Equity Buffer (Fee & Funding Adjusted):');
  console.log(`   True Net Equity : $${buffer.trueNetEquity.toLocaleString()}`);
  console.log(`   Binding Buffer  : $${buffer.bindingBuffer.toLocaleString()} (${buffer.dailySafePct}% Daily Loss Limit Safe)\n`);

  const news = getActiveNewsStatus(getDemoMacroEvents());
  console.log('2) Red-Folder News Blackout Radar (America/New_York):');
  console.log(`   Status          : ${news.status} — ${news.event?.title} in ${news.minutesToEvent}m\n`);

  const positions = [
    { symbol: 'binance|BTCUSDT', side: 'long', notional: 45000, stopLossRisk: 1150 },
    { symbol: 'bybit|NQ100', side: 'long', notional: 40000, stopLossRisk: 1050 },
  ];
  const warnings = analyzeCorrelationHeat(positions, buffer.bindingBuffer);
  console.log('3) Cross-Asset Correlation Heat:');
  if (warnings.length === 0) {
    console.log('   No correlated cluster breaches detected.\n');
  } else {
    for (const w of warnings) {
      console.log(`   ⚠️  ${w.cluster} (${w.direction}): ${w.symbols.join(' + ')} = $${w.combinedRisk} combined risk (${w.bufferSharePct}% of binding buffer)\n`);
    }
  }

  const lockSim = simulatePostPayoutLock({
    startingBalance: 100000,
    currentEquity: 106000,
    initialLossFloor: 96000,
    payoutAmount: 4000,
  });
  console.log('4) Post-Payout Drawdown Lock Simulator:');
  console.log(`   Pre-Payout Buffer  : $${lockSim.prePayoutBuffer} (Max 10% risk/trade: $${lockSim.prePayoutMaxRiskPerTrade})`);
  console.log(`   Post-Payout Buffer : $${lockSim.postPayoutBuffer} (Floor locked at $${lockSim.lockedLossFloor} -> -${lockSim.bufferShrinkPct}% buffer)\n`);
}

async function runWatch() {
  const apiKey = process.env.FP_API_KEY;
  if (!apiKey) {
    console.error('❌ FP_API_KEY not set. Copy .env.example to .env with your fp_test_ sandbox key, or run `npm run demo`.');
    process.exit(1);
  }

  const client = new MyFundedPerpsClient({
    apiKey,
    baseUrl: process.env.FP_BASE_URL,
    wsUrl: process.env.FP_WS_URL,
  });

  console.log('🛡️  PerpShield connecting to MyFundedPerps REST & Account WebSocket...');
  const accounts = await client.getAccounts();
  console.log(`Loaded ${Array.isArray(accounts?.data) ? accounts.data.length : 0} account(s). Starting stream...`);

  const stopStream = client.connectAccountStream(
    async (event) => {
      const news = getActiveNewsStatus(getDemoMacroEvents());
      if (news.status === 'ENTRY_LOCK' || news.status === 'HARD_LOCK') {
        const alertMsg = `🚨 PerpShield ${news.status}: ${news.event?.title} in ${news.minutesToEvent}m!`;
        console.warn(alertMsg);
        await sendWebhookAlert(alertMsg);
      }
      console.log(`[WS ${new Date().toISOString()}]`, event.type || 'account_event');
    },
    (err) => {
      console.error('[WS Error]', err.message);
    }
  );

  process.on('SIGINT', () => {
    console.log('\nShutting down PerpShield stream...');
    stopStream();
    process.exit(0);
  });
}

if (command === 'watch') {
  await runWatch();
} else {
  runDemo();
}
