import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../lib/training.ts';
import {muscleBoundEquipment,equipmentUpdates,matchesExercise,muscleBoundBradford as gym} from '../lib/gym-equipment.ts';
import {backupValid,trainingCSV} from '../lib/data-export.ts';

test('Existing accounts receive equipment once without changing programme, history or user settings',()=>{
 const d=T.defaults(),s=T.makeSession(d.programme.templates[0],d.library,'past',[]);s.exercises[0].sets=[{id:T.uid(),weight:80,reps:8,type:'Working',timestamp:s.startedAt}];const snapshot=T.finishSnapshot(s,[],40),before=structuredClone({d,snapshot});
 const updates=equipmentUpdates(d.library);assert.ok(updates.length);assert.deepEqual({d,snapshot},before);
 const full=[...d.library,...updates];assert.deepEqual(equipmentUpdates(full),[]);assert.equal(new Set(full.map(e=>e.id)).size,full.length);
 const edited={...updates[0],notes:'Seat 4',range:[6,10],increment:5};assert.deepEqual(equipmentUpdates(full.map(e=>e.id===edited.id?edited:e)),[]);
});

test('Exact imported machine matches preserve IDs, notes, aliases and progression settings',()=>{
 const named=muscleBoundEquipment().find(e=>e.brand==='Cybex');const existing={...named,id:'planfit-exercise-42',name:named.name.toLowerCase(),gymIds:undefined,brand:undefined,notes:'Seat 3',range:[6,10],rest:180,increment:5,aliases:['My chest machine']};const before=structuredClone(existing);
 const updates=equipmentUpdates([existing]),match=updates.find(e=>e.id===existing.id);assert.ok(match);for(const key of ['name','notes','range','rest','increment','aliases'])assert.deepEqual(match[key],existing[key]);assert.deepEqual(existing,before);assert.ok(match.gymIds.includes(gym.id));assert.equal(updates.some(e=>e.id===named.id),false);
 const combined=[...updates];assert.deepEqual(equipmentUpdates(combined),[]);
});

test('Generic and different branded chest presses never share identities or PB targets',()=>{
 const original={...T.defaults().library.find(e=>e.id==='bench'),id:'generic-chest',name:'Chest Press'};
 const updates=equipmentUpdates([original]);const cybex=updates.find(e=>e.brand==='Cybex');const atlantis=updates.find(e=>e.name==='Atlantis Incline Press');assert.notEqual(cybex.id,original.id);assert.notEqual(cybex.id,atlantis.id);
 const e={id:'old',exerciseId:original.id,name:original.name,muscles:['Chest'],range:[8,12],requiredSets:1,rest:120,sets:[{id:'set',weight:100,reps:12,type:'Working',timestamp:'2026-10-01T12:00:00Z'}],note:'',feeling:'Fine',painNote:''};
 const history=[{...T.makeSession(T.defaults().programme.templates[0],T.defaults().library,'past',[]),date:'2026-10-01',exercises:[e]}];
 assert.equal(T.target({...e,exerciseId:cybex.id,sets:[]},history).beat,null);
 const duplicate={...cybex,id:'duplicate'};assert.equal(equipmentUpdates([{...cybex,gymIds:undefined,id:'one'},duplicate]).some(e=>e.id==='one'||e.id===cybex.id),false);
});

test('Search finds brand, muscles, gym and aliases without inventing machine variants',()=>{
 const list=muscleBoundEquipment();assert.ok(list.some(e=>matchesExercise(e,'Atlantis chest')));assert.ok(list.some(e=>matchesExercise(e,'musclebound Cybex')));assert.ok(list.some(e=>matchesExercise(e,'elliptical')));assert.equal(list.some(e=>e.name==='Prime Leg Press'),false);assert.equal(gym.inventoryComplete,false);
 for(const e of list){assert.ok(e.equipmentSource.url.startsWith('https://'));assert.ok(e.gymIds.includes(gym.id));}
});

test('Timed equipment preserves null weight/reps and gym metadata in backup and CSV',()=>{
 const e=muscleBoundEquipment().find(e=>e.name==='Stationary Bike');assert.equal(e.tracking,'duration');const {programme}=T.defaults();const t={...programme.templates[0],exercises:[{exerciseId:e.id,sets:1,range:e.range,rest:e.rest,priority:1}]};const session=T.makeSession(t,[e],'bonus',[]);session.exercises[0].sets=[{id:T.uid(),weight:null,reps:null,durationSec:900,type:'Working',timestamp:session.startedAt}];const snapshot=T.finishSnapshot(session,[],20);assert.equal(snapshot.volume,0);assert.deepEqual(snapshot.pbs,[]);
 const record={kind:'exercise',id:e.id,data:e};assert.equal(backupValid(record),true);assert.deepEqual(JSON.parse(JSON.stringify(record)).data,e);assert.ok(trainingCSV([record]).includes(gym.id));
});
