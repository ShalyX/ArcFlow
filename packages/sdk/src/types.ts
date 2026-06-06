import type {
  ApiKey,
  ConfirmPaymentInput,
  CreateIntentInput,
  CreatedApiKey,
  CreatedProject,
  DashboardState,
  PaymentIntent,
  Project,
  Receipt,
  WebhookEndpoint
} from "../../../src/shared/types";

export type ArcFlowConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export type { ApiKey, ConfirmPaymentInput, CreateIntentInput, CreatedApiKey, CreatedProject, DashboardState, PaymentIntent, Project, Receipt, WebhookEndpoint };

export type PaymentConfirmation = {
  intent: PaymentIntent;
  receipt: Receipt;
};

export type ArcFlowWebhookEvent = {
  type: string;
  data: Record<string, unknown>;
};
