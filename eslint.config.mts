import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		plugins: { obsidianmd },
		rules: {
			"obsidianmd/ui/sentence-case": ["error", { enforceCamelCaseLower: true, ignoreWords: ["Codex"] }],
		},
	},
	{
		files: ["src/ui/codex-view.ts"],
		rules: {
			"import/no-nodejs-modules": ["error", { allow: ["child_process", "path"] }],
		},
	},
	{
		files: ["src/run/**/*.ts"],
		rules: {
			"import/no-nodejs-modules": ["error", { allow: ["child_process"] }],
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
