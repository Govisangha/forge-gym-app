import {env} from 'cloudflare:workers';
export function recordDB(){if(!env.DB)throw new Error('Training storage is unavailable');return env.DB as D1Database}
