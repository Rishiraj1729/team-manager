import { NextResponse } from "next/server";
import { createUser, verifyUser } from "@/lib/db";
import { currentUserId, sessionCookie, signSession } from "@/lib/session";
import { snapshot } from "@/lib/db";

export const runtime = "nodejs";
export const preferredRegion = "bom1";
export const maxDuration = 15;

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ user: null });
  return NextResponse.json(await snapshot(userId));
}

export async function POST(request: Request) {
  const body = await request.json();
  try {
    const userId = body.mode === "signup"
      ? await createUser(String(body.name || ""), String(body.email || ""), String(body.password || ""))
      : await verifyUser(String(body.email || ""), String(body.password || ""));
    const cookie = sessionCookie(signSession(userId));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Could not sign in.";
    const message = /timeout|ENOTFOUND|connect/i.test(raw) ? "The database is slow right now. Try again." : raw;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("tm_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
