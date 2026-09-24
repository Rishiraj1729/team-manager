"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ZONES, formatInZone } from "@/lib/time";

type Person = { id: string; name: string; email: string; timezone: string; role: string; stars: number };
type Channel = { id: string; name: string; task_id: string | null; unread: number };
type Message = { id: string; channel_id: string; author_name: string; body: string; created_at: string };
type Task = { id: string; title: string; description: string; assignee_id: string; deadline: string; status: string; channel_id: string };
type Duty = { id: string; title: string; description: string; assignee_id: string };
type Proof = { id: string; task_id: string; note: string; file_name: string | null };
type Meeting = { id: string; title: string; starts_at: string; ends_at: string; meet_link: string | null };
type Invite = { id: string; email: string; role: string; expires_at: string; used_at: string | null; revoked: number };
type Data = {
  user: { id: string; name: string; email: string; timezone: string };
  team: { id: string; name: string; role: "owner" | "member" } | null;
  google: boolean;
  googleReady?: boolean;
  people?: Person[];
  channels?: Channel[];
  messages?: Message[];
  tasks?: Task[];
  duties?: Duty[];
  proofs?: Proof[];
  meetings?: Meeting[];
  reminders?: { id: string; title: string; local_date: string }[];
  invites?: Invite[];
};

const sections = ["Home", "Chat", "Tasks", "Duties", "Meetings", "Team"] as const;

