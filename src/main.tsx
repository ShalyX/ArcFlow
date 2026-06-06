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
  Plus,
  ReceiptText,
  Trash2,
  Send,
  Split,
  TerminalSquare,
  Wallet,
  Webhook
} from "lucide-react";
import {
  confirmPayment,
  clearStoredApiKey,
  createApiKey,
  createPaymentIntent,
  createProject,
  createWebhook,
  deleteWebhook,
  demoSettlePayment,
  getDashboardState,
  getPaymentIntent,
  getReceipt,
  getStoredProjectKeys,
  getStoredApiKey,
  resetDemoData,
  revokeApiKey,
  retryWebhookDelivery,
  rotateWebhookSecret,
  seedDemoIntent,
  saveStoredApiKey,
  saveProjectApiKey,
  testWebhook,
  updateWebhook
} from "./api";
import { ARC_TESTNET, formatUsdc } from "./shared/arc";
import type { CreateIntentInput, DashboardState, EventLog, PaymentIntent, Receipt, TemplateKey, WebhookEndpoint } from "./shared/types";
import { connectAndPayIntent, type WalletCheckoutStep } from "./walletCheckout";
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
  currentProjectId: "proj_default",
  projects: [],
  paymentIntents: [],
  receipts: [],
  webhooks: [],
  webhookDeliveries: [],
  apiKeys: [],
  logs: []
};

type CheckoutStatus =
  | "idle"
  | WalletCheckoutStep
  | "verify-arcflow"
  | "receipt-issued"
  | "failed";

const checkoutSteps: Array<{ key: CheckoutStatus; label: string }> = [
  { key: "connect-wallet", label: "Connect wallet" },
  { key: "switch-network", label: "Switch to Arc Testnet" },
  { key: "check-balance", label: "Check USDC balance" },
  { key: "submit-transfer", label: "Submit transfer" },
  { key: "wait-confirmation", label: "Wait for confirmation" },
  { key: "verify-arcflow", label: "Verify with ArcFlow" },
  { key: "receipt-issued", label: "Receipt issued" }
];

function absoluteUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

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
          <a href="#webhooks"><Webhook size={18} /> Events</a>
          <a href="#logs"><TerminalSquare size={18} /> Logs</a>
          <a href="#config"><Code2 size={18} /> Config</a>
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
            <p>What happened after money moved?</p>
            <h1>ArcFlow Console</h1>
          </div>
          <div className="topbar-actions">
            <ProjectSwitcher state={state} onRefresh={onRefresh} />
            <button className="icon-button" onClick={onRefresh} aria-label="Refresh dashboard" title="Refresh dashboard">
              {loading ? <Loader2 className="spin" size={18} /> : <Activity size={18} />}
            </button>
          </div>
        </header>

        <section className="metrics" aria-label="Overview">
          <Metric label="Total intents" value={state.paymentIntents.length.toString()} icon={Send} />
          <Metric label="Paid" value={paid.toString()} icon={CheckCircle2} />
          <Metric label="Pending" value={pending.toString()} icon={Loader2} />
          <Metric label="Receipts" value={state.receipts.length.toString()} icon={ReceiptText} />
        </section>

        <section className="split-layout">
          <IntentCreator onCreated={onRefresh} />
          <DemoPanel onRefresh={onRefresh} onNavigate={onNavigate} />
        </section>

        <section className="split-layout">
          <SdkPanel />
          <TrailPanel state={state} />
        </section>

        <section className="split-layout">
          <MerchantUnlockPanel />
          <div className="panel">
            <div className="panel-heading">
              <Webhook size={20} />
              <div>
                <h2>Signed Delivery</h2>
                <p>Demo seed enables the local merchant webhook receiver.</p>
              </div>
            </div>
            <div className="demo-script">
              <strong>Merchant endpoint</strong>
              <span>http://127.0.0.1:9090/webhooks/arcflow</span>
            </div>
          </div>
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
                      <div className="row-actions">
                        <button className="tiny-button" onClick={() => onNavigate(intent.checkoutUrl)}>
                        <ExternalLink size={15} /> Open checkout
                        </button>
                        <button className="tiny-button" onClick={() => navigator.clipboard.writeText(absoluteUrl(intent.checkoutUrl))}>
                          <Copy size={15} /> Copy link
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {state.paymentIntents.length === 0 && <EmptyRow colSpan={5} text="Payment intents are checkout sessions. Create one to start a payment trail." />}
              </tbody>
            </table>
          </div>
        </section>

        <section id="receipts" className="section-band">
          <SectionTitle icon={ReceiptText} title="Receipts" />
          <ReceiptGrid receipts={state.receipts} onNavigate={onNavigate} />
        </section>

        <section id="webhooks" className="section-band">
          <SectionTitle icon={Webhook} title="Webhook Events" />
          <WebhookDeliveries deliveries={state.webhookDeliveries} onRefresh={onRefresh} />
        </section>

        <section className="section-band">
          <SectionTitle icon={Webhook} title="Webhook Endpoints" />
          <WebhookEndpointManager webhooks={state.webhooks} onRefresh={onRefresh} />
        </section>

        <section id="config" className="section-band">
          <SectionTitle icon={Code2} title="Developer Config" />
          <DeveloperConfig apiKeys={state.apiKeys} onRefresh={onRefresh} />
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

