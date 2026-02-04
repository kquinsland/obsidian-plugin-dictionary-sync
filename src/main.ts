import { MarkdownView, Notice, Plugin, TFile, normalizePath } from "obsidian";
import { DEFAULT_SETTINGS, DictSyncSettingTab, DictSyncSettings, SyncBehavior } from "./settings";
import { buildAuthoritativeNoteContent, extractLineWordsFromNote } from "./utils/dictionary";
import { resolveDictionaryPath, resolveUserDataPath } from "./utils/dictionary-path";

type SyncTrigger = "manual" | "command" | "vault-open" | "interval";
export type SyncDirection = "bidirectional" | "authoritative-to-local" | "local-to-authoritative" | "authoritative-add-only";

declare const __PLUGIN_VERSION__: string;
declare const __GIT_HASH__: string;

export default class DictionarySyncPlugin extends Plugin {
	settings: DictSyncSettings;
	private syncInProgress = false;
	private syncIntervalId: number | null = null;
	private settingsTab: DictSyncSettingTab | null = null;
	private nextSyncAt: number | null = null;
	readonly buildInfo = {
		version: typeof __PLUGIN_VERSION__ !== "undefined" ? __PLUGIN_VERSION__ : "unknown",
		gitHash: typeof __GIT_HASH__ !== "undefined" ? __GIT_HASH__ : "unknown",
	};
	private cachedEnvInfo: {
		obsidianVersion: string;
		platform: string;
		arch: string;
		osVersion: string;
		electronVersion: string;
		chromeVersion: string;
		nodeVersion: string;
	} | null = null;

