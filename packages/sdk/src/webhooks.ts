import crypto from "node:crypto";
import type { ArcFlowWebhookEvent } from "./types";

export type VerifyWebhookInput = {
  payload: string | Buffer;
  signature: string | string[] | undefined;
  secret: string;
};

export function signArcFlowWebhook(payload: string | Buffer, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyArcFlowWebhook(input: VerifyWebhookInput): ArcFlowWebhookEvent {
  const signature = Array.isArray(input.signature) ? input.signature[0] : input.signature;
  if (!signature) {
    throw new Error("Missing x-arcflow-signature header.");
  }

  const expected = signArcFlowWebhook(input.payload, input.secret);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");

  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error("Invalid ArcFlow webhook signature.");
  }

  return JSON.parse(input.payload.toString()) as ArcFlowWebhookEvent;
}