export function Workspace() {
  const [data, setData] = useState<Data | null>(null);
  const [section, setSection] = useState<(typeof sections)[number]>("Home");
  const [query, setQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState<"open" | "mine" | "done">("open");
  const [channelId, setChannelId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [error, setError] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [showNav, setShowNav] = useState(false);

  async function load() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch("/api/workspace", { signal: controller.signal });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.user) {
        setError(json.error || "Could not open your team.");
        setData(null);
        return;
      }
      setError("");
      setData(json);
      setChannelId((current) => current || json.channels?.find((c: Channel) => !c.task_id)?.id || json.channels?.[0]?.id || "");
    } catch {
      setError("Opening your team took too long. Try again.");
      setData(null);
    } finally {
      clearTimeout(timer);
    }
  }

  useEffect(() => {
    load().catch(() => setError("Could not load the workspace."));
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load().catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const zone = data?.user.timezone || "Asia/Kolkata";
  const owner = data?.team?.role === "owner";
  const needle = query.trim().toLowerCase();
  const messages = useMemo(
    () => (data?.messages || []).filter((m) => m.channel_id === channelId && (!needle || m.body.toLowerCase().includes(needle))),
    [data, channelId, needle]
  );
  const activeTask = (data?.tasks || []).find((t) => t.id === taskId) || (data?.tasks || []).find((t) => t.channel_id === channelId);
  const visibleTasks = (data?.tasks || []).filter((task) => {
    if (needle && !`${task.title} ${task.description}`.toLowerCase().includes(needle)) return false;
    if (taskFilter === "mine") return task.assignee_id === data?.user.id && task.status !== "approved";
    if (taskFilter === "done") return task.status === "approved";
    return task.status !== "approved";
  });
  const myOpen = (data?.tasks || []).filter((task) => task.assignee_id === data?.user.id && (task.status === "open" || task.status === "rejected"));
  const upcoming = (data?.meetings || []).filter((meeting) => new Date(meeting.ends_at).getTime() > Date.now()).slice(0, 3);

  async function act(body: Record<string, unknown>) {
    setError("");
    const res = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Could not save that.");
      return null;
    }
    if (json.invite) {
      setInviteCode(json.invite.code);
      await load();
      return json;
    }
    setData(json);
    if (json.channelId) {
      setChannelId(json.channelId);
      setSection("Chat");
    }
    return json;
  }

  if (!data?.user) {
    return (
      <main className="auth">
        <div className="card">
          <p>{error || "Opening your team…"}</p>
          {error && <button className="primary" onClick={() => load()}>Try again</button>}
        </div>
      </main>
    );
  }

  if (!data.team) {
    return (
      <main className="auth">
        <div className="card">
          <div className="eyebrow">Your team</div>
          <h1>Form it, or join one.</h1>
          <p className="lede">The person who creates the team is the owner. Everyone else joins with a one-time code sent to their email.</p>
          <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act({ type: "createTeam", name: f.get("name") }); }}>
            <label>Team name</label>
            <input name="name" placeholder="North studio" required />
            <button className="primary">Create team</button>
          </form>
          <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act({ type: "join", code: f.get("code") }); }}>
            <label>Employee code</label>
            <input name="code" placeholder="Paste the code" autoCapitalize="characters" required />
            <button className="ghost">Join a team</button>
          </form>
          <p className="error">{error}</p>
          <button className="linkish" onClick={async () => { await fetch("/api/auth", { method: "DELETE" }); window.location.replace("/"); }}>Sign out</button>
        </div>
      </main>
    );
  }

  return (
    <div className="shell">
      <aside className={showNav ? "side show" : "side"}>
        <div className="brand">{data.team.name}</div>
        <div className="sub">{data.user.name} · {data.team.role}</div>
        {sections.map((name) => (
          <button key={name} className={section === name ? "nav-btn active" : "nav-btn"} onClick={() => { setSection(name); setShowNav(false); }}>{name}</button>
        ))}
        <div className="sub">Channels</div>
        {(data.channels || []).map((channel) => (
          <button key={channel.id} className={channel.id === channelId && section === "Chat" ? "item active" : "item"} onClick={() => { setChannelId(channel.id); setSection("Chat"); setShowNav(false); act({ type: "read", channelId: channel.id }); }}>
            {channel.task_id ? channel.name : `# ${channel.name}`}
            {channel.unread > 0 && <span className="badge">{channel.unread}</span>}
          </button>
        ))}
      </aside>
      <section className="main">
        <header className="top">
          <div>
            <strong>{section === "Chat" ? (data.channels || []).find((c) => c.id === channelId)?.name || "Chat" : section}</strong>
            <div className="muted">Times shown in {zone.replace("_", " ")}</div>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks and chat" style={{ maxWidth: 240 }} />
          <button className="ghost" onClick={async () => { await fetch("/api/auth", { method: "DELETE" }); window.location.replace("/"); }}>Sign out</button>
        </header>
        {section === "Home" && (
          <div className="panel">
            <article className="list-card">
              <div className="status">{myOpen.filter((task) => new Date(task.deadline).getTime() < Date.now()).length} overdue</div>
              <strong>Your open work</strong>
              {myOpen.length === 0 && <p className="muted">Nothing assigned to you right now.</p>}
              {myOpen.map((task) => (
                <button key={task.id} className="item" onClick={() => { setTaskId(task.id); setSection("Tasks"); }}>
                  {task.title}
                  <small> · {formatInZone(task.deadline, zone)}{new Date(task.deadline).getTime() < Date.now() ? " · overdue" : ""}</small>
                </button>
              ))}
            </article>
            <article className="list-card">
              <strong>Coming up</strong>
              {upcoming.length === 0 && <p className="muted">No meetings ahead.</p>}
              {upcoming.map((meeting) => (
                <div key={meeting.id}>{meeting.title} · {formatInZone(meeting.starts_at, zone)} {meeting.meet_link && <a href={meeting.meet_link}>Join</a>}</div>
              ))}
            </article>
            <article className="list-card">
              <strong>Reminders</strong>
              {(data.reminders || []).slice(0, 5).map((item) => <div key={item.id}>{item.title} · {item.local_date}</div>)}
              {(data.reminders || []).length === 0 && <p className="muted">You are caught up.</p>}
            </article>
          </div>
        )}
        {section === "Chat" && (
          <>
            <div className="thread">
              {messages.map((message) => (
                <article key={message.id} className="bubble">
                  <strong>{message.author_name}</strong>
                  {message.body}
                  <span>{formatInZone(message.created_at, zone)}</span>
                </article>
              ))}
              {messages.length === 0 && <p className="muted">This channel is quiet.</p>}
            </div>
            <form className="composer" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); const body = String(f.get("body") || ""); e.currentTarget.reset(); act({ type: "message", channelId, body }); }}>
              <input name="body" placeholder="Message the team" required />
              <button className="primary">Send</button>
            </form>
            {owner && <AssignForm people={data.people || []} onSubmit={(body) => act(body)} />}
          </>
        )}
        {section === "Tasks" && (
          <div className="panel">
            <div className="row">
              {(["open", "mine", "done"] as const).map((filter) => (
                <button key={filter} type="button" className={taskFilter === filter ? "nav-btn active" : "nav-btn"} onClick={() => setTaskFilter(filter)}>{filter}</button>
              ))}
            </div>
            {visibleTasks.map((task) => (
              <button key={task.id} className="list-card" onClick={() => setTaskId(task.id)}>
                <div className="status">{task.status}</div>
                <strong>{task.title}</strong>
                <div className="muted">{personName(data, task.assignee_id)} · {formatInZone(task.deadline, zone)}</div>
              </button>
            ))}
            {visibleTasks.length === 0 && <p className="muted">No tasks in this view. Assign one from chat.</p>}
            {activeTask && (
              <TaskDetail data={data} task={activeTask} zone={zone} owner={owner} onReview={(body) => act(body)} onDone={() => load()} />
            )}
          </div>
        )}
        {section === "Duties" && (
          <div className="panel">
            {(data.duties || []).map((duty) => (
              <article key={duty.id} className="list-card">
                <strong>{duty.title}</strong>
                <div>{duty.description}</div>
                <div className="muted">{personName(data, duty.assignee_id)}</div>
              </article>
            ))}
            {owner && (
              <form className="list-card" onSubmit={(e) => submitNamed(e, (f) => act({ type: "duty", title: f.get("title"), description: f.get("description"), assigneeId: f.get("assigneeId") }))}>
                <strong>Assign a duty</strong>
                <label>Title</label>
                <input name="title" required />
                <label>What it covers</label>
                <textarea name="description" />
                <PeopleSelect people={data.people || []} />
                <button className="primary">Save duty</button>
              </form>
            )}
          </div>
        )}
        {section === "Meetings" && (
          <div className="panel">
            {(data.meetings || []).filter((meeting) => !needle || meeting.title.toLowerCase().includes(needle)).map((meeting) => (
              <article key={meeting.id} className="list-card">
                <strong>{meeting.title}</strong>
                <div>{formatInZone(meeting.starts_at, zone)} – {formatInZone(meeting.ends_at, zone)}</div>
                {meeting.meet_link ? <a href={meeting.meet_link}>Join Meet</a> : <div className="muted">Meet link appears after Google is connected.</div>}
                {owner && <button type="button" className="danger" onClick={() => act({ type: "cancelMeeting", meetingId: meeting.id })}>Cancel</button>}
              </article>
            ))}
            {owner && (
              <form className="list-card" onSubmit={(e) => submitNamed(e, (f) => act({
                type: "meeting",
                title: f.get("title"),
                starts: f.get("starts"),
                ends: f.get("ends"),
                attendeeIds: f.getAll("attendee"),
              }))}>
                <strong>Schedule</strong>
                <label>Title</label>
                <input name="title" required />
                <div className="row">
                  <div>
                    <label>Starts</label>
                    <input name="starts" type="datetime-local" required />
                  </div>
                  <div>
                    <label>Ends</label>
                    <input name="ends" type="datetime-local" required />
                  </div>
                </div>
                <label>Invite</label>
                {(data.people || []).map((person) => (
                  <label key={person.id}><input type="checkbox" name="attendee" value={person.id} /> {person.name}</label>
                ))}
                <button className="primary">Create meeting</button>
              </form>
            )}
          </div>
        )}
        {section === "Team" && (
          <div className="panel">
            <article className="list-card">
              <strong>Your clock</strong>
              <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act({ type: "timezone", timezone: f.get("timezone") }); }}>
                <select name="timezone" defaultValue={zone}>
                  {ZONES.map((item) => <option key={item}>{item}</option>)}
                </select>
                <button className="primary">Save timezone</button>
              </form>
            </article>
            {(data.people || []).map((person) => (
              <article key={person.id} className="list-card">
                <strong>{person.name}</strong>
                <div className="muted">{person.email} · {person.role} · {person.timezone}</div>
                <div className="stars">{"★".repeat(Math.min(5, person.stars))} <span className="muted">{person.stars}</span></div>
              </article>
            ))}
            <article className="list-card">
              <strong>Reminders</strong>
              {(data.reminders || []).length === 0 && <p className="muted">Nothing waiting.</p>}
              {(data.reminders || []).map((item) => <div key={item.id}>{item.title} · {item.local_date}</div>)}
              {owner && <button className="ghost" onClick={async () => { await fetch("/api/workspace?remind=1"); await load(); }}>Send today’s reminders</button>}
            </article>
            {owner && (
              <form className="list-card" onSubmit={(e) => submitNamed(e, (f) => act({ type: "invite", email: f.get("email"), role: f.get("role") }))}>
                <strong>Invite</strong>
                <p className="muted">One code, one email, seven days. The role is set here, not by the person joining.</p>
                <label>Email</label>
                <input name="email" type="email" required />
                <label>Role</label>
                <select name="role" defaultValue="member"><option value="member">Member</option><option value="owner">Owner</option></select>
                <button className="primary">Create employee code</button>
                {inviteCode && (
                  <p>Give them this code once: <strong>{inviteCode}</strong>{" "}
                    <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(inviteCode)}>Copy</button>
                  </p>
                )}
                {(data.invites || []).filter((invite) => !invite.used_at && !invite.revoked).map((invite) => (
                  <div key={invite.id} className="row">
                    <span>{invite.email} · {invite.role}</span>
                    <button type="button" className="danger" onClick={() => act({ type: "revoke", inviteId: invite.id })}>Revoke</button>
                  </div>
                ))}
              </form>
            )}
            <article className="list-card">
              <strong>Google</strong>
              <p className="muted">{data.google ? "Connected. Deadlines and meetings can land on the owner’s calendar, and reminders can send from that Gmail." : "Connect the owner’s Gmail to send reminders and calendar invites. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first."}</p>
              {owner && <a href="/api/google/start">Connect Google</a>}
            </article>
            <p className="error">{error}</p>
          </div>
        )}
        {section !== "Team" && error && <p className="error" style={{ padding: "0 22px" }}>{error}</p>}
      </section>
      <nav className="tabs">
        {sections.map((name) => (
          <button key={name} className={section === name ? "active" : ""} onClick={() => setSection(name)}>{name}</button>
        ))}
      </nav>
    </div>
  );
}

