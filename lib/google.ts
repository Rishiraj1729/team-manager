import { getGoogleConnection, saveGoogleConnection } from "./db";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "openid",
  "email",
].join(" ");

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(state: string, origin: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", `${origin}/api/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

async function accessToken(userId: string) {
  const row = getGoogleConnection(userId);
  if (!row) return null;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    refresh_token: row.refresh_token,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

export async function exchangeCode(code: string, origin: string, userId: string) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: `${origin}/api/google/callback`,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error("Google did not accept the connection.");
  const json = (await res.json()) as { refresh_token?: string; access_token?: string };
  if (!json.refresh_token) throw new Error("Google did not return a refresh token. Try connecting again.");
  let email = "";
  if (json.access_token) {
    const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${json.access_token}` },
    });
    if (info.ok) {
      const profile = (await info.json()) as { email?: string };
      email = profile.email || "";
    }
  }
  saveGoogleConnection(userId, json.refresh_token, email);
}

export async function createCalendarEvent(ownerId: string, input: {
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  attendeeEmails: string[];
  withMeet: boolean;
  timeZone: string;
}) {
  const token = await accessToken(ownerId);
  if (!token) return null;
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startIso, timeZone: input.timeZone },
      end: { dateTime: input.endIso, timeZone: input.timeZone },
      attendees: input.attendeeEmails.map((email) => ({ email })),
      conferenceData: input.withMeet
        ? { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
        : undefined,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] };
  };
  const meet = json.hangoutLink
    || json.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri
    || null;
  return { eventId: json.id || null, meetLink: meet };
}

export async function sendGmail(ownerId: string, to: string, subject: string, text: string) {
  const token = await accessToken(ownerId);
  const conn = getGoogleConnection(ownerId);
  if (!token || !conn) return false;
  const from = conn.email || "me";
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
  ].join("\r\n");
  const encoded = Buffer.from(raw).toString("base64url");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });
  return res.ok;
}
