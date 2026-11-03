# PDF Print Template feature

## Decisions
- Full PDF page 1 = full-page background, table overlaid CENTERED on top.
- NO letterhead at all. PDF fully replaces it. No template => plain print.
- All prints: section + teacher, web + mobile. 8.5x11 portrait.
- Single page (page 1 only). Stored as data URI image (rendered from PDF) in settings.printTemplate.

## Steps
1. [ ] schema: add settings.printTemplate (text, nullable) — data URI of page-1 image
2. [ ] drizzle push
3. [ ] API: GET/PUT settings include printTemplate; allow setting/clearing
4. [ ] web hooks/types: AppSettings.printTemplate
5. [ ] web print.ts: remove letterhead(), use printTemplate as bg, center table
6. [ ] web Setup: new "Print Template" tab — upload PDF (pdfjs render page1 -> PNG data URI), preview, remove
7. [ ] mobile print.ts: same bg logic, remove letterhead
8. [ ] mobile Setup: upload PDF via expo-document-picker, render? -> need image. Use server or pdfjs. Simpler: web does rendering; mobile just shows current template + can upload (render via... ?). DECIDE.
9. [ ] remove print-header.ts (both) once unused
10. [ ] build web + tsc mobile
11. [ ] visual verify prints

## Notes
- PDF->image: use pdfjs-dist in web (canvas). Mobile RN has no canvas easily -> let mobile upload the PDF and POST to an API endpoint that renders page1 to PNG (use server-side). OR restrict template upload to WEB only, mobile just consumes settings.printTemplate. Lean: upload on WEB; mobile reads & prints with it. Confirm acceptable.
