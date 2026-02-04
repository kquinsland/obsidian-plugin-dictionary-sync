# Audit findings

# Plugin guidelines (concise summary)

- Use `this.app` instead of the global `app`.
- Keep console output clean (errors only by default).
- Organize multi-file code and rename sample placeholders.
- Avoid Node/Electron APIs on mobile; avoid RegExp lookbehind without fallback.
- UI text: Sentence case; no “settings” in headings; no top-level heading; use `Setting.setHeading()`.
- Security: avoid `innerHTML`/`outerHTML`/`insertAdjacentHTML` with user input; use DOM helpers.
- Clean up resources on unload; avoid detaching leaves on unload.
- Commands: don’t set default hotkeys; use correct callback types.
- Workspace: avoid `activeLeaf`; use `getActiveViewOfType()`/`activeEditor`; don’t retain custom view references.
- Vault: use Editor API for active notes, `Vault.process` for background edits, `FileManager.processFrontMatter` for properties; prefer Vault API over Adapter API; avoid full-file scans; use `normalizePath()`.
- Editor extensions: update via `updateOptions()` and mutate the registered extension array.
- Styling: avoid hardcoded styles; use CSS classes and Obsidian variables.
- TypeScript: prefer `const`/`let` and `async/await`.


## High

- Mobile compatibility: Node/Electron APIs used directly can crash on mobile. Guard with `Platform.isMobile` and/or lazy-load; avoid executing Node/Electron code on mobile.
  - `src/utils/dictionary-path.ts:1`
  - `src/utils/dictionary-path.ts:23`
  - `src/utils/dictionary-path.ts:39`
  - `src/main.ts:257`
  - `src/main.ts:399`
  - `src/main.ts:271`

## Medium

- Background note edits use `Vault.modify` instead of `Vault.process`, and active note edits should prefer the Editor API to preserve cursor/selection. `src/main.ts:373`
- User-defined note path is not normalized. Use `normalizePath()` when storing/using `authoritativeNotePath`. `src/main.ts:389`
- Settings headings use raw HTML headings and a top-level plugin heading. Prefer `Setting.setHeading()` and avoid a top-level heading if there’s only one section. `src/settings.ts:63`, `src/utils/settings-compat.ts:61`

## Low

- UI text uses Title Case for section headings; use Sentence case. `src/settings.ts:65`, `src/settings.ts:102`, `src/settings.ts:148`
- Console logging includes info/debug/warn; guidelines recommend default console output be errors only. `src/main.ts:149`, `src/main.ts:175`, `src/main.ts:206`, `src/main.ts:268`, `src/main.ts:348`, `src/main.ts:364`, `src/main.ts:412`, `src/utils/dictionary-path.ts:33`
