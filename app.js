// app.js — Entry point: wiring de todos los módulos

import * as store from './store.js';
import { generateAlarmTimes, buildAlarms, validateScheduleConfig } from './scheduler.js';
import {
  requestNotificationPermission,
  hasNotificationPermission,
  supportsTriggersAPI,
  scheduleAllAlarms,
  cancelAllAlarms,
  tickWatcher,
  markAlarmDone,
  markFailedSaved,
} from './notifications.js';
import {
  showView,
  updateProgress,
  renderAlarmList,
  renderFailedQuestions,
  showAlarmCard,
  showToast,
  renderTriggerStatus,
} from './ui.js';

// ── State ─────────────────────────────────────────────────────────────────────

let activeAlarmId = null;   // alarma actualmente mostrada en view-alarm
let pendingQueuedQuestions = []; // preguntas en cola durante el done-flow

// ── Service Worker registration ───────────────────────────────────────────────

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    console.log('[SW] registered', reg.scope);

    // Listen for messages from SW (e.g. ALARM_DONE from notification action)
    navigator.serviceWorker.addEventListener('message', event => {
      const { type, alarmId } = event.data || {};
      if (type === 'ALARM_DONE') onAlarmDoneFromSW(alarmId);
      if (type === 'OPEN_ALARM') onOpenAlarmFromSW(alarmId);
    });

    // Register periodic sync for missed alarm catch-up
    if ('periodicSync' in reg) {
      try {
        await reg.periodicSync.register('alarm-check', { minInterval: 60 * 60 * 1000 });
      } catch {
        // periodicSync may require user engagement score — not critical
      }
    }
  } catch (err) {
    console.warn('[SW] registration failed', err);
  }
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function init() {
  await registerSW();
  checkNotificationPermission();
  checkDayReset();
  startAlarmWatcher();

  // Check if opened from a notification (URL param ?alarm=ID)
  const params = new URLSearchParams(location.search);
  const alarmParam = params.get('alarm');
  if (alarmParam) {
    history.replaceState({}, '', location.pathname);
    handleAlarmOpen(alarmParam);
  }
}

function checkDayReset() {
  const today = new Date().toISOString().slice(0, 10);
  const stored = store.getToday();

  if (!stored || stored.date !== today) {
    // New day
    store.clearDay();
    showView('setup');
  } else {
    showDashboard();
  }
}

// ── Notification permission banner ────────────────────────────────────────────

function checkNotificationPermission() {
  if (!hasNotificationPermission()) {
    document.getElementById('notif-banner').classList.add('visible');
  }
}

document.getElementById('btn-request-notif').addEventListener('click', async () => {
  const granted = await requestNotificationPermission();
  if (granted) {
    document.getElementById('notif-banner').classList.remove('visible');
    showToast('Notificaciones activadas ✓', 'success');
  } else {
    showToast('Activa las notificaciones en los ajustes del navegador', 'error');
  }
});

// ── Setup view ────────────────────────────────────────────────────────────────

