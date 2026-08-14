import { describe, expect, it, vi } from "vitest";
import {
  ToastLaborClient,
  toastTimeEntryPayloadHash,
  type ToastTimeEntry,
} from "@/lib/integrations/toast-labor.server";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Toast Labor API client", () => {
  it("authenticates as a machine client and reads the modified labor window", async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/authentication/v1/authentication/login")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          clientId: "client-id",
          clientSecret: "client-secret",
          userAccessType: "TOAST_MACHINE_CLIENT",
        });
        return jsonResponse({
          status: "SUCCESS",
          token: { accessToken: "access-token" },
        });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer access-token",
      );
      expect(
        new Headers(init?.headers).get("Toast-Restaurant-External-ID"),
      ).toBe("restaurant-guid");
      if (url.endsWith("/labor/v1/employees")) {
        return jsonResponse([{ guid: "employee-guid", email: "alex@example.com" }]);
      }
      if (url.endsWith("/labor/v1/jobs")) {
        return jsonResponse([{ guid: "job-guid", title: "Server" }]);
      }
      expect(url).toContain("/labor/v1/timeEntries?");
      expect(url).toContain("includeMissedBreaks=false");
      return jsonResponse([
        {
          guid: "entry-guid",
          modifiedDate: "2026-08-13T16:00:00.000Z",
          employeeReference: { guid: "employee-guid" },
          jobReference: { guid: "job-guid" },
          inDate: "2026-08-13T15:00:00.000Z",
          outDate: null,
          breaks: [],
        },
      ]);
    });
    const client = new ToastLaborClient(
      {
        clientId: "client-id",
        clientSecret: "client-secret",
        restaurantGuid: "restaurant-guid",
      },
      request as typeof fetch,
    );

    const result = await client.readModifiedTimeEntries(
      new Date("2026-08-13T00:00:00.000Z"),
      new Date("2026-08-14T00:00:00.000Z"),
    );

    expect(result.timeEntries).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("hashes equivalent provider facts deterministically", () => {
    const first = {
      guid: "entry-guid",
      modifiedDate: "2026-08-13T16:00:00.000Z",
      employeeReference: { guid: "employee-guid" },
      jobReference: { guid: "job-guid" },
      inDate: "2026-08-13T15:00:00.000Z",
      outDate: null,
      breaks: [],
    } as ToastTimeEntry;
    const reordered = {
      breaks: [],
      outDate: null,
      inDate: first.inDate,
      jobReference: first.jobReference,
      employeeReference: first.employeeReference,
      modifiedDate: first.modifiedDate,
      guid: first.guid,
    } as ToastTimeEntry;
    expect(toastTimeEntryPayloadHash(first)).toBe(
      toastTimeEntryPayloadHash(reordered),
    );
  });
});
