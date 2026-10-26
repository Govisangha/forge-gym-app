// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import {sqliteTable,text,primaryKey,index} from 'drizzle-orm/sqlite-core';
export const records=sqliteTable('training_records',{userId:text('user_id').notNull(),key:text('record_key').notNull(),kind:text('kind').notNull(),payload:text('payload').notNull(),updated:text('updated').notNull()},t=>[primaryKey({columns:[t.userId,t.key]}),index('records_user_kind').on(t.userId,t.kind)]);