document.getElementById('btn-setup').addEventListener('click', async () => {
  const n = parseInt(document.getElementById('input-tests').value, 10);
  const [startH, startM] = document.getElementById('input-start').value.split(':').map(Number);
  const [endH, endM] = document.getElementById('input-end').value.split(':').map(Number);

  const validation = validateScheduleConfig(n, startH, startM, endH, endM);
  const errorEl = document.getElementById('setup-error');

  if (!validation.ok) {
    errorEl.textContent = validation.error;
    return;
  }
  errorEl.textContent = '';

  // Request notification permission if not granted
  if (!hasNotificationPermission()) {
    await requestNotificationPermission();
  }

  // Generate alarms
  const timestamps = generateAlarmTimes(n, validation.startMs, validation.endMs);
  const alarms = buildAlarms(timestamps);

  // Save today config
  store.setToday({
    date: new Date().toISOString().slice(0, 10),
    totalTests: n,
    startHour: startH,
    startMin: startM,
    endHour: endH,
    endMin: endM,
  });
  store.setSchedule(alarms);

  // Schedule via Triggers API if available
  await scheduleAllAlarms(alarms);

  showDashboard();
  showToast(`${n} tests programados para hoy 🎯`, 'success');
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

function showDashboard() {
  const schedule = store.getSchedule();
  const today = store.getToday();
  const done = schedule.filter(a => a.status === 'done').length;
  const total = today?.totalTests ?? 0;

  updateProgress(done, total);
  renderAlarmList(schedule);
  renderTriggerStatus(supportsTriggersAPI());
  showView('dashboard');
}

// Voluntary test button
document.getElementById('btn-voluntary').addEventListener('click', () => {
  const schedule = store.getSchedule();
  const voluntary = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    status: 'voluntary',
  };
  schedule.push(voluntary);
  store.setSchedule(schedule);
  activeAlarmId = voluntary.id;
  showAlarmCard(voluntary);
});

// ── Alarm watcher (setInterval fallback) ─────────────────────────────────────

function startAlarmWatcher() {
  setInterval(async () => {
    await tickWatcher(
      // onAlarmFired: refresh dashboard and switch to alarm view if on dashboard
      (alarm) => {
        activeAlarmId = alarm.id;
        const currentView = getActiveView();
        if (currentView === 'dashboard') {
          showAlarmCard(alarm);
        }
        showDashboard(); // refresh list in background
      },
      // onAlarmActive: if a fired alarm exists and we're on dashboard, redirect
      (alarm) => {
        const currentView = getActiveView();
        if (currentView === 'dashboard' && !activeAlarmId) {
          activeAlarmId = alarm.id;
          showAlarmCard(alarm);
        }
      }
    );
  }, 30_000); // every 30 seconds
}

function getActiveView() {
  const views = ['setup', 'dashboard', 'alarm', 'failed-questions', 'settings'];
  return views.find(v => !document.getElementById(`view-${v}`).hidden) ?? 'dashboard';
}

// ── Alarm active view ─────────────────────────────────────────────────────────

function handleAlarmOpen(alarmId) {
  const schedule = store.getSchedule();
  const alarm = schedule.find(a => a.id === alarmId);
  if (alarm && (alarm.status === 'pending' || alarm.status === 'fired')) {
    activeAlarmId = alarmId;
    showAlarmCard(alarm);
  } else {
    showDashboard();
  }
}

// "Ya lo hice" — show inline done form
document.getElementById('btn-alarm-done').addEventListener('click', () => {
  pendingQueuedQuestions = [];
  document.getElementById('done-form').style.display = 'block';
  document.getElementById('btn-alarm-done').style.display = 'none';
  document.getElementById('btn-alarm-snooze').style.display = 'none';
  document.getElementById('input-failed-count').value = '0';
  renderQueuedQuestions();
});

// Show/hide textarea based on failed count
document.getElementById('input-failed-count').addEventListener('input', function () {
  const count = parseInt(this.value, 10) || 0;
  document.getElementById('failed-questions-input').style.display = count > 0 ? 'block' : 'none';
});

// Add a question to the queue
document.getElementById('btn-add-failed-q').addEventListener('click', () => {
  const ta = document.getElementById('input-failed-q');
  const text = ta.value.trim();
  if (!text) return;
  pendingQueuedQuestions.push(text);
  ta.value = '';
  renderQueuedQuestions();
});

function renderQueuedQuestions() {
  const container = document.getElementById('queued-questions');
  container.innerHTML = '';
  pendingQueuedQuestions.forEach((q, i) => {
    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg3);border-radius:6px;padding:8px;font-size:.85rem;display:flex;align-items:flex-start;gap:8px';
    div.innerHTML = `<span style="flex:1">${q}</span><button style="background:none;border:none;color:var(--text-muted);cursor:pointer" data-i="${i}">✕</button>`;
    div.querySelector('button').addEventListener('click', () => {
      pendingQueuedQuestions.splice(i, 1);
      renderQueuedQuestions();
    });
    container.appendChild(div);
  });
}

// Confirm done + save queued questions
document.getElementById('btn-confirm-done').addEventListener('click', () => {
  if (!activeAlarmId) return;

  const failedCount = parseInt(document.getElementById('input-failed-count').value, 10) || 0;

  // Save queued questions to store
  pendingQueuedQuestions.forEach(q => store.addFailedQuestion(q));

  const session = markAlarmDone(activeAlarmId, failedCount);

  // If they had failed questions and saved them, remove the failed_log reminder
  if (failedCount > 0 && pendingQueuedQuestions.length > 0) {
    markFailedSaved(activeAlarmId);
  }

  pendingQueuedQuestions = [];
  activeAlarmId = null;

  resetAlarmView();
  showDashboard();
  showToast('Test completado ✓', 'success');
});

