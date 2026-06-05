import type { ConfirmPaymentInput, CreateIntentInput, DashboardState, PaymentIntent, WebhookEndpoint } from "./shared/types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options?.headers
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "ArcFlow request failed.");
  }
  return data as T;
}

export function getDashboardState() {
  return request<DashboardState>("/state");
}

export function getPaymentIntent(id: string) {
  return request<PaymentIntent>(`/payment-intents/${id}`);
}

export function createPaymentIntent(input: CreateIntentInput) {
  return request<PaymentIntent>("/payment-intents", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function confirmPayment(id: string, input: ConfirmPaymentInput) {
  return request<DashboardState>(`/payment-intents/${id}/confirm`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function demoSettlePayment(id: string) {
  return request<DashboardState>(`/payment-intents/${id}/demo-settle`, {
    method: "POST"
  });
}

export function seedDemoIntent() {
  return request<PaymentIntent>("/demo/seed", {
    method: "POST"
  });
}

export function resetDemoData() {
  return request<DashboardState>("/demo/reset", {
    method: "POST"
  });
}

export function createWebhook(input: Pick<WebhookEndpoint, "url" | "events" | "enabled">) {
  return request<WebhookEndpoint>("/webhooks", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateWebhook(id: string, input: Partial<Pick<WebhookEndpoint, "url" | "events" | "enabled">>) {
  return request<WebhookEndpoint>(`/webhooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteWebhook(id: string) {
  return fetch(`/api/webhooks/${id}`, { method: "DELETE" }).then((response) => {
    if (!response.ok) throw new Error("Could not delete webhook endpoint.");
  });
}

export function testWebhook(id: string) {
  return request<DashboardState>(`/webhooks/${id}/test`, {
    method: "POST"
  });
}

export function rotateWebhookSecret(id: string) {
  return request<WebhookEndpoint>(`/webhooks/${id}/rotate-secret`, {
    method: "POST"
  });
}

export function retryWebhookDelivery(id: string) {
  return request<DashboardState>(`/webhook-deliveries/${id}/retry`, {
    method: "POST"
  });
}
