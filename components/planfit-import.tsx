'use client';
import React, { useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, FileSpreadsheet, ShieldCheck, TriangleAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import * as P from '@/lib/planfit-import';
import * as T from '@/lib/training';
import type { Exercise, Programme, RecordEntry, Session } from '@/lib/training';

type Props = { library: Exercise[]; sessions: Session[]; programme: Programme; records: RecordEntry[]; close: () => void; put: (entries: P.ImportEntry[]) => Promise<boolean> };
const steps = ['Files', 'Exercises', 'Names', 'Review'];
function TargetSelect({ match, matches, library, onChange }: { match: P.ExerciseMatch; matches: P.ExerciseMatch[]; library: Exercise[]; onChange: (target: string) => void }) {
  return <select className="planfit-select" aria-label={'Match ' + match.name} value={match.target} onChange={e => onChange(e.target.value)}>
    <option value="new">Create separately: {match.name}</option>
    <optgroup label="Forge exercise library">{library.map(e => <option key={e.id} value={'library:' + e.id}>{e.name}</option>)}</optgroup>
    <optgroup label="Same exercise as another source name">{matches.filter(m => m.name !== match.name && !m.target.startsWith('source:')).map(m => <option key={m.name} value={'source:' + m.name}>{m.name}</option>)}</optgroup>
  </select>;
}
function WorkoutPreview({ session }: { session: Session }) {
  return <div className="planfit-set-preview">{session.exercises.map(e => <div key={e.id}><strong>{e.name}</strong><small>{e.sets.length ? e.sets.map(set => `#${set.number ?? '—'} ${T.formatSet(set)}${set.sourceType ? ' · ' + set.sourceType : ''}`).join(' / ') : 'No completed sets'}</small>{e.note && <small>Note: {e.note}</small>}</div>)}</div>;
}
export default function PlanfitImport({ library, sessions, programme, records, close, put }: Props) {
  const [files, setFiles] = useState<P.PlanfitFile[]>([]), [data, setData] = useState<P.PlanfitExport | null>(null);
  const [step, setStep] = useState(0), [error, setError] = useState(''), [reading, setReading] = useState(false), [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<P.ExerciseMatch[]>([]), [ids, setIds] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({}), [accepted, setAccepted] = useState<string[]>([]), [excluded, setExcluded] = useState<string[]>([]);
  const [policy, setPolicy] = useState<P.ImportOptions['duplicatePolicy']>('skip'), [skipInvalid, setSkipInvalid] = useState(false), [saveAliases, setSaveAliases] = useState(true);
  const [query, setQuery] = useState(''), [unreviewedOnly, setUnreviewedOnly] = useState(false), [limit, setLimit] = useState(24);
  const busyRef = useRef(false);
  const previewResult = useMemo(() => {
    if (!data) return { preview: null, error: '' };
    try { return { preview: P.previewPlanfit(data, matches, ids, library, sessions, records), error: '' }; }
    catch (e) { return { preview: null, error: (e as Error).message }; }
  }, [data, matches, ids, library, sessions, records]);
  const preview = previewResult.preview;
  const unreviewed = matches.filter(m => !m.confirmed);
  const duplicates = preview?.workouts.filter(w => w.duplicate) ?? [];
  const filteredMatches = matches.filter(m => m.name.toLowerCase().includes(query.toLowerCase()) && (!unreviewedOnly || !m.confirmed));
  const visibleWorkouts = (preview?.workouts ?? []).filter(w => !query || `${w.session.name} ${w.session.date} ${w.workoutId} ${w.session.exercises.map(e => e.name).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const suggestions = [...new Set((preview?.workouts ?? []).filter(w => !w.invalid && w.session.name === 'Imported Workout' && w.suggestion).map(w => w.suggestion))];
  function changeStep(value: number) { setStep(value); setLimit(24); setQuery(''); setError(''); }
  function confirmName(workoutId: string, name: string, suggested: boolean) { setNames(old => ({ ...old, [workoutId]: name })); setAccepted(old => suggested ? [...new Set([...old, workoutId])] : old.filter(id => id !== workoutId)); }
  async function readFiles(selected: FileList | null) {
    if (!selected?.length || reading) return;
    setReading(true); setError('');
    try {
      const chosen = Array.from(selected);
      if (chosen.some(f => f.size > 20_000_000) || chosen.reduce((sum, f) => sum + f.size, 0) > 100_000_000) throw new Error('Choose CSV files under 20 MB each and 100 MB in total.');
      const loaded = await Promise.all(chosen.map(async file => P.readPlanfitFile(file.name, await file.text())));
      if (new Set(loaded.map(f => f.kind)).size !== loaded.length) throw new Error('Choose one CSV per Planfit table. Two selected files contain the same table.');
      const next = [...files.filter(f => !loaded.some(newFile => newFile.kind === f.kind)), ...loaded];
      setFiles(next); setData(null); setNames({}); setAccepted([]); setExcluded([]); setSkipInvalid(false);
      if (!['workout_sessions', 'workout_exercises', 'workout_sets'].every(kind => next.some(f => f.kind === kind))) return;
      const parsed = await P.parsePlanfitExport(next);
      setMatches(P.proposeExerciseMatches(parsed.names, library));
      setIds(Object.fromEntries(parsed.names.map(name => [name, T.uid()])));
      setData(parsed);
    } catch (e) { setError((e as Error).message); }
    finally { setReading(false); }
  }
  function updateMatch(name: string, target: string) { setMatches(old => old.map(m => m.name === name ? { ...m, target, confirmed: true } : m)); }
  async function confirmImport() {
    if (!data || !preview || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await P.preparePlanfitImport(data, preview, { names, acceptedSuggestions: accepted, excluded, duplicatePolicy: policy, skipInvalid, saveAliases }, sessions, library, programme);
      if (await put(result.entries)) { toast.success(`${result.imported} Planfit workouts imported`, { description: `${result.skipped} skipped. Your normal rotation is unchanged.` }); close(); }
    } catch (e) { setError((e as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <div className="stack planfit-import">
    <div className="import-steps">{steps.map((label, i) => <span key={label} className={step === i ? 'active' : step > i ? 'done' : ''}>{step > i ? <Check size={14}/> : i + 1}<small>{label}</small></span>)}</div>
    {(error || previewResult.error) && <div role="alert" className="warning-banner"><TriangleAlert/>{error || previewResult.error}</div>}
    {step === 0 && <>
      <label className="upload-zone"><Upload/><h3>Choose your Planfit CSV files</h3><p>Select all six together, or add files in batches.</p><input aria-label="Select Planfit CSV files" type="file" multiple accept=".csv,text/csv" disabled={reading} onChange={e => { void readFiles(e.target.files); e.target.value = ''; }}/></label>
      {reading && <p role="status" className="muted">Reading and joining your Planfit export on this device…</p>}
      <div className="planfit-files">{['workout_sessions', 'workout_exercises', 'workout_sets', 'exercise_daily_records', 'daily_steps', 'profile'].map(kind => { const file = files.find(f => f.kind === kind); return <div key={kind}><FileSpreadsheet size={17}/><span><strong>{kind}.csv</strong><small>{file ? `${file.rows.length.toLocaleString()} rows · ${file.name}` : kind.startsWith('workout_') ? 'Required to join workout history' : 'Optional · retained as original source data'}</small></span>{file && <Check className="green" size={18}/>}</div>; })}</div>
      {data && preview && <><h3>Planfit Import Preview</h3><div className="summary-stats"><div><strong>{data.counts.workouts}</strong><span>workouts detected</span></div><div><strong>{data.names.length}</strong><span>unique exercise names</span></div><div><strong>{data.counts.completedSets}</strong><span>completed sets</span></div><div><strong>{duplicates.length}</strong><span>potential duplicates</span></div></div><p className="muted">{data.counts.exercises} exercise entries · {data.counts.sets} total set rows · {matches.filter(m => m.reason === 'new exercise').length} unmatched names</p><p>{data.dateRange.length ? `${T.formatDate(data.dateRange[0], { day: 'numeric', month: 'long', year: 'numeric' })} – ${T.formatDate(data.dateRange[1], { day: 'numeric', month: 'long', year: 'numeric' })}` : 'No valid workout dates detected.'}</p>{data.issues.length > 0 && <p className="gold">{data.issues.length} source issues require review. Affected workouts will not be partially imported.</p>}<button className="primary" onClick={() => changeStep(1)}>Review exercise matching</button></>}
      <p className="muted">Nothing is saved until the final confirmation. Daily exercise summaries, steps and profile are retained for backup/export; they do not create extra workouts, sets or PB events, or overwrite your settings.</p>
    </>}
    {step === 1 && <>
      <h3>Match Planfit exercises</h3><p className="muted">Exact matches and previously saved aliases are recognised. Confirm case/normalised suggestions, choose another exercise, or keep each name separate. Equipment-specific exercises are never merged by guesswork.</p>
      <p><strong>{matches.length - unreviewed.length} / {matches.length}</strong> exercise names reviewed</p>
      <input aria-label="Search Planfit exercise names" placeholder="Search source exercise names" value={query} onChange={e => { setQuery(e.target.value); setLimit(24); }}/>
      <label className="planfit-check"><input type="checkbox" checked={unreviewedOnly} onChange={e => { setUnreviewedOnly(e.target.checked); setLimit(24); }}/>Only show names needing review</label>
      <div className="two-buttons"><button className="secondary" disabled={!unreviewed.some(m => m.reason === 'case variant' || m.reason === 'normalised variant')} onClick={() => setMatches(old => old.map(m => m.reason === 'case variant' || m.reason === 'normalised variant' ? { ...m, confirmed: true } : m))}>Confirm all proposed matches</button><button className="secondary" disabled={!unreviewed.some(m => m.reason === 'new exercise')} onClick={() => setMatches(old => old.map(m => m.reason === 'new exercise' ? { ...m, confirmed: true } : m))}>Keep unmatched names separately</button></div>
      {filteredMatches.slice(0, limit).map(match => <div className="card planfit-match" key={match.name}><div className="row"><strong>{match.name}</strong><span className={match.confirmed ? 'green small-text' : 'gold small-text'}>{match.confirmed ? 'Reviewed' : 'Needs review'} · {match.reason}</span></div><TargetSelect match={match} matches={matches} library={library} onChange={target => updateMatch(match.name, target)}/>{!match.confirmed && <button className="text-button" onClick={() => updateMatch(match.name, match.target)}>Confirm {match.name}</button>}</div>)}
      {filteredMatches.length > limit && <button className="secondary" onClick={() => setLimit(limit + 24)}>Show more exercise names</button>}
      <label className="planfit-check"><input type="checkbox" checked={saveAliases} onChange={e => setSaveAliases(e.target.checked)}/>Remember confirmed exercise aliases for future imports</label>
      <div className="two-buttons"><button className="secondary" onClick={() => changeStep(0)}><ChevronLeft/>Files</button><button className="primary" disabled={!!unreviewed.length || !preview} onClick={() => changeStep(2)}>Review historical workout names</button></div>
    </>}
    {(step === 2 || step === 3) && data && preview && <>
      {step === 2 ? <><h3>Historical workout names</h3><p className="muted">Blank and generic Planfit names stay Imported Workout. Suggestions below use the session's exercises. They are applied only when you choose them.</p><div className="planfit-bulk">{suggestions.map(suggestion => { const group = preview.workouts.filter(w => w.suggestion === suggestion && w.session.name === 'Imported Workout'); return <button className="secondary" key={suggestion} onClick={() => { setNames(old => ({ ...old, ...Object.fromEntries(group.map(w => [w.workoutId, suggestion])) })); setAccepted(old => [...new Set([...old, ...group.map(w => w.workoutId)])]); }}>Apply “{suggestion}” to {group.length} similar unnamed sessions</button>; })}</div></> : <>
        <h3>Planfit Import Preview</h3><div className="info-banner"><ShieldCheck/>Importing history never advances or resets your current workout rotation.</div>
        <div className="summary-stats"><div><strong>{preview.workouts.filter(w => !w.invalid && !excluded.includes(w.workoutId)).length}</strong><span>selected workouts</span></div><div><strong>{duplicates.length}</strong><span>potential duplicates</span></div><div><strong>{data.issues.length}</strong><span>source issues</span></div><div><strong>{unreviewed.length}</strong><span>unreviewed names</span></div></div>
        <label className="field"><span>Duplicate handling</span><select className="planfit-select" aria-label="Planfit duplicate handling" value={policy} onChange={e => setPolicy(e.target.value as P.ImportOptions['duplicatePolicy'])}><option value="skip">Skip duplicates</option><option value="replace">Replace matching sessions</option><option value="anyway">Import distinct source IDs anyway</option></select></label>
        <p className="muted">Already-imported Planfit workout IDs are skipped even with Import anyway. Replace updates the original snapshot. Previously skipped source copies remain skipped. Repeated sessions within this export are retained once. Within-export comparisons include all sets, null values, duration, timestamps and repeated-set counts.</p>
        {data.issues.length > 0 && <div className="card stack"><h3>Source issues</h3>{data.issues.slice(0, 16).map((issue, i) => <p className="small-text" key={i}>{issue.file}, row {issue.row}{issue.workoutId ? ' · ' + issue.workoutId : ''}: {issue.message}</p>)}{data.issues.length > 16 && <p className="muted">{data.issues.length - 16} more issues will be retained in the import report.</p>}<label className="planfit-check"><input type="checkbox" checked={skipInvalid} onChange={e => setSkipInvalid(e.target.checked)}/>Exclude invalid rows and affected workouts; retain their issues in the import report</label></div>}
      </>}
      <input aria-label="Search Planfit workouts" value={query} onChange={e => { setQuery(e.target.value); setLimit(24); }} placeholder="Find a date, exercise or source workout ID"/>
      {visibleWorkouts.slice(0, limit).map(item => {
        const session = item.session, match = item.duplicate && (item.duplicate.location === 'history' ? sessions.find(s => s.id === item.duplicate!.targetId) : preview.workouts.find(w => w.session.id === item.duplicate!.targetId)?.session);
        return <div className="card import-workout" key={item.workoutId}>
          <div className="row"><p className="eyebrow">{session.date}</p>{item.invalid ? <span className="pill gold">INVALID SOURCE DATA</span> : item.duplicate && <span className="pill gold">{item.duplicate.kind === 'source' ? 'ALREADY IMPORTED ID' : 'POTENTIAL DUPLICATE'}</span>}</div>
          <p className="small-text muted">Planfit ID: {item.workoutId}</p>
          {step === 2 && !item.invalid ? <><label className="field"><span>Historical name · {session.date}</span><input aria-label={'Historical name ' + item.workoutId} value={names[item.workoutId] ?? session.name} onChange={e => confirmName(item.workoutId, e.target.value, false)}/></label>{session.name === 'Imported Workout' && item.suggestion && <button className="text-button" onClick={() => confirmName(item.workoutId, item.suggestion, true)}>Accept suggestion: {item.suggestion}</button>}<p className="muted">Source name: {session.importMetadata?.row.workout_name || '(blank)'} · Routine: {session.importMetadata?.row.routine_name || '(blank)'}</p></> : <h3>{names[item.workoutId] ?? session.name}</h3>}
          {!item.invalid && <><p className="muted">{session.exercises.length} exercises · {session.exercises.reduce((n, e) => n + e.sets.length, 0)} completed sets · {session.duration || 'Unknown'} min · {session.volume.toLocaleString()} kg volume</p><WorkoutPreview session={session}/>{session.importMetadata?.startedAtUTC && <p className="small-text muted">Started {session.importMetadata.startedAtUTC} · Finished {session.importMetadata.doneAtUTC ?? 'not supplied'}</p>}{session.note && <p className="muted">Memo: {session.note}</p>}</>}
          {step === 3 && !item.invalid && <><label className="planfit-check"><input type="checkbox" checked={!excluded.includes(item.workoutId)} onChange={e => setExcluded(old => e.target.checked ? old.filter(id => id !== item.workoutId) : [...old, item.workoutId])}/>Include in duplicate-policy review</label>{item.duplicate && <><p className="gold small-text">{item.duplicate.reason} {item.duplicate.location === 'export' ? 'Another session in this export.' : 'Existing Forge history.'}</p>{match && <details><summary>Compare matching workout</summary><h3 className="space-top">{match.name} · {match.date}</h3><p className="muted">{match.duration} min · Started {match.importMetadata?.startedAtUTC ?? match.startedAt}</p><WorkoutPreview session={match}/></details>}</>}</>}
        </div>;
      })}
      {visibleWorkouts.length > limit && <button className="secondary" onClick={() => setLimit(limit + 24)}>Show more workouts ({visibleWorkouts.length - limit} remaining)</button>}
      {step === 2 ? <div className="two-buttons"><button className="secondary" onClick={() => changeStep(1)}>Exercise matching</button><button className="primary" disabled={preview.workouts.some(w => names[w.workoutId] !== undefined && !names[w.workoutId].trim())} onClick={() => changeStep(3)}>Continue to duplicate review</button></div> : <><p className="muted">The six source tables and your review decisions are preserved in workout metadata and source records. Daily summary metrics are never substituted for actual sets. Confirming saves locally first, then backs up when connected.</p><div className="two-buttons"><button className="secondary" disabled={busy} onClick={() => changeStep(2)}>Back to names</button><button className="primary" disabled={busy || !!unreviewed.length || (data.issues.length > 0 && !skipInvalid)} onClick={() => void confirmImport()}><Upload/>{busy ? 'Importing…' : 'Confirm Planfit import'}</button></div></>}
    </>}
  </div>;
}
