import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { mkdirSync } from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { localDate, localHour } from "./time";

export type Role = "owner" | "member";

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  salt: string;
  timezone: string;
};

let db: DatabaseSync | null = null;

function database() {
  if (db) return db;
  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, "uploads"), { recursive: true });
  db = new DatabaseSync(path.join(dir, "app.sqlite"));
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata'
    );
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      stars INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (team_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      name TEXT NOT NULL,
      task_id TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reads (
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      last_read TEXT NOT NULL,
      PRIMARY KEY (user_id, channel_id)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      assignee_id TEXT NOT NULL,
      deadline TEXT NOT NULL,
      status TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      google_event_id TEXT,
      created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS duties (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      assignee_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS proofs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      note TEXT NOT NULL,
      file_path TEXT,
      file_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      stars INTEGER NOT NULL DEFAULT 0,
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      title TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      meet_link TEXT,
      google_event_id TEXT,
      created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meeting_attendees (
      meeting_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (meeting_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      local_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS join_attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS google_connections (
      user_id TEXT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      email TEXT NOT NULL
    );
  `);
  return db;
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString("hex");
}

export function hashCode(code: string) {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function createUser(name: string, email: string, password: string) {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Enter a valid email.");
  if (password.length < 8) throw new Error("Use at least 8 characters.");
  if (name.trim().length < 2) throw new Error("Enter your name.");
  const existing = database().prepare("SELECT id FROM users WHERE email = ?").get(clean) as { id: string } | undefined;
  if (existing) throw new Error("That email already has an account.");
  const salt = randomBytes(16).toString("hex");
  const id = crypto.randomUUID();
  database().prepare(
    "INSERT INTO users (id, email, name, password_hash, salt, timezone) VALUES (?, ?, ?, ?, ?, 'Asia/Kolkata')"
  ).run(id, clean, name.trim(), hashPassword(password, salt), salt);
  return id;
}

export function verifyUser(email: string, password: string) {
  const row = database().prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!row) throw new Error("Email or password is wrong.");
  const actual = Buffer.from(hashPassword(password, row.salt), "hex");
  const expected = Buffer.from(row.password_hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Email or password is wrong.");
  }
  return row.id;
}

export function getUser(id: string) {
  return database().prepare("SELECT id, email, name, timezone FROM users WHERE id = ?").get(id) as
    | { id: string; email: string; name: string; timezone: string }
    | undefined;
}

export function membership(userId: string) {
  return database().prepare(
    `SELECT m.team_id, m.role, m.stars, t.name AS team_name
     FROM members m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ?`
  ).get(userId) as { team_id: string; role: Role; stars: number; team_name: string } | undefined;
}

function requireMember(userId: string) {
  const member = membership(userId);
  if (!member) throw new Error("Join a team first.");
  return member;
}

function requireOwner(userId: string) {
  const member = requireMember(userId);
  if (member.role !== "owner") throw new Error("Only the owner can do that.");
  return member;
}

export function createTeam(userId: string, name: string) {
  if (membership(userId)) throw new Error("You are already on a team.");
  const title = name.trim();
  if (title.length < 2) throw new Error("Name the team.");
  const id = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  const now = new Date().toISOString();
  const d = database();
  d.prepare("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)").run(id, title, now);
  d.prepare("INSERT INTO members (team_id, user_id, role, stars) VALUES (?, ?, 'owner', 0)").run(id, userId);
  d.prepare("INSERT INTO channels (id, team_id, name, task_id) VALUES (?, ?, 'general', NULL)").run(channelId, id);
  return id;
}

export function createInvite(userId: string, email: string, role: Role) {
  const member = requireOwner(userId);
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Enter the person's email.");
  if (role !== "member" && role !== "owner") throw new Error("Unknown role.");
  const code = randomBytes(16).toString("hex").toUpperCase();
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  database().prepare(
    "INSERT INTO invites (id, team_id, email, role, code_hash, expires_at, used_at, revoked) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)"
  ).run(id, member.team_id, clean, role, hashCode(code), expires);
  return { code, email: clean, role, expires };
}

export function revokeInvite(userId: string, inviteId: string) {
  const member = requireOwner(userId);
  database().prepare("UPDATE invites SET revoked = 1 WHERE id = ? AND team_id = ? AND used_at IS NULL").run(inviteId, member.team_id);
}

export function joinTeam(userId: string, code: string) {
  if (membership(userId)) throw new Error("You are already on a team.");
  const user = getUser(userId);
  if (!user) throw new Error("Sign in again.");
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const attempts = database().prepare(
    "SELECT COUNT(*) AS n FROM join_attempts WHERE user_id = ? AND at > ?"
  ).get(userId, since) as { n: number };
  if (attempts.n >= 8) throw new Error("Too many attempts. Wait a few minutes.");
  database().prepare("INSERT INTO join_attempts (id, user_id, at) VALUES (?, ?, ?)").run(crypto.randomUUID(), userId, new Date().toISOString());
  const invite = database().prepare(
    "SELECT * FROM invites WHERE code_hash = ? AND revoked = 0 AND used_at IS NULL"
  ).get(hashCode(code)) as { id: string; team_id: string; email: string; role: Role; expires_at: string } | undefined;
  if (!invite || invite.expires_at < new Date().toISOString()) throw new Error("That code is not valid.");
  if (invite.email !== user.email) throw new Error("This code was issued for a different email.");
  database().prepare("INSERT INTO members (team_id, user_id, role, stars) VALUES (?, ?, ?, 0)").run(invite.team_id, userId, invite.role);
  database().prepare("UPDATE invites SET used_at = ? WHERE id = ?").run(new Date().toISOString(), invite.id);
}

export function setTimezone(userId: string, timezone: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new Error("Unknown timezone.");
  }
  database().prepare("UPDATE users SET timezone = ? WHERE id = ?").run(timezone, userId);
}

export function postMessage(userId: string, channelId: string, body: string) {
  const member = requireMember(userId);
  const channel = database().prepare("SELECT id FROM channels WHERE id = ? AND team_id = ?").get(channelId, member.team_id);
  if (!channel) throw new Error("That conversation is not in your team.");
  const text = body.trim();
  if (!text || text.length > 4000) throw new Error("Write a message.");
  database().prepare(
    "INSERT INTO messages (id, channel_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), channelId, userId, text, new Date().toISOString());
  markRead(userId, channelId);
}

export function markRead(userId: string, channelId: string) {
  const member = requireMember(userId);
  const channel = database().prepare("SELECT id FROM channels WHERE id = ? AND team_id = ?").get(channelId, member.team_id);
  if (!channel) return;
  database().prepare(
    `INSERT INTO reads (user_id, channel_id, last_read) VALUES (?, ?, ?)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read = excluded.last_read`
  ).run(userId, channelId, new Date().toISOString());
}

export function createTask(input: {
  userId: string;
  title: string;
  description: string;
  assigneeId: string;
  deadlineIso: string;
  googleEventId?: string | null;
}) {
  const member = requireOwner(input.userId);
  const assignee = database().prepare(
    "SELECT user_id FROM members WHERE team_id = ? AND user_id = ?"
  ).get(member.team_id, input.assigneeId);
  if (!assignee) throw new Error("That person is not on the team.");
  const title = input.title.trim();
  if (title.length < 2) throw new Error("Name the task.");
  const taskId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  const d = database();
  d.prepare("INSERT INTO channels (id, team_id, name, task_id) VALUES (?, ?, ?, ?)").run(channelId, member.team_id, title, taskId);
  d.prepare(
    `INSERT INTO tasks (id, team_id, title, description, assignee_id, deadline, status, channel_id, google_event_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
  ).run(taskId, member.team_id, title, input.description.trim(), input.assigneeId, input.deadlineIso, channelId, input.googleEventId ?? null, input.userId);
  return { taskId, channelId, teamId: member.team_id };
}

export function createDuty(userId: string, title: string, description: string, assigneeId: string) {
  const member = requireOwner(userId);
  const assignee = database().prepare("SELECT user_id FROM members WHERE team_id = ? AND user_id = ?").get(member.team_id, assigneeId);
  if (!assignee) throw new Error("That person is not on the team.");
  if (title.trim().length < 2) throw new Error("Name the duty.");
  database().prepare(
    "INSERT INTO duties (id, team_id, title, description, assignee_id) VALUES (?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), member.team_id, title.trim(), description.trim(), assigneeId);
}

export function addProof(userId: string, taskId: string, note: string, filePath: string | null, fileName: string | null) {
  const member = requireMember(userId);
  const task = database().prepare("SELECT * FROM tasks WHERE id = ? AND team_id = ?").get(taskId, member.team_id) as { assignee_id: string; status: string } | undefined;
  if (!task) throw new Error("Task not found.");
  if (task.assignee_id !== userId) throw new Error("Only the assignee can submit proof.");
  if (task.status === "approved") throw new Error("This task is already approved.");
  if (!note.trim() && !filePath) throw new Error("Add a note or a file.");
  database().prepare(
    "INSERT INTO proofs (id, task_id, user_id, note, file_path, file_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), taskId, userId, note.trim(), filePath, fileName, new Date().toISOString());
  database().prepare("UPDATE tasks SET status = 'submitted' WHERE id = ?").run(taskId);
}

export function updateTask(userId: string, taskId: string, title: string, deadlineIso: string, assigneeId: string) {
  const member = requireOwner(userId);
  const task = database().prepare("SELECT id FROM tasks WHERE id = ? AND team_id = ?").get(taskId, member.team_id);
  if (!task) throw new Error("Task not found.");
  const assignee = database().prepare("SELECT user_id FROM members WHERE team_id = ? AND user_id = ?").get(member.team_id, assigneeId);
  if (!assignee) throw new Error("That person is not on the team.");
  if (title.trim().length < 2) throw new Error("Name the task.");
  database().prepare("UPDATE tasks SET title = ?, deadline = ?, assignee_id = ? WHERE id = ?").run(title.trim(), deadlineIso, assigneeId, taskId);
  database().prepare("UPDATE channels SET name = ? WHERE task_id = ?").run(title.trim(), taskId);
}

export function cancelMeeting(userId: string, meetingId: string) {
  const member = requireOwner(userId);
  const meeting = database().prepare("SELECT id FROM meetings WHERE id = ? AND team_id = ?").get(meetingId, member.team_id);
  if (!meeting) throw new Error("Meeting not found.");
  database().prepare("DELETE FROM meeting_attendees WHERE meeting_id = ?").run(meetingId);
  database().prepare("DELETE FROM meetings WHERE id = ?").run(meetingId);
}

export function reviewTask(userId: string, taskId: string, decision: "approved" | "rejected", stars: number, comment: string) {
  const member = requireOwner(userId);
  const task = database().prepare("SELECT * FROM tasks WHERE id = ? AND team_id = ?").get(taskId, member.team_id) as { assignee_id: string; status: string } | undefined;
  if (!task) throw new Error("Task not found.");
  if (task.status !== "submitted" && task.status !== "rejected" && task.status !== "open") {
    throw new Error("This task cannot be reviewed.");
  }
  const award = decision === "approved" ? Math.max(0, Math.min(5, Math.round(stars))) : 0;
  database().prepare(
    "INSERT INTO reviews (id, task_id, reviewer_id, decision, stars, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), taskId, userId, decision, award, comment.trim(), new Date().toISOString());
  database().prepare("UPDATE tasks SET status = ? WHERE id = ?").run(decision, taskId);
  if (award) {
    database().prepare("UPDATE members SET stars = stars + ? WHERE team_id = ? AND user_id = ?").run(award, member.team_id, task.assignee_id);
  }
}

export function createMeeting(input: {
  userId: string;
  title: string;
  startsIso: string;
  endsIso: string;
  attendeeIds: string[];
  meetLink?: string | null;
  googleEventId?: string | null;
}) {
  const member = requireOwner(input.userId);
  if (input.title.trim().length < 2) throw new Error("Name the meeting.");
  if (input.endsIso <= input.startsIso) throw new Error("End time must be after the start.");
  const id = crypto.randomUUID();
  database().prepare(
    "INSERT INTO meetings (id, team_id, title, starts_at, ends_at, meet_link, google_event_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, member.team_id, input.title.trim(), input.startsIso, input.endsIso, input.meetLink ?? null, input.googleEventId ?? null, input.userId);
  const people = new Set([input.userId, ...input.attendeeIds]);
  for (const person of people) {
    const ok = database().prepare("SELECT user_id FROM members WHERE team_id = ? AND user_id = ?").get(member.team_id, person);
    if (ok) database().prepare("INSERT INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)").run(id, person);
  }
  return id;
}

export function getGoogleConnection(userId: string) {
  return database().prepare("SELECT refresh_token, email FROM google_connections WHERE user_id = ?").get(userId) as
    | { refresh_token: string; email: string }
    | undefined;
}

export function saveGoogleConnection(userId: string, refreshToken: string, email: string) {
  database().prepare(
    `INSERT INTO google_connections (user_id, refresh_token, email) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET refresh_token = excluded.refresh_token, email = excluded.email`
  ).run(userId, refreshToken, email);
}

export function googleConnected(userId: string) {
  return Boolean(getGoogleConnection(userId));
}

export function teamOwnerId(teamId: string) {
  const row = database().prepare("SELECT user_id FROM members WHERE team_id = ? AND role = 'owner' LIMIT 1").get(teamId) as { user_id: string } | undefined;
  return row?.user_id;
}

export function memberEmail(userId: string) {
  return getUser(userId)?.email || "";
}

export function proofFile(userId: string, proofId: string) {
  const member = requireMember(userId);
  const row = database().prepare(
    `SELECT p.file_path, p.file_name FROM proofs p
     JOIN tasks t ON t.id = p.task_id
     WHERE p.id = ? AND t.team_id = ?`
  ).get(proofId, member.team_id) as { file_path: string | null; file_name: string | null } | undefined;
  if (!row?.file_path) return null;
  return row;
}

export function dueReminders(force: boolean) {
  const rows = database().prepare(
    `SELECT t.id AS task_id, t.title, t.deadline, t.assignee_id, t.team_id, u.email, u.timezone, u.name
     FROM tasks t JOIN users u ON u.id = t.assignee_id
     WHERE t.status IN ('open', 'rejected')`
  ).all() as { task_id: string; title: string; deadline: string; assignee_id: string; team_id: string; email: string; timezone: string; name: string }[];
  const due = [];
  for (const row of rows) {
    const date = localDate(row.timezone);
    if (!force && localHour(row.timezone) !== 9) continue;
    const sent = database().prepare(
      "SELECT id FROM reminders WHERE task_id = ? AND user_id = ? AND local_date = ?"
    ).get(row.task_id, row.assignee_id, date);
    if (sent) continue;
    due.push({ ...row, local_date: date });
  }
  return due;
}

export function recordReminder(taskId: string, userId: string, local: string) {
  database().prepare(
    "INSERT INTO reminders (id, task_id, user_id, local_date, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(crypto.randomUUID(), taskId, userId, local, new Date().toISOString());
}

export function snapshot(userId: string) {
  const user = getUser(userId);
  if (!user) return null;
  const member = membership(userId);
  if (!member) {
    return { user, team: null, google: googleConnected(userId) };
  }
  const d = database();
  const people = d.prepare(
    `SELECT u.id, u.name, u.email, u.timezone, m.role, m.stars
     FROM members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY u.name`
  ).all(member.team_id);
  const channels = d.prepare(
    `SELECT c.*,
      (SELECT COUNT(*) FROM messages msg
        WHERE msg.channel_id = c.id
        AND msg.created_at > COALESCE((SELECT last_read FROM reads r WHERE r.user_id = ? AND r.channel_id = c.id), '')) AS unread
     FROM channels c WHERE c.team_id = ? ORDER BY c.task_id IS NOT NULL, c.name`
  ).all(userId, member.team_id);
  const messages = d.prepare(
    `SELECT msg.*, u.name AS author_name FROM messages msg
     JOIN channels c ON c.id = msg.channel_id
     JOIN users u ON u.id = msg.author_id
     WHERE c.team_id = ? ORDER BY msg.created_at`
  ).all(member.team_id);
  const tasks = d.prepare("SELECT * FROM tasks WHERE team_id = ? ORDER BY deadline").all(member.team_id);
  const duties = d.prepare("SELECT * FROM duties WHERE team_id = ?").all(member.team_id);
  const proofs = d.prepare(
    `SELECT p.id, p.task_id, p.user_id, p.note, p.file_name, p.created_at FROM proofs p
     JOIN tasks t ON t.id = p.task_id WHERE t.team_id = ? ORDER BY p.created_at`
  ).all(member.team_id);
  const reviews = d.prepare(
    `SELECT r.* FROM reviews r JOIN tasks t ON t.id = r.task_id WHERE t.team_id = ? ORDER BY r.created_at`
  ).all(member.team_id);
  const meetings = d.prepare("SELECT * FROM meetings WHERE team_id = ? ORDER BY starts_at").all(member.team_id);
  const attendees = d.prepare(
    `SELECT a.meeting_id, a.user_id FROM meeting_attendees a
     JOIN meetings m ON m.id = a.meeting_id WHERE m.team_id = ?`
  ).all(member.team_id);
  const reminders = d.prepare(
    `SELECT r.*, t.title FROM reminders r JOIN tasks t ON t.id = r.task_id
     WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 30`
  ).all(userId);
  const invites = member.role === "owner"
    ? d.prepare(
      "SELECT id, email, role, expires_at, used_at, revoked FROM invites WHERE team_id = ? ORDER BY expires_at DESC"
    ).all(member.team_id)
    : [];
  return {
    user,
    team: { id: member.team_id, name: member.team_name, role: member.role },
    google: googleConnected(userId),
    people,
    channels,
    messages,
    tasks,
    duties,
    proofs,
    reviews,
    meetings,
    attendees,
    reminders,
    invites,
  };
}
