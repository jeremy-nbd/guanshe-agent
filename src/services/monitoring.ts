type FrontendMonitorPayload = {
  details?: Record<string, unknown>;
  message: string;
  type: "frontend_error" | "frontend_rejection";
};

function shouldLogVerboseError() {
  return process.env.NODE_ENV !== "production";
}

export function getSafeUserErrorMessage(
  fallback: string,
  error: unknown,
  options?: { allowListedMessages?: string[] },
) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const allowListedMessages = options?.allowListedMessages ?? [];

  if (allowListedMessages.includes(error.message)) {
    return error.message;
  }

  return shouldLogVerboseError() ? error.message : fallback;
}

export async function reportFrontendEvent(payload: FrontendMonitorPayload) {
  try {
    const body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/monitor", blob);
      return;
    }

    await fetch("/api/monitor", {
      body,
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
      method: "POST",
    });
  } catch {
    // Swallow monitoring failures to avoid interfering with user flows.
  }
}
