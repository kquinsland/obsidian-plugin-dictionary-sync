import * as path from "path";
import { promises as fs } from "fs";
import * as electron from "electron";

interface DictionaryPathResult {
	path: string | null;
	error: string | null;
}

type ElectronCompat = typeof import("electron") & {
	remote?: {
		app?: {
			getPath?: (name: string) => string;
		};
	};
	app?: {
		getPath?: (name: string) => string;
	};
};

export async function resolveDictionaryPath(userDataPath: string | null): Promise<DictionaryPathResult> {
	const candidates = buildDictionaryPathCandidates(userDataPath);
	for (const candidate of candidates) {
		if (await pathExists(candidate)) {
			return { path: candidate, error: null };
		}
	}

	return {
		path: null,
		error: candidates.length === 0 ? "No candidate dictionary paths available." : "Dictionary file not found.",
	};
}

export function resolveUserDataPath(): string | null {
	try {
		const electronCompat = electron as ElectronCompat;
		if (electronCompat.app?.getPath) {
			return electronCompat.app.getPath("userData");
		}
		if (electronCompat.remote?.app?.getPath) {
			return electronCompat.remote.app.getPath("userData");
		}
	} catch {
		// Ignore Electron lookup failures.
	}

	return null;
}

function buildDictionaryPathCandidates(userDataPath: string | null): string[] {
	const candidates: string[] = [];
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	const configHome = process.env.XDG_CONFIG_HOME ?? (home ? path.join(home, ".config") : "");

	if (userDataPath) {
		candidates.push(path.join(userDataPath, "Custom Dictionary.txt"));
	}

	if (process.platform === "darwin") {
		candidates.push(path.join(home, "Library", "Application Support", "obsidian", "Custom Dictionary.txt"));
		candidates.push(path.join(home, "Library", "Application Support", "Obsidian", "Custom Dictionary.txt"));
	}

	if (process.platform === "win32") {
		const appData = process.env.APPDATA ?? "";
		if (appData) {
			candidates.push(path.join(appData, "obsidian", "Custom Dictionary.txt"));
			candidates.push(path.join(appData, "Obsidian", "Custom Dictionary.txt"));
		}
	}

	if (process.platform === "linux") {
		if (configHome) {
			candidates.push(path.join(configHome, "obsidian", "Custom Dictionary.txt"));
			candidates.push(path.join(configHome, "Obsidian", "Custom Dictionary.txt"));
		}
	}

	return candidates.filter((candidate) => candidate.length > 0);
}

export async function pathExists(candidate: string): Promise<boolean> {
	try {
		await fs.access(candidate);
		return true;
	} catch {
		return false;
	}
}
