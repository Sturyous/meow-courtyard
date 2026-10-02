# Repository instructions

<!-- BEGIN CODEX MAINTAINED -->
## Stack and boundaries
- This is a standalone Vite webpage using strict TypeScript, Canvas 2D, DOM/CSS and Supabase. Keep this architecture; do not add a frontend framework or an application server for routine fixes.
- `src/game.ts` owns movement, scene and rendering; `src/main.ts` connects UI and multiplayer; `src/persistence.ts` owns database calls; `src/realtime.ts` owns presence and broadcasts.
- Persistent inventory transfers must succeed in a database transaction before the UI reports success. Broadcasts are notifications, not the source of truth for inventory.
- Keep generated assets used by the game in `public/assets`; keep asset provenance and specifications in `docs`. Do not ship unused generation drafts.
- Never print backend credentials. Do not commit `.env.local`. QA writes must use an explicitly isolated room.
- Database migrations, publishing, commits and pushes require explicit user authorization. Prepare and test migrations locally first.
## Checks
- Install with `npm install`; start with `npm run dev`; typecheck with `npm exec -- tsc --noEmit`; production build with `npm run build`.
- `npm test` requires Node.js 22.13+ and runs native assertions plus PGlite SQL checks. PGlite is a development dependency and does not verify multi-connection production contention.
- Apply `supabase/schema.sql`, then `supabase/transactions.sql` before publishing a client that uses the transactional RPCs.
- Validate action cancellation, scene changes, inventory conservation and stale repeated claims when those paths change.
- UI acceptance includes two independent browser identities and desktop sizes 1024x768 and 1280x720. A successful build does not replace visual acceptance.
- Preserve the pixel style, consistent character anchors and prop foreground layers. Identity previews must use the game character renderer.
<!-- END CODEX MAINTAINED -->
