// scheduler.js — Algoritmo de distribución aleatoria de alarmas

const MIN_GAP_MS = 15 * 60 * 1000; // 15 minutos

/**
 * Genera N timestamps aleatorios entre startMs y endMs,
 * con al menos MIN_GAP_MS de separación entre ellos.
 * @param {number} n - número de alarmas
 * @param {number} startMs - timestamp inicio (ms)
 * @param {number} endMs - timestamp fin (ms)
 * @returns {number[]} array de timestamps ordenados
 */
export function generateAlarmTimes(n, startMs, endMs) {
  const windowMs = endMs - startMs;
  const requiredMs = (n - 1) * MIN_GAP_MS;

  if (n === 0) return [];
  if (n === 1) {
    return [startMs + Math.floor(Math.random() * windowMs)];
  }

  if (requiredMs > windowMs) {
    throw new Error(`Ventana de tiempo insuficiente. Necesitas al menos ${Math.ceil((requiredMs + MIN_GAP_MS) / 60000)} minutos para ${n} tests.`);
  }

  // Rejection sampling (max 500 intentos)
  for (let attempt = 0; attempt < 500; attempt++) {
    const candidates = Array.from({ length: n }, () => startMs + Math.random() * windowMs)
      .sort((a, b) => a - b);

    if (hasValidGaps(candidates)) return candidates.map(Math.floor);
  }

  // Fallback determinista: dividir en N slots iguales
  return deterministicFallback(n, startMs, endMs);
}

function hasValidGaps(sorted) {
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] < MIN_GAP_MS) return false;
  }
  return true;
}

function deterministicFallback(n, startMs, endMs) {
  const windowMs = endMs - startMs;
  const slotMs = windowMs / n;
  const maxOffset = slotMs - MIN_GAP_MS;

  return Array.from({ length: n }, (_, i) => {
    const slotStart = startMs + i * slotMs;
    const offset = maxOffset > 0 ? Math.random() * maxOffset : 0;
    return Math.floor(slotStart + offset);
  });
}

/**
 * Construye objetos de alarma completos a partir de timestamps
 */
export function buildAlarms(timestamps) {
  return timestamps.map(ts => ({
    id: crypto.randomUUID(),
    timestamp: ts,
    status: 'pending', // pending | fired | done | missed | voluntary
  }));
}

/**
 * Valida que la configuración de horario sea posible
 */
export function validateScheduleConfig(n, startHour, startMin, endHour, endMin) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(startHour, startMin, 0, 0);
  const end = new Date(now);
  end.setHours(endHour, endMin, 0, 0);

  if (end <= start) return { ok: false, error: 'La hora de fin debe ser posterior a la de inicio.' };
  if (n < 1 || n > 20) return { ok: false, error: 'El número de tests debe estar entre 1 y 20.' };

  const windowMs = end - start;
  const requiredMs = (n - 1) * MIN_GAP_MS;
  if (requiredMs > windowMs) {
    const minMinutes = Math.ceil((requiredMs + MIN_GAP_MS) / 60000);
    return { ok: false, error: `Para ${n} tests necesitas al menos ${minMinutes} minutos de ventana.` };
  }

  return { ok: true, startMs: start.getTime(), endMs: end.getTime() };
}
