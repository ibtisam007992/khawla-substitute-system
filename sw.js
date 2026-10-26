/* Service Worker — منظومة الاحتياط المدرسي الذكي */
const VERSION = "khawla-v1.1.0";
const SHELL = ["./", "./index.html", "./teacher.html", "./manifest.webmanifest", "./teacher.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];
const RUNTIME_HOSTS = ["cdn.tailwindcss.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];
const REM_CACHE = "khawla-reminders";
const REM_URL = "./__reminders.json";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== REM_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.endsWith("__reminders.json") || url.pathname.startsWith("/api/")) return;
  // صفحة التطبيق: الشبكة أولاً ثم النسخة المخزنة (يعمل دون إنترنت)
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put("./index.html", copy)); return r; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  // المكتبات الخارجية والخطوط: من المخزن ثم تحديث في الخلفية
  if (RUNTIME_HOSTS.includes(url.hostname) || url.origin === self.location.origin) {
    e.respondWith(
      caches.open(VERSION).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req).then((r) => { if (r && (r.ok || r.type === "opaque")) cache.put(req, r.clone()); return r; }).catch(() => hit);
          return hit || net;
        })
      )
    );
  }
});

/* ---------- التذكيرات ---------- */
async function readReminders() {
  try { const c = await caches.open(REM_CACHE); const r = await c.match(REM_URL); return r ? await r.json() : []; } catch (e) { return []; }
}
async function writeReminders(list) {
  const c = await caches.open(REM_CACHE);
  await c.put(REM_URL, new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } }));
}

async function fireDue() {
  const list = await readReminders();
  if (!list.length) return;
  const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const pageVisible = wins.some((w) => w.visibilityState === "visible");
  const now = Date.now();
  let changed = false;
  for (const r of list) {
    if (r.fired || now < r.at || now > r.at + 25 * 60 * 1000) continue;
    r.fired = true; changed = true;
    if (pageVisible) continue; // الصفحة المفتوحة تتولى التنبيه الصوتي بنفسها
    await self.registration.showNotification(r.title, {
      body: r.body, tag: r.key, lang: "ar", dir: "rtl", renotify: true, requireInteraction: true,
      vibrate: [300, 150, 300, 150, 600], icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", data: { tab: "notify" }
    });
  }
  if (changed) await writeReminders(list.filter((r) => now < r.at + 6 * 3600 * 1000));
}

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "reminders") {
    e.waitUntil((async () => {
      const old = await readReminders();
      const firedKeys = new Set(old.filter((r) => r.fired).map((r) => r.key));
      await writeReminders((d.list || []).map((r) => ({ ...r, fired: firedKeys.has(r.key) || !!r.fired })));
    })());
  } else if (d.type === "check") {
    e.waitUntil(fireDue());
  } else if (d.type === "skipWaiting") {
    self.skipWaiting();
  }
});

self.addEventListener("periodicsync", (e) => { if (e.tag === "khawla-remind") e.waitUntil(fireDue()); });
self.addEventListener("sync", (e) => { if (e.tag === "khawla-remind") e.waitUntil(fireDue()); });

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.tab) || "daily";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const want = tab === "teacher" ? wins.filter((w) => w.url.includes("teacher.html")) : wins.filter((w) => !w.url.includes("teacher.html"));
      for (const w of want) { if ("focus" in w) { if (tab !== "teacher") w.postMessage({ type: "open-tab", tab }); return w.focus(); } }
      return self.clients.openWindow(tab === "teacher" ? "./teacher.html" : "./index.html?tab=" + tab + "&source=notification");
    })
  );
});

/* دفع حقيقي (Web Push) — جاهز للربط بخادم لاحقًا */
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "تذكير حصة احتياط", {
    body: d.body || "", tag: d.tag || "khawla-push", renotify: true, lang: "ar", dir: "rtl", requireInteraction: true,
    vibrate: [400, 200, 400, 200, 800], icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", data: { tab: d.tab || "notify" }
  }));
});
