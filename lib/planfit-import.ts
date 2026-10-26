import * as T from './training';
import type { Exercise, Programme, RecordEntry, Session, SetLog } from './training';

export type Row = Record<string, string>;
export type PlanfitFileKind = 'workout_sessions' | 'workout_exercises' | 'workout_sets' | 'exercise_daily_records' | 'daily_steps' | 'profile';
export type PlanfitFile = { kind: PlanfitFileKind; name: string; hash: string; headers: string[]; rows: Row[] };
export type PlanfitIssue = { file: string; row: number; message: string; workoutId?: string; raw?: Row };
export type PlanfitSourceSession = { id: string; workoutId: string; row: Row; order: number; exercises: { row: Row; order: number; sets: { row: Row; order: number }[] }[] };
export type PlanfitExport = { files: PlanfitFile[]; sessions: PlanfitSourceSession[]; names: string[]; issues: PlanfitIssue[]; invalidIds: string[]; counts: { workouts: number; exercises: number; sets: number; completedSets: number }; dateRange: string[]; sourceReferences: Record<string, string> };
export type ExerciseMatch = { name: string; target: string; reason: 'exact' | 'saved alias' | 'case variant' | 'normalised variant' | 'new exercise'; confirmed: boolean };
export type Duplicate = { targetId: string; kind: 'source' | 'identical' | 'potential'; location: 'history' | 'export'; reason: string; referenceOnly?: boolean };
export type PreviewSession = { workoutId: string; session: Session; suggestion: string; duplicate?: Duplicate; invalid: boolean };
export type PlanfitPreview = { workouts: PreviewSession[]; newExercises: Exercise[]; matches: ExerciseMatch[] };
export type ImportOptions = { names: Record<string, string>; excluded: string[]; duplicatePolicy: 'skip' | 'replace' | 'anyway'; skipInvalid: boolean; saveAliases: boolean; acceptedSuggestions: string[] };
export type ImportEntry = { kind: string; id: string; data: any };
const kinds: PlanfitFileKind[] = ['workout_sessions', 'workout_exercises', 'workout_sets', 'exercise_daily_records', 'daily_steps', 'profile'];
const required: Record<PlanfitFileKind, string[]> = {
  workout_sessions: ['workout_id', 'date', 'started_at_utc'],
  workout_exercises: ['workout_id', 'exercise_entry_id', 'exercise_name', 'record_type'],
  workout_sets: ['workout_id', 'exercise_entry_id', 'set_no', 'set_type', 'weight_kg', 'reps', 'duration_sec', 'completed'],
  exercise_daily_records: ['date', 'exercise_name', 'completed_sets', 'max_weight_kg', 'max_reps', 'volume_kg', 'est_1rm_kg'],
  daily_steps: ['date', 'steps', 'target_steps'],
  profile: ['gender', 'purpose', 'exercise_experience', 'strength_level', 'weight_unit'],
};
export const normaliseExerciseName = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const canonical = (row: Row) => JSON.stringify(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
export async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join(''); }
export async function readPlanfitFile(name: string, text: string): Promise<PlanfitFile> {
  const table = T.parseCSVTable(text);
  const headers = table.headers.map(h => h.toLowerCase().trim());
  if (new Set(headers).size !== headers.length) throw new Error(`${name}: duplicate CSV column names.`);
  const expected = kinds.find(k => name.toLowerCase().replace(/\.csv$/, '') === k);
  const candidates = kinds.filter(k => required[k].every(h => headers.includes(h)));
  const kind = expected ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!kind) throw new Error(`${name}: this is not a recognised Planfit CSV table.`);
  const missing = required[kind].filter(h => !headers.includes(h));
  if (missing.length) throw new Error(`${name}: missing Planfit columns: ${missing.join(', ')}.`);
  if (table.rows.length > 100000) throw new Error(`${name}: split files larger than 100,000 rows before importing.`);
  const rows = table.rows.map(row => Object.fromEntries(table.headers.map((h, i) => [headers[i], row[h]])));
  return { kind, name, hash: await digest(text), headers, rows };
}
export function completedValue(value: string) {
  if (/^(true|1|yes|completed|done)$/i.test(value.trim())) return true;
  if (/^(false|0|no|incomplete|not completed|pending)$/i.test(value.trim())) return false;
  throw new Error(`Unrecognised completed value: ${JSON.stringify(value)}`);
}
function numeric(value: string | undefined, label: string, integer = false): number | null {
  if (value === undefined || /^(?:null|none|nan|n\/a)?$/i.test(value.trim())) return null;
  const parsed = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}
