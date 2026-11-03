type ApiMetric = {
  durationMs: number;
  ok: boolean;
  route: string;
  status: number;
};

type FrontendMonitorPayload = {
  details?: Record<string, unknown>;
  message: string;
  type: string;
};

type MonitoringEvent =
  | {
      data: ApiMetric;
      kind: "api_metric";
    }
  | {
      data: {
        error:
          | {
              message: string;
              name: string;
              stack?: string;
            }
          | "unknown_error";
        route: string;
      };
      kind: "api_error";
    }
  | {
      data: FrontendMonitorPayload;
      kind: "frontend_event";
    };

function getMonitoringHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = process.env.MONITORING_WEBHOOK_AUTH_TOKEN;
  const customHeaderName = process.env.MONITORING_WEBHOOK_HEADER_NAME;

  if (token && customHeaderName) {
    headers[customHeaderName] = token;
    return headers;
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function buildEnvelope(event: MonitoringEvent) {
  return {
    app: "bitwins",
    environment: process.env.NODE_ENV ?? "development",
    event,
    timestamp: new Date().toISOString(),
  };
}

async function sendToMonitoringPlatform(event: MonitoringEvent) {
  const webhookUrl = process.env.MONITORING_WEBHOOK_URL;
  const envelope = buildEnvelope(event);

  if (!webhookUrl) {
    console.info("[monitoring-fallback]", JSON.stringify(envelope));
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      body: JSON.stringify(envelope),
      headers: getMonitoringHeaders(),
      method: "POST",
    });

    if (!response.ok) {
      console.error(
        "[monitoring-delivery-failed]",
        JSON.stringify({
          kind: event.kind,
          status: response.status,
        }),
      );
    }
  } catch (error) {
    console.error(
      "[monitoring-delivery-error]",
      JSON.stringify({
        error: error instanceof Error ? error.message : "unknown_error",
        kind: event.kind,
      }),
    );
  }
}

export function logApiMetric(metric: ApiMetric) {
  void sendToMonitoringPlatform({
    data: metric,
    kind: "api_metric",
  });
}

export function logApiError(route: string, error: unknown) {
  void sendToMonitoringPlatform({
    data: {
      error:
        error instanceof Error
          ? {
              message: error.message,
              name: error.name,
              stack: error.stack,
            }
          : "unknown_error",
      route,
    },
    kind: "api_error",
  });
}

export function forwardFrontendMonitor(payload: FrontendMonitorPayload) {
  void sendToMonitoringPlatform({
    data: payload,
    kind: "frontend_event",
  });
}