function personName(data: Data, id: string) {
  return data.people?.find((person) => person.id === id)?.name || "Someone";
}

function PeopleSelect({ people }: { people: Person[] }) {
  return (
    <>
      <label>Person</label>
      <select name="assigneeId">{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
    </>
  );
}

function AssignForm({ people, onSubmit }: { people: Person[]; onSubmit: (body: Record<string, unknown>) => void }) {
  return (
    <form className="panel" onSubmit={(e) => submitNamed(e, (f) => onSubmit({
      type: "task",
      title: f.get("title"),
      description: f.get("description"),
      assigneeId: f.get("assigneeId"),
      deadline: f.get("deadline"),
    }))}>
      <strong>Assign from here</strong>
      <div className="row">
        <input name="title" placeholder="Task" required />
        <input name="deadline" type="datetime-local" required />
      </div>
      <textarea name="description" placeholder="What done looks like" />
      <PeopleSelect people={people} />
      <button className="primary">Assign task</button>
    </form>
  );
}

function TaskDetail({ data, task, zone, owner, onReview, onDone }: {
  data: Data;
  task: Task;
  zone: string;
  owner: boolean;
  onReview: (body: Record<string, unknown>) => void;
  onDone: () => void;
}) {
  const proofs = (data.proofs || []).filter((proof) => proof.task_id === task.id);
  const mine = task.assignee_id === data.user.id;
  return (
    <article className="list-card">
      <div className="status">{task.status}</div>
      <h2>{task.title}</h2>
      <p>{task.description}</p>
      <p>Deadline {formatInZone(task.deadline, zone)}</p>
      {proofs.map((proof) => (
        <div key={proof.id}>
          <div>{proof.note}</div>
          {proof.file_name && <a href={`/api/files/${proof.id}`}>{proof.file_name}</a>}
        </div>
      ))}
      {mine && task.status !== "approved" && (
        <form onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          form.set("taskId", task.id);
          const res = await fetch("/api/proof", { method: "POST", body: form });
          const json = await res.json();
          if (!res.ok) return;
          event.currentTarget.reset();
          onDone();
          void json;
        }}>
          <label>Proof</label>
          <textarea name="note" placeholder="What you finished" />
          <input name="file" type="file" accept="image/*,.pdf" />
          <button className="primary">Submit proof</button>
        </form>
      )}
      {owner && (
        <form onSubmit={(e) => submitNamed(e, (f) => onReview({ type: "updateTask", taskId: task.id, title: f.get("title"), deadline: f.get("deadline"), assigneeId: f.get("assigneeId") }))}>
          <label>Reschedule</label>
          <input name="title" defaultValue={task.title} required />
          <input name="deadline" type="datetime-local" required />
          <PeopleSelect people={data.people || []} />
          <button className="ghost">Save changes</button>
        </form>
      )}
      {owner && task.status !== "approved" && (
        <form onSubmit={(e) => submitNamed(e, (f) => onReview({
          type: "review",
          taskId: task.id,
          decision: f.get("decision"),
          stars: f.get("stars"),
          comment: f.get("comment"),
        }))}>
          <label>Review</label>
          <select name="decision"><option value="approved">Approve</option><option value="rejected">Send back</option></select>
          <label>Stars</label>
          <input name="stars" type="number" min={0} max={5} defaultValue={3} />
          <textarea name="comment" placeholder="A note" />
          <button className="primary">Save review</button>
        </form>
      )}
    </article>
  );
}

function submitNamed(event: FormEvent<HTMLFormElement>, run: (form: FormData) => void) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  run(form);
  event.currentTarget.reset();
}
