import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import postgres from "postgres";
import { localDate, localHour } from "./time";

export type Role = "owner" | "member";

const sql = postgres(process.env.DATABASE_URL || "", {
  ssl: "require",
  max: 1,
  prepare: false,
  connect_timeout: 8,
  idle_timeout: 10,
});

function rows<T>(value: T[]) {
  return value.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(row as Record<string, unknown>)) {
      out[key] = item instanceof Date ? item.toISOString() : item;
    }
    return out as T;
  });
}

async function one<T>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T | undefined> {
  const result = rows(await query);
  return result[0] as T | undefined;
}

async function many<T>(query: postgres.PendingQuery<postgres.Row[]>): Promise<T[]> {
  return rows(await query) as T[];
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString("hex");
}

export function hashCode(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export async function createUser(name: string, email: string, password: string) {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Enter a valid email.");
  if (password.length < 8) throw new Error("Use at least 8 characters.");
  if (name.trim().length < 2) throw new Error("Enter your name.");
  const existing = await one<{ id: string }>(sql`select id from users where email = ${clean}`);
  if (existing) throw new Error("That email already has an account.");
  const salt = randomBytes(16).toString("hex");
  const id = crypto.randomUUID();
  await sql`insert into users (id, email, name, password_hash, salt, timezone) values (${id}, ${clean}, ${name.trim()}, ${hashPassword(password, salt)}, ${salt}, 'Asia/Kolkata')`;
  return id;
}

export async function verifyUser(email: string, password: string) {
  const row = await one<{ id: string; password_hash: string; salt: string }>(sql`select id, password_hash, salt from users where email = ${email.trim().toLowerCase()}`);
  if (!row) throw new Error("Email or password is wrong.");
  const actual = Buffer.from(hashPassword(password, row.salt), "hex");
  const expected = Buffer.from(row.password_hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Email or password is wrong.");
  return row.id;
}

export async function getUser(id: string) {
  return one<{ id: string; email: string; name: string; timezone: string }>(sql`select id, email, name, timezone from users where id = ${id}`);
}

export async function membership(userId: string) {
  return one<{ team_id: string; role: Role; stars: number; team_name: string }>(sql`
    select m.team_id, m.role, m.stars, t.name as team_name
    from members m join teams t on t.id = m.team_id where m.user_id = ${userId}`);
}

async function requireMember(userId: string) {
  const member = await membership(userId);
  if (!member) throw new Error("Join a team first.");
  return member;
}

async function requireOwner(userId: string) {
  const member = await requireMember(userId);
  if (member.role !== "owner") throw new Error("Only the owner can do that.");
  return member;
}

export async function createTeam(userId: string, name: string) {
  if (await membership(userId)) throw new Error("You are already on a team.");
  const title = name.trim();
  if (title.length < 2) throw new Error("Name the team.");
  const id = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  await sql`insert into teams (id, name, created_at) values (${id}, ${title}, ${new Date().toISOString()})`;
  await sql`insert into members (team_id, user_id, role, stars) values (${id}, ${userId}, 'owner', 0)`;
  await sql`insert into channels (id, team_id, name, task_id) values (${channelId}, ${id}, 'general', null)`;
  return id;
}

export async function createInvite(userId: string, email: string, role: Role) {
  const member = await requireOwner(userId);
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Enter the person's email.");
  if (role !== "member" && role !== "owner") throw new Error("Unknown role.");
  const code = randomBytes(16).toString("hex").toUpperCase();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await sql`insert into invites (id, team_id, email, role, code_hash, expires_at, used_at, revoked) values (${crypto.randomUUID()}, ${member.team_id}, ${clean}, ${role}, ${hashCode(code)}, ${expires}, null, 0)`;
  return { code, email: clean, role, expires };
}

export async function revokeInvite(userId: string, inviteId: string) {
  const member = await requireOwner(userId);
  await sql`update invites set revoked = 1 where id = ${inviteId} and team_id = ${member.team_id} and used_at is null`;
}

export async function joinTeam(userId: string, code: string) {
  if (await membership(userId)) throw new Error("You are already on a team.");
  const user = await getUser(userId);
  if (!user) throw new Error("Sign in again.");
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const attempts = await one<{ n: number }>(sql`select count(*)::int as n from join_attempts where user_id = ${userId} and at > ${since}`);
  if ((attempts?.n || 0) >= 8) throw new Error("Too many attempts. Wait a few minutes.");
  await sql`insert into join_attempts (id, user_id, at) values (${crypto.randomUUID()}, ${userId}, ${new Date().toISOString()})`;
  const invite = await one<{ id: string; team_id: string; email: string; role: Role; expires_at: string }>(sql`
    select id, team_id, email, role, expires_at from invites where code_hash = ${hashCode(code)} and revoked = 0 and used_at is null`);
  if (!invite || invite.expires_at < new Date().toISOString()) throw new Error("That code is not valid.");
  if (invite.email !== user.email) throw new Error("This code was issued for a different email.");
  await sql`insert into members (team_id, user_id, role, stars) values (${invite.team_id}, ${userId}, ${invite.role}, 0)`;
  await sql`update invites set used_at = ${new Date().toISOString()} where id = ${invite.id}`;
}

export async function setTimezone(userId: string, timezone: string) {
  try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); } catch { throw new Error("Unknown timezone."); }
  await sql`update users set timezone = ${timezone} where id = ${userId}`;
}

