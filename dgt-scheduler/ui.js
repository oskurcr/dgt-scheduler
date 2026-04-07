// ui.js — DOM helpers

// ── Views ─────────────────────────────────────────────────────────────────────

const VIEWS = ['setup', 'dashboard', 'alarm', 'failed-questions', 'settings'];

export function showView(name) {
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.hidden = v !== name;
  });
}

// ── Progress bar ──────────────────────────────────────────────────────────────

export function updateProgress(done, total) {
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');
  if (!bar || !label) return;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  bar.style.width = `${pct}%`;
  label.textContent = `${done} / ${total} tests completados`;
}

// ── Alarm list ────────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  pending: { text: 'Pendiente', cls: 'badge-pending' },
  fired:   { text: '¡Ahora!',   cls: 'badge-fired'   },
  done:    { text: 'Hecho ✓',   cls: 'badge-done'    },
  missed:  { text: 'Perdido',   cls: 'badge-missed'  },
  voluntary: { text: 'Extra',   cls: 'badge-voluntary'},
};

export function renderAlarmList(schedule) {
  const container = document.getElementById('alarm-list');
  if (!container) return;

  container.innerHTML = '';
  const sorted = [...schedule].sort((a, b) => a.timestamp - b.timestamp);

  sorted.forEach((alarm, i) => {
    const time = new Date(alarm.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const { text, cls } = STATUS_LABELS[alarm.status] ?? { text: alarm.status, cls: '' };
    const isVoluntary = alarm.status === 'voluntary';

    const li = document.createElement('li');
    li.className = `alarm-item ${alarm.status === 'fired' ? 'alarm-item--active' : ''}`;
    li.innerHTML = `
      <span class="alarm-time">${isVoluntary ? '+ Extra' : `Test ${i + 1}`}</span>
      <span class="alarm-hour">${time}</span>
      <span class="badge ${cls}">${text}</span>
    `;
    container.appendChild(li);
  });

  if (sorted.length === 0) {
    container.innerHTML = '<li class="alarm-empty">No hay tests programados hoy.</li>';
  }
}

// ── Failed questions list ─────────────────────────────────────────────────────

export function renderFailedQuestions(questions, onDelete) {
  const container = document.getElementById('failed-list');
  if (!container) return;

  container.innerHTML = '';

  if (questions.length === 0) {
    container.innerHTML = '<li class="failed-empty">No hay preguntas guardadas aún.</li>';
    return;
  }

  questions.forEach(q => {
    const date = new Date(q.createdAt).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    const li = document.createElement('li');
    li.className = 'failed-item';
    li.innerHTML = `
      <div class="failed-meta">${date}</div>
      <div class="failed-text">${escapeHtml(q.question)}</div>
      <button class="btn-delete" data-id="${q.id}" aria-label="Eliminar">✕</button>
    `;
    li.querySelector('.btn-delete').addEventListener('click', () => onDelete(q.id));
    container.appendChild(li);
  });
}

// ── Alarm active card ─────────────────────────────────────────────────────────

export function showAlarmCard(alarm) {
  const time = new Date(alarm.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const el = document.getElementById('alarm-time-display');
  if (el) el.textContent = `Alarma de las ${time}`;
  showView('alarm');
}

// ── Toast ─────────────────────────────────────────────────────────────────────

export function showToast(message, type = 'info') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast toast--${type} toast--visible`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove('toast--visible'), 3000);
}

// ── Settings: trigger API status ──────────────────────────────────────────────

export function renderTriggerStatus(supported) {
  const el = document.getElementById('trigger-api-status');
  if (!el) return;
  if (supported) {
    el.innerHTML = '<span class="badge badge-done">✓ Notificaciones background activas</span>';
  } else {
    el.innerHTML = `
      <span class="badge badge-missed">✗ Notificaciones background no disponibles</span>
      <p class="settings-hint">Para activarlas, abre <code>chrome://flags/#enable-experimental-web-platform-features</code> y activa la opción.</p>
    `;
  }
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
