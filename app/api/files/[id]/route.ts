import { NextResponse } from "next/server";
import { proofFile } from "@/lib/db";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return new NextResponse("Sign in.", { status: 401 });
  const { id } = await context.params;
  const file = await proofFile(userId, id);
  if (!file?.file_bytes) return new NextResponse("Not found.", { status: 404 });
  const bytes = Buffer.isBuffer(file.file_bytes) ? file.file_bytes : Buffer.from(file.file_bytes);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Disposition": `inline; filename="${file.file_name || "proof"}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
