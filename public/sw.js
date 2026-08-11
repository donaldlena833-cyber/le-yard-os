const CACHE_NAME = "le-yard-os-public-shell-v3";
const PUBLIC_SHELL = [
  "/offline.html",
  "/offline.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

function unsafeNotificationPath(value) {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.includes("\\") ||
      /[\u0000-\u001f\u007f-\u009f]/.test(decoded)
    ) {
      return true;
    }
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return true;
    }
  }
  return false;
}

function safeNotificationPath(value) {
  if (typeof value !== "string" || unsafeNotificationPath(value)) return "/today";

  try {
    const target = new URL(value, self.location.origin);
    const normalized = `${target.pathname}${target.search}${target.hash}`;
    if (
      target.origin !== self.location.origin ||
      unsafeNotificationPath(normalized)
    ) {
      return "/today";
    }
    return normalized;
  } catch {
    return "/today";
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) {
    return;
  }

  // Tenant HTML, API responses, and signed file URLs are deliberately never
  // written to Cache Storage. Only a generic offline page may satisfy a failed
  // navigation, preventing one signed-in user from leaving records for another.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline.html")),
    );
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = {};
  }
  const destination = safeNotificationPath(data.url);
  event.waitUntil(
    self.registration.showNotification(data.title || "Le Yard OS", {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "le-yard-update",
      data: { url: destination },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = safeNotificationPath(event.notification.data?.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const target = new URL(destination, self.location.origin).href;
        const existing = windows.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        if (existing) {
          if (existing.url !== target && "navigate" in existing) {
            await existing.navigate(target);
          }
          return existing.focus();
        }
        return self.clients.openWindow(destination);
      }),
  );
});
