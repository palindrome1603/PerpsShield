import { randomUUID } from 'node:crypto';

const DEFAULT_BASE_URL = 'https://developers.myfundedperpetuals.com/v1';
const DEFAULT_WS_URL = 'wss://account-stream.myfundedperpetuals.com/v1/stream';

/**
 * Sleep helper for Retry-After and WebSocket reconnect backoff.
 * @param {number} ms
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse Retry-After header (seconds or HTTP-date) into milliseconds.
 * @param {string | null} headerValue
 * @param {number} fallbackMs
 */
export function parseRetryAfterMs(headerValue, fallbackMs = 1000) {
  if (!headerValue) return fallbackMs;
  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const targetTime = Date.parse(headerValue);
  if (!Number.isNaN(targetTime)) {
    return Math.max(0, targetTime - Date.now());
  }
  return fallbackMs;
}

/**
 * MyFundedPerps REST + WebSocket client.
 * Enforces Idempotency-Key on mutations and Retry-After backoff on 429/503.
 */
export class MyFundedPerpsClient {
  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} [options.baseUrl]
   * @param {string} [options.wsUrl]
   * @param {typeof fetch} [options.fetchImpl]
   */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, wsUrl = DEFAULT_WS_URL, fetchImpl = fetch }) {
    if (!apiKey) {
      throw new Error('FP_API_KEY is required (use a sandbox fp_test_ key for testing).');
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.wsUrl = wsUrl;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Perform a REST request with automatic 429/503 Retry-After backoff
   * and stable Idempotency-Key reuse across retries.
   * @param {string} path
   * @param {object} [options]
   */
  async request(path, { method = 'GET', body, idempotencyKey, maxRetries = 3 } = {}) {
    const isMutation = method !== 'GET' && method !== 'HEAD';
    const key = isMutation ? idempotencyKey || randomUUID() : undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const headers = {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      };
      if (key) {
        headers['Idempotency-Key'] = key;
      }

      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429 || res.status === 503) {
        if (attempt === maxRetries) {
          throw new Error(`MyFundedPerps API ${res.status} after ${maxRetries} retries on ${path}`);
        }
        const waitMs = parseRetryAfterMs(res.headers?.get?.('retry-after'), 1500 * (attempt + 1));
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`MyFundedPerps API ${res.status} on ${method} ${path}: ${text}`);
      }

      return res.json();
    }
  }

  getAccounts() {
    return this.request('/accounts');
  }

  getMarkets() {
    return this.request('/markets');
  }

  getMarketQuote(symbol, side, size) {
    const params = new URLSearchParams({ symbol, side, size: String(size) });
    return this.request(`/markets/quote?${params.toString()}`);
  }

  cancelOrder(orderId, idempotencyKey) {
    return this.request(`/orders/${encodeURIComponent(orderId)}`, {
      method: 'DELETE',
      idempotencyKey,
    });
  }

  /**
   * Connect to the authenticated Account WebSocket stream instead of polling.
   * Automatically reconnects with exponential backoff on disconnect.
   * @param {(event: any) => void} onEvent
   * @param {(err: Error) => void} [onError]
   */
  connectAccountStream(onEvent, onError = () => {}) {
    let closedByUser = false;
    let reconnectAttempt = 0;
    let activeSocket = null;

    const connect = () => {
      if (closedByUser) return;

      const ws = new WebSocket(this.wsUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      activeSocket = ws;

      ws.addEventListener('open', () => {
        reconnectAttempt = 0;
        onEvent({ type: 'stream_connected', timestamp: new Date().toISOString() });
      });

      ws.addEventListener('message', (msg) => {
        try {
          const parsed = JSON.parse(String(msg.data));
          onEvent(parsed);
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      });

      ws.addEventListener('error', () => {
        onError(new Error('WebSocket stream error'));
      });

      ws.addEventListener('close', async () => {
        if (closedByUser) return;
        const delayMs = Math.min(30000, 1000 * 2 ** reconnectAttempt);
        reconnectAttempt += 1;
        await sleep(delayMs);
        connect();
      });
    };

    connect();

    return () => {
      closedByUser = true;
      activeSocket?.close();
    };
  }
}
