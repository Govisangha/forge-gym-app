import type { RecordEntry } from './training';
export const importRecordKinds = ['import-batch', 'import-source'];
export function backupValid(r: any) {
  if (!r || typeof r.kind !== 'string' || typeof r.id !== 'string' || !r.data || r.data.id !== r.id || !['settings', 'programme', 'exercise', 'session', 'weight', 'measurement', 'photo', ...importRecordKinds].includes(r.kind)) return false;
  const d = r.data;
  if (r.kind === 'session') return typeof d.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && !!d.finishedAt && Array.isArray(d.exercises) && Array.isArray(d.pbs) && d.exercises.every((e: any) => typeof e.exerciseId === 'string' && typeof e.name === 'string' && Array.isArray(e.sets) && e.sets.every((s: any) => (s.weight === null || Number.isFinite(s.weight) && s.weight >= 0) && (s.reps === null || Number.isInteger(s.reps) && s.reps >= 0) && (s.durationSec === undefined || s.durationSec === null || Number.isFinite(s.durationSec) && s.durationSec >= 0)));
  if (r.kind === 'programme') return Array.isArray(d.templates) && Array.isArray(d.priorities) && d.templates.every((t: any) => typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.exercises));
  if (r.kind === 'settings') return Array.isArray(d.weeks) && d.weeks.length === 2 && d.weeks.every((w: any) => Array.isArray(w) && w.length && w.every((x: any) => Number.isInteger(x) && x >= 0 && x <= 6)) && Array.isArray(d.rotation) && d.rotation.length && Number.isInteger(d.cursor) && typeof d.anchor === 'string' && typeof d.nextDue === 'string';
  if (r.kind === 'exercise') return typeof d.name === 'string' && Array.isArray(d.muscles) && Array.isArray(d.range);
  if (r.kind === 'weight') return Number.isFinite(d.kg) && d.kg > 0;
  if (importRecordKinds.includes(r.kind)) return d.source === 'planfit' && (r.kind === 'import-source' ? typeof d.type === 'string' : Array.isArray(d.files));
  return typeof d.date === 'string';
}
export function trainingCSV(records: Pick<RecordEntry, 'kind' | 'id' | 'data'>[]) {
  const headers = ['record_kind','session_id','date','workout','exercise_id','exercise','set_number','weight','reps','type','effort','duration','bodyweight','notes','duration_sec','completed','source_set_type','planfit_workout_id','planfit_exercise_entry_id','payload'];
  const rows: any[][] = [];
  for (const record of records) {
    if (record.kind === 'session') {
      const s = record.data;
      if (!s.exercises.some((e: any) => e.sets.length)) rows.push(['session-metadata', s.id, s.date, s.name, ...Array(15).fill(''), JSON.stringify(s)]);
      for (const [order, exercise] of s.exercises.entries()) {
        if (!exercise.sets.length) rows.push(['exercise-metadata', s.id, s.date, s.name, exercise.exerciseId, exercise.name, ...Array(13).fill(''), JSON.stringify({ session: s.importMetadata, exercise })]);
        for (const [i, set] of exercise.sets.entries()) rows.push(['session',s.id,s.date,s.name,exercise.exerciseId,exercise.name,set.number ?? i + 1,set.weight,set.reps,set.type,set.effort ?? '',s.duration,s.bodyweight ?? '',set.note ?? '',set.durationSec ?? '',set.completed ?? true,set.sourceType ?? '',s.importMetadata?.workoutId ?? '',exercise.importMetadata?.exerciseEntryId ?? '',JSON.stringify({ sessionNote: s.note, exerciseNote: exercise.note, feeling: exercise.feeling, painNote: exercise.painNote, pbs: s.pbs, setTimestamp: set.timestamp, exerciseOrder: order, startedAt: s.startedAt, finishedAt: s.finishedAt, sessionImportMetadata: s.importMetadata, exerciseImportMetadata: exercise.importMetadata, setImportMetadata: set.importMetadata })]);
      }
    } else rows.push([record.kind, record.id, record.data.date ?? '', ...Array(16).fill(''), JSON.stringify(record.data)]);
  }
  const escape = (value: any) => { let text = String(value ?? ''); if (/^[=+\-@]/.test(text) && typeof value === 'string') text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  return [headers, ...rows].map(row => row.map(escape).join(',')).join('\r\n');
}
