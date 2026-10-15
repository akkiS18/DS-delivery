# Development rules
- Work in small, reviewable stages; preserve existing behavior outside the task.
- Do not install dependencies, run full builds, full test suites, emulators, or provision environments unless the user asks.
- Review changed code and relevant callers. Write targeted tests for critical logic; provide local commands and say which checks were not run.
- Never commit .env, credentials, tokens, database dumps, node_modules, or build output.
- Keep real payments disabled by default. Never claim delivery from taxi dispatch alone.
- Keep docs/ROADMAP.html as product guidance; report gaps rather than silently claiming a whole day is complete.
