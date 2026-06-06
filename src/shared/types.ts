export type PaymentIntentStatus = "pending" | "paid" | "expired" | "canceled";
export type LogLevel = "info" | "success" | "warning" | "error";

export type PaymentIntent = {
  id: string;
  projectId: string;
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
  projectId: string;
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
  projectId: string;
  url: string;
  events: string[];
  enabled: boolean;
  signingSecret: string;
  lastRotatedAt: string;
  createdAt: string;
};

export type WebhookDelivery = {
  id: string;
  projectId?: string;
  webhookId?: string;
  eventType: string;
  endpointUrl?: string;
  status: "skipped" | "delivered" | "failed";
  httpStatus?: number;
  attempt: number;
  error?: string;
  payload?: Record<string, unknown>;
  responseBody?: string;
  signatureHeader?: string;
  createdAt: string;
};

export type SplitReceiver = {
  address: `0x${string}`;
  shareBps: number;
  label?: string;
};

export type SplitAllocation = SplitReceiver & {
  amount: string;
};

export type SplitPlan = {
  splitId: string;
  name: string;
  settlementReceiver: `0x${string}`;
  totalAmount: string;
  allocations: SplitAllocation[];
};

export type Split = {
  id: string;
  projectId: string;
  name: string;
  settlementReceiver: `0x${string}`;
  receivers: SplitReceiver[];
  createdAt: string;
};

export type EventLog = {
  id: string;
  projectId?: string;
  level: LogLevel;
  type: string;
  message: string;
  paymentIntentId?: string;
  receiptId?: string;
  createdAt: string;
};

export type ApiKey = {
  id: string;
  projectId: string;
  name: string;
  keyPreview: string;
  enabled: boolean;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type CreatedApiKey = ApiKey & {
  key: string;
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

export type CreatedProject = {
  project: Project;
  apiKey: CreatedApiKey;
};

export type TemplateKey = "payment-link" | "access-unlock" | "invoice" | "split-payment";

export type DashboardState = {
  currentProjectId: string;
  projects: Project[];
  splits: Split[];
  paymentIntents: PaymentIntent[];
  receipts: Receipt[];
  webhooks: WebhookEndpoint[];
  webhookDeliveries: WebhookDelivery[];
  apiKeys: ApiKey[];
  logs: EventLog[];
};

export type CreateIntentInput = {
  amount: string;
  receiver: `0x${string}`;
  description: string;
  template: TemplateKey;
  metadata?: Record<string, string>;
};

export type CreateSplitInput = {
  name: string;
  settlementReceiver: `0x${string}`;
  receivers: SplitReceiver[];
};

export type ConfirmPaymentInput = {
  txHash: `0x${string}`;
};
