export type PaymentIntentStatus = "pending" | "paid" | "expired" | "canceled";
export type LogLevel = "info" | "success" | "warning" | "error";

export type PaymentIntent = {
  id: string;
  amount: string;
  receiver: `0x${string}`;
  status: PaymentIntentStatus;
  checkoutUrl: string;
  description: string;
  template: TemplateKey;
  metadata: Record<string, string>;
  txHash?: `0x${string}`;
  receiptId?: string;
  createdAt: string;
  updatedAt: string;
};

export type Receipt = {
  id: string;
  paymentIntentId: string;
  amount: string;
  receiver: `0x${string}`;
  payer?: `0x${string}`;
  txHash: `0x${string}`;
  status: "issued";
  receiptUrl: string;
  metadata: Record<string, string>;
  issuedAt: string;
};

export type WebhookEndpoint = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
};

export type WebhookDelivery = {
  id: string;
  webhookId?: string;
  eventType: string;
  endpointUrl?: string;
  status: "skipped" | "delivered" | "failed";
  httpStatus?: number;
  attempt: number;
  error?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type EventLog = {
  id: string;
  level: LogLevel;
  type: string;
  message: string;
  paymentIntentId?: string;
  receiptId?: string;
  createdAt: string;
};

export type TemplateKey = "payment-link" | "access-unlock" | "invoice";

export type DashboardState = {
  paymentIntents: PaymentIntent[];
  receipts: Receipt[];
  webhooks: WebhookEndpoint[];
  webhookDeliveries: WebhookDelivery[];
  logs: EventLog[];
};

export type CreateIntentInput = {
  amount: string;
  receiver: `0x${string}`;
  description: string;
  template: TemplateKey;
  metadata?: Record<string, string>;
};

export type ConfirmPaymentInput = {
  txHash: `0x${string}`;
};