	async onload() {
		await this.loadSettings();

		this.settingsTab = new DictSyncSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		this.addCommand({
			id: "dictionary-sync-now",
			name: "Sync dictionary now",
			callback: () => {
				void this.syncNow("command", this.getDefaultDirection());
			},
		});

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnOpen) {
				void this.syncNow("vault-open", this.getDefaultDirection());
			}
			void this.refreshDictionaryStatus();
		});

		await this.refreshDictionaryStatus();
		this.scheduleSync();
	}

	onunload() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
	}

	async loadSettings() {
		const stored = await this.loadData() as Partial<DictSyncSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
	}

	async saveSettings() {
		const persisted = this.stripVolatileSettings(this.settings);
		await this.saveData(persisted);
	}

	async updateSettings(partial: Partial<DictSyncSettings>) {
		this.settings = Object.assign({}, this.settings, partial);
		await this.saveSettings();
		this.settingsTab?.refresh();
	}

	private stripVolatileSettings(settings: DictSyncSettings): DictSyncSettings {
		const {
			dictionaryPath,
			dictionaryPathError,
			hostDictionaryError,
			...rest
		} = settings;
		return {
			...rest,
			dictionaryPath: null,
			dictionaryPathError: null,
			hostDictionaryError: null,
		};
	}

	async updateSyncBehavior(behavior: SyncBehavior) {
		await this.updateSettings({ syncBehavior: behavior });
		this.settingsTab?.refresh();
	}

	async updateSyncOnOpen(enabled: boolean) {
		await this.updateSettings({ syncOnOpen: enabled });
		this.settingsTab?.refresh();
	}

	async updateSyncInterval(minutes: number) {
		await this.updateSettings({ syncIntervalMinutes: minutes });
		this.scheduleSync();
		this.settingsTab?.refresh();
	}

	private scheduleSync() {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}

		if (this.settings.syncIntervalMinutes <= 0) {
			this.nextSyncAt = null;
			return;
		}

		const intervalMinutes = Math.max(1, Math.floor(this.settings.syncIntervalMinutes));
		const intervalMs = intervalMinutes * 60 * 1000;
		this.nextSyncAt = Date.now() + intervalMs;
		this.syncIntervalId = window.setInterval(() => {
			this.nextSyncAt = Date.now() + intervalMs;
			void this.syncNow("interval", this.getDefaultDirection());
		}, intervalMs);
		this.registerInterval(this.syncIntervalId);
	}

	async refreshDictionaryStatus() {
		const dictionaryPath = await resolveDictionaryPath(resolveUserDataPath());
		await this.updateSettings({
			dictionaryPath: dictionaryPath?.path ?? null,
			dictionaryPathError: dictionaryPath?.error ?? null,
		});

		try {
			const sourceFile = this.getSourceFile();
			if (sourceFile) {
				const content = await this.app.vault.read(sourceFile);
				const sourceWords = extractLineWordsFromNote(content);
				await this.updateSettings({ lastSourceWordCount: sourceWords.length });
			} else {
				await this.updateSettings({ lastSourceWordCount: 0 });
			}
		} catch (error) {
			console.error("[dictionary-sync] Failed to read source note", error);
			await this.updateSettings({ lastSourceWordCount: 0 });
		}

		try {
			const hostWords = await this.listHostDictionaryWords();
			await this.updateSettings({
				lastHostWordCount: hostWords.length,
				hostDictionaryError: null,
			});
		} catch (error) {
			await this.updateSettings({
				lastHostWordCount: 0,
				hostDictionaryError: error instanceof Error ? error.message : String(error),
			});
		}
	}

	async syncNow(trigger: SyncTrigger, direction: SyncDirection) {
		if (this.syncInProgress) {
			if (trigger === "manual" || trigger === "command") {
				new Notice("Dictionary sync is already running.");
			}
			return;
		}

		this.syncInProgress = true;
		await this.updateSettings({
			lastSyncStatus: "syncing",
			lastSyncError: null,
		});

		try {
			const { sourceWords, hostWords, addedCount, removedCount, warning } = await this.performSync(direction);
			await this.updateSettings({
				lastSyncTime: new Date().toISOString(),
				lastSyncStatus: "idle",
				lastSyncError: null,
				lastSourceWordCount: sourceWords.length,
				lastHostWordCount: hostWords.length + addedCount,
				lastAddedWordCount: addedCount,
				hostDictionaryError: null,
			});

			if (trigger === "manual" || trigger === "command") {
				const parts = [`Added ${addedCount} word${addedCount === 1 ? "" : "s"}`];
				if (removedCount > 0) {
					parts.push(`removed ${removedCount}`);
				}
				const notice = `Dictionary sync complete (${direction}). ${parts.join(", ")}.`;
				new Notice(notice);
				if (warning) {
					new Notice(warning);
				}
			}

		} catch (error) {
			await this.updateSettings({
				lastSyncTime: new Date().toISOString(),
				lastSyncStatus: "error",
				lastSyncError: error instanceof Error ? error.message : String(error),
			});

			console.error("[dictionary-sync] Sync failed", error);

			if (trigger === "manual" || trigger === "command") {
				new Notice("Dictionary sync failed. Check settings for details.");
			}
		} finally {
			this.syncInProgress = false;
			if (this.settings.syncIntervalMinutes > 0 && this.nextSyncAt === null) {
				const intervalMinutes = Math.max(1, Math.floor(this.settings.syncIntervalMinutes));
				this.nextSyncAt = Date.now() + intervalMinutes * 60 * 1000;
			}
			this.settingsTab?.refresh();
		}
	}

	getNextSyncAt(): number | null {
		return this.settings.syncIntervalMinutes > 0 ? this.nextSyncAt : null;
	}

	getDefaultDirection(): SyncDirection {
		return this.settings.syncBehavior === "authoritative-add-only"
			? "authoritative-add-only"
			: "bidirectional";
	}

	getEnvironmentInfo() {
		if (this.cachedEnvInfo) {
			return this.cachedEnvInfo;
		}

		const obsidianVersion =
			(this.app as unknown as { version?: string; getVersion?: () => string })?.version
			?? (this.app as unknown as { getVersion?: () => string })?.getVersion?.()
			?? "unknown";

		let platform = "unknown";
		let arch = "unknown";
		let osVersion = "unknown";
		try {
			const os = require("os") as typeof import("os");
			platform = os.platform?.() ?? platform;
			arch = os.arch?.() ?? arch;
			osVersion = (os as unknown as { version?: () => string }).version?.()
				?? os.release?.()
				?? osVersion;
		} catch {
			// Ignore OS lookup failures.
		}

		const versions = (typeof process !== "undefined" && process.versions)
			? process.versions
			: ({} as NodeJS.ProcessVersions);

		this.cachedEnvInfo = {
			obsidianVersion,
			platform: platform || "unknown",
			arch: arch || "unknown",
			osVersion: osVersion || "unknown",
			electronVersion: versions.electron ?? "unknown",
			chromeVersion: versions.chrome ?? "unknown",
			nodeVersion: versions.node ?? "unknown",
		};
		return this.cachedEnvInfo;
	}

	private async performSync(direction: SyncDirection) {
		const sourceFile = this.getSourceFile();
		if (!sourceFile) {
			throw new Error("Authoritative source note is not set or could not be found.");
		}

		const content = await this.app.vault.read(sourceFile);
		const sourceWords = extractLineWordsFromNote(content);
		const session = this.getSpellCheckerSession();
		const listFunction = session?.listWordsInSpellCheckerDictionary ?? session?.listWordsFromSpellCheckerDictionary;
		const removeFunction = session?.removeWordFromSpellCheckerDictionary;
		if (!session || typeof listFunction !== "function") {
			throw new Error("Spellchecker API is unavailable in this Obsidian environment.");
		}

		const hostWords = await this.listHostDictionaryWords(session, listFunction);
		const hostSet = new Set(hostWords.map((word) => word.trim()));
		const sourceSet = new Set(sourceWords.map((word) => word.trim()));
		const mergeUnique = (words: string[]) => {
			const map = new Map<string, string>();
			for (const word of words) {
				const trimmed = word.trim();
				if (!trimmed) {
					continue;
				}
				if (!map.has(trimmed)) {
					map.set(trimmed, trimmed);
				}
			}
			return Array.from(map.values());
		};

		let desiredSourceWords = sourceWords;
		let desiredHostWords = hostWords;
		let warning: string | null = null;

		if (direction === "bidirectional") {
			const merged = mergeUnique([...sourceWords, ...hostWords]);
			desiredSourceWords = merged.sort((a, b) => a.localeCompare(b));
			desiredHostWords = desiredSourceWords;
		} else if (direction === "authoritative-to-local") {
			desiredSourceWords = mergeUnique(sourceWords).sort((a, b) => a.localeCompare(b));
			desiredHostWords = desiredSourceWords;
		} else if (direction === "authoritative-add-only") {
			desiredSourceWords = mergeUnique(sourceWords).sort((a, b) => a.localeCompare(b));
			desiredHostWords = desiredSourceWords;
		} else {
			desiredSourceWords = mergeUnique(hostWords).sort((a, b) => a.localeCompare(b));
			desiredHostWords = hostWords;
		}

		const wordsToAdd = desiredHostWords.filter((word) => !hostSet.has(word.trim()));

		let addedCount = 0;
		for (const word of wordsToAdd) {
			try {
				const added = session.addWordToSpellCheckerDictionary(word);
				if (added) {
					addedCount += 1;
				}
			} catch (error) {
				console.error("[dictionary-sync] Failed to add word", word, error);
			}
		}

		let removedCount = 0;
		if (direction === "authoritative-to-local") {
			const extras = hostWords.filter((word) => !sourceSet.has(word.trim()));
			if (extras.length > 0) {
				if (typeof removeFunction === "function") {
					for (const word of extras) {
						try {
							const removed = removeFunction.call(session, word);
							if (removed) {
								removedCount += 1;
							}
						} catch (error) {
							console.error("[dictionary-sync] Failed to remove word", word, error);
						}
					}
				} else {
					warning = "Host dictionary removal API unavailable; extra words were not removed.";
				}
			}
		}

		if (direction === "bidirectional" || direction === "local-to-authoritative") {
			const updatedContent = buildAuthoritativeNoteContent(desiredSourceWords, content);
			if (updatedContent !== content) {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView?.file?.path === sourceFile.path) {
					activeView.editor.setValue(updatedContent);
				} else {
					await this.app.vault.process(sourceFile, () => updatedContent);
				}
			}
		}

		return {
			sourceWords: desiredSourceWords,
			hostWords,
			addedCount,
			removedCount,
			warning,
		};
	}

	private getSourceFile(): TFile | null {
		const path = normalizePath(this.settings.authoritativeNotePath.trim());
		if (!path) {
			return null;
		}

		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	private getSpellCheckerSession() {
		try {
			const electron = require("electron") as unknown as Record<string, any>;
			if (electron?.session?.defaultSession) {
				return electron.session.defaultSession;
			}
			if (electron?.remote?.session?.defaultSession) {
				return electron.remote.session.defaultSession;
			}
			if (electron?.remote?.getCurrentWebContents) {
				return electron.remote.getCurrentWebContents().session;
			}
		} catch {
			// Ignore Electron lookup failures.
		}

		return null;
	}

	private async listHostDictionaryWords(
		session = this.getSpellCheckerSession(),
		listFunction: ((...args: unknown[]) => Promise<string[]>) | undefined = session?.listWordsInSpellCheckerDictionary ?? session?.listWordsFromSpellCheckerDictionary
	) {
		if (!session || typeof listFunction !== "function") {
			throw new Error("Spellchecker word list API is unavailable.");
		}

		const words = await listFunction.call(session);
		return Array.isArray(words) ? words : [];
	}
}
