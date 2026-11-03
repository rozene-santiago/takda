# New features — web + mobile

## Decisions (from user)
1. Save Points = FULL config snapshot (grades/sections/subjects/rooms/teachers/timeslots/blocked/allocations/entries/settings-partial). Load = replace-with-confirm (rollback). Lives BOTH on Schedule (button) + Setup (manager tab).
2. Undo/Redo = multi-step, session-scoped. Ctrl+Z / Ctrl+Shift+Z (+Ctrl+Y). Button on Schedule. Tracks entry ops (create/update/delete/bulk/clear). Applies to drag-drop + conflicts adjustments.
3. Teacher Schedule: show blocked times in grid; drag-and-drop entries; "Transfer to teacher" = reassign ONE class to another teacher.
4. Both web + mobile.

## Backend (packages/web/src/api)
- [ ] schema: new table `save_points` (id, name, createdAt, payload JSON text).
- [ ] GET /save-points (list, no payload — id/name/createdAt/counts)
- [ ] POST /save-points (create snapshot: name -> serialize all tables)
- [ ] GET /save-points/:id (full payload)
- [ ] POST /save-points/:id/restore (wipe + reinsert everything)
- [ ] DELETE /save-points/:id
- [ ] drizzle push

## Web frontend
- [ ] hooks: useSavePoints, useCreateSavePoint, useRestoreSavePoint, useDeleteSavePoint
- [ ] undo stack: lib/history.ts (context provider) — records inverse ops; keyboard listener
- [ ] Schedule (index.tsx): Save point button (quick save + list), Undo/Redo buttons, wire mutations through history
- [ ] Setup: "Save Points" manager tab (create/list/restore/delete)
- [ ] Teacher Schedule: render blocked cells; drag-drop move/swap; "Transfer to teacher" in cell editor
- [ ] Lock guard: disable new mutating actions when locked

## Mobile frontend
- [ ] hooks mirror
- [ ] Schedule: Save point + Undo/Redo (buttons; no ctrl+z on mobile — use buttons)
- [ ] Setup: Save Points pane
- [ ] Teacher Schedule: blocked cells + move/swap + transfer to teacher

## Verify
- [ ] web `bun run build` EXIT 0
- [ ] mobile `bunx tsc --noEmit` EXIT 0
- [ ] visual check both

## PROGRESS (resumed)
- [x] Backend all routes + schema + db push
- [x] Web history.tsx + provider + app.tsx
- [x] Web Schedule: undo/redo/save-point buttons + rec() wiring + save modal
- [x] Web Setup: Save Points manager tab
- [x] Web Teacher Schedule: blocked cells + drag/swap + Transfer to teacher
- [x] WEB BUILD EXIT 0
- [x] Mobile hooks (save points) + history store
- [x] Mobile Schedule: undo/redo/save-point buttons
- [x] Mobile Setup: Save Points pane
- [x] Mobile Teacher Schedule: blocked + move/swap + transfer
- [x] mobile tsc EXIT 0
- [x] visual verify both
