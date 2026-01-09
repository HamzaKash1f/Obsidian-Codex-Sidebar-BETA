import { App, PluginSettingTab, Setting } from "obsidian";
import CodexSidebarPlugin from "./main";

export interface CodexSettings {
  codexExecutablePath: string;
  mockRun: boolean;
  skipGitRepoCheck: boolean;
  attachVaultRoot: boolean;
  attachCurrentNoteFolder: boolean;
  extraAddDirs: string; // newline or comma separated absolute paths
  contextMaxTokens: number; // for UI display only
}

export const DEFAULT_SETTINGS: CodexSettings = {
  codexExecutablePath: "codex",
  mockRun: true,
  skipGitRepoCheck: false,
  attachVaultRoot: true,
  attachCurrentNoteFolder: true,
  extraAddDirs: "",
  contextMaxTokens: 8000,
};


export class CodexSettingTab extends PluginSettingTab {
	plugin: CodexSidebarPlugin;

	constructor(app: App, plugin: CodexSidebarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl).setName("Sidebar").setHeading();

		new Setting(containerEl)
			.setName("Codex executable path")
			.setDesc("Codex CLI binary name or full path.")
			.addText((text) =>
				text
					.setPlaceholder("Codex")
					.setValue(this.plugin.settings.codexExecutablePath)
					.onChange(async (value) => {
						this.plugin.settings.codexExecutablePath = value || "codex";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Mock run (no Codex CLI required)")
			.setDesc("Simulates Codex output without spawning any process.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.mockRun)
					.onChange(async (value) => {
						this.plugin.settings.mockRun = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Skip Git repo check")
			.setDesc("Runs Codex without checking for a Git repo.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.skipGitRepoCheck)
					.onChange(async (value) => {
						this.plugin.settings.skipGitRepoCheck = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Attach vault root")
			.setDesc("Adds the vault root via --add-dir so Codex can read your vault.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.attachVaultRoot)
					.onChange(async (value) => {
						this.plugin.settings.attachVaultRoot = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Attach current note folder")
			.setDesc("Codex adds the current note folder via --add-dir when available.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.attachCurrentNoteFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachCurrentNoteFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Extra folders (one per line)")
			.setDesc("Absolute paths added with --add-dir.")
			.addTextArea((text) =>
				text
					// eslint-disable-next-line obsidianmd/ui/sentence-case
					.setPlaceholder("C:\\path\\to\\knowledge-base\nD:\\docs")
					.setValue(this.plugin.settings.extraAddDirs)
					.onChange(async (value) => {
						this.plugin.settings.extraAddDirs = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Context budget (tokens)")
			.setDesc("Used for the UI context indicator; it does not change limits.")
			.addText((text) =>
				text
					.setPlaceholder("8000")
					.setValue(String(this.plugin.settings.contextMaxTokens ?? 8000))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						this.plugin.settings.contextMaxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : 8000;
						await this.plugin.saveSettings();
					})
			);
	}
}
 
