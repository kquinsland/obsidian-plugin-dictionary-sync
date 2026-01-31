# Dictionary Sync - Maintenance Notes

- Spellchecker API uses Electron session (`session.defaultSession`). Prefer `listWordsInSpellCheckerDictionary`, fallback to `listWordsFromSpellCheckerDictionary`. Sync should surface a clear error if unavailable.
- Host dictionary file path is best-effort only. It typically resolves under Obsidian userData as `Custom Dictionary.txt` but may be unavailable on OS-managed dictionaries.
- Settings UI uses the SettingGroup compatibility helper for API 1.11.0+. Keep unless you bump `minAppVersion` and adjust CSS.
- Sync flow is guarded against overlap; new triggers are skipped while a sync is running.
- Authoritative note parsing is line-based (frontmatter stripped, code blocks ignored). Only the leading token is treated as a word; expand in `src/utils/dictionary.ts` if richer formats are needed.
- Auto deploy watcher: `pnpm dev:deploy` runs `pnpm dev` and copies `main.js`, `manifest.json`, `styles.css` into `test-vault/.obsidian/plugins/obsidian-dictionary-sync/`.
