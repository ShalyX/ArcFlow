import type { ConfirmPaymentInput, CreateIntentInput, DashboardState, PaymentIntent, Receipt } from "../../../src/shared/types";

export type ArcFlowConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export type { ConfirmPaymentInput, CreateIntentInput, DashboardState, PaymentIntent, Receipt };

export type PaymentConfirmation = {
  intent: PaymentIntent;
  receipt: Receipt;
};

export type ArcFlowWebhookEvent = {
  type: string;
  data: Record<string, unknown>;
};