const supportedWebhookEvents = ["payment_intent.paid", "receipt.issued"];
const demoMerchantWebhookUrl = "http://127.0.0.1:9090/webhooks/arcflow";

function ProjectSwitcher({ state, onRefresh }: { state: DashboardState; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentProject = state.projects.find((project) => project.id === state.currentProjectId);

  async function switchProject(projectId: string) {
    setError("");
    const key = getStoredProjectKeys()[projectId];
    if (!key) {
      setError("No browser key saved for that project.");
      return;
    }
    saveStoredApiKey(key);
    await onRefresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await createProject(name || "New project");
      saveProjectApiKey(result.project.id, result.apiKey.key);
      setName("");
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="project-switcher">
      <label>
        Project
        <select value={state.currentProjectId} onChange={(event) => switchProject(event.target.value)}>
          {state.projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </label>
      <form onSubmit={submit}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder={currentProject ? `New project from ${currentProject.name}` : "New project"} />
        <button className="icon-button compact" disabled={busy} aria-label="Create project" title="Create project">
          {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
        </button>
      </form>
      {error && <small>{error}</small>}
    </div>
  );
}

function WebhookEndpointManager({ webhooks, onRefresh }: { webhooks: WebhookEndpoint[]; onRefresh: () => Promise<void> }) {
  const [url, setUrl] = useState("http://127.0.0.1:9090/webhooks/arcflow");
  const [events, setEvents] = useState<string[]>(["payment_intent.paid"]);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  function toggleEvent(event: string) {
    setEvents((current) => current.includes(event) ? current.filter((item) => item !== event) : [...current, event]);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError("");
    try {
      await createWebhook({ url, events, enabled });
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create webhook endpoint.");
    } finally {
      setBusy("");
    }
  }

  async function run(action: string, callback: () => Promise<unknown>) {
    setBusy(action);
    setError("");
    try {
      await callback();
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Webhook action failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="webhook-manager">
      <form className="panel compact-panel" onSubmit={submit}>
        <div className="panel-heading">
          <Plus size={20} />
          <div>
            <h2>Add Endpoint</h2>
            <p>Receive signed ArcFlow payment events.</p>
          </div>
        </div>
        <label>
          Endpoint URL
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/webhooks/arcflow" />
        </label>
        <div className="field-note">Localhost endpoints work for this local demo. Hosted ArcFlow will require public HTTPS endpoints.</div>
        <fieldset className="event-checkboxes">
          <legend>Events</legend>
          {supportedWebhookEvents.map((event) => (
            <label key={event}>
              <input type="checkbox" checked={events.includes(event)} onChange={() => toggleEvent(event)} />
              {event}
            </label>
          ))}
        </fieldset>
        <label className="inline-check">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Enable endpoint
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary-button" disabled={Boolean(busy) || events.length === 0}>
          {busy === "create" ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
          Add webhook
        </button>
      </form>

      <div className="webhook-list">
        {webhooks.map((webhook) => {
          const isDemoEndpoint = webhook.url === demoMerchantWebhookUrl;
          return (
          <article className="webhook-card" key={webhook.id}>
            <div className="line-card">
              <Webhook size={19} />
              <div>
                <strong>{webhook.url}</strong>
                <span>{webhook.enabled ? "Enabled" : "Disabled"} · {webhook.events.join(", ")}</span>
              </div>
            </div>
            <div className="webhook-actions">
              <button className="tiny-button" onClick={() => navigator.clipboard.writeText(webhook.signingSecret)}>
                <Copy size={15} />
                Copy secret
              </button>
              <button className="tiny-button" onClick={() => run(`rotate-${webhook.id}`, () => rotateWebhookSecret(webhook.id))}>
                {busy === `rotate-${webhook.id}` ? <Loader2 className="spin" size={15} /> : <KeyRound size={15} />}
                {isDemoEndpoint ? "Sync secret" : "Rotate secret"}
              </button>
              <button
                className="tiny-button"
                onClick={() => run(`toggle-${webhook.id}`, () => updateWebhook(webhook.id, { enabled: !webhook.enabled }))}
              >
                {busy === `toggle-${webhook.id}` ? <Loader2 className="spin" size={15} /> : <Activity size={15} />}
                {webhook.enabled ? "Disable" : "Enable"}
              </button>
              <button className="tiny-button" onClick={() => run(`test-${webhook.id}`, () => testWebhook(webhook.id))}>
                {busy === `test-${webhook.id}` ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
                Send test
              </button>
              <button className="tiny-button danger-button" onClick={() => run(`delete-${webhook.id}`, () => deleteWebhook(webhook.id))}>
                {busy === `delete-${webhook.id}` ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                Delete
              </button>
            </div>
            <div className="secret-line">
              <span>{isDemoEndpoint ? "Demo signing secret" : "Signing secret"}</span>
              <code>{maskSecret(webhook.signingSecret)}</code>
              <small>Last rotated {new Date(webhook.lastRotatedAt).toLocaleString()}</small>
            </div>
            {isDemoEndpoint && (
              <div className="field-note">This bundled endpoint must match the merchant demo's local webhook secret.</div>
            )}
          </article>
          );
        })}
        {webhooks.length === 0 && (
          <div className="empty-state">Webhook endpoints are where ArcFlow sends signed payment events after verification.</div>
        )}
      </div>
    </div>
  );
}

function maskSecret(secret: string) {
  if (!secret) return "whsec_unset";
  return `${secret.slice(0, 10)}${"*".repeat(10)}${secret.slice(-4)}`;
}

type MerchantAccess = {
  customerId: string;
  access: null | {
    productId: string;
    unlockedAt: string;
  };
};

function MerchantUnlockPanel() {
  const [access, setAccess] = useState<MerchantAccess | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    setError("");
    try {
      const response = await fetch("http://127.0.0.1:9090/access/cus_demo");
      if (!response.ok) throw new Error("Merchant API is not reachable.");
      setAccess((await response.json()) as MerchantAccess);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load merchant unlock status.");
    }
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  return (
    <section className="panel">
      <div className="panel-heading">
        <LockKeyhole size={20} />
        <div>
          <h2>Merchant Unlock</h2>
          <p>Tracks whether the signed webhook unlocked `cus_demo`.</p>
        </div>
      </div>
      <div className="unlock-status">
        <span>cus_demo</span>
        <strong>{access?.access ? "Unlocked" : "Waiting"}</strong>
        {access?.access && <small>{access.access.productId} · {new Date(access.access.unlockedAt).toLocaleString()}</small>}
        {error && <small>{error}</small>}
      </div>
      <button className="secondary-button" onClick={refresh}>
        <Activity size={17} /> Refresh merchant status
      </button>
    </section>
  );
}

function DemoPanel({ onRefresh, onNavigate }: { onRefresh: () => Promise<void>; onNavigate: (path: string) => void }) {
  const [busy, setBusy] = useState("");

  async function run(action: "seed" | "seed-open" | "reset") {
    setBusy(action);
    try {
      if (action === "seed") await seedDemoIntent();
      if (action === "seed-open") {
        const intent = await seedDemoIntent();
        await onRefresh();
        onNavigate(intent.checkoutUrl);
        return;
      }
      if (action === "reset") await resetDemoData();
      await onRefresh();
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <TerminalSquare size={20} />
        <div>
          <h2>Demo Controls</h2>
          <p>Seed or reset the trail for a clean walkthrough.</p>
        </div>
      </div>
      <div className="demo-actions">
        <button className="primary-button" onClick={() => run("seed-open")} disabled={Boolean(busy)}>
          {busy === "seed-open" ? <Loader2 className="spin" size={18} /> : <ExternalLink size={18} />}
          Seed and open checkout
        </button>
        <button className="secondary-button" onClick={() => run("seed")} disabled={Boolean(busy)}>
          {busy === "seed" ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          Seed only
        </button>
        <button className="secondary-button" onClick={() => run("reset")} disabled={Boolean(busy)}>
          {busy === "reset" ? <Loader2 className="spin" size={18} /> : <TerminalSquare size={18} />}
          Reset demo data
        </button>
      </div>
      <div className="demo-script">
        <strong>Demo spine</strong>
        <span>{"Create intent -> settle payment -> issue receipt -> record webhook/log events."}</span>
      </div>
    </section>
  );
}

function TrailPanel({ state }: { state: DashboardState }) {
  const latestIntent = state.paymentIntents[0];
  const latestReceipt = state.receipts[0];
  const latestDelivery = state.webhookDeliveries[0];
  const latestLog = state.logs[0];
  const steps = [
    { label: "Intent", value: latestIntent ? latestIntent.status : "waiting" },
    { label: "Receipt", value: latestReceipt ? "issued" : "waiting" },
    { label: "Webhook", value: latestDelivery ? latestDelivery.status : "waiting" },
    { label: "Log", value: latestLog ? latestLog.type : "waiting" }
  ];

  return (
    <section className="panel">
      <div className="panel-heading">
        <Activity size={20} />
        <div>
          <h2>Payment Trail</h2>
          <p>The shortest answer to what happened after money moved.</p>
        </div>
      </div>
      <div className="trail-steps">
        {steps.map((step) => (
          <div key={step.label}>
            <span>{step.label}</span>
            <strong>{step.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeveloperConfig({ apiKeys, onRefresh }: { apiKeys: DashboardState["apiKeys"]; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState("Local console key");
  const [manualKey, setManualKey] = useState(getStoredApiKey());
  const [createdKey, setCreatedKey] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const activeKey = getStoredApiKey();
  const config = [
    { label: "API base", value: "http://127.0.0.1:8787/api" },
    { label: "SDK package", value: "@arcflow/sdk" },
    { label: "React package", value: "@arcflow/react" },
    { label: "API key header", value: "x-arcflow-api-key" },
    { label: "Webhook header", value: "x-arcflow-signature" },
    { label: "Arc RPC", value: ARC_TESTNET.rpcUrl },
    { label: "USDC token", value: ARC_TESTNET.usdcAddress }
  ];

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError("");
    try {
      const apiKey = await createApiKey(name);
      saveProjectApiKey(apiKey.projectId, apiKey.key);
      setManualKey(apiKey.key);
      setCreatedKey(apiKey.key);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create API key.");
    } finally {
      setBusy("");
    }
  }

  async function revokeKey(id: string) {
    setBusy(`revoke-${id}`);
    setError("");
    try {
      await revokeApiKey(id);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke API key.");
    } finally {
      setBusy("");
    }
  }

  function saveManualKey() {
    saveStoredApiKey(manualKey);
    setManualKey(getStoredApiKey());
  }

  function clearManualKey() {
    clearStoredApiKey();
    setManualKey("");
  }

  return (
    <div className="developer-config">
      <form className="panel compact-panel" onSubmit={createKey}>
        <div className="panel-heading">
          <KeyRound size={20} />
          <div>
            <h2>API Keys</h2>
            <p>Protect payment and webhook mutation routes.</p>
          </div>
        </div>
        <label>
          Key name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production server key" />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary-button" disabled={Boolean(busy)}>
          {busy === "create" ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
          Create API key
        </button>
        {createdKey && (
          <div className="secret-line key-secret">
            <span>New key</span>
            <code>{createdKey}</code>
            <button className="tiny-button" type="button" onClick={() => navigator.clipboard.writeText(createdKey)}>
              <Copy size={15} />
              Copy
            </button>
          </div>
        )}
        <div className="field-note">Full API keys are shown once. Store server keys outside the repo.</div>
      </form>

      <div className="panel compact-panel">
        <div className="panel-heading">
          <Code2 size={20} />
          <div>
            <h2>Console Auth</h2>
            <p>The local console sends this key with protected requests.</p>
          </div>
        </div>
        <label>
          Active API key
          <input value={manualKey} onChange={(event) => setManualKey(event.target.value)} placeholder="ak_test_..." />
        </label>
        <div className="webhook-actions">
          <button className="tiny-button" type="button" onClick={saveManualKey}>
            <KeyRound size={15} />
            Use key
          </button>
          <button className="tiny-button" type="button" onClick={() => navigator.clipboard.writeText(activeKey)} disabled={!activeKey}>
            <Copy size={15} />
            Copy active
          </button>
          <button className="tiny-button danger-button" type="button" onClick={clearManualKey}>
            <Trash2 size={15} />
            Clear
          </button>
        </div>
        <div className="field-note">{activeKey ? `Active key ${maskSecret(activeKey)}` : "No active key saved in this browser."}</div>
      </div>

      <div className="api-key-list">
        {apiKeys.map((apiKey) => (
          <article className="webhook-card" key={apiKey.id}>
            <div className="line-card">
              <KeyRound size={19} />
              <div>
                <strong>{apiKey.name}</strong>
                <span>{apiKey.enabled ? "Enabled" : "Revoked"} · {apiKey.keyPreview}</span>
              </div>
            </div>
            <div className="secret-line">
              <span>Created</span>
              <code>{new Date(apiKey.createdAt).toLocaleString()}</code>
              <small>{apiKey.lastUsedAt ? `Last used ${new Date(apiKey.lastUsedAt).toLocaleString()}` : "Never used"}</small>
            </div>
            {apiKey.enabled && (
              <div className="webhook-actions">
                <button className="tiny-button danger-button" type="button" onClick={() => revokeKey(apiKey.id)} disabled={Boolean(busy)}>
                  {busy === `revoke-${apiKey.id}` ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                  Revoke
                </button>
              </div>
            )}
          </article>
        ))}
        {apiKeys.length === 0 && <div className="empty-state">Create an API key before using protected ArcFlow mutation routes.</div>}
      </div>

      <div className="config-grid">
        {config.map((item) => (
          <article className="config-item" key={item.label}>
            <span>{item.label}</span>
            <code>{item.value}</code>
            <button className="icon-button compact" onClick={() => navigator.clipboard.writeText(item.value)} aria-label={`Copy ${item.label}`} title={`Copy ${item.label}`}>
              <Copy size={16} />
            </button>
          </article>
        ))}
      </div>
    </div>
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
  const [walletAddress, setWalletAddress] = useState("");
  const [checkoutStatus, setCheckoutStatus] = useState<CheckoutStatus>("idle");
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
      setCheckoutStatus("verify-arcflow");
      await confirmPayment(intent.id, { txHash: txHash as `0x${string}` });
      setIntent(await getPaymentIntent(intent.id));
      setCheckoutStatus("receipt-issued");
      setMessage("Payment verified and receipt issued.");
    } catch (error) {
      setCheckoutStatus("failed");
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
      setCheckoutStatus("receipt-issued");
      setMessage("Demo settlement created a receipt and event log.");
    } catch (error) {
      setCheckoutStatus("failed");
      setMessage(error instanceof Error ? error.message : "Could not settle demo payment.");
    } finally {
      setBusy(false);
    }
  }

  async function payWithWallet() {
    if (!intent) return;
    setBusy(true);
    setCheckoutStatus("connect-wallet");
    setMessage("Connect your wallet, approve Arc Testnet, then confirm the USDC transfer.");
    try {
      const payment = await connectAndPayIntent(intent, { onStep: setCheckoutStatus });
      setWalletAddress(payment.account);
      setTxHash(payment.txHash);
      setCheckoutStatus("verify-arcflow");
      setMessage("Transfer confirmed on Arc. Issuing ArcFlow receipt...");
      await confirmPayment(intent.id, { txHash: payment.txHash });
      setIntent(await getPaymentIntent(intent.id));
      setCheckoutStatus("receipt-issued");
      setMessage("Payment verified and receipt issued.");
    } catch (error) {
      setCheckoutStatus("failed");
      setMessage(error instanceof Error ? error.message : "Wallet checkout failed.");
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
            <button className="secondary-button full-width" onClick={() => navigator.clipboard.writeText(window.location.href)}>
              <Copy size={17} /> Copy checkout link
            </button>
            <CheckoutStepper status={intent.status === "paid" ? "receipt-issued" : checkoutStatus} />
            <button className="primary-button full-width" onClick={payWithWallet} disabled={busy || intent.status === "paid"}>
              {busy ? <Loader2 className="spin" size={18} /> : <Wallet size={18} />}
              Connect wallet and pay USDC
            </button>
            {walletAddress && (
              <div className="wallet-chip">
                <Wallet size={16} />
                <span>{walletAddress}</span>
              </div>
            )}
            {txHash && (
              <a className="secondary-button full-width" href={`${ARC_TESTNET.explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer">
                <ExternalLink size={17} /> View transaction
              </a>
            )}
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
            {intent.status === "paid" && intent.receiptId && (
              <a className="secondary-button full-width" href={`/receipts/${intent.receiptId}`}>
                <ReceiptText size={17} /> Open receipt
              </a>
            )}
            {message && <div className="notice">{message}</div>}
          </>
        ) : (
          <div className="notice">{message || "Loading checkout..."}</div>
        )}
      </section>
    </main>
  );
}

function CheckoutStepper({ status }: { status: CheckoutStatus }) {
  const activeIndex = checkoutSteps.findIndex((step) => step.key === status);
  const failed = status === "failed";

  return (
    <ol className="checkout-steps">
      {checkoutSteps.map((step, index) => {
        const complete = activeIndex >= 0 && index < activeIndex;
        const active = step.key === status;
        return (
          <li className={complete ? "complete" : active ? "active" : failed && index === activeIndex ? "failed" : ""} key={step.key}>
            <span>{complete ? <CheckCircle2 size={15} /> : index + 1}</span>
            <strong>{step.label}</strong>
          </li>
        );
      })}
    </ol>
  );
}

function ReceiptView({ receiptId, state, onBack }: { receiptId: string; state: DashboardState; onBack: () => void }) {
  const [receipt, setReceipt] = useState<Receipt | null>(state.receipts.find((item) => item.id === receiptId) || null);
  const [message, setMessage] = useState("");
  const intent = receipt ? state.paymentIntents.find((item) => item.id === receipt.paymentIntentId) : undefined;

  useEffect(() => {
    getReceipt(receiptId).then(setReceipt).catch((error) => setMessage(error.message));
  }, [receiptId]);

  return (
    <main className="checkout-shell">
      <section className="checkout-panel receipt-document">
        <button className="text-button" onClick={onBack}>Back to console</button>
        {receipt ? (
          <>
            <div className="receipt-hero">
              <ReceiptText size={34} />
              <div>
                <h1>Payment Receipt</h1>
                <p>Proof of a verified Arc USDC payment event.</p>
              </div>
              <Status value={receipt.status} />
            </div>
            <dl>
              <div><dt>Receipt</dt><dd>{receipt.id}</dd></div>
              <div><dt>Intent</dt><dd>{receipt.paymentIntentId}</dd></div>
              {intent && <div><dt>Description</dt><dd>{intent.description}</dd></div>}
              <div><dt>Amount</dt><dd>{formatUsdc(receipt.amount)} USDC</dd></div>
              <div><dt>Status</dt><dd>{receipt.status}</dd></div>
              <div><dt>Receiver</dt><dd>{receipt.receiver}</dd></div>
              <div><dt>Payer</dt><dd>{receipt.payer || "Unknown"}</dd></div>
              <div><dt>Tx hash</dt><dd>{receipt.txHash}</dd></div>
              <div><dt>Issued</dt><dd>{new Date(receipt.issuedAt).toLocaleString()}</dd></div>
            </dl>
            <div className="receipt-actions">
              <button className="secondary-button" onClick={() => navigator.clipboard.writeText(absoluteUrl(receipt.receiptUrl))}>
                <Copy size={17} /> Copy receipt link
              </button>
              <button className="secondary-button" onClick={() => navigator.clipboard.writeText(receipt.txHash)}>
                <Copy size={17} /> Copy tx hash
              </button>
              <a className="secondary-button" href={`${ARC_TESTNET.explorerUrl}/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">
                <ExternalLink size={17} /> View transaction
              </a>
            </div>
          </>
        ) : (
          <div className="notice">{message || "Loading receipt..."}</div>
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
    return <div className="empty-state">Receipts are issued only after ArcFlow verifies an exact USDC transfer for an intent.</div>;
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

function WebhookDeliveries({ deliveries, onRefresh }: { deliveries: DashboardState["webhookDeliveries"]; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selectedDeliveryId, setSelectedDeliveryId] = useState("");
  const selectedDelivery = deliveries.find((delivery) => delivery.id === selectedDeliveryId);

  if (deliveries.length === 0) return <div className="empty-state">Webhook events show what ArcFlow told your app after payment verification.</div>;

  async function retry(deliveryId: string) {
    setBusy(deliveryId);
    setError("");
    try {
      await retryWebhookDelivery(deliveryId);
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry delivery.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="table-surface">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Status</th>
              <th>Endpoint</th>
              <th>HTTP</th>
              <th>Attempt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td>
                  <strong>{delivery.eventType}</strong>
                  <small>{new Date(delivery.createdAt).toLocaleString()}</small>
                </td>
                <td><Status value={delivery.status} /></td>
                <td>{delivery.endpointUrl || "No matching enabled endpoint"}</td>
                <td>{delivery.httpStatus || "-"}</td>
                <td>{delivery.attempt}</td>
                <td>
                  <div className="row-actions">
                    <button className="tiny-button" onClick={() => setSelectedDeliveryId(delivery.id)}>
                      <ExternalLink size={15} />
                      Details
                    </button>
                    {delivery.status === "failed" && delivery.webhookId ? (
                      <button className="tiny-button" onClick={() => retry(delivery.id)} disabled={Boolean(busy)}>
                        {busy === delivery.id ? <Loader2 className="spin" size={15} /> : <Activity size={15} />}
                        Retry
                      </button>
                    ) : (
                      <span className="muted-dash">-</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedDelivery && (
        <DeliveryDetail delivery={selectedDelivery} onClose={() => setSelectedDeliveryId("")} />
      )}
    </>
  );
}

function DeliveryDetail({ delivery, onClose }: { delivery: DashboardState["webhookDeliveries"][number]; onClose: () => void }) {
  return (
    <section className="delivery-detail">
      <div className="panel-heading">
        <Webhook size={20} />
        <div>
          <h2>Delivery Details</h2>
          <p>{delivery.eventType}</p>
        </div>
        <button className="tiny-button" onClick={onClose}>Close</button>
      </div>
      <dl>
        <div><dt>Endpoint URL</dt><dd>{delivery.endpointUrl || "No endpoint"}</dd></div>
        <div><dt>Status</dt><dd><Status value={delivery.status} /></dd></div>
        <div><dt>HTTP status</dt><dd>{delivery.httpStatus || "-"}</dd></div>
        <div><dt>Retry count</dt><dd>{Math.max(0, delivery.attempt - 1)}</dd></div>
        <div><dt>Last retry</dt><dd>{delivery.attempt > 1 ? new Date(delivery.createdAt).toLocaleString() : "Not retried"}</dd></div>
        <div><dt>Next retry</dt><dd>Manual retry only</dd></div>
        <div><dt>Created at</dt><dd>{new Date(delivery.createdAt).toLocaleString()}</dd></div>
        <div><dt>Signature header</dt><dd>{delivery.signatureHeader || "-"}</dd></div>
        <div><dt>Response body</dt><dd>{delivery.responseBody || delivery.error || "-"}</dd></div>
      </dl>
      <div className="detail-code">
        <strong>Request payload</strong>
        <pre>{JSON.stringify(delivery.payload || {}, null, 2)}</pre>
      </div>
    </section>
  );
}

function LogList({ logs }: { logs: EventLog[] }) {
  if (logs.length === 0) return <div className="empty-state">Flow logs explain each step after money moves: intent creation, receipt issuance, webhook delivery, and verification errors.</div>;
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