// Snooze
document.getElementById('btn-alarm-snooze').addEventListener('click', async () => {
  if (!activeAlarmId) return;

  // Update next ping to 10 min from now
  const reminders = store.getReminders();
  const r = reminders.find(r => r.alarmId === activeAlarmId && r.type === 'ack');
  if (r) {
    store.updateReminderNextPing(activeAlarmId, 'ack', Date.now() + 10 * 60 * 1000);
  }

  activeAlarmId = null;
  resetAlarmView();
  showDashboard();
  showToast('Snooze 10 min ⏰');
});

// Back to dashboard from alarm
document.getElementById('btn-alarm-back').addEventListener('click', () => {
  resetAlarmView();
  showDashboard();
});

function resetAlarmView() {
  document.getElementById('done-form').style.display = 'none';
  document.getElementById('btn-alarm-done').style.display = '';
  document.getElementById('btn-alarm-snooze').style.display = '';
  document.getElementById('failed-questions-input').style.display = 'none';
  document.getElementById('queued-questions').innerHTML = '';
}

// ── SW message handlers ───────────────────────────────────────────────────────

function onAlarmDoneFromSW(alarmId) {
  markAlarmDone(alarmId, 0);
  if (activeAlarmId === alarmId) {
    activeAlarmId = null;
    resetAlarmView();
  }
  showDashboard();
}

function onOpenAlarmFromSW(alarmId) {
  activeAlarmId = alarmId;
  const alarm = store.getSchedule().find(a => a.id === alarmId);
  if (alarm) showAlarmCard(alarm);
}

// ── Failed questions view ─────────────────────────────────────────────────────

function showFailedQuestionsView() {
  const questions = store.getFailedQuestions();
  renderFailedQuestions(questions, (id) => {
    store.deleteFailedQuestion(id);
    renderFailedQuestions(store.getFailedQuestions(), arguments.callee);
    showToast('Pregunta eliminada');
  });
  showView('failed-questions');
}

document.getElementById('btn-nav-failed').addEventListener('click', showFailedQuestionsView);
document.getElementById('btn-back-from-failed').addEventListener('click', showDashboard);

// Toggle add question form
document.getElementById('btn-toggle-add-q').addEventListener('click', () => {
  const form = document.getElementById('add-question-form');
  form.classList.toggle('open');
  document.getElementById('btn-toggle-add-q').textContent = form.classList.contains('open') ? '✕ Cancelar' : '+ Añadir pregunta';
});

document.getElementById('btn-save-new-q').addEventListener('click', () => {
  const ta = document.getElementById('input-new-q');
  const text = ta.value.trim();
  if (!text) return;
  store.addFailedQuestion(text);
  ta.value = '';
  document.getElementById('add-question-form').classList.remove('open');
  document.getElementById('btn-toggle-add-q').textContent = '+ Añadir pregunta';
  showFailedQuestionsView();
  showToast('Pregunta guardada ✓', 'success');
});

// ── Settings view ─────────────────────────────────────────────────────────────

document.getElementById('btn-nav-settings').addEventListener('click', () => {
  renderTriggerStatus(supportsTriggersAPI());
  showView('settings');
});

document.getElementById('btn-back-from-settings').addEventListener('click', showDashboard);

document.getElementById('btn-reset-day').addEventListener('click', () => {
  if (!confirm('¿Resetear el schedule de hoy? Se perderán las alarmas programadas.')) return;
  cancelAllAlarms();
  store.clearDay();
  activeAlarmId = null;
  showView('setup');
  showToast('Schedule reseteado');
});

document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (!confirm('¿Borrar TODOS los datos? Esto incluye preguntas falladas e historial.')) return;
  cancelAllAlarms();
  localStorage.clear();
  activeAlarmId = null;
  showView('setup');
  showToast('Datos borrados');
});

// ── Go ────────────────────────────────────────────────────────────────────────

init();
