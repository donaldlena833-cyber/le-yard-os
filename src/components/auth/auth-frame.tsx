"use client";

import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { ThemeProvider, useTheme } from "@/components/providers/theme-provider";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";

function Frame({
  product,
  children,
}: {
  product: string;
  children: ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();
  return (
    <main className="auth-frame workspace-design">
      <div className="auth-container">
        <header className="auth-brand">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-semibold tracking-[.12em]">LE YARD</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {product.replace("Le Yard ", "")}
              </p>
            </div>
          </div>
          <Button
            variant="quiet"
            size="icon"
            aria-label={
              theme === "dark"
                ? "Switch to light appearance"
                : "Switch to dark appearance"
            }
            onClick={toggleTheme}
          >
            {theme === "dark" ? (
              <Sun className="size-[18px]" />
            ) : (
              <Moon className="size-[18px]" />
            )}
          </Button>
        </header>
        <section className="auth-card">{children}</section>
        <p className="auth-footer">
          <BrandMark className="ly-footer-signature" /><span>New York · Your shared workspace</span>
        </p>
      </div>
    </main>
  );
}

export function AuthFrame(props: { product: string; children: ReactNode }) {
  return (
    <ThemeProvider>
      <Frame {...props} />
    </ThemeProvider>
  );
}
