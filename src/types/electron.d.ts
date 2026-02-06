declare module "electron" {
	type SpellCheckerSession = {
		listWordsInSpellCheckerDictionary?: (...args: unknown[]) => Promise<string[]>;
		listWordsFromSpellCheckerDictionary?: (...args: unknown[]) => Promise<string[]>;
		addWordToSpellCheckerDictionary?: (word: string) => boolean;
		removeWordFromSpellCheckerDictionary?: (word: string) => boolean;
	};

	export const session:
		| {
				defaultSession?: SpellCheckerSession;
		  }
		| undefined;

	export const app:
		| {
				getPath?: (name: string) => string;
		  }
		| undefined;

	export const remote:
		| {
				session?: {
					defaultSession?: SpellCheckerSession;
				};
				getCurrentWebContents?: () => { session: SpellCheckerSession };
				app?: {
					getPath?: (name: string) => string;
				};
		  }
		| undefined;
}
