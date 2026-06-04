import type { ArcFlowConfig, ConfirmPaymentInput, CreateIntentInput, DashboardState, PaymentConfirmation, PaymentIntent } from "./types";

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

  demo = {
    seed: () => this.request<PaymentIntent>("/demo/seed", { method: "POST" }),
    reset: () => this.request<DashboardState>("/demo/reset", { method: "POST" })
  };

  state = {
    get: () => this.request<DashboardState>("/state")
  };

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };

    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "ArcFlow request failed.");
    }

    return data as T;
  }
}

export type { ArcFlowConfig, ConfirmPaymentInput, CreateIntentInput, DashboardState, PaymentConfirmation, PaymentIntent };
export { verifyArcFlowWebhook, signArcFlowWebhook } from "./webhooks";
