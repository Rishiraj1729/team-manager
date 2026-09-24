import { NextResponse } from "next/server";
import { googleAuthUrl, googleConfigured } from "@/lib/google";
import { currentUserId, sessionSecret } from "@/lib/session";
import { createHmac } from "crypto";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(new URL("/", request.url));
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/home?google=missing", request.url));
  }
  const origin = new URL(request.url).origin;
  const state = createHmac("sha256", sessionSecret()).update(userId).digest("hex") + "." + userId;
  return NextResponse.redirect(googleAuthUrl(state, origin));
}
