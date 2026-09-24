import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { cookies } from "next/headers";

export function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dir = path.join(process.cwd(), "data");
  const file = path.join(dir, "session.secret");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"));
  return readFileSync(file, "utf8");
}

export function signSession(userId: string) {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 14;
  const payload = `${userId}.${exp}`;
  const mac = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `${payload}.${mac}`;
}

export function readSessionToken(token: string | undefined) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;
  const payload = `${userId}.${exp}`;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  return userId;
}

export async function currentUserId() {
  const jar = await cookies();
  return readSessionToken(jar.get("tm_session")?.value);
}

export function sessionCookie(token: string) {
  return {
    name: "tm_session",
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    },
  };
}
