"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#181b18", color: "#f8f6ef", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ maxWidth: 480, textAlign: "center" }}>
            <p style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", opacity: 0.5 }}>Le Yard OS</p>
            <h1 style={{ margin: "18px 0 0", fontSize: 36, letterSpacing: "-.05em" }}>We need a clean restart.</h1>
            <p style={{ margin: "16px auto 0", maxWidth: 400, fontSize: 13, lineHeight: 1.7, opacity: 0.58 }}>The application shell could not recover. No unsaved action was finalized.</p>
            <button onClick={reset} style={{ marginTop: 24, border: 0, borderRadius: 12, padding: "12px 18px", background: "#dfa14a", color: "#181b18", fontWeight: 700, cursor: "pointer" }}>Restart Le Yard OS</button>
          </section>
        </main>
      </body>
    </html>
  );
}
