// store.js — Capa de datos: localStorage (página) + IndexedDB (service worker)

const LS = {
  TODAY: 'dgt_today',
  SCHEDULE: 'dgt_schedule',
  SESSIONS: 'dgt_sessions',
  FAILED_Q: 'dgt_failed_q',
  REMINDERS: 'dgt_reminders',
};

// ── LocalStorage helpers ──────────────────────────────────────────────────────

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Today ─────────────────────────────────────────────────────────────────────

export function getToday() { return lsGet(LS.TODAY); }

export function setToday(data) { lsSet(LS.TODAY, data); }

// ── Schedule ──────────────────────────────────────────────────────────────────

export function getSchedule() { return lsGet(LS.SCHEDULE) ?? []; }

export function setSchedule(alarms) {
  lsSet(LS.SCHEDULE, alarms);
  idbSet(LS.SCHEDULE, alarms); // keep SW in sync
}

export function updateAlarmStatus(id, status) {
  const schedule = getSchedule();
  const alarm = schedule.find(a => a.id === id);
  if (alarm) alarm.status = status;
  setSchedule(schedule);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function getSessions() { return lsGet(LS.SESSIONS) ?? []; }

export function addSession(session) {
  const sessions = getSessions();
  sessions.push(session);
  lsSet(LS.SESSIONS, sessions);
}

export function updateSession(id, patch) {
  const sessions = getSessions();
  const s = sessions.find(s => s.id === id);
  if (s) Object.assign(s, patch);
  lsSet(LS.SESSIONS, sessions);
}

// ── Failed questions ──────────────────────────────────────────────────────────

export function getFailedQuestions() { return lsGet(LS.FAILED_Q) ?? []; }

export function addFailedQuestion(question) {
  const list = getFailedQuestions();
  list.unshift({ id: crypto.randomUUID(), question, createdAt: Date.now() });
  lsSet(LS.FAILED_Q, list);
}

export function deleteFailedQuestion(id) {
  const list = getFailedQuestions().filter(q => q.id !== id);
  lsSet(LS.FAILED_Q, list);
}

// ── Reminders ─────────────────────────────────────────────────────────────────

export function getReminders() { return lsGet(LS.REMINDERS) ?? []; }

export function setReminders(reminders) {
  lsSet(LS.REMINDERS, reminders);
  idbSet(LS.REMINDERS, reminders);
}

export function addReminder(reminder) {
  const reminders = getReminders();
  // avoid duplicates for same alarmId+type
  const existing = reminders.findIndex(r => r.alarmId === reminder.alarmId && r.type === reminder.type);
  if (existing >= 0) reminders[existing] = reminder;
  else reminders.push(reminder);
  setReminders(reminders);
}

export function removeReminder(alarmId, type) {
  const reminders = getReminders().filter(r => !(r.alarmId === alarmId && r.type === type));
  setReminders(reminders);
}

export function updateReminderNextPing(alarmId, type, nextPingAt) {
  const reminders = getReminders();
  const r = reminders.find(r => r.alarmId === alarmId && r.type === type);
  if (r) r.nextPingAt = nextPingAt;
  setReminders(reminders);
}

// ── Day reset ─────────────────────────────────────────────────────────────────

export function clearDay() {
  lsSet(LS.TODAY, null);
  lsSet(LS.SCHEDULE, []);
  lsSet(LS.REMINDERS, []);
  idbSet(LS.SCHEDULE, []);
  idbSet(LS.REMINDERS, []);
}

// ── IndexedDB (for Service Worker access) ────────────────────────────────────

let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dgt-sw', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv');
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror = e => reject(e.target.error);
  });
}

export async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = e => reject(e.target.error);
  });
}

export async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}
