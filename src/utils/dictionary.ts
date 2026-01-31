export function normalizeWord(word: string): string {
	return word.trim().toLowerCase();
}

export function splitFrontmatter(content: string): { frontmatter: string | null; body: string } {
	if (!content.startsWith("---")) {
		return { frontmatter: null, body: content };
	}

	const endIndex = content.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter: null, body: content };
	}

	const frontmatterEnd = endIndex + 4;
	const frontmatter = content.slice(0, frontmatterEnd);
	let body = content.slice(frontmatterEnd);
	if (body.startsWith("\n")) {
		body = body.slice(1);
	}

	return { frontmatter, body };
}

export function extractWordsFromNote(content: string): string[] {
	const { body } = splitFrontmatter(content);
	const lines = body.split(/\r?\n/);
	const words: string[] = [];
	const seen = new Set<string>();
	let inCodeBlock = false;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		if (line.startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			continue;
		}

		if (inCodeBlock || line.startsWith("<!--")) {
			continue;
		}

		const candidate = extractWordCandidate(line);
		if (!candidate) {
			continue;
		}

		const normalized = normalizeWord(candidate);
		if (!normalized || seen.has(normalized)) {
			continue;
		}

		seen.add(normalized);
		words.push(candidate);
	}

	return words;
}

export function extractLineWordsFromNote(content: string): string[] {
	const { body } = splitFrontmatter(content);
	const lines = body.split(/\r?\n/);
	const words: string[] = [];
	let inCodeBlock = false;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		if (line.startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			continue;
		}

		if (inCodeBlock || line.startsWith("<!--")) {
			continue;
		}

		words.push(line);
	}

	return words;
}

export function buildAuthoritativeNoteContent(words: string[], originalContent: string): string {
	const { frontmatter } = splitFrontmatter(originalContent);
	const cleaned = words.map((word) => word.trim()).filter((word) => word.length > 0);
	const body = cleaned.join("\n");
	const suffix = body.length > 0 ? "\n" : "";
	if (!frontmatter) {
		return `${body}${suffix}`;
	}

	return `${frontmatter}\n${body}${suffix}`;
}

function extractWordCandidate(line: string): string | null {
	let cleaned = line
		.replace(/^#+\s+/, "")
		.replace(/^>\s+/, "")
		.replace(/^[-*+]\s+/, "")
		.replace(/^\d+[.)]\s+/, "");

	const separatorIndex = findSeparatorIndex(cleaned);
	if (separatorIndex !== -1) {
		cleaned = cleaned.slice(0, separatorIndex).trim();
	}

	const match = cleaned.match(/^[A-Za-z][A-Za-z'-]*/);
	return match ? match[0] : null;
}

function findSeparatorIndex(line: string): number {
	const separators = [" : ", " - ", ":"];
	for (const separator of separators) {
		const index = line.indexOf(separator);
		if (index !== -1) {
			return index;
		}
	}

	return -1;
}
