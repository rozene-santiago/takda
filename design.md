# ZenSched — Design System

Class scheduling app for schools. Calm, focused, zen workspace vibe (inspired by zen.docendo.co).
Brand = De La Salle University–Dasmariñas (DLSU-D) color system. Use **Primary + Modern** palette.

## Colors
| Token | Hex | Use |
|-------|-----|-----|
| Primary Green | `#007041` | brand, headers, primary buttons, active state |
| Mid Green | `#338D67` | secondary accents, hover |
| Bright Green | `#00AD6D` | success, positive accents |
| Light Sage | `#ADD1C2` | soft backgrounds, subtle fills |
| Forest Deep | `#1E3D32` | deep headers, sidebar |
| Lime | `#BDF261` | highlights/callouts ONLY — never large areas |
| Warm Cream | `#EAE6DA` | page background (warm neutral) |
| Cool Gray | `#E9E9E9` | neutral surfaces, dividers |
| Black | `#1A1A1A` | primary text |
| White | `#FFFFFF` | cards, surfaces |
| Danger | `#C0392B` | conflicts, errors |
| Amber | `#D99A00` | warnings, under/over allocation |

## Typography
- Display/headings: **Archivo** (bold, condensed-ish, strong) — matches the brand's chunky headline style.
- Body/UI: **Inter** fallback... no — use **Plus Jakarta Sans** for body for warmth. Headlines Archivo.
- Hierarchy via size + weight. Generous line height (1.5 body).

## Layout
- App shell: left sidebar nav (Forest Deep), top bar, main content on Warm Cream bg.
- Cards: white, rounded-xl, soft shadow, 1px Cool Gray border.
- Schedule board: days (cols) × periods (rows) grid, draggable blocks.

## Components
- Buttons: primary = Primary Green fill / white text; secondary = white w/ green border; ghost.
- Blocks (schedule cells): subject color tint bg, teacher + room small text, draggable.
- Conflict states: red ring + red dot; allocation warning = amber chip.
- Chips/pills for subjects, grade levels.

## Motion
- Subtle: 150ms ease transitions on hover/drag. Block lift shadow on drag. Staggered fade-in on board load.
- Use simple CSS transitions; no heavy animation libs.

## Drag & Drop
- Native HTML5 DnD. Drag subject from palette → drop into grid cell. Drag existing blocks to move. Visual drop-target highlight (sage tint).

## UX patterns
- Single-user, no auth.
- Section switcher at top of board.
- Auto-fill = suggest mode: generates a preview overlay, user approves/discards.
- Live conflict panel docked right or below board.
