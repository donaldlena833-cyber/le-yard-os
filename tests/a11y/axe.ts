import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const blockingImpacts = new Set(["critical", "serious"]);

function describeViolations(
  violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"],
): string {
  if (!violations.length) return "No serious or critical accessibility violations";

  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 4)
        .map(
          (node) =>
            `  - ${node.target.join(" ")}: ${node.failureSummary ?? "Failed accessibility rule"}`,
        )
        .join("\n");
      return `${violation.id} (${violation.impact}): ${violation.help}\n${nodes}`;
    })
    .join("\n\n");
}

export async function expectNoBlockingAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter((violation) =>
    blockingImpacts.has(violation.impact ?? ""),
  );

  expect(blocking.length, describeViolations(blocking)).toBe(0);
}
