import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../node_modules/esbuild/lib/main.js';
import * as T from '../lib/training.ts';
import { backupValid, trainingCSV } from '../lib/data-export.ts';
import { fixtureTables, csv } from './planfit-fixture.mjs';
const bundled = await build({ entryPoints: ['lib/planfit-import.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node24' });
const P = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].contents).toString('base64'));
const defaults = () => T.defaults();
async function fixture(transform = x => x) {
  const tables = transform(fixtureTables());
  const files = await Promise.all(Object.entries(tables).map(([kind, rows]) => P.readPlanfitFile(kind + '.csv', csv(kind, rows))));
  const data = await P.parsePlanfitExport(files);
  const { library, programme, settings } = defaults();
  const ids = Object.fromEntries(data.names.map((name, i) => [name, 'new-exercise-' + i]));
  const matches = P.proposeExerciseMatches(data.names, library).map(m => ({ ...m, confirmed: true }));
  const preview = P.previewPlanfit(data, matches, ids, library, []);
  return { data, matches, ids, preview, library, programme, settings };
}
const options = patch => ({ names: {}, excluded: [], duplicatePolicy: 'skip', skipInvalid: false, saveAliases: true, acceptedSuggestions: [], ...patch });
async function importIt(f, patch = {}, history = []) { return P.preparePlanfitImport(f.data, f.preview, options(patch), history, f.library, f.programme); }
const session = (f, id) => f.preview.workouts.find(w => w.workoutId === id).session;
function records(entries) { return entries.map(e => ({ ...e, key: e.kind + ':' + e.id, dirty: false, revision: 'test', updated: 0 })); }

