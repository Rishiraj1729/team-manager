"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [mode, setMode] = useState<"signup" | "login">("login");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(nextMode: "signup" | "login", nextEmail: string, nextPassword: string, name?: string) {
    setPending(true);
    setError("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ mode: nextMode, name, email: nextEmail, password: nextPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not continue.");
        setPending(false);
        return;
      }
      window.location.assign("/home");
    } catch {
      setError("Sign-in took too long. Try again.");
      setPending(false);
    } finally {
      clearTimeout(timer);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    submit(mode, String(form.get("email") || ""), String(form.get("password") || ""), String(form.get("name") || ""));
  }

  return (
    <main className="auth">
      <form className="card" onSubmit={onSubmit}>
        <Link href="/" className="eyebrow">Team</Link>
        <h1>{mode === "signup" ? "Create your account." : "Welcome back."}</h1>
        <p className="lede">{mode === "signup" ? "Then form a team or join with an employee code." : "Pick up your tasks, chat, and meetings."}</p>
        {mode === "signup" && (
          <>
            <label htmlFor="name">Name</label>
            <input id="name" name="name" autoComplete="name" required />
          </>
        )}
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
        <p className="error">{error}</p>
        <button className="primary" disabled={pending}>{pending ? "Please wait" : mode === "signup" ? "Create account" : "Sign in"}</button>
        <button type="button" className="ghost" disabled={pending} onClick={() => { setEmail("demo@team.app"); setPassword("demo1234"); submit("login", "demo@team.app", "demo1234"); }}>
          Enter as demo owner
        </button>
        <button type="button" className="linkish" onClick={() => setMode(mode === "signup" ? "login" : "signup")}>
          {mode === "signup" ? "I already have an account" : "Create an account"}
        </button>
      </form>
    </main>
  );
}
