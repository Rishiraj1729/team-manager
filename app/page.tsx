import Link from "next/link";

const points = [
  ["Form a team", "You create the team and become the owner. People join with a one-time code sent to their own email."],
  ["Their clock, not yours", "Set a deadline in your timezone. Each person sees that same moment in theirs."],
  ["Work with a record", "Assign a task from chat, collect proof, then approve it. Stars stay on the person’s profile."],
  ["Meet without extra seats", "Schedule in the app. Connect Google once and the invite, with a Meet link, comes from you."],
];

export default function Landing() {
  return (
    <main className="landing">
      <header className="land-nav">
        <strong>Team</strong>
        <nav className="row">
          <Link href="/login">Sign in</Link>
          <Link href="/login?mode=signup" className="land-cta">Create account</Link>
        </nav>
      </header>
      <section className="hero">
        <p className="eyebrow">Team manager</p>
        <h1>A quiet place for the work your team actually does.</h1>
        <p className="lede">Tasks, duties, chat, proof, and meetings. Deadlines follow each person’s timezone. No per-seat bill.</p>
        <div className="hero-actions">
          <Link href="/login?mode=signup" className="land-cta">Create an account</Link>
          <Link href="/login" className="land-quiet">Sign in</Link>
        </div>
        <p className="muted">Try it first: demo@team.app / demo1234, or member@team.app / demo1234.</p>
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
