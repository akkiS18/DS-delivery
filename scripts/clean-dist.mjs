// Removes dist/ so a build never ships stale files from an earlier build. Cross-platform (no rm -rf / rimraf dependency).
import { rmSync } from 'node:fs';
rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
