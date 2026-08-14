import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PermissionAwareAction, permissionExplanation } from "@/components/permissions/action-permission";

describe("permission-aware actions", () => {
  it("explains every unavailable action state", () => {
    expect(permissionExplanation({ state: "missing_capability" })).toMatch(/job role/);
    expect(permissionExplanation({ state: "missing_location_scope" })).toMatch(/location/);
    expect(permissionExplanation({ state: "mfa_required" })).toMatch(/multi-factor/);
    expect(permissionExplanation({ state: "missing_prerequisite" })).toMatch(/setup/);
    expect(permissionExplanation({ state: "workflow_unavailable" })).toMatch(/not configured/);
    expect(permissionExplanation({ state: "read_only" })).toMatch(/read only/);
  });

  it("keeps a prerequisite-blocked action visible and disabled", () => {
    const markup = renderToStaticMarkup(<PermissionAwareAction permission={{ state: "missing_prerequisite", explanation: "Add a unit first." }}>{({ disabled }) => <button disabled={disabled}>Create recipe</button>}</PermissionAwareAction>);
    expect(markup).toContain("Create recipe");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Add a unit first.");
  });
});
