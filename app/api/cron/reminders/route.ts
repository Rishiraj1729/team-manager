import { NextResponse } from "next/server";
import { dueReminders, recordReminder, teamOwnerId } from "@/lib/db";
import { sendGmail } from "@/lib/google";
import { formatInZone } from "@/lib/time";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const due = await dueReminders(false);
  for (const item of due) {
    const ownerId = await teamOwnerId(item.team_id);
    if (ownerId) {
      await sendGmail(
        ownerId,
        item.email,
        `Reminder: ${item.title}`,
        `Hi ${item.name},\n\n${item.title} is still open. Your deadline is ${formatInZone(item.deadline, item.timezone)}.\n`
      );
    }
    await recordReminder(item.task_id, item.assignee_id, item.local_date);
  }
  return NextResponse.json({ sent: due.length });
}
