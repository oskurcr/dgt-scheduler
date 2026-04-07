// notifications.js — Scheduling de notificaciones (2 niveles) y lógica de reminders

import { getSchedule, updateAlarmStatus, getReminders, addReminder, removeReminder, updateReminderNextPing, addSession } from './store.js';

const ACK_PING_MS = 10 * 60 * 1000;      // 10 min
const FAILED_PING_MS = 15 * 60 * 1000;   // 15 min

// ── Permission ────────────────────────────────────────────────────────────────

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function hasNotificationPermission() {
  return 'Notification' in window && Notification.permission === 'granted';
}

// ── Feature detection ─────────────────────────────────────────────────────────

export function supportsTriggersAPI() {
  return typeof TimestampTrigger !== 'undefined';
}

// ── Schedule all alarms (called after setup) ──────────────────────────────────

export async function scheduleAllAlarms(alarms) {
  if (!hasNotificationPermission()) return;

  const reg = await navigator.serviceWorker.ready;

  if (supportsTriggersAPI()) {
    // Nivel 1: Notification Triggers API (background, app cerrada)
    reg.active.postMessage({ type: 'SCHEDULE_ALARMS', alarms });
  }
  // Nivel 2 se maneja via setInterval en app.js (siempre activo)
}

export async function cancelAllAlarms() {
  const reg = await navigator.serviceWorker.ready;
  reg.active.postMessage({ type: 'CANCEL_ALL_ALARMS' });
}

// ── Fire an alarm notification (desde setInterval fallback) ───────────────────

export async function fireAlarmNotification(alarm) {
  const reg = await navigator.serviceWorker.ready;
  reg.active.postMessage({ type: 'FIRE_ALARM', alarm });

  // Actualizar estado y crear reminder de confirmación
  updateAlarmStatus(alarm.id, 'fired');
  addReminder({
    type: 'ack',
    alarmId: alarm.id,
    nextPingAt: Date.now() + ACK_PING_MS,
  });
}

// ── Fire a reminder notification ──────────────────────────────────────────────

export async function fireReminderNotification(reminder) {
  const reg = await navigator.serviceWorker.ready;
  reg.active.postMessage({ type: 'FIRE_REMINDER', reminder });
}

// ── Mark alarm as done (called from UI) ───────────────────────────────────────

export function markAlarmDone(alarmId, failedCount) {
  updateAlarmStatus(alarmId, 'done');
  removeReminder(alarmId, 'ack');

  // Crear sesión
  const session = {
    id: crypto.randomUUID(),
    alarmId,
    completedAt: Date.now(),
    failedCount,
    failedSaved: failedCount === 0, // si 0 fallos, no hay nada que guardar
  };
  addSession(session);

  // Si hay fallos, crear reminder para guardarlos
  if (failedCount > 0) {
    addReminder({
      type: 'failed_log',
      alarmId,
      nextPingAt: Date.now() + FAILED_PING_MS,
      sessionId: session.id,
    });
  }

  return session;
}

export function markFailedSaved(alarmId) {
  removeReminder(alarmId, 'failed_log');
}

// ── Watcher: check alarms and reminders (called by setInterval in app.js) ─────

export async function tickWatcher(onAlarmFired, onAlarmActive) {
  const now = Date.now();
  const schedule = getSchedule();
  const reminders = getReminders();

  // Check alarms
  for (const alarm of schedule) {
    if (alarm.status === 'pending' && alarm.timestamp <= now) {
      await fireAlarmNotification(alarm);
      onAlarmFired(alarm);
    }

    // Check if an active (fired) alarm needs the UI shown
    if (alarm.status === 'fired') {
      onAlarmActive(alarm);
    }
  }

  // Check reminders
  for (const reminder of reminders) {
    if (reminder.nextPingAt <= now) {
      await fireReminderNotification(reminder);
      const interval = reminder.type === 'ack' ? ACK_PING_MS : FAILED_PING_MS;
      updateReminderNextPing(reminder.alarmId, reminder.type, now + interval);
    }
  }
}
