// Isolated scripted workspace. Never reads a private Canopia database or uses a real connection.
export {};
process.env.CANOPIA_AI_MODE = 'simulation';
process.env.CANOPIA_ALLOW_AI_CALLS = 'false';
process.env.CANOPIA_ALLOW_EMAIL = 'false';
process.env.CANOPIA_EMAIL_MODE = 'preview';
process.env.CANOPIA_ALLOW_REAL_STAYS = 'false';
process.env.DATABASE_URL = '';
process.env.CANOPIA_DATA_DIR = '.local/demo';
process.env.HOST = '127.0.0.1';
process.env.PORT = '4320';
process.env.CANOPIA_ORIGIN = 'http://127.0.0.1:4320';
await import('../server/index.ts');