test('Dedicated Planfit detection uses filenames or exact table columns, including empty optional tables', async () => {
  const file = await P.readPlanfitFile('renamed-export.csv', csv('daily_steps', []));
  assert.equal(file.kind, 'daily_steps'); assert.deepEqual(file.rows, []);
  await assert.rejects(P.readPlanfitFile('workout_sets.csv', 'date,weight\n2026-01-01,30'), /missing Planfit columns/);
  await assert.rejects(P.parsePlanfitExport([file]), /workout_sessions/);
  await assert.rejects(P.readPlanfitFile('unknown.csv', 'one,two\n1,2'), /not a recognised/);
});
test('All three workout tables join by both stable source IDs and retain exercise file order', async () => {
  const f = await fixture();
  assert.equal(f.data.counts.workouts, 7); assert.equal(f.data.counts.exercises, 10); assert.equal(f.data.counts.sets, 14); assert.equal(f.data.counts.completedSets, 13);
  const legs = session(f, 'legs-a'), back = session(f, 'back-a');
  assert.deepEqual(legs.exercises.map(e => e.name), ['Leg Press', 'Leg Curl']);
  assert.deepEqual(back.exercises.map(e => e.name), ['Preacher Curl', 'Barbell Row']);
  assert.deepEqual(back.exercises[0].sets.map(s => [s.number, s.weight, s.reps, s.sourceType]), [[1,30,12,'normal'],[2,25,13,'drop_set']]);
  assert.equal(legs.exercises[0].sets.length, 2); assert.equal(legs.exercises[0].importMetadata.incompleteSets.length, 1);
  assert.equal(legs.exercises[0].importMetadata.exerciseEntryId, 'entry-1');
  assert.equal(session(f, 'legs-copy').exercises[0].importMetadata.exerciseEntryId, 'entry-1');
  assert.equal(legs.exercises[0].exerciseId, session(f, 'legs-copy').exercises[0].exerciseId);
});
test('Session source times, active/elapsed durations, calories, notes and all source IDs survive import', async () => {
  const f = await fixture(), result = await importIt(f), legs = result.entries.find(e => e.kind === 'session' && e.data.importMetadata.workoutId === 'legs-a').data;
  assert.equal(legs.startedAt, '2025-11-08T07:00:00.000Z'); assert.equal(legs.finishedAt, '2025-11-08T08:00:00.000Z');
  assert.equal(legs.duration, 50); assert.equal(legs.importMetadata.elapsedMin, 60); assert.equal(legs.importMetadata.caloriesKcal, 350);
  assert.equal(legs.note, 'A memo, with a comma\nand a new line'); assert.equal(legs.exercises[0].note, 'Feet high');
  assert.equal(legs.importMetadata.row.routine_name, 'Routine A'); assert.equal(legs.importMetadata.row.is_home, 'false');
  assert.equal(legs.volume, 1360); // Warm-up and incomplete sets excluded.
});
test('Walking and other nullable sets are preserved without fake weight, reps, strength PBs or targets', async () => {
  const f = await fixture(), walk = session(f, 'walk-a'), set = walk.exercises[0].sets[0];
  assert.equal(set.weight, null); assert.equal(set.reps, null); assert.equal(set.durationSec, 1500); assert.equal(set.completed, true);
  assert.equal(T.sessionVolume(walk), 0); assert.equal(T.e1rm(set), 0); assert.equal(T.formatSet(set), '25m');
  assert.deepEqual(T.setRecords(walk, walk.exercises[0], set, []), []);
  assert.equal(T.target(walk.exercises[0], [walk]).beat, null);
  const imported = await importIt(f); assert.equal(imported.entries.find(e => e.kind === 'session' && e.data.importMetadata.workoutId === 'walk-a').data.pbs.length, 0);
  const pull = session(f, 'bodyweight').exercises[0].sets[0]; assert.equal(pull.weight, null); assert.equal(pull.reps, 8); assert.equal(pull.durationSec, null);
});
test('Classification suggests from exercises and never fabricates names or changes the live rotation', async () => {
  const f = await fixture(), before = JSON.stringify(f.settings);
  assert.equal(session(f, 'legs-a').name, 'Imported Workout'); assert.equal(f.preview.workouts.find(w => w.workoutId === 'legs-a').suggestion, 'Legs + Shoulders');
  assert.equal(session(f, 'back-a').name, 'My Upper Back'); assert.equal(f.preview.workouts.find(w => w.workoutId === 'walk-a').suggestion, 'Walking / Cardio');
  const a = await importIt(f); assert.equal(a.entries.find(e => e.kind === 'session' && e.data.importMetadata.workoutId === 'legs-a').data.name, 'Imported Workout');
  const b = await importIt(f, { names: { 'legs-a': 'Legs + Shoulders' }, acceptedSuggestions: ['legs-a'] });
  const named = b.entries.find(e => e.kind === 'session' && e.data.importMetadata.workoutId === 'legs-a').data;
  assert.equal(named.name, 'Legs + Shoulders'); assert.equal(named.importMetadata.nameOrigin, 'confirmed-suggestion'); assert.equal(named.templateId, 'legs');
  assert.equal(named.importMetadata.row.workout_name, 'Gym Workout Routine'); assert.equal(JSON.stringify(f.settings), before); assert.ok(!b.entries.some(e => e.kind === 'settings' || e.kind === 'programme'));
});
test('Case and punctuation matches require confirmation; distinct equipment/variants remain distinct', async () => {
  const library = defaults().library;
  const m = P.proposeExerciseMatches(['Leg Press','Leg press','Leg Curl','Leg curl','Seated Leg Curl','Dumbbell Leg Curl','Leg-Press'], library);
  assert.equal(m[0].confirmed, true); assert.equal(m[1].confirmed, false); assert.equal(m[1].reason, 'case variant');
  assert.equal(m[2].target, 'new'); assert.equal(m[3].target, 'source:Leg Curl'); assert.equal(m[4].target, 'library:legcurl'); assert.equal(m[5].target, 'new'); assert.equal(m[6].confirmed, false);
  const f = await fixture(); f.preview.matches[0].confirmed = false;
  await assert.rejects(importIt(f), /Review every exercise/);
});
test('Confirmed aliases are saved and recognised on future imports while historical source names stay exact', async () => {
  const f = await fixture(), result = await importIt(f, { duplicatePolicy: 'anyway' });
  const lib = result.entries.filter(e => e.kind === 'exercise').map(e => e.data);
  const press = lib.find(e => e.id === 'legpress'); assert.ok(press.aliases.includes('Leg press'));
  const curl = lib.find(e => e.name === 'Leg Curl'); assert.ok(curl.aliases.includes('Leg curl'));
  const future = P.proposeExerciseMatches(['Leg press','Leg curl'], lib);
  assert.ok(future.every(m => m.confirmed && m.reason === 'saved alias'));
  assert.equal(result.entries.find(e => e.kind === 'session' && e.data.importMetadata.workoutId === 'legs-copy').data.exercises[0].name, 'Leg press');
});
test('Exact duplicate weight sessions and Walking sessions are flagged; genuinely later walks are retained', async () => {
  const f = await fixture();
  assert.equal(f.preview.workouts.find(w => w.workoutId === 'legs-copy').duplicate.kind, 'identical');
  assert.equal(f.preview.workouts.find(w => w.workoutId === 'walk-copy').duplicate.kind, 'identical');
  assert.equal(f.preview.workouts.find(w => w.workoutId === 'walk-later').duplicate, undefined);
  const a = await importIt(f); assert.equal(a.imported, 5); assert.equal(a.skipped, 2);
  const b = await importIt(f, { duplicatePolicy: 'anyway' }); assert.equal(b.imported, 7);
});
test('Source workout IDs prevent reimport even when source rows change or Import anyway is selected', async () => {
  const f = await fixture(), first = await importIt(f), history = first.entries.filter(e => e.kind === 'session').map(e => e.data), saved = records(first.entries);
  f.preview = P.previewPlanfit(f.data, f.matches, f.ids, f.library, history, saved);
  assert.ok(f.preview.workouts.every(w => w.duplicate?.kind === 'source'));
  const repeated = await importIt(f, { duplicatePolicy: 'anyway' }, history); assert.equal(repeated.imported, 0); assert.equal(repeated.skipped, 7);
  const changed = await fixture(t => { t.workout_sets[1][6] = 110; return t; });
  changed.preview = P.previewPlanfit(changed.data, changed.matches, changed.ids, changed.library, history, saved);
  assert.equal(changed.preview.workouts[0].duplicate.kind, 'source');
  const update = await importIt(changed, { duplicatePolicy: 'replace' }, history);
  assert.equal(update.entries.find(e => e.kind === 'session' && e.data.id === history.find(s => s.importMetadata.workoutId === 'legs-a').id).data.exercises[0].sets[1].weight, 110);
});
test('Skipping the first of three duplicates still retains only one actual workout', async () => {
  const f = await fixture(t => {
    t.workout_sessions.push(['walk-copy-2',...t.workout_sessions[4].slice(1)]);
    t.workout_exercises.push(['walk-copy-2',...t.workout_exercises[7].slice(1)]);
    t.workout_sets.push(['walk-copy-2',...t.workout_sets[11].slice(1)]);
    return t;
  });
  const result = await importIt(f, { excluded: ['walk-a'] });
  assert.equal(result.entries.filter(e => e.kind === 'session' && e.data.date === '2026-09-08').length, 2); // one morning + one distinct evening walk
});
test('Duplicate fingerprints compare exact set multiplicity and duration, never subsets or null-as-zero', async () => {
  const f = await fixture(), a = session(f, 'walk-a'), b = structuredClone(a);
  b.exercises[0].sets[0].durationSec = 1600; assert.equal(T.likelyDuplicate(a, b), false);
  b.exercises[0].sets[0].durationSec = 1500; b.exercises[0].sets.push(structuredClone(b.exercises[0].sets[0])); assert.equal(T.likelyDuplicate(a, b), false);
  b.exercises[0].sets.pop(); b.exercises[0].sets[0].weight = 0; assert.equal(T.likelyDuplicate(a, b), false);
});
test('Bad joins, invalid completed states and invalid dates require review, never partial-session imports', async () => {
  const f = await fixture(t => { t.workout_sets[7][9] = 'maybe'; t.workout_sessions[0][1] = '2025-02-31'; t.workout_sets.push(['missing','2026-01-01','orphan','Walking',1,'normal','','',60,true]); return t; });
  assert.equal(f.data.issues.length, 3); await assert.rejects(importIt(f), /Fix the reported rows/);
  const result = await importIt(f, { skipInvalid: true });
  assert.ok(!result.entries.some(e => e.kind === 'session' && ['legs-a','back-a'].includes(e.data.importMetadata.workoutId)));
  assert.equal(result.entries.find(e => e.kind === 'import-batch').data.issues.length, 3);
});
test('Daily summaries, steps, and profile survive without creating workouts, sets, PB events or setting changes', async () => {
  const f = await fixture(), result = await importIt(f), aux = result.entries.filter(e => e.kind === 'import-source' && e.data.type !== 'workout-reference');
  assert.equal(aux.length, 3); assert.equal(aux.find(e => e.data.type === 'profile').data.row.weight_unit, 'lb');
  assert.equal(aux.find(e => e.data.type === 'daily_steps').data.row.steps, '8500');
  assert.equal(aux.find(e => e.data.type === 'exercise_daily_records').data.row.est_1rm_kg, '42');
  assert.equal(session(f, 'back-a').exercises[0].sets[0].weight, 30);
  assert.ok(!result.entries.some(e => e.kind === 'settings' || e.kind === 'weight'));
});
test('Lossless backups restore nullable duration sets, import metadata, aliases and all supplementary source records', async () => {
  const f = await fixture(), result = await importIt(f), restored = JSON.parse(JSON.stringify(result.entries));
  assert.ok(restored.every(backupValid)); assert.deepEqual(restored, result.entries);
  const csvText = trainingCSV(records(result.entries)); const table = T.parseCSVTable(csvText);
  const walk = table.rows.find(r => r.exercise === 'Walking'); assert.equal(walk.weight, ''); assert.equal(walk.reps, ''); assert.equal(walk.duration_sec, '1500');
  assert.equal(walk.planfit_workout_id, 'walk-a'); assert.ok(JSON.parse(walk.payload).setImportMetadata.row.completed);
  assert.equal(table.rows.filter(r => r.record_kind === 'import-source').length, 10);
  assert.ok(table.rows.every(row => Object.keys(row).length === table.headers.length));
});
test('Import scale is derived from arbitrary exports, with repeatable source IDs and no hardcoded date/count assumptions', async () => {
  const make = count => ({ workout_sessions: Array.from({ length: count }, (_,i) => ['source-'+i, T.addDays('2024-01-01',i), '', '', '', '', 30, 40, '', false, '']), workout_exercises: Array.from({ length: count }, (_,i) => ['source-'+i,T.addDays('2024-01-01',i),'entry','Preacher Curl','weight_reps','']), workout_sets: Array.from({ length: count }, (_,i) => ['source-'+i,T.addDays('2024-01-01',i),'entry','Preacher Curl',1,'normal',30,8+i%5,'',true]) });
  const f = await fixture(() => make(211)); assert.equal(f.data.counts.workouts,211); assert.equal(f.data.counts.completedSets,211); assert.deepEqual(f.data.dateRange,['2024-01-01',T.addDays('2024-01-01',210)]);
  const again = await fixture(() => make(211)); assert.equal(f.data.sessions[100].id,again.data.sessions[100].id);
  assert.equal((await importIt(f)).imported,211);
});