export async function postMessage(userId: string, channelId: string, body: string) {
  const member = await requireMember(userId);
  const channel = await one(sql`select id from channels where id = ${channelId} and team_id = ${member.team_id}`);
  if (!channel) throw new Error("That conversation is not in your team.");
  const text = body.trim();
  if (!text || text.length > 4000) throw new Error("Write a message.");
  await sql`insert into messages (id, channel_id, author_id, body, created_at) values (${crypto.randomUUID()}, ${channelId}, ${userId}, ${text}, ${new Date().toISOString()})`;
  await markRead(userId, channelId);
}

export async function markRead(userId: string, channelId: string) {
  const member = await requireMember(userId);
  const channel = await one(sql`select id from channels where id = ${channelId} and team_id = ${member.team_id}`);
  if (!channel) return;
  const now = new Date().toISOString();
  await sql`insert into reads (user_id, channel_id, last_read) values (${userId}, ${channelId}, ${now})
    on conflict (user_id, channel_id) do update set last_read = excluded.last_read`;
}

export async function createTask(input: {
  userId: string; title: string; description: string; assigneeId: string; deadlineIso: string; googleEventId?: string | null;
}) {
  const member = await requireOwner(input.userId);
  const assignee = await one(sql`select user_id from members where team_id = ${member.team_id} and user_id = ${input.assigneeId}`);
  if (!assignee) throw new Error("That person is not on the team.");
  const title = input.title.trim();
  if (title.length < 2) throw new Error("Name the task.");
  const taskId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  await sql`insert into channels (id, team_id, name, task_id) values (${channelId}, ${member.team_id}, ${title}, ${taskId})`;
  await sql`insert into tasks (id, team_id, title, description, assignee_id, deadline, status, channel_id, google_event_id, created_by)
    values (${taskId}, ${member.team_id}, ${title}, ${input.description.trim()}, ${input.assigneeId}, ${input.deadlineIso}, 'open', ${channelId}, ${input.googleEventId ?? null}, ${input.userId})`;
  return { taskId, channelId, teamId: member.team_id };
}

export async function createDuty(userId: string, title: string, description: string, assigneeId: string) {
  const member = await requireOwner(userId);
  const assignee = await one(sql`select user_id from members where team_id = ${member.team_id} and user_id = ${assigneeId}`);
  if (!assignee) throw new Error("That person is not on the team.");
  if (title.trim().length < 2) throw new Error("Name the duty.");
  await sql`insert into duties (id, team_id, title, description, assignee_id) values (${crypto.randomUUID()}, ${member.team_id}, ${title.trim()}, ${description.trim()}, ${assigneeId})`;
}

export async function addProof(userId: string, taskId: string, note: string, fileName: string | null, fileBytes: Buffer | null) {
  const member = await requireMember(userId);
  const task = await one<{ assignee_id: string; status: string }>(sql`select assignee_id, status from tasks where id = ${taskId} and team_id = ${member.team_id}`);
  if (!task) throw new Error("Task not found.");
  if (task.assignee_id !== userId) throw new Error("Only the assignee can submit proof.");
  if (task.status === "approved") throw new Error("This task is already approved.");
  if (!note.trim() && !fileBytes) throw new Error("Add a note or a file.");
  await sql`insert into proofs (id, task_id, user_id, note, file_name, file_bytes, created_at) values (${crypto.randomUUID()}, ${taskId}, ${userId}, ${note.trim()}, ${fileName}, ${fileBytes}, ${new Date().toISOString()})`;
  await sql`update tasks set status = 'submitted' where id = ${taskId}`;
}

