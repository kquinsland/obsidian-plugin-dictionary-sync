import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const targetDir = path.join(
	projectRoot,
	"test-vault",
	".obsidian",
	"plugins",
	"obsidian-dictionary-sync"
);

const filesToSync = ["main.js", "manifest.json", "styles.css"];
let debounceTimer = null;

async function ensureTargetDir() {
	await fs.mkdir(targetDir, { recursive: true });
}

async function copyArtifacts() {
	await ensureTargetDir();
	await Promise.all(
		filesToSync.map(async (file) => {
			const source = path.join(projectRoot, file);
			const dest = path.join(targetDir, file);
			try {
				await fs.copyFile(source, dest);
			} catch (error) {
				if (error?.code === "ENOENT") {
					return;
				}
				throw error;
			}
		})
	);
}

function scheduleCopy() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => {
		void copyArtifacts();
	}, 200);
}

function watchArtifacts() {
	for (const file of filesToSync) {
		const target = path.join(projectRoot, file);
		fs.watch(target, { persistent: true }, () => {
			scheduleCopy();
		});
	}
}

function startBuildWatcher() {
	return spawn("pnpm", ["dev"], {
		stdio: "inherit",
		shell: false,
	});
}

async function main() {
	await copyArtifacts();
	watchArtifacts();

	const child = startBuildWatcher();
	const shutdown = () => {
		child.kill("SIGINT");
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

await main();
