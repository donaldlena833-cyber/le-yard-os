// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  getChurchSquareStockPushDeviceAction,
  removeChurchSquareStockPushDeviceAction,
  saveChurchSquareStockPushDeviceAction,
} from "@/app/actions/workflows/church-square-stock-push";
import { ChurchSquareStockPushDevice } from "@/components/inventory/church-square-stock-push-device";

vi.mock("@/app/actions/workflows/church-square-stock-push", () => ({
  getChurchSquareStockPushDeviceAction: vi.fn(),
  removeChurchSquareStockPushDeviceAction: vi.fn(),
  saveChurchSquareStockPushDeviceAction: vi.fn(),
}));

const locationId = "30000000-0000-4000-8000-000000000002";
const endpoint = "https://example.invalid/test-browser";
const endpointHash = "a3".repeat(32);
const keyBytes = new Uint8Array(65).fill(12);
keyBytes[0] = 4;
const vapidPublicKey = Buffer.from(keyBytes).toString("base64url");
const subscriptionKeys = { p256dh: "public-key", auth: "auth-key" };
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
const originalSubtle = Object.getOwnPropertyDescriptor(window.crypto, "subtle");

function browser({ existing = false, permission = "default", expired = false, mismatched = false }:
{ existing?: boolean; permission?: NotificationPermission; expired?: boolean; mismatched?: boolean } = {}) {
  const endpointDigest = new Uint8Array(32).fill(163);
  Object.defineProperty(window.crypto, "subtle", { configurable: true, value: {
    digest: vi.fn().mockResolvedValue(endpointDigest.buffer),
  } });
  const requestPermission = vi.fn<() => Promise<NotificationPermission>>().mockResolvedValue("granted");
  vi.stubGlobal("Notification", { permission, requestPermission });
  const subscription = { endpoint, expirationTime: expired ? 1 : null, options: {
    applicationServerKey: mismatched ? new Uint8Array(65).buffer : keyBytes.buffer,
  }, toJSON: () => ({ keys: subscriptionKeys }), unsubscribe: vi.fn() };
  const pushManager = { getSubscription: vi.fn().mockResolvedValue(existing ? subscription : null),
    subscribe: vi.fn().mockResolvedValue(subscription) };
  const getRegistration = vi.fn().mockResolvedValue({ active: {}, pushManager });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration } });
  return { requestPermission, pushManager, subscription };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  if (originalServiceWorker) Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  else Reflect.deleteProperty(navigator, "serviceWorker");
  if (originalSubtle) Object.defineProperty(window.crypto, "subtle", originalSubtle);
  else Reflect.deleteProperty(window.crypto, "subtle");
});

it("prompts only on explicit opt-in and disables only the Church Street device record", async () => {
  const { requestPermission, pushManager, subscription } = browser();
  vi.mocked(saveChurchSquareStockPushDeviceAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: true });
  vi.mocked(removeChurchSquareStockPushDeviceAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: true });
  render(<ChurchSquareStockPushDevice locationId={locationId} vapidPublicKey={vapidPublicKey} />);
  const enable = await screen.findByRole("button", { name: "Enable device alerts" });
  expect(requestPermission).not.toHaveBeenCalled();
  expect(pushManager.subscribe).not.toHaveBeenCalled();
  expect(saveChurchSquareStockPushDeviceAction).not.toHaveBeenCalled();
  fireEvent.click(enable);
  expect(await screen.findByText(/This device is enrolled/)).toBeTruthy();
  expect(requestPermission).toHaveBeenCalledOnce();
  expect(pushManager.subscribe).toHaveBeenCalledExactlyOnceWith({ userVisibleOnly: true, applicationServerKey: keyBytes.buffer });
  expect(saveChurchSquareStockPushDeviceAction).toHaveBeenCalledExactlyOnceWith({ locationId,
    subscription: { endpoint, expirationTime: null, keys: subscriptionKeys },
  });

  const disable = screen.getByRole<HTMLButtonElement>("button", { name: "Turn off device alerts" });
  await waitFor(() => expect(disable.disabled).toBe(false));
  fireEvent.click(disable);
  expect(await screen.findByText(/Device alerts turned off for Church Street/)).toBeTruthy();
  expect(removeChurchSquareStockPushDeviceAction).toHaveBeenCalledExactlyOnceWith({ locationId, endpointHash });
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
});

it("allows disabling the existing enrollment with production setup unavailable", async () => {
  const { requestPermission, subscription } = browser({ existing: true, permission: "granted" });
  vi.mocked(getChurchSquareStockPushDeviceAction).mockResolvedValue({ ok: true, mode: "live", persisted: false, data: true });
  vi.mocked(removeChurchSquareStockPushDeviceAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: true });
  render(<ChurchSquareStockPushDevice locationId={locationId} vapidPublicKey={null} />);
  const disable = await screen.findByRole("button", { name: "Turn off device alerts" });
  expect(screen.getByText(/Device alert delivery is unavailable.*still enrolled/)).toBeTruthy();
  expect(getChurchSquareStockPushDeviceAction).toHaveBeenCalledExactlyOnceWith({ locationId, endpointHash });
  expect(screen.queryByRole("button", { name: "Enable device alerts" })).toBeNull();
  fireEvent.click(disable);
  expect(await screen.findByText(/Device alerts turned off for Church Street/)).toBeTruthy();
  expect(requestPermission).not.toHaveBeenCalled();
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
});

it.each([
  [{ mismatched: true }, /different notification key/],
  [{ expired: true }, /subscription expired/],
] as const)("does not misreport an unusable browser subscription as ready", async (condition, message) => {
  const { requestPermission, pushManager } = browser({ existing: true, permission: "granted", ...condition });
  vi.mocked(getChurchSquareStockPushDeviceAction).mockResolvedValue({ ok: true, mode: "live", persisted: false, data: true });
  render(<ChurchSquareStockPushDevice locationId={locationId} vapidPublicKey={vapidPublicKey} />);
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Enable device alerts" })).toBeNull();
  expect(screen.getByRole("button", { name: "Turn off device alerts" })).toBeTruthy();
  expect(requestPermission).not.toHaveBeenCalled();
  expect(pushManager.subscribe).not.toHaveBeenCalled();
});

it("shows unsupported browsers a Home Screen option without registering a device", async () => {
  render(<ChurchSquareStockPushDevice locationId={locationId} vapidPublicKey={vapidPublicKey} />);
  expect(await screen.findByText(/add Operations to the Home Screen/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(getChurchSquareStockPushDeviceAction).not.toHaveBeenCalled();
});
