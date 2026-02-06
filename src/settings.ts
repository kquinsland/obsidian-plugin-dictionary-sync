import { App, Notice, PluginSettingTab, Setting, SuggestModal, TFile, normalizePath } from "obsidian";
import DictionarySyncPlugin, { SyncDirection } from "./main";
import { createSettingsGroup } from "./utils/settings-compat";

export type SyncBehavior = "bidirectional" | "authoritative-add-only";

export interface DictSyncSettings {
	authoritativeNotePath: string;
	syncBehavior: SyncBehavior;
	syncOnOpen: boolean;
	syncIntervalMinutes: number;
	lastSyncTime: string | null;
	lastSyncStatus: "idle" | "syncing" | "error";
	lastSyncError: string | null;
	lastSourceWordCount: number;
	lastHostWordCount: number;
	lastAddedWordCount: number;
	// Non-synced, runtime-only fields (do not persist to data.json)
	dictionaryPath: string | null;
	dictionaryPathError: string | null;
	hostDictionaryError: string | null;
}

export const DEFAULT_SETTINGS: DictSyncSettings = {
	authoritativeNotePath: "",
	syncBehavior: "bidirectional",
	syncOnOpen: false,
	syncIntervalMinutes: 0,
	lastSyncTime: null,
	lastSyncStatus: "idle",
	lastSyncError: null,
	lastSourceWordCount: 0,
	lastHostWordCount: 0,
	lastAddedWordCount: 0,
	dictionaryPath: null,
	dictionaryPathError: null,
	hostDictionaryError: null,
};

export class DictSyncSettingTab extends PluginSettingTab {
	plugin: DictionarySyncPlugin;
	private statusArea: HTMLTextAreaElement | null = null;
	private intervalDescEl: HTMLElement | null = null;
	private refreshTimerId: number | null = null;

