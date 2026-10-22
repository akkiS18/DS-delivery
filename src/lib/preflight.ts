// Imported FIRST by src/server.ts: ES modules evaluate in import order, so an unsafe configuration stops the process
// before env parsing, Prisma or Telegram are touched. Prints variable names only, never values.
import { checkConfig } from './config-check.js';

const report = checkConfig(process.env);
for (const w of report.warnings) console.warn(`[config] warning: ${w}`);
if (report.errors.length > 0) {
  for (const e of report.errors) console.error(`[config] ERROR: ${e}`);
  console.error(`[config] ${report.errors.length} configuration error(s); refusing to start.`);
  process.exit(1);
}
