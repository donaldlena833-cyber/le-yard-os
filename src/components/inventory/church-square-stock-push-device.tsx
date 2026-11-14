"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getChurchSquareStockPushDeviceAction,
  removeChurchSquareStockPushDeviceAction,
  saveChurchSquareStockPushDeviceAction,
} from "@/app/actions/workflows/church-square-stock-push";
import { Button } from "@/components/ui/button";

type Device = {
  manager?: PushManager;
  endpointHash?: string;
  enrolled: boolean | null;
  problem?: string;
};

const unsupported = "This browser cannot receive device alerts. On iPhone or iPad, add Operations to the Home Screen and open it from there.";
const setupPending = "Device alert delivery is unavailable.";
const permissionDenied = "Allow notifications for Operations in your browser settings to use device alerts.";
const unavailable = "Device enrollment could not be checked. Check this device again.";

function applicationKey(value: string | null) {
  if (!value || !/^[A-Za-z0-9_-]{87}$/.test(value)) return null;
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=");
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return bytes.length === 65 && bytes[0] === 4 ? bytes : null;
}

async function hashEndpoint(endpoint: string) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function subscriptionProblem(subscription: PushSubscription, key: Uint8Array | null) {
  if (subscription.expirationTime !== null && subscription.expirationTime <= Date.now()) {
    return "This browser's subscription expired. Check this device again after updating its notification settings.";
  }
  const current = subscription.options?.applicationServerKey;
  if (key && (!current || current.byteLength !== key.length || !new Uint8Array(current).every((byte, index) => byte === key[index]))) {
    return "This browser uses a different notification key. Use a different browser profile for Church Street alerts.";
  }
  return undefined;
}

async function inspectDevice(locationId: string, key: Uint8Array | null): Promise<Device> {
  if (!("serviceWorker" in navigator) || !("Notification" in window) || !window.crypto.subtle) {
    return { enrolled: null, problem: unsupported };
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active || !registration.pushManager) {
    return { enrolled: null, problem: "The Operations browser worker is unavailable. Reload this page and check this device again." };
  }
  const manager = registration.pushManager;
  const subscription = await manager.getSubscription();
  const permissionProblem = Notification.permission === "denied" ? permissionDenied : undefined;
  if (!subscription) return { manager, enrolled: false, problem: permissionProblem };

  const endpointHash = await hashEndpoint(subscription.endpoint);
  const result = await getChurchSquareStockPushDeviceAction({ locationId, endpointHash });
  if (!result.ok || result.mode !== "live") return { manager, endpointHash, enrolled: null, problem: unavailable };
  return { manager, endpointHash, enrolled: result.data, problem: subscriptionProblem(subscription, key) ?? permissionProblem };
}

export function ChurchSquareStockPushDevice({ locationId, vapidPublicKey }: { locationId: string; vapidPublicKey: string | null }) {
  const [device, setDevice] = useState<Device>();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const key = applicationKey(vapidPublicKey);

  useEffect(() => {
    let disposed = false;
    void inspectDevice(locationId, applicationKey(vapidPublicKey)).then(
      (next) => { if (!disposed) setDevice(next); },
      () => { if (!disposed) setDevice({ enrolled: null, problem: unavailable }); },
    );
    return () => { disposed = true; };
  }, [locationId, vapidPublicKey]);

  function checkAgain() {
    setMessage("");
    startTransition(async () => {
      try {
        setDevice(await inspectDevice(locationId, key));
      } catch {
        setDevice({ enrolled: null, problem: unavailable });
      }
    });
  }

  function enable() {
    if (pending || !key || !device?.manager || device.enrolled !== false || device.problem) return;
    const manager = device.manager;
    setMessage("");
    startTransition(async () => {
      try {
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (permission !== "granted") {
          setMessage("Notification permission was not granted. Device alerts are off.");
          return;
        }
        const subscription = await manager.getSubscription() ?? await manager.subscribe({
          userVisibleOnly: true, applicationServerKey: key.slice().buffer,
        });
        const problem = subscriptionProblem(subscription, key);
        if (problem) {
          setDevice({ ...device, problem });
          return;
        }
        const { keys } = subscription.toJSON();
        if (!keys?.p256dh || !keys.auth) {
          setMessage("This browser returned an incomplete subscription. Check this device again.");
          return;
        }
        const endpointHash = await hashEndpoint(subscription.endpoint);
        const result = await saveChurchSquareStockPushDeviceAction({ locationId, subscription: {
          endpoint: subscription.endpoint, expirationTime: subscription.expirationTime, keys: { p256dh: keys.p256dh, auth: keys.auth },
        } });
        if (result.ok && result.mode === "live" && result.persisted && result.data) {
          setDevice({ manager, endpointHash, enrolled: true });
          setMessage("Device alerts enabled for Church Street.");
        } else {
          setDevice({ manager, endpointHash, enrolled: null, problem: unavailable });
          setMessage("Enrollment could not be confirmed.");
        }
      } catch {
        setDevice({ enrolled: null, problem: unavailable });
        setMessage("Enrollment could not be confirmed.");
      }
    });
  }

  function disable() {
    if (pending || !device?.endpointHash || !device.enrolled) return;
    const endpointHash = device.endpointHash;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await removeChurchSquareStockPushDeviceAction({ locationId, endpointHash });
        if (result.ok && result.mode === "live" && result.persisted && result.data) {
          setDevice({ ...device, enrolled: false });
          setMessage("Device alerts turned off for Church Street.");
        } else setMessage("Changes could not be confirmed. Try turning off device alerts again.");
      } catch {
        setMessage("Changes could not be confirmed. Try turning off device alerts again.");
      }
    });
  }

  return (
    <section className="mx-auto mt-6 max-w-[1520px] px-4 sm:px-6 lg:px-8" aria-labelledby="church-square-stock-device-heading">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
        <h2 id="church-square-stock-device-heading" className="text-base font-semibold">Low-stock alerts on this device</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">Opt in on each device that should receive a Church Street alert when a tracked Square item drops to five or below.</p>
        <p role="status" className="mt-2 text-sm text-[var(--ink-soft)]">
          {!device ? "Checking this browser…" : device.problem ?? (key ?
            device.enrolled ? "This device is enrolled." : "Device alerts are off." : setupPending)}
          {device?.enrolled && (!key || device.problem) && " This device is still enrolled."}
          {message && <> {message}</>}
        </p>
        {device && (
          <div className="mt-2 flex flex-wrap gap-2">
            {key && device.enrolled === false && !device.problem && <Button variant="secondary" size="sm" disabled={pending} onClick={enable}>Enable device alerts</Button>}
            {device.enrolled && device.endpointHash && <Button variant="secondary" size="sm" disabled={pending} onClick={disable}>Turn off device alerts</Button>}
            {device.problem && device.problem !== unsupported && <Button variant="quiet" size="sm" disabled={pending} onClick={checkAgain}>Check this device again</Button>}
          </div>
        )}
      </div>
    </section>
  );
}
