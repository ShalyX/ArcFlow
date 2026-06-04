import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BellRing,
  BookOpenCheck,
  Boxes,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  ReceiptText,
  Send,
  Split,
  TerminalSquare,
  Webhook
} from "lucide-react";
import { confirmPayment, createPaymentIntent, demoSettlePayment, getDashboardState, getPaymentIntent } from "./api";
import { ARC_TESTNET, formatUsdc } from "./shared/arc";
import type { CreateIntentInput, DashboardState, EventLog, PaymentIntent, Receipt, TemplateKey } from "./shared/types";
import "./styles.css";

const templateOptions: Array<{ key: TemplateKey; title: string; copy: string; icon: React.ElementType }> = [
  { key: "payment-link", title: "Payment link", copy: "Hosted checkout and receipt for a one-time USDC payment.", icon: Link2 },
  { key: "access-unlock", title: "Access unlock", copy: "Confirm payment, send webhook, unlock API or gated content.", icon: LockKeyhole },
  { key: "invoice", title: "Invoice", copy: "Attach customer and invoice metadata to a verifiable payment.", icon: FileText }
];

const roadmap = [
  { title: "Splits", icon: Split, copy: "Route revenue to multiple receivers after settlement." },
  { title: "Subscriptions", icon: BellRing, copy: "Recurring intents, retries, and access status webhooks." },
  { title: "Agent spend controls", icon: KeyRound, copy: "Policy wallets, per-action caps, and spend logs." },
  { title: "Credibility", icon: BadgeCheck, copy: "Payment and fulfillment history becomes a reputation graph." }
];

const initialState: DashboardState = {
  paymentIntents: [],
  receipts: [],
  webhooks: [],
  logs: []
};

function App() {
  const [state, setState] = useState<DashboardState>(initialState);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  async function refresh() {
    const next = await getDashboardState();
    setState(next);
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch(() => setLoading(false));
    const interval = window.setInterval(() => refresh().catch(() => undefined), 5000);
    return () => window.clearInterval(interval);
  }, []);

  function navigate(path: string) {
    window.history.pushState({}, "", path);
    setRoute(path);
  }

  if (route.startsWith("/pay/")) {
    return <Checkout paymentIntentId={route.split("/")[2]} onBack={() => navigate("/")} />;
  }

  if (route.startsWith("/receipts/")) {
    return <ReceiptView receiptId={route.split("/")[2]} state={state} onBack={() => navigate("/")} />;
  }

  return <Dashboard state={state} loading={loading} onRefresh={refresh} onNavigate={navigate} />;
}

