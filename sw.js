// sw.js — Service Worker

const CACHE_NAME = 'dgt-v1';
const ASSETS = [
  './index.html',
  './app.js',
  './scheduler.js',
  './store.js',
  './notifications.js',
  './ui.js',
  './manifest.json',
];

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch (cache-first) ───────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// ── Notification click ────────────────────────────────────────────────────────

self.addEventListener('notificationclick', event => {
  const { alarmId, type } = event.notification.data || {};
  event.notification.close();

  if (event.action === 'done') {
    event.waitUntil(markAlarmDoneInIDB(alarmId).then(() => notifyClients({ type: 'ALARM_DONE', alarmId })));
    return;
  }

  if (event.action === 'snooze') {
    event.waitUntil(scheduleSnooze(alarmId));
    return;
  }

  // Default: open/focus the PWA
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const url = self.registration.scope + (alarmId ? `?alarm=${alarmId}` : '');
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'OPEN_ALARM', alarmId });
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// ── Messages from page ────────────────────────────────────────────────────────

self.addEventListener('message', event => {
  const { type, ...data } = event.data || {};

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (type === 'SCHEDULE_ALARMS') {
    event.waitUntil(scheduleAlarmsWithTrigger(data.alarms));
    return;
  }

  if (type === 'CANCEL_ALL_ALARMS') {
    event.waitUntil(cancelAllScheduledNotifications());
    return;
  }

  if (type === 'FIRE_ALARM') {
    event.waitUntil(showAlarmNotification(data.alarm));
    return;
  }

  if (type === 'FIRE_REMINDER') {
    event.waitUntil(showReminderNotification(data.reminder));
    return;
  }
});

// ── Periodic sync (catch missed alarms) ───────────────────────────────────────

self.addEventListener('periodicsync', event => {
  if (event.tag === 'alarm-check') {
    event.waitUntil(checkMissedAlarms());
  }
});

// ── IDB helpers (SW-side, no store.js import) ─────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dgt-sw', 1);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains('kv')) {
        e.target.result.createObjectStore('kv');
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}

// ── Notification helpers ──────────────────────────────────────────────────────

async function showAlarmNotification(alarm) {
  const options = {
    body: 'Abre tu app de test y haz uno ahora 🚗',
    tag: `alarm-${alarm.id}`,
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 300],
    data: { alarmId: alarm.id, type: 'alarm' },
    actions: [
      { action: 'done', title: '✅ Ya lo hice' },
      { action: 'snooze', title: '⏰ +10 min' },
    ],
  };

  // Mark as fired in IDB
  const schedule = await idbGet('dgt_schedule') ?? [];
  const alarm_ = schedule.find(a => a.id === alarm.id);
  if (alarm_) alarm_.status = 'fired';
  await idbSet('dgt_schedule', schedule);

  return self.registration.showNotification('¡Hora del test! 🚨', options);
}

async function showReminderNotification(reminder) {
  if (reminder.type === 'ack') {
    return self.registration.showNotification('¿Empezaste ya el test? 👀', {
      body: 'Llevas un rato sin confirmar. Venga, 10 minutos y listo.',
      tag: `reminder-ack-${reminder.alarmId}`,
      requireInteraction: true,
      vibrate: [200, 100, 200],
      data: { alarmId: reminder.alarmId, type: 'reminder-ack' },
      actions: [
        { action: 'done', title: '✅ Ya lo hice' },
        { action: 'snooze', title: '⏰ +10 min' },
      ],
    });
  }

  if (reminder.type === 'failed_log') {
    return self.registration.showNotification('¿Guardaste los fallos? 📝', {
      body: 'No olvides anotar las preguntas que fallaste.',
      tag: `reminder-failed-${reminder.alarmId}`,
      requireInteraction: false,
      vibrate: [100, 50, 100],
      data: { alarmId: reminder.alarmId, type: 'reminder-failed' },
    });
  }
}

// ── Notification Triggers API (Nivel 1) ───────────────────────────────────────

async function scheduleAlarmsWithTrigger(alarms) {
  if (typeof TimestampTrigger === 'undefined') return; // not supported

  for (const alarm of alarms) {
    if (alarm.timestamp <= Date.now()) continue;
    await self.registration.showNotification('¡Hora del test! 🚨', {
      body: 'Abre tu app de test y haz uno ahora 🚗',
      tag: `alarm-${alarm.id}`,
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 300],
      data: { alarmId: alarm.id, type: 'alarm' },
      actions: [
        { action: 'done', title: '✅ Ya lo hice' },
        { action: 'snooze', title: '⏰ +10 min' },
      ],
      showTrigger: new TimestampTrigger(alarm.timestamp),
    });
  }
}

async function cancelAllScheduledNotifications() {
  const notifications = await self.registration.getNotifications({ includeTriggered: true });
  notifications.forEach(n => n.close());
}

// ── Snooze ────────────────────────────────────────────────────────────────────

async function scheduleSnooze(alarmId) {
  const snoozeTime = Date.now() + 10 * 60 * 1000;

  if (typeof TimestampTrigger !== 'undefined') {
    await self.registration.showNotification('¡Hora del test! 🚨', {
      body: 'Snooze terminado. ¡Ahora sí!',
      tag: `alarm-${alarmId}`,
      requireInteraction: true,
      vibrate: [300, 100, 300],
      data: { alarmId, type: 'alarm' },
      actions: [
        { action: 'done', title: '✅ Ya lo hice' },
        { action: 'snooze', title: '⏰ +10 min' },
      ],
      showTrigger: new TimestampTrigger(snoozeTime),
    });
  }
  // Fallback: la página lo manejará via setInterval
}

// ── Mark done in IDB ──────────────────────────────────────────────────────────

async function markAlarmDoneInIDB(alarmId) {
  const schedule = await idbGet('dgt_schedule') ?? [];
  const alarm = schedule.find(a => a.id === alarmId);
  if (alarm) alarm.status = 'done';
  await idbSet('dgt_schedule', schedule);
}

// ── Notify open clients ───────────────────────────────────────────────────────

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage(message));
}

// ── Periodic sync: check missed alarms ───────────────────────────────────────

async function checkMissedAlarms() {
  const schedule = await idbGet('dgt_schedule') ?? [];
  const now = Date.now();
  for (const alarm of schedule) {
    if (alarm.status === 'pending' && alarm.timestamp < now) {
      alarm.status = 'fired';
      await showAlarmNotification(alarm);
    }
  }
  await idbSet('dgt_schedule', schedule);
}
