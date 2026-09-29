import 'dotenv/config';
import { createApp } from './app.js';
import { ensureBootstrapAdmin } from './auth/authService.js';

const PORT = Number(process.env.PORT ?? '4000');

async function main() {
  await ensureBootstrapAdmin();

  const app = createApp();
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] DutyCal API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] 서버 시작 실패:', err);
  process.exit(1);
});