function Dashboard({
  state,
  loading,
  onRefresh,
  onNavigate
}: {
  state: DashboardState;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (path: string) => void;
}) {
  const paid = state.paymentIntents.filter((intent) => intent.status === "paid").length;
  const pending = state.paymentIntents.filter((intent) => intent.status === "pending").length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">AF</div>
          <div>
            <strong>ArcFlow</strong>
            <span>USDC event layer</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Primary">
          <a href="#intents"><Send size={18} /> Intents</a>
          <a href="#receipts"><ReceiptText size={18} /> Receipts</a>
          <a href="#webhooks"><Webhook size={18} /> Webhooks</a>
          <a href="#logs"><TerminalSquare size={18} /> Logs</a>
          <a href="#templates"><Boxes size={18} /> Templates</a>
        </nav>
        <div className="network-panel">
          <span>Network</span>
          <strong>{ARC_TESTNET.name}</strong>
          <small>Chain ID {ARC_TESTNET.id}</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>Payment intents, receipts, webhooks, and logs for USDC apps on Arc.</p>
            <h1>ArcFlow Console</h1>
          </div>
          <button className="icon-button" onClick={onRefresh} aria-label="Refresh dashboard" title="Refresh dashboard">
            {loading ? <Loader2 className="spin" size={18} /> : <Activity size={18} />}
          </button>
        </header>

        <section className="metrics" aria-label="Overview">
          <Metric label="Total intents" value={state.paymentIntents.length.toString()} icon={Send} />
          <Metric label="Paid" value={paid.toString()} icon={CheckCircle2} />
          <Metric label="Pending" value={pending.toString()} icon={Loader2} />
          <Metric label="Receipts" value={state.receipts.length.toString()} icon={ReceiptText} />
        </section>

        <section className="split-layout">
          <IntentCreator onCreated={onRefresh} />
          <SdkPanel />
        </section>

        <section id="intents" className="section-band">
          <SectionTitle icon={Send} title="Payment Intents" />
          <div className="table-surface">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Template</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {state.paymentIntents.map((intent) => (
                  <tr key={intent.id}>
                    <td>
                      <strong>{intent.description}</strong>
                      <small>{intent.id}</small>
                    </td>
                    <td>{formatUsdc(intent.amount)} USDC</td>
                    <td><Status value={intent.status} /></td>
                    <td>{intent.template}</td>
                    <td>
                      <button className="tiny-button" onClick={() => onNavigate(intent.checkoutUrl)}>
                        <ExternalLink size={15} /> Open
                      </button>
                    </td>
                  </tr>
                ))}
                {state.paymentIntents.length === 0 && <EmptyRow colSpan={5} text="Create the first intent to start the ledger." />}
              </tbody>
            </table>
          </div>
        </section>

        <section id="receipts" className="section-band">
          <SectionTitle icon={ReceiptText} title="Receipts" />
          <ReceiptGrid receipts={state.receipts} onNavigate={onNavigate} />
        </section>

        <section id="webhooks" className="section-band">
          <SectionTitle icon={Webhook} title="Webhooks" />
          <div className="webhook-list">
            {state.webhooks.map((webhook) => (
              <article className="line-card" key={webhook.id}>
                <Webhook size={19} />
                <div>
                  <strong>{webhook.url}</strong>
                  <span>{webhook.enabled ? "Enabled" : "Disabled"} · {webhook.events.join(", ")}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="templates" className="section-band">
          <SectionTitle icon={BookOpenCheck} title="Templates" />
          <div className="template-grid">
            {templateOptions.map((template) => (
              <article className="template-card" key={template.key}>
                <template.icon size={21} />
                <strong>{template.title}</strong>
                <p>{template.copy}</p>
              </article>
            ))}
          </div>
          <div className="roadmap-strip">
            {roadmap.map((item) => (
              <div key={item.title}>
                <item.icon size={18} />
                <strong>{item.title}</strong>
                <span>{item.copy}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="logs" className="section-band">
          <SectionTitle icon={TerminalSquare} title="Event Logs" />
          <LogList logs={state.logs} />
        </section>
      </section>
    </main>
  );
}

function IntentCreator({ onCreated }: { onCreated: () => Promise<void> }) {
  const [form, setForm] = useState<CreateIntentInput>({
    amount: "10.00",
    receiver: "0x0000000000000000000000000000000000000001",
    description: "API access unlock",
    template: "access-unlock",
    metadata: { customerId: "cus_demo", productId: "api_basic" }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createPaymentIntent(form);
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create intent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-heading">
        <Send size={20} />
        <div>
          <h2>Create Intent</h2>
          <p>Generate a hosted checkout URL and event record.</p>
        </div>
      </div>
      <label>
        Description
        <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      </label>
      <div className="form-grid">
        <label>
          Amount
          <input value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
        </label>
        <label>
          Template
          <select value={form.template} onChange={(event) => setForm({ ...form, template: event.target.value as TemplateKey })}>
            {templateOptions.map((template) => <option value={template.key} key={template.key}>{template.title}</option>)}
          </select>
        </label>
      </div>
      <label>
        Receiver
        <input value={form.receiver} onChange={(event) => setForm({ ...form, receiver: event.target.value as `0x${string}` })} />
      </label>
      {error && <div className="error">{error}</div>}
      <button className="primary-button" disabled={busy}>
        {busy ? <Loader2 className="spin" size={18} /> : <ArrowRight size={18} />}
        Create payment intent
      </button>
    </form>
  );
}

function SdkPanel() {
  const snippet = `import { ArcFlow } from "@arcflow/sdk";

const arcflow = new ArcFlow({ apiKey: process.env.ARCFLOW_KEY });

const intent = await arcflow.paymentIntents.create({
  amount: "10.00",
  receiver: "0x...",
  template: "access-unlock",
  metadata: { customerId: "cus_123" }
});`;

  return (
    <section className="panel sdk-panel">
      <div className="panel-heading">
        <Code2 size={20} />
        <div>
          <h2>ArcFlow SDK</h2>
          <p>Public package name can stay product-scoped.</p>
        </div>
      </div>
      <pre>{snippet}</pre>
      <button className="secondary-button" onClick={() => navigator.clipboard.writeText(snippet)}>
        <Copy size={17} /> Copy
      </button>
    </section>
  );
}

function Checkout({ paymentIntentId, onBack }: { paymentIntentId: string; onBack: () => void }) {
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [txHash, setTxHash] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPaymentIntent(paymentIntentId).then(setIntent).catch((error) => setMessage(error.message));
  }, [paymentIntentId]);

  async function submitConfirmation(event: React.FormEvent) {
    event.preventDefault();
    if (!intent) return;
    setBusy(true);
    setMessage("");
    try {
      await confirmPayment(intent.id, { txHash: txHash as `0x${string}` });
      setIntent(await getPaymentIntent(intent.id));
      setMessage("Payment verified and receipt issued.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify payment.");
    } finally {
      setBusy(false);
    }
  }

  async function demoSettle() {
    if (!intent) return;
    setBusy(true);
    setMessage("");
    try {
      await demoSettlePayment(intent.id);
      setIntent(await getPaymentIntent(intent.id));
      setMessage("Demo settlement created a receipt and event log.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not settle demo payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="checkout-shell">
      <section className="checkout-panel">
        <button className="text-button" onClick={onBack}>Back to console</button>
        {intent ? (
          <>
            <div className="checkout-head">
              <div className="brand-mark">AF</div>
              <div>
                <h1>{intent.description}</h1>
                <p>{formatUsdc(intent.amount)} USDC on {ARC_TESTNET.name}</p>
              </div>
            </div>
            <div className="payment-box">
              <span>Send ERC-20 USDC to</span>
              <code>{intent.receiver}</code>
              <small>USDC token: {ARC_TESTNET.usdcAddress}</small>
            </div>
            <form onSubmit={submitConfirmation}>
              <label>
                Transaction hash
                <input value={txHash} onChange={(event) => setTxHash(event.target.value)} placeholder="0x..." />
              </label>
              <button className="primary-button" disabled={busy || intent.status === "paid"}>
                {busy ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
                Verify payment
              </button>
            </form>
            <button className="secondary-button full-width" onClick={demoSettle} disabled={busy || intent.status === "paid"}>
              <TerminalSquare size={17} /> Demo settle
            </button>
            {intent.status === "paid" && <div className="success">Paid · receipt {intent.receiptId}</div>}
            {message && <div className="notice">{message}</div>}
          </>
        ) : (
          <div className="notice">{message || "Loading checkout..."}</div>
        )}
      </section>
    </main>
  );
}

function ReceiptView({ receiptId, state, onBack }: { receiptId: string; state: DashboardState; onBack: () => void }) {
  const receipt = state.receipts.find((item) => item.id === receiptId);

  return (
    <main className="checkout-shell">
      <section className="checkout-panel receipt-document">
        <button className="text-button" onClick={onBack}>Back to console</button>
        {receipt ? (
          <>
            <ReceiptText size={34} />
            <h1>Payment Receipt</h1>
            <dl>
              <div><dt>Receipt</dt><dd>{receipt.id}</dd></div>
              <div><dt>Amount</dt><dd>{formatUsdc(receipt.amount)} USDC</dd></div>
              <div><dt>Status</dt><dd>{receipt.status}</dd></div>
              <div><dt>Receiver</dt><dd>{receipt.receiver}</dd></div>
              <div><dt>Payer</dt><dd>{receipt.payer || "Unknown"}</dd></div>
              <div><dt>Issued</dt><dd>{new Date(receipt.issuedAt).toLocaleString()}</dd></div>
            </dl>
            <a className="secondary-button" href={`${ARC_TESTNET.explorerUrl}/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">
              <ExternalLink size={17} /> View transaction
            </a>
          </>
        ) : (
          <div className="notice">Receipt not found yet. Return to the console after settlement.</div>
        )}
      </section>
    </main>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <article className="metric">
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SectionTitle({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
  return (
    <div className="section-title">
      <Icon size={20} />
      <h2>{title}</h2>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{value}</span>;
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="empty-cell">{text}</td>
    </tr>
  );
}

function ReceiptGrid({ receipts, onNavigate }: { receipts: Receipt[]; onNavigate: (path: string) => void }) {
  if (receipts.length === 0) {
    return <div className="empty-state">Receipts will appear after verified or demo-settled payments.</div>;
  }

  return (
    <div className="receipt-grid">
      {receipts.map((receipt) => (
        <article className="receipt-card" key={receipt.id}>
          <ReceiptText size={21} />
          <strong>{formatUsdc(receipt.amount)} USDC</strong>
          <span>{receipt.id}</span>
          <button className="tiny-button" onClick={() => onNavigate(receipt.receiptUrl)}>
            <ExternalLink size={15} /> Open
          </button>
        </article>
      ))}
    </div>
  );
}

function LogList({ logs }: { logs: EventLog[] }) {
  if (logs.length === 0) return <div className="empty-state">No events yet.</div>;
  return (
    <div className="log-list">
      {logs.map((log) => (
        <article className={`log-item log-${log.level}`} key={log.id}>
          <span>{new Date(log.createdAt).toLocaleTimeString()}</span>
          <strong>{log.type}</strong>
          <p>{log.message}</p>
        </article>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
