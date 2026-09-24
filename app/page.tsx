"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    fetch("/api/auth").then(async (res) => {
      const data = await res.json();
      if (data.user) router.replace("/home");
    }).catch(() => undefined);
  }, [router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Could not continue.");
      return;
    }
    router.push("/home");
  }

  return (
    <main className="auth">
      <form className="card" onSubmit={onSubmit}>
        <div className="eyebrow">Team</div>
        <h1>{mode === "signup" ? "Start quietly." : "Welcome back."}</h1>
        <p className="lede">A private place for your people, their deadlines, and the proof of the work.</p>
        <p className="lede">Demo owner: demo@team.app / demo1234. Demo member: member@team.app / demo1234.</p>
        {mode === "signup" && (
          <>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" autoComplete="name" required />
          </>
        )}
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required />
        <p className="error">{error}</p>
        <button className="primary" disabled={pending}>{pending ? "Please wait" : mode === "signup" ? "Create account" : "Sign in"}</button>
        <button type="button" className="linkish" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "I already have an account" : "Create an account"}
        </button>
      </form>
    </main>
  );
}
