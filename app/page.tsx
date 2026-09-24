import Link from "next/link";

const points = [
  ["Invite by code", "The owner creates the team. Each person joins once, with a code tied to their email."],
  ["Deadlines in their time", "You set the hour in your zone. They see the same moment in theirs."],
  ["Chat and proof", "Assign work from the conversation. They submit a note or a file. You approve and award stars."],
  ["Meetings", "Schedule from the app. A Google connection adds the calendar invite and a Meet link."],
];

export default function Landing() {
  return (
    <main className="landing">
      <header className="land-nav">
        <strong>Team</strong>
        <div className="row">
          <Link href="/login">Sign in</Link>
          <Link href="/login" className="land-cta">Start</Link>
        </div>
      </header>
      <section className="hero">
        <p className="eyebrow">For a small team</p>
        <h1>Work, deadlines, and proof. In one quiet place.</h1>
        <p className="lede">Run tasks, duties, chat, and meetings without a per-seat bill. Times follow each person. Reminders stay until the work is done.</p>
        <div className="row">
          <Link href="/login" className="land-cta">Open the demo</Link>
          <Link href="/login" className="land-quiet">Create an account</Link>
        </div>
        <p className="muted">Demo owner demo@team.app · demo1234. Member member@team.app · demo1234.</p>
      </section>
      <section className="grid">
        {points.map(([title, copy]) => (
          <article key={title} className="list-card">
            <strong>{title}</strong>
            <p>{copy}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
