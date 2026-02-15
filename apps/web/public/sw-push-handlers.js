/* global self, clients, URL */

const DEFAULT_NOTIFICATION = {
  title: 'Lumen Player',
  body: 'Open app to continue playback.',
  url: '/player',
};

const normalizeTargetPath = (input) => {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return DEFAULT_NOTIFICATION.url;
  }

  if (input.startsWith('/dashboard')) {
    return '/settings';
  }

  if (input.startsWith('/')) {
    return input;
  }

  return DEFAULT_NOTIFICATION.url;
};

const parsePushPayload = (event) => {
  if (!event.data) {
    return DEFAULT_NOTIFICATION;
  }

  try {
    const parsed = event.data.json();
    return {
      title: typeof parsed.title === 'string' ? parsed.title : DEFAULT_NOTIFICATION.title,
      body: typeof parsed.body === 'string' ? parsed.body : DEFAULT_NOTIFICATION.body,
      url: normalizeTargetPath(parsed.url),
      icon: typeof parsed.icon === 'string' ? parsed.icon : '/pwa-192x192.png',
      badge: typeof parsed.badge === 'string' ? parsed.badge : '/pwa-192x192.png',
      tag: typeof parsed.tag === 'string' ? parsed.tag : 'lumen-push',
      data: parsed,
    };
  } catch {
    const text = event.data.text();
    return {
      ...DEFAULT_NOTIFICATION,
      body: text || DEFAULT_NOTIFICATION.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: 'lumen-push',
      data: { url: DEFAULT_NOTIFICATION.url },
    };
  }
};

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      data: {
        ...payload.data,
        url: normalizeTargetPath(payload.url),
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const nextPath = normalizeTargetPath(event.notification.data?.url);
  const targetUrl = new URL(nextPath, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    const focused = windows.find((client) => client.url.startsWith(self.location.origin));
    if (focused) {
      await focused.focus();
      if ('navigate' in focused) {
        await focused.navigate(targetUrl);
      }
      return;
    }

    await clients.openWindow(targetUrl);
  })());
});
