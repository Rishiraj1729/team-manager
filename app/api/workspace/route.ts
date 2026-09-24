import { NextResponse } from "next/server";
import {
  createDuty,
  createInvite,
  createMeeting,
  createTask,
  createTeam,
  dueReminders,
  joinTeam,
  markRead,
  memberEmail,
  postMessage,
  recordReminder,
  reviewTask,
  revokeInvite,
  setTimezone,
  snapshot,
  teamOwnerId,
  updateTask,
  cancelMeeting,
} from "@/lib/db";
import { createCalendarEvent, googleConfigured, sendGmail } from "@/lib/google";
import { currentUserId } from "@/lib/session";
import { formatInZone, zonedInputToUtc } from "@/lib/time";

export const runtime = "nodejs";

async function deliverReminders(force: boolean) {
  const due = await dueReminders(force);
  for (const item of due) {
    const ownerId = await teamOwnerId(item.team_id);
    const when = formatInZone(item.deadline, item.timezone);
    if (ownerId) {
      await sendGmail(
        ownerId,
        item.email,
        `Reminder: ${item.title}`,
        `Hi ${item.name},\n\n${item.title} is still open. Your deadline is ${when}.\n`
      );
    }
    await recordReminder(item.task_id, item.assignee_id, item.local_date);
  }
  return due.length;
}

export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const force = new URL(request.url).searchParams.get("remind") === "1";
  let sent = 0;
  if (force) {
    const data = await snapshot(userId);
    if (!data || !("team" in data) || !data.team || data.team.role !== "owner") {
      return NextResponse.json({ error: "Only the owner can send reminders." }, { status: 403 });
    }
    sent = await deliverReminders(true);
  }
  const data = await snapshot(userId);
  if (!data?.user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  return NextResponse.json({ ...data, remindersSent: sent, googleReady: googleConfigured() });
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const body = await request.json();
  try {
    const me = await snapshot(userId);
    const zone = me?.user.timezone || "Asia/Kolkata";
    switch (body.type) {
      case "createTeam":
        await createTeam(userId, String(body.name || ""));
        break;
      case "invite":
        return NextResponse.json({ invite: await createInvite(userId, String(body.email || ""), body.role === "owner" ? "owner" : "member") });
      case "revoke":
        await revokeInvite(userId, String(body.inviteId || ""));
        break;
      case "join":
        await joinTeam(userId, String(body.code || ""));
        break;
      case "timezone":
        await setTimezone(userId, String(body.timezone || ""));
        break;
      case "message":
        await postMessage(userId, String(body.channelId || ""), String(body.body || ""));
        break;
      case "read":
        await markRead(userId, String(body.channelId || ""));
        break;
      case "task": {
        const deadlineIso = zonedInputToUtc(String(body.deadline || ""), zone);
        const end = new Date(new Date(deadlineIso).getTime() + 30 * 60 * 1000).toISOString();
        const email = await memberEmail(String(body.assigneeId || ""));
        const event = await createCalendarEvent(userId, {
          summary: String(body.title || ""),
          description: String(body.description || ""),
          startIso: deadlineIso,
          endIso: end,
          attendeeEmails: email ? [email] : [],
          withMeet: false,
          timeZone: zone,
        });
        const created = await createTask({
          userId,
          title: String(body.title || ""),
          description: String(body.description || ""),
          assigneeId: String(body.assigneeId || ""),
          deadlineIso,
          googleEventId: event?.eventId,
        });
        return NextResponse.json({ ...(await snapshot(userId)), channelId: created.channelId });
      }
      case "duty":
        await createDuty(userId, String(body.title || ""), String(body.description || ""), String(body.assigneeId || ""));
        break;
      case "updateTask": {
        const deadlineIso = zonedInputToUtc(String(body.deadline || ""), zone);
        await updateTask(userId, String(body.taskId || ""), String(body.title || ""), deadlineIso, String(body.assigneeId || ""));
        break;
      }
      case "cancelMeeting":
        await cancelMeeting(userId, String(body.meetingId || ""));
        break;
      case "review":
        await reviewTask(
          userId,
          String(body.taskId || ""),
          body.decision === "approved" ? "approved" : "rejected",
          Number(body.stars || 0),
          String(body.comment || "")
        );
        break;
      case "meeting": {
        const startsIso = zonedInputToUtc(String(body.starts || ""), zone);
        const endsIso = zonedInputToUtc(String(body.ends || ""), zone);
        const ids = Array.isArray(body.attendeeIds) ? body.attendeeIds.map(String) : [];
        const emails = (await Promise.all(ids.map((id: string) => memberEmail(id)))).filter(Boolean);
        const event = await createCalendarEvent(userId, {
          summary: String(body.title || ""),
          description: "Scheduled in Team",
          startIso: startsIso,
          endIso: endsIso,
          attendeeEmails: emails,
          withMeet: true,
          timeZone: zone,
        });
        await createMeeting({
          userId,
          title: String(body.title || ""),
          startsIso,
          endsIso,
          attendeeIds: ids,
          meetLink: event?.meetLink,
          googleEventId: event?.eventId,
        });
        break;
      }
      default:
        throw new Error("Unknown action.");
    }
    return NextResponse.json(await snapshot(userId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