export async function updateTask(userId: string, taskId: string, title: string, deadlineIso: string, assigneeId: string) {
  const member = await requireOwner(userId);
  const task = await one(sql`select id from tasks where id = ${taskId} and team_id = ${member.team_id}`);
  if (!task) throw new Error("Task not found.");
  const assignee = await one(sql`select user_id from members where team_id = ${member.team_id} and user_id = ${assigneeId}`);
  if (!assignee) throw new Error("That person is not on the team.");
  if (title.trim().length < 2) throw new Error("Name the task.");
  await sql`update tasks set title = ${title.trim()}, deadline = ${deadlineIso}, assignee_id = ${assigneeId} where id = ${taskId}`;
  await sql`update channels set name = ${title.trim()} where task_id = ${taskId}`;
}

export async function cancelMeeting(userId: string, meetingId: string) {
  const member = await requireOwner(userId);
  const meeting = await one(sql`select id from meetings where id = ${meetingId} and team_id = ${member.team_id}`);
  if (!meeting) throw new Error("Meeting not found.");
  await sql`delete from meeting_attendees where meeting_id = ${meetingId}`;
  await sql`delete from meetings where id = ${meetingId}`;
}

export async function reviewTask(userId: string, taskId: string, decision: "approved" | "rejected", stars: number, comment: string) {
  const member = await requireOwner(userId);
  const task = await one<{ assignee_id: string; status: string }>(sql`select assignee_id, status from tasks where id = ${taskId} and team_id = ${member.team_id}`);
  if (!task) throw new Error("Task not found.");
  if (task.status !== "submitted" && task.status !== "rejected" && task.status !== "open") throw new Error("This task cannot be reviewed.");
  const award = decision === "approved" ? Math.max(0, Math.min(5, Math.round(stars))) : 0;
  await sql`insert into reviews (id, task_id, reviewer_id, decision, stars, comment, created_at) values (${crypto.randomUUID()}, ${taskId}, ${userId}, ${decision}, ${award}, ${comment.trim()}, ${new Date().toISOString()})`;
  await sql`update tasks set status = ${decision} where id = ${taskId}`;
  if (award) await sql`update members set stars = stars + ${award} where team_id = ${member.team_id} and user_id = ${task.assignee_id}`;
}

export async function createMeeting(input: {
  userId: string; title: string; startsIso: string; endsIso: string; attendeeIds: string[]; meetLink?: string | null; googleEventId?: string | null;
}) {
  const member = await requireOwner(input.userId);
  if (input.title.trim().length < 2) throw new Error("Name the meeting.");
  if (input.endsIso <= input.startsIso) throw new Error("End time must be after the start.");
  const id = crypto.randomUUID();
  await sql`insert into meetings (id, team_id, title, starts_at, ends_at, meet_link, google_event_id, created_by)
    values (${id}, ${member.team_id}, ${input.title.trim()}, ${input.startsIso}, ${input.endsIso}, ${input.meetLink ?? null}, ${input.googleEventId ?? null}, ${input.userId})`;
  for (const person of new Set([input.userId, ...input.attendeeIds])) {
    const ok = await one(sql`select user_id from members where team_id = ${member.team_id} and user_id = ${person}`);
    if (ok) await sql`insert into meeting_attendees (meeting_id, user_id) values (${id}, ${person}) on conflict do nothing`;
  }
  return id;
}

export async function getGoogleConnection(userId: string) {
  return one<{ refresh_token: string; email: string }>(sql`select refresh_token, email from google_connections where user_id = ${userId}`);
}

export async function saveGoogleConnection(userId: string, refreshToken: string, email: string) {
  await sql`insert into google_connections (user_id, refresh_token, email) values (${userId}, ${refreshToken}, ${email})
    on conflict (user_id) do update set refresh_token = excluded.refresh_token, email = excluded.email`;
}

export async function googleConnected(userId: string) {
  return Boolean(await getGoogleConnection(userId));
}

export async function teamOwnerId(teamId: string) {
  const row = await one<{ user_id: string }>(sql`select user_id from members where team_id = ${teamId} and role = 'owner' limit 1`);
  return row?.user_id;
}

export async function memberEmail(userId: string) {
  return (await getUser(userId))?.email || "";
}

export async function proofFile(userId: string, proofId: string) {
  const member = await requireMember(userId);
  const row = await one<{ file_name: string | null; file_bytes: Buffer | null }>(sql`
    select p.file_name, p.file_bytes from proofs p join tasks t on t.id = p.task_id
    where p.id = ${proofId} and t.team_id = ${member.team_id}`);
  if (!row?.file_bytes) return null;
  return row;
}

