import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { Card, Surface } from "@/components/ui/surface";

describe("shared UI primitives", () => {
  it("renders a semantic page heading with status and actions", () => {
    const markup = renderToStaticMarkup(
      <PageHeader
        eyebrow="Kitchen"
        title="Inventory"
        detail="Current stock and counts."
        status={<StatusPill tone="positive">Connected</StatusPill>}
        actions={<Button>Add item</Button>}
      />,
    );

    expect(markup).toContain("<header");
    expect(markup).toContain("<h2");
    expect(markup).toContain("Inventory");
    expect(markup).toContain("Connected");
    expect(markup).toContain("Add item");
  });

  it("keeps mobile buttons comfortably tappable", () => {
    const compact = renderToStaticMarkup(<Button size="sm">Review</Button>);
    const icon = renderToStaticMarkup(<Button size="icon" aria-label="Close">×</Button>);

    expect(compact).toContain("min-h-11");
    expect(icon).toContain("size-11");
    expect(icon).toContain('aria-label="Close"');
  });

  it("renders semantic surfaces and cards with restrained hierarchy", () => {
    const surface = renderToStaticMarkup(
      <Surface as="aside" variant="inset" padding="sm">Context</Surface>,
    );
    const card = renderToStaticMarkup(<Card>Operational detail</Card>);

    expect(surface).toContain("<aside");
    expect(surface).toContain("bg-[var(--canvas-strong)]");
    expect(card).toContain("<article");
    expect(card).toContain("bg-[var(--paper-strong)]");
  });

  it("keeps status meaning visible beyond color alone", () => {
    const markup = renderToStaticMarkup(
      <StatusPill tone="warning" dot>Needs review</StatusPill>,
    );

    expect(markup).toContain("Needs review");
    expect(markup).toContain('aria-hidden="true"');
  });
});