	constructor(app: App, plugin: DictionarySyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	refresh(): void {
		this.display();
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
		this.clearRefreshTimer();
		this.statusArea = null;
		this.intervalDescEl = null;

		const sourceGroup = createSettingsGroup(containerEl, "Authoritative source", this.plugin.manifest.id);
		sourceGroup.addSetting((setting) => {
			setting
				.setName("Source note")
				.setDesc("Vault note containing the authoritative word list.")
				.addText((text) => {
					text
						.setPlaceholder("path/to/note.md")
						.setValue(this.plugin.settings.authoritativeNotePath)
						.onChange(async (value) => {
							const normalized = normalizePath(value.trim());
							await this.plugin.updateSettings({ authoritativeNotePath: normalized });
						});
				})
				.addButton((button) => {
					button.setButtonText("Browse").onClick(() => {
						new NoteSuggestModal(this.app, (file) => {
							void this.plugin.updateSettings({ authoritativeNotePath: file.path });
						}).open();
					});
				});
		});

		sourceGroup.addSetting((setting) => {
			setting
				.setName("Sync behavior")
				.setDesc("Choose how automatic syncs reconcile words.")
				.addDropdown((dropdown) => {
					dropdown
						.addOption("bidirectional", "Bi-directional merge (default)")
						.addOption("authoritative-add-only", "Authoritative → local (add-only)")
						.setValue(this.plugin.settings.syncBehavior)
						.onChange(async (value) => {
							await this.plugin.updateSyncBehavior(value as SyncBehavior);
						});
				});
		});

		const syncGroup = createSettingsGroup(containerEl, "Sync trigger", this.plugin.manifest.id);
		syncGroup.addSetting((setting) => {
			setting
				.setName("Manual sync")
				.setDesc("Run a sync immediately.")
				.addButton((button) => {
					button.setButtonText("Sync now").onClick(() => {
						void this.plugin.syncNow("manual", this.plugin.getDefaultDirection());
					});
				});
		});

		syncGroup.addSetting((setting) => {
			setting
				.setName("On vault open")
				.setDesc("Run a sync when the vault opens.")
				.addToggle((toggle) => {
					toggle
						.setValue(this.plugin.settings.syncOnOpen)
						.onChange(async (value) => {
							await this.plugin.updateSyncOnOpen(value);
						});
				});
		});

		syncGroup.addSetting((setting) => {
			setting
				.setName("Interval (minutes)")
				.setDesc(this.buildIntervalDesc())
				.addText((text) => {
					text
						.setPlaceholder("0")
						.setValue(String(this.plugin.settings.syncIntervalMinutes))
						.onChange(async (value) => {
							const parsed = Number.parseInt(value, 10);
							await this.plugin.updateSyncInterval(Number.isFinite(parsed) ? parsed : 0);
						});
				});
			this.intervalDescEl = setting.descEl;
		});

		const destructiveGroup = createSettingsGroup(containerEl, "One-way sync (destructive)", this.plugin.manifest.id);
		destructiveGroup.addSetting((setting) => {
			setting
				.setName("Warning")
				.setDesc("These actions overwrite one side and may remove words. Use with care.");
		});

		const addOneWayButton = (setting: Setting, label: string, direction: SyncDirection, desc: string) => {
			setting
				.setName(label)
				.setDesc(desc)
				.addButton((button) => {
					button.setButtonText("Run").onClick(() => {
						void this.plugin.syncNow("manual", direction);
					});
				});
		};

		destructiveGroup.addSetting((setting) => {
			addOneWayButton(
				setting,
				"Sync to local from authoritative",
				"authoritative-to-local",
				"Authoritative note overwrites the host dictionary. Empty authoritative list means local dictionary is cleared."
			);
		});

		destructiveGroup.addSetting((setting) => {
			addOneWayButton(
				setting,
				"Sync to authoritative from local",
				"local-to-authoritative",
				"Host dictionary overwrites the authoritative note. Existing note content is replaced."
			);
		});

		const statusGroup = createSettingsGroup(containerEl, "Status", this.plugin.manifest.id);
		const status = this.plugin.settings;

		statusGroup.addSetting((setting) => {
			setting
				.setName("Status summary")
				.setDesc("Copyable summary of current sync status and build info.");

			const statusArea = setting.controlEl.createEl("textarea", {
				cls: "dictionary-sync-status",
			});
			statusArea.value = this.buildStatusText();
			statusArea.rows = 13;
			statusArea.readOnly = true;
			this.statusArea = statusArea;
		});

		statusGroup.addSetting((setting) => {
			const desc = status.dictionaryPath ?? (status.dictionaryPathError ?? "Unavailable");
			setting
				.setName("Host dictionary file path")
				.setDesc(desc);

			if (status.dictionaryPath) {
				setting.addExtraButton((button) => {
					button
						.setIcon("copy")
						.setTooltip("Copy path to clipboard")
						.onClick(async () => {
							try {
								await navigator.clipboard.writeText(status.dictionaryPath ?? "");
								new Notice("Dictionary path copied.");
							} catch (error) {
								console.error("[dictionary-sync] Failed to copy path", error);
								new Notice("Failed to copy dictionary path.");
							}
						});
				});
			}
		});

		this.startRefreshTimer();
	}

	private buildStatusText(): string {
		const status = this.plugin.settings;
		const env = this.plugin.getEnvironmentInfo();
		const lines = [
			`Plugin version: ${this.plugin.buildInfo.version}`,
			`Git hash: ${this.plugin.buildInfo.gitHash}`,
			`Obsidian version: ${env.obsidianVersion}`,
			`Platform: ${env.platform} (${env.arch})`,
			`OS version: ${env.osVersion}`,
			`Electron: ${env.electronVersion}`,
			`Chrome: ${env.chromeVersion}`,
			`Node: ${env.nodeVersion}`,
			`Current status: ${status.lastSyncStatus}`,
			`Sync behavior: ${status.syncBehavior}`,
			`Sync trigger: on-open ${status.syncOnOpen ? "enabled" : "disabled"}, interval ${status.syncIntervalMinutes} min`,
			`Last sync time: ${status.lastSyncTime ?? "Never"}`,
			`Time until next sync: ${formatNextSync(this.plugin.getNextSyncAt())}`,
			`Last error: ${status.lastSyncError ?? "None"}`,
			`Host dictionary word count: ${status.hostDictionaryError ?? `${status.lastHostWordCount} word(s)`}`,
			`Authoritative word count: ${status.lastSourceWordCount} word(s)`,
			`Last sync added: ${status.lastAddedWordCount} word(s)`,
			`Host dictionary file path: ${status.dictionaryPath ?? (status.dictionaryPathError ?? "Unavailable")}`,
		];
		return lines.join("\n");
	}

	private buildIntervalDesc(): string {
		const base = "Set to 0 to disable scheduled syncs.";
		if (this.plugin.settings.syncIntervalMinutes <= 0) {
			return base;
		}
		return `${base} Next sync in ${formatNextSync(this.plugin.getNextSyncAt())}.`;
	}

	private startRefreshTimer(): void {
		if (this.plugin.settings.syncIntervalMinutes <= 0) {
			return;
		}
		this.refreshTimerId = window.setInterval(() => {
			if (this.statusArea) {
				this.statusArea.value = this.buildStatusText();
			}
			if (this.intervalDescEl) {
				this.intervalDescEl.setText(this.buildIntervalDesc());
			}
		}, 1000);
	}

	private clearRefreshTimer(): void {
		if (this.refreshTimerId !== null) {
			window.clearInterval(this.refreshTimerId);
			this.refreshTimerId = null;
		}
	}
}

function formatNextSync(nextSyncAt: number | null): string {
	if (!nextSyncAt) {
		return "Not scheduled";
	}
	const remainingMs = nextSyncAt - Date.now();
	if (remainingMs <= 0) {
		return "Due now";
	}
	const totalSeconds = Math.ceil(remainingMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) {
		return `${seconds}s`;
	}
	if (minutes < 60) {
		return `${minutes}m ${seconds}s`;
	}
	const hours = Math.floor(minutes / 60);
	const remainderMinutes = minutes % 60;
	return `${hours}h ${remainderMinutes}m`;
}

class NoteSuggestModal extends SuggestModal<TFile> {
	private readonly onSelect: (file: TFile) => void;

	constructor(app: App, onSelect: (file: TFile) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder("Select a note");
	}

	getSuggestions(query: string): TFile[] {
		const lower = query.toLowerCase();
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path.toLowerCase().includes(lower));
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createDiv({ text: file.path });
	}

	onChooseSuggestion(file: TFile): void {
		this.onSelect(file);
	}
}
