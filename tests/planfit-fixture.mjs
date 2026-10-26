export const headers = {
  workout_sessions: ['workout_id','date','routine_name','workout_name','started_at_utc','done_at_utc','duration_min','elapsed_min','calories_kcal','is_home','memo'],
  workout_exercises: ['workout_id','date','exercise_entry_id','exercise_name','record_type','memo'],
  workout_sets: ['workout_id','date','exercise_entry_id','exercise_name','set_no','set_type','weight_kg','reps','duration_sec','completed'],
  exercise_daily_records: ['date','exercise_name','completed_sets','max_weight_kg','max_reps','volume_kg','est_1rm_kg'],
  daily_steps: ['date','steps','target_steps'],
  profile: ['gender','purpose','exercise_experience','strength_level','workouts_per_week','workout_time','is_home','equipment_type','date_of_birth','weight_unit'],
};
export function fixtureTables() {
  const sessions = [
    ['legs-a','2025-11-08','Routine A','Gym Workout Routine','2025-11-08 07:00:00','2025-11-08 08:00:00',50,60,350,false,'A memo, with a comma\nand a new line'],
    ['legs-copy','2025-11-08','Routine A','','2025-11-08 07:00:00','2025-11-08 08:00:00',50,60,350,false,'Duplicate export row'],
    ['back-a','2026-09-07','Routine C','My Upper Back','2026-09-07T18:00:00Z','2026-09-07T18:45:00Z',40,45,200,false,'Keep this actual name'],
    ['walk-a','2026-09-08','Walking','','2026-09-08T09:00:00Z','2026-09-08T09:25:00Z',25,25,100,false,'Morning walk'],
    ['walk-copy','2026-09-08','Walking','Workout','2026-09-08T09:00:00Z','2026-09-08T09:25:00Z',25,25,100,false,'Same walk, duplicate export'],
    ['walk-later','2026-09-08','Walking','','2026-09-08T17:00:00Z','2026-09-08T17:50:00Z',50,50,170,false,'Another valid walk'],
    ['bodyweight','2026-10-20','Bodyweight','','','','','',0,false,'No invented weight'],
  ];
  const exercises = [
    ['legs-a','2025-11-08','entry-1','Leg Press','weight_reps','Feet high'],
    ['legs-a','2025-11-08','entry-2','Leg Curl','weight_reps','Controlled eccentric'],
    ['legs-copy','2025-11-08','entry-1','Leg press','weight_reps',''],
    ['legs-copy','2025-11-08','entry-2','Leg curl','weight_reps',''],
    ['back-a','2026-09-07','preacher','Preacher Curl','weight_reps','Elbows stable'],
    ['back-a','2026-09-07','row','Barbell Row','weight_reps','Heavy row'],
    ['walk-a','2026-09-08','walk','Walking','duration','Outside'],
    ['walk-copy','2026-09-08','walk','Walking','duration',''],
    ['walk-later','2026-09-08','walk','Walking','duration',''],
    ['bodyweight','2026-10-20','pullup','Pull Up','reps','Bodyweight only'],
  ];
  const sets = [
    ['legs-a','2025-11-08','entry-2','Leg Curl',1,'normal',30,12,'',true],
    ['legs-a','2025-11-08','entry-1','Leg Press',2,'normal',100,10,'',true],
    ['legs-a','2025-11-08','entry-1','Leg Press',1,'warmup',50,12,'',true],
    ['legs-a','2025-11-08','entry-1','Leg Press',3,'normal',100,9,'',false],
    ['legs-copy','2025-11-08','entry-1','Leg press',1,'warmup',50,12,'',1],
    ['legs-copy','2025-11-08','entry-1','Leg press',2,'normal',100,10,'',1],
    ['legs-copy','2025-11-08','entry-2','Leg curl',1,'normal',30,12,'',1],
    ['back-a','2026-09-07','row','Barbell Row',1,'normal',80,8,'',true],
    ['back-a','2026-09-07','preacher','Preacher Curl',2,'drop_set',25,13,'',true],
    ['back-a','2026-09-07','preacher','Preacher Curl',1,'normal',30,12,'',true],
    ['walk-a','2026-09-08','walk','Walking',1,'normal','','',1500,true],
    ['walk-copy','2026-09-08','walk','Walking',1,'normal','','',1500,true],
    ['walk-later','2026-09-08','walk','Walking',1,'normal','','',3000,true],
    ['bodyweight','2026-10-20','pullup','Pull Up',1,'failure','',8,'',true],
  ];
  return {
    workout_sessions: sessions, workout_exercises: exercises, workout_sets: sets,
    exercise_daily_records: [['2026-09-07','Preacher Curl',2,30,13,685,42]],
    daily_steps: [['2026-09-08',8500,10000]],
    profile: [['male','definition','experienced','intermediate',3,60,false,'gym','1990-01-01','lb']],
  };
}
export function csv(kind, rows) { return '\uFEFF' + [headers[kind],...rows].map(row=>row.map(cell=>'"'+String(cell??'').replaceAll('"','""')+'"').join(',')).join('\r\n'); }
