import type {Exercise} from './training';

export const muscleBoundBradford={id:'muscle-bound-bradford',name:'Muscle Bound Bradford',inventoryComplete:false,checkedOn:'2026-10-27',website:'https://muscleboundgymuk.co.uk/bradford/'};
const posts='https://www.findglocal.com/GB/Bradford/108042851826704/Muscle-Bound-Gym';
const facilities='https://muscleboundgymuk.co.uk/facilities-and-equipment/';

// Only equipment identifiable in public gym listings belongs here. A brand's
// presence does not verify its whole range. This is not a complete inventory.
export function muscleBoundEquipment():Exercise[]{
 const strength:[string,string,string,string[],string[],number][]=[
  ['atlantis-shoulder-press','Atlantis Plate Loaded Shoulder Press','Atlantis',['Shoulders'],['Triceps'],120],
  ['atlantis-incline-press','Atlantis Incline Press','Atlantis',['Chest'],['Shoulders','Triceps'],120],
  ['cybex-chest-press','Cybex Pin Loaded Chest Press','Cybex',['Chest'],['Shoulders','Triceps'],120],
  ['hoist-bicep-curl','Hoist ROC-IT Bicep Curl','Hoist',['Biceps'],[],90],
  ['newtech-chest-press','Newtech M-Torture Chest Press','Newtech',['Chest'],['Shoulders','Triceps'],120],
 ];
 const cardio:[string,string,string[]][]=[['treadmill','Treadmill',['Cardio']],['stationary-bike','Stationary Bike',['Cardio']],['cross-trainer','Cross Trainer',['Cardio']],['stair-climber','Stair Climber',['Cardio']],['rowing-machine','Rowing Machine',['Cardio']]];
 const common={notes:'',substitutions:[],gymIds:[muscleBoundBradford.id]};
 return [
  ...strength.map(([id,name,brand,muscles,secondary,rest]):Exercise=>({...structuredClone(common),id:'mb-bradford-'+id,name,brand,muscles,secondary,equipment:name.includes('Plate Loaded')||brand==='Newtech'?'Plate-loaded machine':'Machine',range:[8,12],rest,increment:2.5,tracking:'reps',equipmentSource:{url:posts,checkedOn:muscleBoundBradford.checkedOn,detail:'Named in published Muscle Bound Bradford posts, mirrored by FindGlocal. Availability may change.'},aliases:brand==='Hoist'?['Hoist Roc It Bicep Curl']:[]})),
  ...cardio.map(([id,name,muscles]):Exercise=>({...structuredClone(common),id:'mb-bradford-'+id,name,muscles,secondary:[],equipment:'Cardio machine',range:[1,1],rest:60,increment:2.5,tracking:'duration',equipmentSource:{url:facilities,checkedOn:muscleBoundBradford.checkedOn,detail:'Equipment category listed by Muscle Bound. Manufacturer and model are unspecified.'},aliases:name==='Cross Trainer'?['Elliptical']:name==='Stair Climber'?['Stairmaster']:name==='Stationary Bike'?['Exercise Bike']:[]})),
 ];
}
const normalise=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en-GB').replace(/[^a-z0-9]+/g,' ').trim();

// Preserve existing identities and user settings. Never fold a brand-specific
// machine into a generic exercise or resolve ambiguous duplicate names silently.
export function equipmentUpdates(library:Exercise[]):Exercise[]{
 const updates:Exercise[]=[];
 for(const item of muscleBoundEquipment()){
  const sameId=library.find(e=>e.id===item.id);
  const matches=library.filter(e=>normalise(e.name)===normalise(item.name));
  const existing=sameId??(matches.length===1?matches[0]:undefined);
  if(!existing){if(!matches.length)updates.push(item);continue;}
  if(existing.gymIds?.includes(muscleBoundBradford.id))continue;
  updates.push({...existing,gymIds:[...(existing.gymIds??[]),muscleBoundBradford.id],brand:existing.brand??item.brand,tracking:existing.tracking??item.tracking,equipmentSource:existing.equipmentSource??item.equipmentSource});
 }
 return updates;
}
export function matchesExercise(exercise:Pick<Exercise,'name'>&Partial<Exercise>,query:string){
 const haystack=normalise([exercise.name,exercise.brand,exercise.equipment,...(exercise.muscles??[]),...(exercise.aliases??[]),...(exercise.gymIds?.includes(muscleBoundBradford.id)?[muscleBoundBradford.name,'musclebound']:[])].filter(Boolean).join(' '));
 return normalise(query).split(' ').filter(Boolean).every(word=>haystack.includes(word));
}
