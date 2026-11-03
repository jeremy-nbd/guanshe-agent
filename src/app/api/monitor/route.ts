import { NextResponse } from "next/server";

import { forwardFrontendMonitor } from "@/services/serverMonitoring";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      details?: Record<string, unknown>;
      message?: string;
      type?: string;
    };

    forwardFrontendMonitor({
      details: body.details ?? {},
      message: String(body.message ?? "unknown_frontend_error"),
      type: String(body.type ?? "frontend_error"),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
