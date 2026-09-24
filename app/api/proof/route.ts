import { NextResponse } from "next/server";
import { addProof, membership } from "@/lib/db";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]);

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const member = await membership(userId);
  if (!member) return NextResponse.json({ error: "Join a team first." }, { status: 400 });
  const form = await request.formData();
  const taskId = String(form.get("taskId") || "");
  const note = String(form.get("note") || "");
  const file = form.get("file");
  let fileName: string | null = null;
  let fileBytes: Buffer | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Files must be under 8 MB." }, { status: 400 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "Use a PNG, JPG, WEBP, GIF, or PDF." }, { status: 400 });
    fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) || "proof";
    fileBytes = Buffer.from(await file.arrayBuffer());
  }
  try {
    await addProof(userId, taskId, note, fileName, fileBytes);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save proof.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
