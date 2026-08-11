// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InlineNotice } from "@/components/ui/inline-notice";

afterEach(() => cleanup());

describe("FormField", () => {
  it("connects its label, description, and error without discarding existing descriptions", () => {
    render(
      <>
        <p id="account-guidance">Use the work account.</p>
        <FormField
          id="guest-email"
          label="Guest email"
          description="Used for booking verification."
          error="Enter a valid email address."
          required
        >
          <input
            name="email"
            type="email"
            aria-describedby="account-guidance"
          />
        </FormField>
      </>,
    );

    const control = screen.getByRole("textbox", { name: /Guest email/ });
    expect(control.id).toBe("guest-email");
    expect((control as HTMLInputElement).required).toBe(true);
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(control.getAttribute("aria-errormessage")).toBe("guest-email-error");
    expect(control.getAttribute("aria-describedby")).toBe(
      "account-guidance guest-email-description guest-email-error",
    );
    expect(control.className).toContain("min-h-11");
    expect(control.className).toContain("motion-reduce:transition-none");
    expect(screen.getByText("Required")).toBeTruthy();
  });

  it("preserves control-level accessibility state when no field error is present", () => {
    render(
      <FormField id="party-size" label="Party size">
        <input type="number" aria-invalid="spelling" className="numeric" />
      </FormField>,
    );

    const control = screen.getByRole("spinbutton", { name: "Party size" });
    expect(control.getAttribute("aria-invalid")).toBe("spelling");
    expect(control.className).toContain("numeric");
    expect(control.getAttribute("aria-describedby")).toBeNull();
  });
});

describe("InlineNotice", () => {
  it("keeps static guidance non-interruptive and communicates tone beyond color", () => {
    render(
      <InlineNotice tone="warning" title="Verification needed">
        Confirm a guest-owned channel before seating.
      </InlineNotice>,
    );

    const notice = screen.getByRole("note");
    expect(notice.getAttribute("aria-live")).toBeNull();
    expect(notice.querySelector("[aria-hidden='true']")).toBeTruthy();
    expect(screen.getByText("Verification needed")).toBeTruthy();
  });

  it("uses intentional live-region priority and protects action target size", () => {
    const { rerender } = render(
      <InlineNotice
        tone="success"
        announce="polite"
        action={<Button size="sm">Open booking</Button>}
      >
        Reservation confirmed.
      </InlineNotice>,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    const action = screen.getByRole("button", { name: "Open booking" });
    expect(action.className).toContain("min-h-11");
    expect(action.parentElement?.className).toContain("[&_button]:min-w-11");

    rerender(
      <InlineNotice tone="danger" announce="assertive">
        The update could not be saved.
      </InlineNotice>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.getAttribute("aria-atomic")).toBe("true");
  });
});
