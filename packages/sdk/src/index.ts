import type {
  ApiKey,
  ArcFlowConfig,
  ConfirmPaymentInput,
  CreateIntentInput,
  CreateIntentSplitRecipient,
  CreateSplitInput,
  CreatedApiKey,
  CreatedProject,
  DashboardState,
  PaymentConfirmation,
  PaymentIntent,
  Split,
  WebhookEndpoint
} from "./types";

export class ArcFlow {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetcher: typeof fetch;

  constructor(config: ArcFlowConfig = {}) {
    this.baseUrl = (config.baseUrl || "http://127.0.0.1:8787/api").replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.fetcher = config.fetcher || fetch;
  }

  paymentIntents = {
    create: (input: CreateIntentInput) => this.request<PaymentIntent>("/payment-intents", { method: "POST", body: input }),
    get: (id: string) => this.request<PaymentIntent>(`/payment-intents/${id}`),
    confirm: (id: string, input: ConfirmPaymentInput) =>
      this.request<PaymentConfirmation>(`/payment-intents/${id}/confirm`, { method: "POST", body: input }),
    demoSettle: (id: string) =>
      this.request<PaymentConfirmation>(`/payment-intents/${id}/demo-settle`, { method: "POST" })
  };

  projects = {
    create: (name: string) => this.request<CreatedProject>("/projects", { method: "POST", body: { name } })
  };

  apiKeys = {
    create: (name: string) => this.request<CreatedApiKey>("/api-keys", { method: "POST", body: { name } }),
    revoke: (id: string) => this.request<ApiKey>(`/api-keys/${id}`, { method: "DELETE" })
  };

  splits = {
    create: (input: CreateSplitInput) => this.request<Split>("/splits", { method: "POST", body: input })
  };

  webhooks = {
    create: (input: Pick<WebhookEndpoint, "url" | "events" | "enabled">) =>
      this.request<WebhookEndpoint>("/webhooks", { method: "POST", body: input }),
    update: (id: string, input: Partial<Pick<WebhookEndpoint, "url" | "events" | "enabled">>) =>
      this.request<WebhookEndpoint>(`/webhooks/${id}`, { method: "PATCH", body: input }),
    delete: (id: string) => this.request<void>(`/webhooks/${id}`, { method: "DELETE", parseJson: false }),
    rotateSecret: (id: string) => this.request<WebhookEndpoint>(`/webhooks/${id}/rotate-secret`, { method: "POST" }),
    test: (id: string) => this.request<DashboardState>(`/webhooks/${id}/test`, { method: "POST" })
  };

  webhookDeliveries = {
    retry: (id: string) => this.request<DashboardState>(`/webhook-deliveries/${id}/retry`, { method: "POST" })
  };

  demo = {
    seed: () => this.request<PaymentIntent>("/demo/seed", { method: "POST" }),
    reset: () => this.request<DashboardState>("/demo/reset", { method: "POST" })
  };

  state = {
    get: () => this.request<DashboardState>("/state")
  };

  private async request<T>(path: string, options: { method?: string; body?: unknown; parseJson?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };

    if (this.apiKey) headers["x-arcflow-api-key"] = this.apiKey;

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const data = options.parseJson === false ? undefined : await response.json();

    if (!response.ok) {
      throw new Error((data as { error?: string } | undefined)?.error || "ArcFlow request failed.");
    }

    return data as T;
  }
}

export type {
  ApiKey,
  ArcFlowConfig,
  ConfirmPaymentInput,
  CreateIntentInput,
  CreateIntentSplitRecipient,
  CreateSplitInput,
  CreatedApiKey,
  CreatedProject,
  DashboardState,
  PaymentConfirmation,
  PaymentIntent,
  Split,
  WebhookEndpoint
};
export { verifyArcFlowWebhook, signArcFlowWebhook } from "./webhooks";
