import { cpSync } from 'fs';

// tsc only emits JavaScript, so the .sql migrations have to be copied by hand.
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });

console.log('Copied migrations to dist/db/migrations');
