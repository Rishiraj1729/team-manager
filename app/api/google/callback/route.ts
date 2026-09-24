import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google";
import { currentUserId, sessionSecret } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = await currentUserId();
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  if (!userId || !code) return NextResponse.redirect(new URL("/home?google=failed", request.url));
  const [mac, stateUser] = state.split(".");
  const expected = createHmac("sha256", sessionSecret()).update(userId).digest("hex");
  const a = Buffer.from(mac || "");
  const b = Buffer.from(expected);
  if (stateUser !== userId || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.redirect(new URL("/home?google=failed", request.url));
  }
  try {
    await exchangeCode(code, url.origin, userId);
    return NextResponse.redirect(new URL("/home?google=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/home?google=failed", request.url));
  }
}
