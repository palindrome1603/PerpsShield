import { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Zap,
  Shield,
  TrendingUp,
  PlayCircle,
  AlertTriangle,
  Share2,
  BarChart3,
  CheckCircle2,
  Link2,
  Calculator,
  Brain,
  Upload,
  Copy,
  Download,
  X,
} from 'lucide-react';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'radar', label: 'News Radar' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'lock', label: 'Post-Payout Lock' },
  { id: 'mcp', label: 'MCP AI' },
];

const FOOTER_ITEMS = [
  { icon: ShieldCheck, label: 'Guard Against News Blackouts' },
  { icon: Link2, label: 'Detect Hidden Correlation Risk' },
  { icon: Calculator, label: 'Track True Net-Equity' },
  { icon: Brain, label: 'AI Fill Post-Mortems & Tilt Guard' },
  { icon: Upload, label: 'Shareable Execution Scorecards' },
];

const MCP_SNIPPET = `{
  "mcpServers": {
    "myfundedperps-readonly": {
      "url": "https://mcp.myfundedperpetuals.com",
      "transport": "oauth",
      "scope": "read-only"
    }
  }
}`;

function formatCountdown(timestampUtc) {
  if (!timestampUtc) return '--:--';
  const diffSec = Math.max(0, Math.floor((Date.parse(timestampUtc) - Date.now()) / 1000));
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

function downloadScorecardPng(data) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#050908';
  ctx.fillRect(0, 0, 1200, 630);

  const grad = ctx.createRadialGradient(600, 80, 40, 600, 80, 560);
  grad.addColorStop(0, 'rgba(16, 185, 129, 0.28)');
  grad.addColorStop(1, 'rgba(5, 9, 8, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1200, 630);

  ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, 1128, 558);

  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 28px Inter, sans-serif';
  ctx.fillText('PerpShield · Funded Execution Scorecard', 76, 102);

  ctx.fillStyle = '#f3f7f5';
  ctx.font = 'bold 120px Inter, sans-serif';
  ctx.fillText(`${data.executionScore}%`, 76, 280);

  ctx.fillStyle = '#94a39e';
  ctx.font = '26px Inter, sans-serif';
  ctx.fillText(`Account: ${data.connectedAccount}`, 76, 340);
  ctx.fillText(`True Net Buffer: $${data.buffer.bindingBuffer.toLocaleString()} (${data.buffer.dailySafePct}% DLL Safe)`, 76, 390);
  ctx.fillText(`News Blackout Guard: ${data.news.status}   ·   Tilt Guard: ${data.tiltStatus}`, 76, 440);

  ctx.fillStyle = '#64746e';
  ctx.font = '22px monospace';
  ctx.fillText('github.com/palindrome1603/PerpsShield', 76, 540);

  const link = document.createElement('a');
  link.download = 'perpshield-scorecard.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [state, setState] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [connectError, setConnectError] = useState('');
  const [copiedMcp, setCopiedMcp] = useState(false);

  const [lockInputs, setLockInputs] = useState({
    startingBalance: 100000,
    currentEquity: 106000,
    initialLossFloor: 96000,
    payoutAmount: 4000,
  });
  const [lockResult, setLockResult] = useState(null);

  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => {
        setState(d);
        setLockResult(d.payoutLock);
      })
      .catch(() => {});

    const es = new EventSource('/api/stream');
    es.onmessage = (ev) => {
      try {
        setState(JSON.parse(ev.data));
      } catch {}
    };
    return () => es.close();
  }, []);

  const handleCancelFlagged = async () => {
    await fetch('/api/orders/cancel-flagged', { method: 'POST' });
    const fresh = await fetch('/api/state').then((r) => r.json());
    setState(fresh);
  };

  const handleSimulateLock = async (next) => {
    setLockInputs(next);
    const res = await fetch('/api/simulate-lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).then((r) => r.json());
    setLockResult(res);
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    setConnectError('');
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: apiKeyInput }),
    });
    const data = await res.json();
    if (!res.ok) {
      setConnectError(data.error || 'Connection failed');
      return;
    }
    setApiKeyInput('');
    setConnectOpen(false);
    const fresh = await fetch('/api/state').then((r) => r.json());
    setState(fresh);
  };

  const buffer = state?.buffer || { bindingBuffer: 2487, dailySafePct: 81, trueNetEquity: 102487 };
  const news = state?.news || { status: 'ENTRY_LOCK', event: { title: 'US CPI (MoM & YoY)', timestampUtc: '' } };
  const restingOrders = state?.restingOrders || [];
  const positions = state?.positions || [];
  const warnings = state?.correlationWarnings || [];
  const ordersCleared = restingOrders.length === 0;
  const countdown = formatCountdown(news?.event?.timestampUtc);

  return (
    <>
      <div className="bg-grid" />
      <div className="bg-glow" />
      <div className="bg-arc" />

      <div className="container">
        <nav>
          <div className="brand">
            <div className="brand-icon">
              <ShieldCheck size={18} color="#34d399" />
            </div>
            PerpShield
          </div>

          <div className="nav-links">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="nav-right">
            <button type="button" className="sandbox-pill" onClick={() => setConnectOpen(true)}>
              <span className="dot-green" />
              {state?.mode === 'live' ? 'Live Connected' : 'fp_test_sandbox'}
            </button>
            <button type="button" className="btn-primary" onClick={() => setConnectOpen(true)}>
              {state?.mode === 'live' ? 'Switch Key' : 'Connect Key →'}
            </button>
          </div>
        </nav>

        {activeTab === 'overview' && (
          <>
            <section className="hero">
              <h1>
                Trade Smart. Stay Safe.
                <br />
                <span>With PerpShield.</span>
              </h1>
              <p>A real-time survival and execution co-pilot for funded perpetuals traders.</p>

              <div className="hero-pillars">
                <span><Zap size={14} color="#34d399" /> Real-Time Guards</span>
                <span><Shield size={14} color="#34d399" /> Risk Intelligence</span>
                <span><TrendingUp size={14} color="#34d399" /> Execution Analytics</span>
              </div>

              <div className="hero-actions">
                <button type="button" className="btn-primary" onClick={() => setActiveTab('radar')}>
                  Inspect News Radar →
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => state && downloadScorecardPng(state)}
                >
                  <PlayCircle size={15} /> Export Scorecard PNG
                </button>
              </div>
            </section>

            <section className="bento">
              <div className="col-stack">
                <div className={`card ${ordersCleared ? '' : 'card-alert'}`}>
                  <div className="card-header">
                    <div className="card-title">
                      <AlertTriangle size={16} color={ordersCleared ? '#34d399' : '#f87171'} />
                      News Guard
                    </div>
                    <span className={`badge ${ordersCleared ? 'badge-green' : 'badge-red'}`}>
                      {ordersCleared ? 'Protected' : news.status}
                    </span>
                  </div>
                  <div className="alert-headline" style={{ color: ordersCleared ? '#6ee7b7' : '#fca5a5' }}>
                    {ordersCleared ? 'Resting Orders Cleared' : news.event?.title || 'Red-Folder News Detected'}
                  </div>
                  <div className="subtext">
                    {ordersCleared
                      ? `Countdown ${countdown} · 0 resting orders exposed inside -10m/+2m blackout.`
                      : `In ${countdown} · Entry Lock (-10m/+2m) active. ${restingOrders.length} resting order(s) flagged.`}
                  </div>
                  <button
                    type="button"
                    className={`btn-card ${ordersCleared ? '' : 'btn-card-red'}`}
                    onClick={handleCancelFlagged}
                    disabled={ordersCleared}
                  >
                    {ordersCleared ? 'Blackout Safe ✓' : 'Cancel Flagged Orders →'}
                  </button>
                </div>

                <div className="card">
                  <div className="card-header">
                    <div className="card-title">
                      <Share2 size={16} color="#fbbf24" />
                      Correlation Risk
                    </div>
                    <span className={`badge ${warnings.length > 0 ? 'badge-amber' : 'badge-green'}`}>
                      {warnings.length > 0 ? 'Elevated' : 'Clear'}
                    </span>
                  </div>
                  <div className="subtext">Crypto + Nasdaq + FX</div>
                  <div className="big-num">
                    {warnings.length > 0 ? `${warnings[0].bufferSharePct}%` : '0.32'}{' '}
                    <small style={{ color: warnings.length > 0 ? '#fbbf24' : '#34d399' }}>
                      {warnings.length > 0 ? 'of DLL' : 'Low'}
                    </small>
                  </div>
                  <svg width="100%" height="36" viewBox="0 0 260 36" fill="none" style={{ margin: '4px 0' }}>
                    <defs>
                      <linearGradient id="amberFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d="M0 30 Q35 28 60 22 T120 20 T180 12 T230 15 L260 6 L260 36 L0 36 Z" fill="url(#amberFill)" />
                    <path d="M0 30 Q35 28 60 22 T120 20 T180 12 T230 15 L260 6" stroke="#fbbf24" strokeWidth="2" fill="none" />
                  </svg>
                  <div className="subtext">
                    {warnings.length > 0
                      ? `${warnings[0].symbols.join(' + ')} correlated (${warnings[0].direction})`
                      : 'Portfolio beta balanced across venues'}
                  </div>
                </div>
              </div>

              <div className="card card-center">
                <div className="card-header">
                  <div className="card-title">
                    <ShieldCheck size={17} color="#34d399" />
                    Live Protection
                  </div>
                  <div className="connected-tag">
                    <span className="dot-green" />
                    {state?.connectedAccount || 'MyFundedPerps · 100K Select'}
                  </div>
                </div>

                <div className="center-body">
                  <div className="ring-wrap">
                    <svg width="170" height="170" viewBox="0 0 170 170">
                      <defs>
                        <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#6ee7b7" />
                          <stop offset="100%" stopColor="#10b981" />
                        </linearGradient>
                      </defs>
                      <circle cx="85" cy="85" r="70" stroke="rgba(255,255,255,0.07)" strokeWidth="11" fill="none" />
                      <circle
                        cx="85"
                        cy="85"
                        r="70"
                        stroke="url(#ringGrad)"
                        strokeWidth="11"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray="439.8"
                        strokeDashoffset="35"
                        transform="rotate(-90 85 85)"
                      />
                    </svg>
                    <div className="ring-label">
                      <div className="score">{state?.executionScore || 98}%</div>
                      <div className="caption">Execution Score</div>
                      <div className="delta">↑ +2%</div>
                    </div>
                  </div>

                  <div className="status-list">
                    <div className="status-row">
                      <div className="status-left">
                        <CheckCircle2 size={16} color="#34d399" />
                        <span>Red-Folder News Guard</span>
                      </div>
                      <span className="status-val">{news.status}</span>
                    </div>
                    <div className="status-row">
                      <div className="status-left">
                        <CheckCircle2 size={16} color="#34d399" />
                        <span>Correlation Risk Monitor</span>
                      </div>
                      <span className="status-val">{warnings.length > 0 ? `${warnings.length} Alert` : 'Clear'}</span>
                    </div>
                    <div className="status-row">
                      <div className="status-left">
                        <CheckCircle2 size={16} color="#34d399" />
                        <div>
                          Net-Equity Buffer
                          <small>(After Fees &amp; Funding)</small>
                        </div>
                      </div>
                      <span className="status-val white">${buffer.bindingBuffer.toLocaleString()}</span>
                    </div>
                    <div className="status-row">
                      <div className="status-left">
                        <CheckCircle2 size={16} color="#34d399" />
                        <span>Tilt &amp; Execution Health</span>
                      </div>
                      <span className="status-val">{state?.tiltStatus || 'Clear'}</span>
                    </div>
                  </div>
                </div>

                <svg width="100%" height="44" viewBox="0 0 560 44" fill="none">
                  <defs>
                    <linearGradient id="emeraldWave" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d="M0 34 Q45 14 95 26 T190 22 T285 28 T380 18 T475 24 T560 12 L560 44 L0 44 Z" fill="url(#emeraldWave)" />
                  <path d="M0 34 Q45 14 95 26 T190 22 T285 28 T380 18 T475 24 T560 12" stroke="#34d399" strokeWidth="2" fill="none" />
                </svg>
              </div>

              <div className="col-stack">
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">
                      <BarChart3 size={16} color="#34d399" />
                      Execution Post-Mortem
                    </div>
                    <span className="badge badge-green">MCP Ready</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
                    <CheckCircle2 size={20} color="#34d399" />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>Avoided revenge trading</div>
                      <div className="subtext">+21% discipline via MCP audit</div>
                    </div>
                  </div>
                  <button type="button" className="btn-card" onClick={() => setActiveTab('mcp')}>
                    Open MCP Setup →
                  </button>
                </div>

                <div className="card">
                  <div className="card-header">
                    <div className="card-title">
                      <ShieldCheck size={16} color="#34d399" />
                      Net Equity Buffer
                    </div>
                  </div>
                  <div className="big-num">
                    ${buffer.bindingBuffer.toLocaleString()} <small>{buffer.dailySafePct}% Safe</small>
                  </div>
                  <div className="subtext">After Fees, Slippage &amp; Funding</div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${buffer.dailySafePct}%` }} />
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {activeTab === 'radar' && (
          <section className="panel card">
            <div className="card-header">
              <div className="card-title">Red-Folder Macro News Blackout Radar (ET / UTC)</div>
              <span className="badge badge-amber">-10m Entry Lock · -2m/+2m Hard Lock</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Impact</th>
                  <th>Countdown</th>
                  <th>Timestamp (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {(state?.events || []).map((ev, idx) => (
                  <tr key={`${ev.title}-${idx}`}>
                    <td>{ev.title}</td>
                    <td><span className="badge badge-red">HIGH</span></td>
                    <td className="mono">{formatCountdown(ev.timestampUtc)}</td>
                    <td className="mono">{new Date(ev.timestampUtc).toUTCString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeTab === 'correlation' && (
          <section className="panel card">
            <div className="card-header">
              <div className="card-title">Cross-Asset Exposure &amp; Correlation Heat (122 Perps)</div>
              <span className="badge badge-green">{positions.length} Open Positions</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Side</th>
                  <th>Notional</th>
                  <th>Stop-Loss Risk</th>
                  <th>Unrealized P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.id}>
                    <td className="mono">{pos.symbol}</td>
                    <td>
                      <span className={`badge ${pos.side === 'long' ? 'badge-green' : 'badge-red'}`}>
                        {pos.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="mono">${pos.notional.toLocaleString()}</td>
                    <td className="mono">${pos.stopLossRisk.toLocaleString()}</td>
                    <td className="mono" style={{ color: pos.unrealizedPnl >= 0 ? '#34d399' : '#f87171' }}>
                      {pos.unrealizedPnl >= 0 ? '+' : ''}${pos.unrealizedPnl}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeTab === 'lock' && (
          <section className="panel card">
            <div className="card-header">
              <div className="card-title">Post-Payout Drawdown Lock Simulator (Select / Prime / Signature)</div>
              <span className="badge badge-amber">Permanent Floor Lock</span>
            </div>
            <div className="sim-grid">
              <div className="sim-inputs">
                {Object.entries(lockInputs).map(([key, val]) => (
                  <label key={key} className="field">
                    <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                    <input
                      type="number"
                      value={val}
                      onChange={(e) => handleSimulateLock({ ...lockInputs, [key]: Number(e.target.value) })}
                    />
                  </label>
                ))}
              </div>
              {lockResult && (
                <div className="sim-output">
                  <div className="status-row">
                    <span>Pre-Payout Buffer</span>
                    <span className="status-val white">${lockResult.prePayoutBuffer.toLocaleString()}</span>
                  </div>
                  <div className="status-row">
                    <span>Locked Loss Floor (After 1st Payout)</span>
                    <span className="status-val">${lockResult.lockedLossFloor.toLocaleString()}</span>
                  </div>
                  <div className="status-row">
                    <span>Post-Payout Remaining Buffer</span>
                    <span className="status-val" style={{ color: '#fbbf24' }}>
                      ${lockResult.postPayoutBuffer.toLocaleString()} (-{lockResult.bufferShrinkPct}%)
                    </span>
                  </div>
                  <div className="status-row">
                    <span>Safe 10% Risk / Trade (Post-Payout)</span>
                    <span className="status-val white">${lockResult.postPayoutMaxRiskPerTrade.toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'mcp' && (
          <section className="panel card">
            <div className="card-header">
              <div className="card-title">MyFundedPerps MCP Server + Shareable Execution Card</div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => state && downloadScorecardPng(state)}
              >
                <Download size={14} /> Download Scorecard PNG
              </button>
            </div>
            <p className="subtext" style={{ marginBottom: 12 }}>
              Paste into Claude Desktop or Cursor to run read-only AI fill post-mortems and revenge-trading tilt checks:
            </p>
            <pre className="code-block">{MCP_SNIPPET}</pre>
            <button
              type="button"
              className="btn-card"
              onClick={() => {
                navigator.clipboard?.writeText(MCP_SNIPPET);
                setCopiedMcp(true);
                setTimeout(() => setCopiedMcp(false), 1800);
              }}
            >
              <Copy size={13} /> {copiedMcp ? 'Copied MCP Config ✓' : 'Copy MCP Config'}
            </button>
          </section>
        )}

        <footer className="footer-strip">
          {FOOTER_ITEMS.map(({ icon: Icon, label }) => (
            <div className="footer-item" key={label}>
              <div className="footer-icon">
                <Icon size={15} color="#34d399" />
              </div>
              {label}
            </div>
          ))}
        </footer>
      </div>

      {connectOpen && (
        <div className="modal-backdrop">
          <form className="card modal-card" onSubmit={handleConnect}>
            <div className="card-header">
              <div className="card-title">Connect MyFundedPerps Sandbox Key</div>
              <button type="button" className="btn-icon-close" onClick={() => setConnectOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <p className="subtext" style={{ marginBottom: 12 }}>
              Use a read-only or sandbox key (<code>fp_test_...</code>). Held in server memory only—never written to browser storage or logs.
            </p>
            <input
              type="password"
              placeholder="fp_test_..."
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="key-input"
              required
            />
            {connectError && <div className="alert-headline" style={{ marginTop: 8 }}>{connectError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn-ghost" onClick={() => setConnectOpen(false)}>Cancel</button>
              <button type="submit" className="btn-primary">Connect Stream</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
