import type { ApiKey, ConfirmPaymentInput, CreateIntentInput, CreatedApiKey, CreatedProject, DashboardState, PaymentIntent, WebhookEndpoint } from "./shared/types";

const apiKeyStorageKey = "arcflow.apiKey";
const projectKeyStorageKey = "arcflow.projectKeys";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const apiKey = getStoredApiKey();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-arcflow-api-key": apiKey } : {}),
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

export function getStoredApiKey() {
  return window.localStorage.getItem(apiKeyStorageKey) || "";
}

export function saveStoredApiKey(apiKey: string) {
  window.localStorage.setItem(apiKeyStorageKey, apiKey.trim());
}

export function clearStoredApiKey() {
  window.localStorage.removeItem(apiKeyStorageKey);
}

export function getStoredProjectKeys() {
  try {
    return JSON.parse(window.localStorage.getItem(projectKeyStorageKey) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveProjectApiKey(projectId: string, apiKey: string) {
  const keys = getStoredProjectKeys();
  keys[projectId] = apiKey;
  window.localStorage.setItem(projectKeyStorageKey, JSON.stringify(keys));
  saveStoredApiKey(apiKey);
}

export function createApiKey(name: string) {
  return request<CreatedApiKey>("/api-keys", {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export function createProject(name: string) {
  return request<CreatedProject>("/projects", {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

export function revokeApiKey(id: string) {
  return request<ApiKey>(`/api-keys/${id}`, {
    method: "DELETE"
  });
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
  const apiKey = getStoredApiKey();
  return fetch(`/api/webhooks/${id}`, {
    method: "DELETE",
    headers: apiKey ? { "x-arcflow-api-key": apiKey } : {}
  }).then((response) => {
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