export async function dueReminders(force: boolean) {
  const list = await many<{ task_id: string; title: string; deadline: string; assignee_id: string; team_id: string; email: string; timezone: string; name: string }>(sql`
    select t.id as task_id, t.title, t.deadline, t.assignee_id, t.team_id, u.email, u.timezone, u.name
    from tasks t join users u on u.id = t.assignee_id where t.status in ('open', 'rejected')`);
  const due = [];
  for (const row of list) {
    const date = localDate(row.timezone);
    if (!force && localHour(row.timezone) !== 9) continue;
    const sent = await one(sql`select id from reminders where task_id = ${row.task_id} and user_id = ${row.assignee_id} and local_date = ${date}`);
    if (sent) continue;
    due.push({ ...row, local_date: date });
  }
  return due;
}

export async function recordReminder(taskId: string, userId: string, local: string) {
  await sql`insert into reminders (id, task_id, user_id, local_date, created_at) values (${crypto.randomUUID()}, ${taskId}, ${userId}, ${local}, ${new Date().toISOString()})`;
}

export async function ensureDemo() {
  const existing = await one(sql`select id from users where email = 'demo@team.app'`);
  if (existing) return;
  const ownerId = await createUser("Demo Owner", "demo@team.app", "demo1234");
  const memberId = await createUser("Demo Member", "member@team.app", "demo1234");
  await setTimezone(memberId, "Europe/Berlin");
  const teamId = await createTeam(ownerId, "North studio");
  await sql`insert into members (team_id, user_id, role, stars) values (${teamId}, ${memberId}, 'member', 4)`;
  const channel = await one<{ id: string }>(sql`select id from channels where team_id = ${teamId} and task_id is null`);
  if (channel) {
    await sql`insert into messages (id, channel_id, author_id, body, created_at) values (${crypto.randomUUID()}, ${channel.id}, ${ownerId}, 'Welcome to North studio. Your open task is on Home.', ${new Date().toISOString()})`;
  }
  const deadline = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  await createTask({ userId: ownerId, title: "Send the weekly notes", description: "Write what shipped and what is blocked.", assigneeId: memberId, deadlineIso: deadline });
  await createDuty(ownerId, "Inbox check", "Look at new messages each morning.", memberId);
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();
  await createMeeting({ userId: ownerId, title: "Weekly standup", startsIso: start, endsIso: end, attendeeIds: [memberId] });
}

export async function snapshot(userId: string) {
  const user = await getUser(userId);
  if (!user) return null;
  const member = await membership(userId);
  const google = await googleConnected(userId);
  if (!member) return { user, team: null, google };
  const teamId = member.team_id;
  const [people, channels, messages, tasks, duties, proofs, reviews, meetings, attendees, reminders, invites] = await Promise.all([
    many(sql`select u.id, u.name, u.email, u.timezone, m.role, m.stars from members m join users u on u.id = m.user_id where m.team_id = ${teamId} order by u.name`),
    many(sql`select c.*, (select count(*)::int from messages msg where msg.channel_id = c.id and msg.created_at > coalesce((select last_read from reads r where r.user_id = ${userId} and r.channel_id = c.id), '1970-01-01')) as unread from channels c where c.team_id = ${teamId} order by (c.task_id is not null), c.name`),
    many(sql`select msg.id, msg.channel_id, msg.body, msg.created_at, u.name as author_name from messages msg join channels c on c.id = msg.channel_id join users u on u.id = msg.author_id where c.team_id = ${teamId} order by msg.created_at`),
    many(sql`select * from tasks where team_id = ${teamId} order by deadline`),
    many(sql`select * from duties where team_id = ${teamId}`),
    many(sql`select p.id, p.task_id, p.user_id, p.note, p.file_name, p.created_at from proofs p join tasks t on t.id = p.task_id where t.team_id = ${teamId} order by p.created_at`),
    many(sql`select r.* from reviews r join tasks t on t.id = r.task_id where t.team_id = ${teamId} order by r.created_at`),
    many(sql`select * from meetings where team_id = ${teamId} order by starts_at`),
    many(sql`select a.meeting_id, a.user_id from meeting_attendees a join meetings m on m.id = a.meeting_id where m.team_id = ${teamId}`),
    many(sql`select r.id, r.local_date, t.title from reminders r join tasks t on t.id = r.task_id where r.user_id = ${userId} order by r.created_at desc limit 30`),
    member.role === "owner"
      ? many(sql`select id, email, role, expires_at, used_at, revoked from invites where team_id = ${teamId} order by expires_at desc`)
      : Promise.resolve([]),
  ]);
  return {
    user, team: { id: member.team_id, name: member.team_name, role: member.role }, google,
    people, channels, messages, tasks, duties, proofs, reviews, meetings, attendees, reminders, invites,
  };
}
