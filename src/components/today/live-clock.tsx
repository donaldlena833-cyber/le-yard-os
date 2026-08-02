"use client";

import { useEffect, useState } from "react";

export function LiveClock() {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    const initial = window.setTimeout(() => setTime(new Date()), 0);
    const timer = window.setInterval(() => setTime(new Date()), 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  if (!time) return <span className="numeric">—:—</span>;

  return (
    <time className="numeric" dateTime={time.toISOString()}>
      {time.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
    </time>
  );
}
