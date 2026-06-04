import React, { createContext, useContext, useMemo, useState } from "react";
import { ArcFlow } from "../../sdk/src/index";
import type { ArcFlowConfig, PaymentIntent } from "../../sdk/src/index";

type ArcFlowContextValue = {
  client: ArcFlow;
};

const ArcFlowContext = createContext<ArcFlowContextValue | null>(null);

export type ArcFlowProviderProps = ArcFlowConfig & {
  children: React.ReactNode;
};

export function ArcFlowProvider({ children, ...config }: ArcFlowProviderProps) {
  const client = useMemo(() => new ArcFlow(config), [config.apiKey, config.baseUrl, config.fetcher]);
  return <ArcFlowContext.Provider value={{ client }}>{children}</ArcFlowContext.Provider>;
}

export function useArcFlow() {
  const context = useContext(ArcFlowContext);
  if (!context) {
    throw new Error("useArcFlow must be used inside ArcFlowProvider.");
  }
  return context.client;
}

export type PaymentButtonProps = {
  intentId: string;
  children?: React.ReactNode;
  className?: string;
  onIntentLoaded?: (intent: PaymentIntent) => void;
};

export function PaymentButton({ intentId, children = "Pay with ArcFlow", className, onIntentLoaded }: PaymentButtonProps) {
  const arcflow = useArcFlow();
  const [loading, setLoading] = useState(false);

  async function openCheckout() {
    setLoading(true);
    try {
      const intent = await arcflow.paymentIntents.get(intentId);
      onIntentLoaded?.(intent);
      window.location.href = intent.checkoutUrl;
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className={className} onClick={openCheckout} disabled={loading} type="button">
      {loading ? "Opening checkout..." : children}
    </button>
  );
}

export type { ArcFlowConfig, PaymentIntent };
