import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEventWindow, getActiveNewsStatus } from '../src/news-radar.mjs';
import { analyzeCorrelationHeat, computeTrueNetBuffer, simulatePostPayoutLock } from '../src/risk-engine.mjs';
import { MyFundedPerpsClient, parseRetryAfterMs } from '../src/client.mjs';

test('news radar flags PREFLIGHT_WARN (-15m), ENTRY_LOCK (-10m), and HARD_LOCK (-2m to +2m)', () => {
  const base = Date.UTC(2026, 10, 26, 13, 30, 0);
  const cpi = { title: 'US CPI', impact: 'high', timestampUtc: new Date(base).toISOString() };

  assert.equal(evaluateEventWindow(cpi, base - 20 * 60000).status, 'CLEAR');
  assert.equal(evaluateEventWindow(cpi, base - 12 * 60000).status, 'PREFLIGHT_WARN');
  assert.equal(evaluateEventWindow(cpi, base - 8 * 60000).status, 'ENTRY_LOCK');
  assert.equal(evaluateEventWindow(cpi, base - 90 * 1000).status, 'HARD_LOCK');
  assert.equal(evaluateEventWindow(cpi, base + 90 * 1000).status, 'HARD_LOCK');
  assert.equal(evaluateEventWindow(cpi, base + 3 * 60000).status, 'CLEAR');

  const active = getActiveNewsStatus([cpi], base - 5 * 60000);
  assert.equal(active.status, 'ENTRY_LOCK');
});

test('true net buffer deducts funding and exit costs accurately', () => {
  const res = computeTrueNetBuffer({
    equity: 102000,
    startOfDayEquity: 102000,
    lossFloor: 96000,
    dailyLossLimit: 3000,
    accruedFunding: 50,
    estimatedExitCosts: 150,
  });

  assert.equal(res.trueNetEquity, 101800);
  assert.equal(res.dailyBuffer, 2800);
  assert.equal(res.bindingBuffer, 2800);
});

test('correlation heat detects multi-asset macro cluster risk exceeding 65% of buffer', () => {
  const warnings = analyzeCorrelationHeat(
    [
      { symbol: 'binance|BTCUSDT', side: 'long', notional: 50000, stopLossRisk: 1100 },
      { symbol: 'bybit|NQ100', side: 'long', notional: 40000, stopLossRisk: 1000 },
    ],
    2500
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].cluster, 'RISK_ON');
  assert.equal(warnings[0].combinedRisk, 2100);
});

test('post-payout drawdown lock simulator calculates buffer shrink', () => {
  const sim = simulatePostPayoutLock({
    startingBalance: 100000,
    currentEquity: 106000,
    initialLossFloor: 96000,
    payoutAmount: 4000,
  });

  assert.equal(sim.prePayoutBuffer, 10000);
  assert.equal(sim.postPayoutBuffer, 2000);
  assert.equal(sim.bufferShrinkPct, 80);
});

test('REST client reuses Idempotency-Key and honors Retry-After on 429', async () => {
  let calls = 0;
  const seenKeys = [];
  const fakeFetch = async (_url, init) => {
    calls += 1;
    seenKeys.push(init.headers['Idempotency-Key']);
    if (calls === 1) {
      return { status: 429, headers: new Headers({ 'retry-after': '0' }), ok: false };
    }
    return { status: 200, ok: true, json: async () => ({ ok: true }) };
  };

  const client = new MyFundedPerpsClient({ apiKey: 'fp_test_dummy', fetchImpl: fakeFetch });
  const result = await client.cancelOrder('ord_123');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.ok(seenKeys[0]);
  assert.equal(seenKeys[0], seenKeys[1]);
  assert.equal(parseRetryAfterMs('2'), 2000);
});
