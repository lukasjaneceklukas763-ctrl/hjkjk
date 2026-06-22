"use strict";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isNgAds = url.hostname === "www.ngads.com" && url.pathname.endsWith("/gateway_v2.php");
  const isNoop = url.pathname.endsWith("/noop.txt") || url.pathname.endsWith("/undefined");
  if (!isNgAds && !isNoop) return;

  event.respondWith(Promise.resolve(new Response("ok=1&success=0", {
    status: 200,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "Cache-Control": "no-store"
    }
  })));
});