function utc(value: string | undefined): string | null {
  if (!value?.trim()||/^(null|none|nan|n\/a)$/i.test(value.trim())) return null;
  T.normaliseImportDate(value.trim().slice(0,10),'dmy');
  let input = value.trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(input)) input += 'Z';
  const time = Date.parse(input);
  if (!Number.isFinite(time)) throw new Error(`Invalid UTC timestamp: ${value}`);
  return new Date(time).toISOString();
}
export function importedSetType(value: string): T.SetType {
  const key = value.toLowerCase().replace(/[ _-]/g, '');
  return key.includes('warm') ? 'Warm-up' : key.includes('drop') ? 'Drop set' : key.includes('fail') ? 'Failure' : key.includes('backoff') ? 'Back-off' : 'Working';
}
export function historicalName(row: Row) {
  const value = row.workout_name?.trim() ?? '';
  return !value || /^(gym workout routine|gym workout|workout routine|workout|routine|training|imported workout)$/i.test(value) ? 'Imported Workout' : value;
}
export async function parsePlanfitExport(files: PlanfitFile[]): Promise<PlanfitExport> {
  for (const kind of kinds) if (files.filter(f => f.kind === kind).length > 1) throw new Error(`Select only one ${kind}.csv file.`);
  for (const kind of kinds.slice(0, 3)) if (!files.some(f => f.kind === kind)) throw new Error(`Add ${kind}.csv to join the Planfit workout tables.`);
  const issues: PlanfitIssue[] = [], invalid = new Set<string>();
  const issue = (file: string, row: number, message: string, workoutId?: string, raw?: Row) => { issues.push({ file, row, message, workoutId, raw }); if (workoutId) invalid.add(workoutId); };
  const parents = files.find(f => f.kind === 'workout_sessions')!;
  const exercises = files.find(f => f.kind === 'workout_exercises')!;
  const sets = files.find(f => f.kind === 'workout_sets')!;
  const groups = new Map<string, PlanfitSourceSession>();
  for (const [i, row] of parents.rows.entries()) {
    const workoutId = row.workout_id.trim();
    if (!workoutId) { issue(parents.name, i + 2, 'Missing workout_id.', undefined, row); continue; }
    if (groups.has(workoutId)) { issue(parents.name, i + 2, 'Repeated parent workout_id. Review/fix this session before import.', workoutId, row); continue; }
    const id = 'planfit-' + await digest(workoutId);
    groups.set(workoutId, { id, workoutId, row, order: i, exercises: [] });
    try {
      T.normaliseImportDate(row.date, 'dmy');
      const started = utc(row.started_at_utc), done = utc(row.done_at_utc);
      if (started && done && done < started) throw new Error('Completed timestamp is before the started timestamp.');
      numeric(row.duration_min, 'duration'); numeric(row.elapsed_min, 'elapsed time'); numeric(row.calories_kcal, 'calories');
    } catch (error) { issue(parents.name, i + 2, (error as Error).message, workoutId, row); }
  }
  const entries = new Map<string, PlanfitSourceSession['exercises'][number]>();
  for (const [i, row] of exercises.rows.entries()) {
    const workoutId = row.workout_id.trim(), entryId = row.exercise_entry_id.trim();
    const parent = groups.get(workoutId), key = JSON.stringify([workoutId, entryId]);
    if (!parent) { issue(exercises.name, i + 2, 'Exercise has no parent workout_id in workout_sessions.csv.', workoutId, row); continue; }
    if (!entryId || !row.exercise_name.trim() || entries.has(key)) { issue(exercises.name, i + 2, 'Missing or duplicate exercise_entry_id / exercise name.', workoutId, row); continue; }
    const entry = { row, order: i, sets: [] as { row: Row; order: number }[] };
    parent.exercises.push(entry); entries.set(key, entry);
  }
  let completedSets = 0;
  for (const [i, row] of sets.rows.entries()) {
    const workoutId = row.workout_id.trim(), entry = entries.get(JSON.stringify([workoutId, row.exercise_entry_id.trim()]));
    if (!entry) { issue(sets.name, i + 2, 'Set has no matching workout_id + exercise_entry_id.', workoutId, row); continue; }
    entry.sets.push({ row, order: i });
    try {
      const done = completedValue(row.completed);
      numeric(row.set_no, 'set number', true);
      if (!done) continue;
      completedSets++;
      numeric(row.weight_kg, 'weight'); numeric(row.reps, 'reps', true); numeric(row.duration_sec, 'set duration'); numeric(row.set_no, 'set number', true);
    } catch (error) { issue(sets.name, i + 2, (error as Error).message, workoutId, row); }
  }
  const sessions = [...groups.values()];
  const dates = sessions.map(s => { try { return T.normaliseImportDate(s.row.date, 'dmy'); } catch { return ''; } }).filter(Boolean).sort();
  const sourceReferences = Object.fromEntries(await Promise.all(sessions.map(async s => [s.workoutId, 'pf-ref-' + await digest(s.workoutId)])));
  return { files, sessions, names: [...new Set(exercises.rows.map(r => r.exercise_name.trim()).filter(Boolean))], issues, invalidIds: [...invalid], counts: { workouts: parents.rows.length, exercises: exercises.rows.length, sets: sets.rows.length, completedSets }, dateRange: dates.length ? [dates[0], dates.at(-1)!] : [], sourceReferences };
}
export function proposeExerciseMatches(names: string[], library: Exercise[]): ExerciseMatch[] {
  return names.map((name, i) => {
    const exact = library.filter(e => e.name === name);
    if (exact.length === 1) return { name, target: 'library:' + exact[0].id, reason: 'exact', confirmed: true };
    const alias = library.filter(e => e.aliases?.some(a => a === name));
    if (alias.length === 1) return { name, target: 'library:' + alias[0].id, reason: 'saved alias', confirmed: true };
    const caseMatches = library.filter(e => e.name.toLowerCase() === name.toLowerCase());
    if (caseMatches.length === 1) return { name, target: 'library:' + caseMatches[0].id, reason: 'case variant', confirmed: false };
    const normalised = library.filter(e => normaliseExerciseName(e.name) === normaliseExerciseName(name) || e.aliases?.some(a => normaliseExerciseName(a) === normaliseExerciseName(name)));
    if (normalised.length === 1) return { name, target: 'library:' + normalised[0].id, reason: 'normalised variant', confirmed: false };
    const sibling = names.slice(0, i).find(other => normaliseExerciseName(other) === normaliseExerciseName(name));
    if (sibling) return { name, target: 'source:' + sibling, reason: sibling.toLowerCase() === name.toLowerCase() ? 'case variant' : 'normalised variant', confirmed: false };
    return { name, target: 'new', reason: 'new exercise', confirmed: false };
  });
}
function resolveExercise(name: string, matches: ExerciseMatch[], library: Exercise[], ids: Record<string, string>, seen = new Set<string>()): Exercise {
  if (seen.has(name)) throw new Error(`Exercise mapping cycle involving ${name}. Choose a library exercise or create it separately.`);
  seen.add(name);
  const match = matches.find(m => m.name === name);
  if (match?.target.startsWith('library:')) { const exercise = library.find(e => e.id === match.target.slice(8)); if (!exercise) throw new Error(`Missing library match for ${name}.`); return exercise; }
  if (match?.target.startsWith('source:')) return resolveExercise(match.target.slice(7), matches, library, ids, seen);
  return { id: ids[name], name, muscles: [], secondary: [], equipment: 'Imported', range: [8, 12], rest: 90, increment: 2.5, notes: '', substitutions: [] };
}
export function classifyWorkout(exercises: Session['exercises']) {
  const names = exercises.map(e => normaliseExerciseName(e.name));
  if (!names.length) return '';
  const cardio = /\b(walking|walk|treadmill|running|run|cycling|bike|bicycle|elliptical|stair|cardio)\b/;
  if (names.every(n => cardio.test(n))) return 'Walking / Cardio';
  const text = exercises.map(e => e.name + ' ' + e.muscles.join(' ')).join(' ').toLowerCase();
  const legs = /\b(leg|squat|quad|hamstring|glute|calf|calves|deadlift)\b/.test(text);
  const chest = /\b(chest|bench|pectoral|pec)\b/.test(text);
  const back = /\b(row|pulldown|pull up|pull-up|lat|lats|upper back)\b/.test(text);
  if (legs && !chest && !back) return 'Legs + Shoulders';
  if (chest && !legs && !back) return 'Chest + Triceps';
  if (back && !legs && !chest) return 'Back + Biceps + Traps';
  if (!legs && !chest && !back && /\b(curl|bicep|biceps|tricep|triceps|pushdown|forearm)\b/.test(text)) return 'Arms';
  return 'Custom';
}
function sameTiming(a: Session, b: Session) {
  const am = a.importMetadata, bm = b.importMetadata;
  if (am?.startedAtUTC && bm?.startedAtUTC && am.startedAtUTC !== bm.startedAtUTC) return false;
  return true;
}
function duplicateKind(a: Session, b: Session): Duplicate['kind'] {
  const am = a.importMetadata, bm = b.importMetadata;
  return am?.startedAtUTC && bm?.startedAtUTC && am.startedAtUTC === bm.startedAtUTC && am.doneAtUTC === bm.doneAtUTC && a.duration === b.duration ? 'identical' : 'potential';
}
export function previewPlanfit(data: PlanfitExport, matches: ExerciseMatch[], ids: Record<string, string>, library: Exercise[], history: Session[], records: RecordEntry[] = []): PlanfitPreview {
  const newExercises = new Map<string, Exercise>(), workouts: PreviewSession[] = [];
  for (const source of data.sessions) {
    if (data.invalidIds.includes(source.workoutId)) { workouts.push({ workoutId: source.workoutId, invalid: true, suggestion: '', session: { id: source.id, name: historicalName(source.row), date: source.row.date, exercises: [] } as unknown as Session }); continue; }
    const row = source.row, date = T.normaliseImportDate(row.date, 'dmy'), started = utc(row.started_at_utc), done = utc(row.done_at_utc);
    const duration = numeric(row.duration_min, 'duration'), elapsed = numeric(row.elapsed_min, 'elapsed time');
    const session: Session = { id: source.id, name: historicalName(row), templateId: '', color: '#f59e0b', mode: 'import', date, startedAt: started ?? date + 'T12:00:00.000Z', finishedAt: done ?? started ?? date + 'T12:00:00.000Z', duration: duration ?? elapsed ?? (started && done ? (Date.parse(done) - Date.parse(started)) / 60000 : 0), note: row.memo ?? '', exercises: [], pbs: [], volume: 0,
      importMetadata: { source: 'planfit', workoutId: source.workoutId, workoutIds: [source.workoutId], batchId: '', row: { ...row }, startedAtUTC: started, doneAtUTC: done, durationMin: duration, elapsedMin: elapsed, caloriesKcal: numeric(row.calories_kcal, 'calories'), sourceOrder: source.order, fingerprint: '', nameOrigin: historicalName(row) === 'Imported Workout' ? 'unlabeled' : 'source' } };
    for (const entry of source.exercises) {
      const name = entry.row.exercise_name.trim(), exercise = resolveExercise(name, matches, library, ids);
      if (!library.some(e => e.id === exercise.id)) newExercises.set(exercise.id, exercise);
      const ordered = [...entry.sets].sort((a, b) => (numeric(a.row.set_no, 'set number', true) ?? a.order + 1) - (numeric(b.row.set_no, 'set number', true) ?? b.order + 1) || a.order - b.order);
      const completed = ordered.filter(set => completedValue(set.row.completed));
      session.exercises.push({ id: source.id + '-e' + entry.order, exerciseId: exercise.id, name: entry.row.exercise_name, muscles: [...exercise.muscles], range: [...exercise.range], requiredSets: completed.length, rest: exercise.rest, note: entry.row.memo ?? '', feeling: 'Fine', painNote: '',
        importMetadata: { source: 'planfit', exerciseEntryId: entry.row.exercise_entry_id, recordType: entry.row.record_type ?? '', sourceOrder: entry.order, row: { ...entry.row }, incompleteSets: ordered.filter(set => !completedValue(set.row.completed)).map(set => ({ ...set.row })) },
        sets: completed.map(set => ({ id: source.id + '-s' + set.order, weight: numeric(set.row.weight_kg, 'weight'), reps: numeric(set.row.reps, 'reps', true), durationSec: numeric(set.row.duration_sec, 'duration'), number: numeric(set.row.set_no, 'set number', true), completed: true, type: importedSetType(set.row.set_type), sourceType: set.row.set_type ?? '', timestamp: session.startedAt, importMetadata: { source: 'planfit', row: { ...set.row }, sourceOrder: set.order } })),
      });
    }
    session.volume = T.sessionVolume(session); session.importMetadata!.fingerprint = T.fingerprint(session);
    const suggestion = classifyWorkout(session.exercises);
    session.importMetadata!.suggestedName = suggestion;
    const known = history.find(s => s.importMetadata?.source === 'planfit' && (s.importMetadata.workoutId === source.workoutId || (s.importMetadata.workoutIds??[]).includes(source.workoutId)));
    const reference = records.find(r => r.kind === 'import-source' && r.data.type === 'workout-reference' && r.data.workoutId === source.workoutId)?.data;
    let duplicate: Duplicate | undefined;
    if (known || reference) duplicate = { targetId: known?.id ?? reference.sessionId, kind: 'source', location: 'history', referenceOnly: !known && reference?.disposition==='duplicate-skipped', reason: !known && reference?.disposition==='duplicate-skipped'?'This Planfit ID was previously skipped as a duplicate of the saved workout.':'This Planfit workout_id was already reviewed/imported.' };
    else {
      const previous = history.find(s => T.likelyDuplicate(session, s) && sameTiming(session, s));
      const within = workouts.find(w => !w.invalid && T.likelyDuplicate(session, w.session) && sameTiming(session, w.session));
      if (previous || within) { const match = previous ?? within!.session, kind = duplicateKind(session, match); duplicate = { targetId: match.id, kind, location: previous ? 'history' : 'export', reason: kind === 'identical' ? 'Identical timestamps, duration and completed sets.' : 'Same date and all completed sets match. Timestamps/duration need review.' }; }
    }
    workouts.push({ workoutId: source.workoutId, session, suggestion, duplicate, invalid: false });
  }
  return { workouts, newExercises: [...newExercises.values()], matches };
}
export async function preparePlanfitImport(data: PlanfitExport, preview: PlanfitPreview, options: ImportOptions, history: Session[], library: Exercise[], programme: Programme) {
  if (preview.matches.some(m => !m.confirmed)) throw new Error('Review every exercise name before importing.');
  if (data.issues.length && !options.skipInvalid) throw new Error('Fix the reported rows or explicitly exclude invalid rows and affected sessions.');
  const batchId = T.uid(), entries: ImportEntry[] = [], kept: Session[] = [], skipped: { workoutId: string; reason: string; targetId?: string }[] = [];
  const references: { workoutId: string; sessionId: string; disposition: string }[] = [];
  const ordered = preview.workouts.filter(w => !w.invalid).sort((a, b) => a.session.startedAt.localeCompare(b.session.startedAt) || a.session.importMetadata!.sourceOrder - b.session.importMetadata!.sourceOrder);
  for (const item of ordered) {
    if (options.excluded.includes(item.workoutId)) { skipped.push({ workoutId: item.workoutId, reason: 'Excluded by user' }); continue; }
    const source = structuredClone(item.session);
    const actualWithin = kept.find(s => T.likelyDuplicate(source, s) && sameTiming(source, s));
    const duplicate = item.duplicate?.location === 'history' ? item.duplicate : actualWithin ? {targetId:actualWithin.id,kind:duplicateKind(source,actualWithin),location:'export' as const,reason:'Same completed sets and session timing as a retained workout in this export.'} : undefined;
    const existing = duplicate?.location === 'history' ? history.find(s => s.id === duplicate.targetId) : actualWithin;
    if (duplicate && (duplicate.referenceOnly || options.duplicatePolicy === 'skip' || (duplicate.location==='export'&&options.duplicatePolicy==='replace') || (duplicate.kind === 'source' && options.duplicatePolicy === 'anyway') || (options.duplicatePolicy === 'replace' && !existing))) {
      const targetId = duplicate.location === 'export' && !existing ? undefined : duplicate.targetId;
      if (targetId) { skipped.push({ workoutId: item.workoutId, reason: duplicate.reason, targetId }); references.push({ workoutId: item.workoutId, sessionId: targetId, disposition: 'duplicate-skipped' }); continue; }
    }
    if (duplicate && options.duplicatePolicy === 'replace' && existing) {
      source.id = existing.id;
      source.importMetadata!.workoutIds = [...new Set([...(existing.importMetadata?.workoutIds ?? []), item.workoutId])];
    }
    const customName = options.names[item.workoutId]?.trim();
    if (customName) { source.name = customName; source.importMetadata!.nameOrigin = options.acceptedSuggestions.includes(item.workoutId) && customName === item.suggestion ? 'confirmed-suggestion' : 'user'; }
    if (!source.name.trim()) throw new Error('Every imported workout needs a name. Leave it as Imported Workout if unknown.');
    source.importMetadata!.batchId = batchId;
    const template = programme.templates.find(t => t.name.toLowerCase() === source.name.toLowerCase());
    if (template && source.name !== 'Imported Workout') { source.templateId = template.id; source.color = template.color; }
    const baseline = [...history.filter(s => s.id !== source.id && s.startedAt <= source.startedAt), ...kept.filter(s => s.id !== source.id && s.startedAt <= source.startedAt)];
    const snapshot = T.recalculateRecords(source, baseline);
    const index = kept.findIndex(s => s.id === snapshot.id); if (index >= 0) kept.splice(index, 1);
    kept.push(snapshot); references.push({ workoutId: item.workoutId, sessionId: snapshot.id, disposition: 'imported' });
  }
  for (const snapshot of kept) entries.push({ kind: 'session', id: snapshot.id, data: snapshot });
  const used = new Set(kept.flatMap(s => s.exercises.map(e => e.exerciseId)));
  const exercises = [...library, ...preview.newExercises].map(exercise => {
    if (!options.saveAliases) return exercise;
    const aliases = preview.matches.filter(m => m.confirmed && m.target === 'library:' + exercise.id).map(m => m.name).filter(name => name !== exercise.name);
    // Source-to-source matches resolve through the stable IDs used in snapshots.
    for (const item of preview.workouts.filter(w=>!w.invalid).map(w=>w.session)) for (const entry of item.exercises) if (entry.exerciseId === exercise.id && entry.name !== exercise.name) aliases.push(entry.name);
    return { ...exercise, aliases: [...new Set([...(exercise.aliases ?? []), ...aliases])] };
  });
  for (const exercise of exercises) if (used.has(exercise.id) || (options.saveAliases && library.some(e => e.id === exercise.id) && JSON.stringify(exercise.aliases ?? []) !== JSON.stringify(library.find(e => e.id === exercise.id)?.aliases ?? []))) entries.push({ kind: 'exercise', id: exercise.id, data: exercise });
  for (const reference of references) { const id = data.sourceReferences[reference.workoutId]; entries.push({ kind: 'import-source', id, data: { id, source: 'planfit', type: 'workout-reference', ...reference, batchId } }); }
  for (const file of data.files.filter(f => !kinds.slice(0, 3).includes(f.kind))) for (const row of file.rows) {
    const id = 'pf-data-' + await digest(file.kind + canonical(row));
    entries.push({ kind: 'import-source', id, data: { id, source: 'planfit', type: file.kind, date: row.date ?? '', row: { ...row }, sourceFile: file.name } });
  }
  const id = batchId;
  entries.push({ kind: 'import-batch', id, data: { id, source: 'planfit', importedAt: new Date().toISOString(), files: data.files.map(({ name, kind, hash, rows }) => ({ name, kind, hash, rows: rows.length })), importedWorkouts: kept.length, skipped, issues: data.issues, exerciseMatches: preview.matches, duplicatePolicy: options.duplicatePolicy } });
  return { entries, imported: kept.length, skipped: skipped.length + preview.workouts.filter(w => w.invalid).length };
}
