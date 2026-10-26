import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../lib/training.ts';
test('Beat This recommends an actual rep improvement when only the first set is at the upper range',()=>{
  const {programme,library}=T.defaults();
  const previous=T.makeSession(programme.templates[2],library,'normal',[]);
  previous.date='2026-09-07';
  const exercise=previous.exercises.find(e=>e.exerciseId==='preacher');
  exercise.sets=[12,10,9].map(reps=>({id:T.uid(),weight:30,reps,type:'Working',timestamp:previous.startedAt}));
  const next=structuredClone(exercise);next.sets=[];
  assert.deepEqual({...T.target(next,[previous],2.5),beat:null},{weight:30,reps:13,increase:false,beat:null});
  exercise.sets[0].reps=13;
  assert.equal(T.target(next,[previous],2.5).reps,14);
  exercise.sets.forEach(set=>set.reps=12);
  assert.deepEqual({...T.target(next,[previous],2.5),beat:null},{weight:32.5,reps:8,increase:true,beat:null});
});