test('Reviewed aliases persist even when the variant session is skipped as an exact duplicate', async () => {
  const f=await fixture(), result=await importIt(f);
  const curl=result.entries.find(e=>e.kind==='exercise'&&e.data.name==='Leg Curl').data;
  assert.ok(curl.aliases.includes('Leg curl'));
  assert.ok(!result.entries.some(e=>e.kind==='session'&&e.data.importMetadata.workoutId==='legs-copy'));
});
test('Repeated exercise entries retain every occurrence and PB calculations use prior sets only', async () => {
  const f=await fixture(t=>{
    t.workout_exercises.push(['back-a','2026-09-07','preacher-extra','Preacher Curl','weight_reps','Second exercise entry']);
    t.workout_sets.push(['back-a','2026-09-07','preacher-extra','Preacher Curl',1,'normal',30,13,'',true]);return t;
  });
  const result=await importIt(f), back=result.entries.find(e=>e.kind==='session'&&e.data.importMetadata.workoutId==='back-a').data;
  assert.equal(T.exposures('preacher',[back]).length,2);
  const rep=back.pbs.find(p=>p.type==='Rep PB'&&p.detail==='30 kg × 13');assert.equal(rep.previous,12);
  assert.deepEqual(back.exercises.filter(e=>e.exerciseId==='preacher').flatMap(e=>e.sets.map(s=>s.reps)),[12,13,13]);
});
test('Unknown imported names compare only equivalent exercise sequences, not unrelated Imported Workouts',async()=>{
  const f=await fixture(),legs=session(f,'legs-a'),walk=session(f,'walk-a');
  assert.equal(T.equivalentSessions(legs,walk),false);
  assert.equal(T.previousSession(walk,[legs]),undefined);
});
test('Literal null fields and completed sets without numeric values are retained without coercion',async()=>{
  const f=await fixture(t=>{t.workout_sets[10][6]='null';t.workout_sets[10][7]='NULL';t.workout_sets[10][8]='1500';t.workout_sets[13][7]='';return t;});
  assert.equal(session(f,'walk-a').exercises[0].sets[0].weight,null);
  const empty=session(f,'bodyweight').exercises[0].sets[0];assert.equal(empty.reps,null);assert.equal(empty.durationSec,null);assert.equal(empty.completed,true);
  const result=await importIt(f);assert.ok(result.entries.every(backupValid));
});
