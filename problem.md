The task at hand is to create an obsidian plugin that syncs dictionary definitions into markdown notes.

The plugin should have a minimal settings page that allows the user to specify:

- The 'authoritative' dictionary source file. This must be a note in their vault.
- How often to do a sync (e.g., on vault open, every X minutes, manual button).
	- Also register a command that can be run via the command pallette to trigger a manual sync.

- View status and other information:
	- last sync time and any errors that occurred during the last sync or current sync status.
	- where the dictionary source file is located on the filesystem (full path), if possible. This will not be the authoritative source within Obsidian, but the actual file path where the Electron app/runtime stores the words.
	- How many dictionary words are in the host's dictionary file versus how many words were synced from the authoritative source file.

Before beginning any work, propose a high-level design for the plugin and add the steps needed to implement it in the high-level plan section below and await feedback.
Do not print the outline to the console, add it to the list below.


## Background

A tiny bit of background on why:
	- https://forum.obsidian.md/t/custom-dictionary-txt-sync-tool/51905

A python implementation that has some details about how the dictionary sync should work: https://github.com/kquinsland/obsidian-dictionary-sync-tool

And a revised version of that tool lives here: https://github.com/kquinsland/obsidian-dict-sync

## Additional Information

I have added `pnpm` to $PATH and done most of the setup steps outlined in the README.md already.
The `test-vault` folder is a sym-link to the root of a test vault that should be used for testing the plugin during development.
That vault has a few sample notes in it already. One of the notes contains words that are already on the host's custom dictionary.

You may need human operator to do some steps that require interaction with the Obsidian app itself, such as loading the plugin into the vault for testing.
Stop and ask for help if you need it.

## High-Level plan

0. Create the absolute minimal Obsidian plugin boilerplate code to get started and verify that it loads in Obsidian.
	`test-vault/.obsidian/plugins/obsidian-dictionary-sync/` is where the plugin code should go during development.
1. Demonstrate that there is an API accessible from within Obsidian plugin space that allows accessing the custom dictionary values.
	The acceptance criteria for this would be a simple section in the plugins' settings page that shows how many words are currently in the host dictionary
2. Identify how to locate the host dictionary file on disk (if accessible) and document fallbacks when full path is unavailable.
	The acceptance criteria for this would be showing the full path (if available) in the settings page.
3. Define the authoritative source note format, parse it into a normalized word list, and de-duplicate with the host dictionary.
4. Implement sync modes (on vault open, scheduled interval, manual command) with persisted settings and safe scheduling.
5. Build a minimal settings UI that shows sync status, last error, last sync time, host dictionary counts, and authoritative source counts.
6. Add logging + test-vault validation steps to confirm words flow into the host dictionary and that status updates are accurate.
