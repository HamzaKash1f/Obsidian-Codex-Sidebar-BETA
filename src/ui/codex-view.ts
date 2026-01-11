import { App, ItemView, MarkdownRenderer, MarkdownView, Notice, SuggestModal, TFile, WorkspaceLeaf } from "obsidian";
import * as path from "path";
import type { ChildProcessWithoutNullStreams } from "child_process";
import type { Plugin } from "obsidian";
import type { CodexSettings } from "../settings";
import { runCodex } from "../run/codex-runner";
import type { RunStatus, MessageRole } from "../types";
import { estimateTokens } from "../utils/token";
import { pdfToText } from "../pdf/pdf-text";
import { createCodexLayout, type CodexLayout } from "./layout";
import { MessageStore } from "./message-store";

export const CODEX_VIEW_TYPE = "codex-view";

type CodexPlugin = Plugin & { settings: CodexSettings };

export class CodexView extends ItemView {
	private plugin: CodexPlugin;
	private layout!: CodexLayout;

	private status: RunStatus = "Idle";
	private cwdAbs: string;
	private basePathAbs: string | null;
	private currentChild: ChildProcessWithoutNullStreams | null = null;

	private readonly store = new MessageStore();
	private readonly messageContentEls = new Map<string, HTMLElement>();
	private readonly historyTokenCap = 12000;
	private readonly onRunRequested = () => void this.handleRun();

	constructor(leaf: WorkspaceLeaf, plugin: CodexPlugin) {
		super(leaf);
		this.plugin = plugin;

		this.basePathAbs = this.getVaultBasePathAbs(plugin.app);
		this.cwdAbs = this.basePathAbs ?? "";
	}

	getViewType(): string {
		return CODEX_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Codex";
	}

	getIcon(): string {
		return "codex-logo";
	}

	async onOpen() {
		this.layout = createCodexLayout(this.contentEl, "codex-logo");

		this.setStatus("Idle");
		this.setInlineMessage("");
		this.setCwdToVaultRoot();
		this.updateContextUsage();
		this.updateHistoryUsage();
		this.setTyping(false);

		this.layout.runBtnEl.addEventListener("click", this.onRunRequested);
		this.layout.newChatBtnEl.addEventListener("click", () => this.startNewChat());
		this.layout.importPdfBtnEl.addEventListener("click", () => void this.importPdfFromVault());
		this.layout.promptEl.addEventListener("keydown", (evt) => this.onPromptKeyDown(evt));
		this.layout.promptEl.addEventListener("input", () => this.updateContextUsage());
	}

	async onClose() {
		// No-op for now.
	}

	// -------------------------
	// UI state helpers
	// -------------------------
	private setStatus(status: RunStatus) {
		this.status = status;
		this.layout.statusEl.setText(`Status: ${status}`);
		this.layout.runBtnEl.disabled = status === "Running";
	}

	private setInlineMessage(msg: string) {
		this.layout.inlineMsgEl.setText(msg);
		this.layout.inlineMsgEl.toggleClass("is-hidden", !msg.length);
	}

	private setTyping(isTyping: boolean) {
		this.layout.typingEl.toggleClass("is-hidden", !isTyping);
	}

	private updateContextUsage() {
		const budget = this.plugin.settings.contextMaxTokens || 8000;
		const approxTokens = estimateTokens(this.layout.promptEl.value ?? "");
		const pct = Math.min(100, Math.round((approxTokens / budget) * 100));
		this.layout.contextBarFillEl.style.width = `${pct}%`;
		this.layout.contextBarTextEl.setText(
			`Context (approx): ~${approxTokens} tokens / ${budget} (${pct}%)`
		);
	}

	private updateHistoryUsage() {
		const context = this.store.buildConversationContext();
		const approxTokens = estimateTokens(context);
		const pct = Math.min(100, Math.round((approxTokens / this.historyTokenCap) * 100));
		this.layout.historyBarFillEl.style.width = `${pct}%`;
		this.layout.historyBarTextEl.setText(
			`History (approx): ~${approxTokens} tokens / ${this.historyTokenCap} (${pct}%)`
		);
	}

	private setCwdDisplayFromAbs(cwdAbs: string) {
		if (this.basePathAbs) {
			const rel = path.relative(this.basePathAbs, cwdAbs);
			const pretty = rel && rel !== "" ? rel : "(vault root)";
			this.layout.cwdEl.setText(`cwd: ${pretty}`);
		} else {
			this.layout.cwdEl.setText(`cwd: ${cwdAbs || "(unknown vault root)"}`);
		}
	}

	private setCwdToVaultRoot() {
		if (this.basePathAbs) {
			this.cwdAbs = this.basePathAbs;
			this.setCwdDisplayFromAbs(this.cwdAbs);
		} else {
			this.cwdAbs = "";
			this.setCwdDisplayFromAbs(this.cwdAbs);
		}
	}

	// -------------------------
	// Message helpers
	// -------------------------
	private addMessage(role: MessageRole, content: string): string {
		const message = this.store.addMessage(role, content);

		const row = document.createElement("div");
		row.classList.add("codex-message", `codex-${role}`);
		row.setAttribute("data-role", role);

		const bubble = row.createDiv({ cls: "codex-bubble" });
		let contentEl: HTMLElement;

		if (role === "debug") {
			const details = bubble.createEl("details", { cls: "codex-debug-details" });
			const summary = details.createEl("summary", { cls: "codex-debug-summary" });
			summary.setText("Thinking");
			const pre = details.createEl("pre", { cls: "codex-message-content codex-debug-content" });
			contentEl = pre;
		} else {
			contentEl = bubble.createDiv({ cls: "codex-message-content" });
		}

		if (role === "assistant" || role === "debug") {
			contentEl.setAttribute("aria-live", "polite");
		}

		this.messageContentEls.set(message.id, contentEl);

		if (role === "debug") {
			contentEl.setText(content);
		} else {
			void this.renderMarkdownInto(contentEl, content);
		}

		this.layout.messageListEl.insertBefore(row, this.layout.typingEl);
		this.scrollToBottom();
		this.updateHistoryUsage();
		return message.id;
	}

	private updateMessageContent(messageId: string, content: string) {
		this.store.updateContent(messageId, content);
		const message = this.store.get(messageId);

		const contentEl = this.messageContentEls.get(messageId);
		if (!contentEl || !message) return;

		contentEl.empty();
		if (message.role === "debug") {
			contentEl.setText(content);
		} else {
			void this.renderMarkdownInto(contentEl, content);
		}
		this.scrollToBottom();
		this.updateHistoryUsage();
	}

	private appendMessageContent(messageId: string, chunk: string) {
		this.store.appendContent(messageId, chunk);
		const message = this.store.get(messageId);
		if (!message) return;
		this.updateMessageContent(messageId, message.content);
	}

	private async renderMarkdownInto(container: HTMLElement, markdown: string) {
		const sourcePath = this.plugin.app.workspace.getActiveFile()?.path ?? "";
		await MarkdownRenderer.render(this.app, markdown, container, sourcePath, this);
		this.addCopyButtons(container);
	}

	private addCopyButtons(container: HTMLElement) {
		const blocks = container.querySelectorAll<HTMLPreElement>("pre");
		blocks.forEach((pre) => {
			if (pre.querySelector(".codex-code-copy")) return;
			const button = document.createElement("button");
			button.className = "codex-code-copy";
			button.type = "button";
			button.setAttribute("aria-label", "Copy code");
			button.setAttribute("title", "Copy");
			button.innerText = "Copy";
			button.addEventListener("click", () => {
				void this.handleCopyClick(pre, button);
			});
			pre.appendChild(button);
		});
	}

	private async handleCopyClick(pre: HTMLPreElement, button: HTMLButtonElement) {
		const code = pre.querySelector("code")?.textContent ?? "";
		await navigator.clipboard.writeText(code);
		button.setText("Copied");
		window.setTimeout(() => button.setText("Copy"), 1500);
	}

	private scrollToBottom() {
		window.requestAnimationFrame(() => {
			this.layout.messageListEl.scrollTop = this.layout.messageListEl.scrollHeight;
		});
	}

	private startNewChat() {
		this.store.startNewChat();
		this.addMessage("system", "New chat");
		this.updateHistoryUsage();
	}

	async importPdfFromVault() {
		const pdfs = this.app.vault
			.getFiles()
			.filter((file) => file.extension?.toLowerCase() === "pdf");

		if (!pdfs.length) {
			new Notice("No PDF files found in this vault");
			return;
		}

		const file = await this.pickPdf(pdfs);
		if (!file) return;

		this.setInlineMessage("Reading PDF.");
		try {
			const bytes = await this.app.vault.adapter.readBinary(file.path);
			const text = await pdfToText(bytes);
			const message = `PDF: ${file.path}\n\n${text}`;
			this.addMessage("system", message);
			this.updateHistoryUsage();
			this.scrollToBottom();
		} catch (err) {
			new Notice("Failed to read PDF (see console)");
			console.error(err);
		} finally {
			this.setInlineMessage("");
		}
	}

	private pickPdf(files: TFile[]): Promise<TFile | null> {
		return new Promise((resolve) => {
			const modal = new (class extends SuggestModal<TFile> {
				getSuggestions(query: string): TFile[] {
					const q = query.toLowerCase();
					return files.filter((f) => f.path.toLowerCase().includes(q));
				}
				renderSuggestion(file: TFile, el: HTMLElement) {
					el.createEl("div", { text: file.name });
					el.createEl("small", { text: file.path });
				}
				onChooseSuggestion(file: TFile) {
					resolve(file);
				}
				onClose() {
					resolve(null);
				}
			})(this.app);

			modal.setPlaceholder("Search PDF files in the vault");
			modal.open();
		});
	}

	private buildConversationContext(): string {
		return this.store.buildConversationContext();
	}

	// -------------------------
	// Tab/Enter behavior
	// -------------------------
	private onPromptKeyDown(evt: KeyboardEvent) {
		if (evt.key === "Enter" && !evt.shiftKey) {
			evt.preventDefault();
			this.onRunRequested();
			return;
		}

		if (evt.key !== "Tab") return;
		if (this.layout.promptEl.value.trim().length > 0) return;

		evt.preventDefault();

		const mdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const file = mdView?.file;

		if (!file) {
			this.setInlineMessage("Please open a note.");
			return;
		}

		const folderRel = file.parent?.path ?? "";
		this.setInlineMessage("");

		if (!this.basePathAbs) {
			this.cwdAbs = folderRel;
			this.setCwdDisplayFromAbs(this.cwdAbs);
			return;
		}

		this.cwdAbs = folderRel ? path.join(this.basePathAbs, folderRel) : this.basePathAbs;
		this.setCwdDisplayFromAbs(this.cwdAbs);
	}

	// -------------------------
	// Run behavior
	// -------------------------
	private buildDebugText(options: {
		exe: string;
		args: string[];
		cwd: string | undefined;
		addDirs?: string[];
		exitCode: string | number;
		stderr?: string;
		error?: string;
		note?: string;
	}) {
		const lines = [
			`executable: ${options.exe}`,
			`args: ${JSON.stringify(options.args)}`,
			`cwd: ${options.cwd ?? "(undefined)"}`,
		];
		if (options.addDirs) {
			lines.push(`addDirs: ${JSON.stringify(options.addDirs)}`);
		}
		lines.push(`exitCode: ${options.exitCode}`);
		lines.push(`stderr:\n${options.stderr ?? "(empty)"}`);
		lines.push(`error: ${options.error ?? "(none)"}`);
		if (options.note) {
			lines.push(`note: ${options.note}`);
		}
		return lines.join("\n");
	}

	private async handleRun() {
		if (this.status === "Running") return;

		this.setInlineMessage("");

		const exe = (this.plugin.settings.codexExecutablePath || "codex").trim();
		const promptRaw = this.layout.promptEl.value ?? "";
		const prompt = promptRaw.trim();

		if (!prompt.length) {
			this.setInlineMessage("Please enter a prompt.");
			return;
		}

		const contextPrefix = this.buildConversationContext();
		const promptWithContext = contextPrefix
			? `${contextPrefix}\n\nUSER: ${prompt}\nASSISTANT:`
			: prompt;

		this.addMessage("user", promptRaw.trim());
		this.layout.promptEl.value = "";
		this.updateContextUsage();

		const cwd = this.cwdAbs || this.basePathAbs || undefined;

		const args: string[] = ["exec"];

		if (this.plugin.settings.skipGitRepoCheck) {
			args.push("--skip-git-repo-check");
		}

		const addDirs: string[] = [];
		if (this.plugin.settings.attachVaultRoot && this.basePathAbs) {
			addDirs.push(this.basePathAbs);
		}
		if (this.plugin.settings.attachCurrentNoteFolder) {
			const mdView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const folderRel = mdView?.file?.parent?.path;
			if (folderRel && this.basePathAbs) {
				addDirs.push(path.join(this.basePathAbs, folderRel));
			}
		}
		if (this.plugin.settings.extraAddDirs.trim().length) {
			const parsed = this.plugin.settings.extraAddDirs
				.split(/\r?\n|,/)
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			addDirs.push(...parsed);
		}
		addDirs.forEach((dir) => {
			args.push("--add-dir", dir);
		});

		args.push(promptWithContext);

		this.setStatus("Running");
		this.setTyping(true);

		const debugId = this.addMessage(
			"debug",
			this.buildDebugText({
				exe,
				args,
				cwd,
				addDirs,
				exitCode: "(running)",
				stderr: "(streaming)",
				error: "(none yet)",
			})
		);

		const assistantId = this.addMessage("assistant", "");
		let combinedStderr = "";
		let combinedStdout = "";

		if (this.plugin.settings.mockRun) {
			const mockOutput = `MOCK RESULT\n\nPrompt:\n${prompt}\n\n(cwd: ${this.layout.cwdEl.getText() ?? ""})\n`;
			await runCodex(
				{ exe, args, cwd, mockOutput, mockDelayMs: 400 },
				{
					onStdout: (chunk) => {
						combinedStdout += chunk;
						this.appendMessageContent(assistantId, chunk);
					},
				}
			);

			this.updateMessageContent(
				debugId,
				this.buildDebugText({
					exe,
					args,
					cwd,
					addDirs,
					exitCode: "(mock)",
					stderr: "(empty)",
					error: "(none)",
					note: "mockRun=true (no process spawned)",
				})
			);
			this.setStatus("Idle");
			this.setTyping(false);
			return;
		}

		const result = await runCodex(
			{ exe, args, cwd },
			{
				onStdout: (chunk) => {
					combinedStdout += chunk;
					this.appendMessageContent(assistantId, chunk);
				},
				onStderr: (chunk) => {
					combinedStderr += chunk;
					this.updateMessageContent(
						debugId,
						this.buildDebugText({
							exe,
							args,
							cwd,
							addDirs,
							exitCode: "(running)",
							stderr: combinedStderr || "(empty)",
							error: "(none)",
						})
					);
				},
				onSpawn: (child) => {
					this.currentChild = child;
				},
			}
		);

		this.currentChild = null;

		if (result.exitCode === 0) {
			this.setStatus("Idle");
		} else {
			this.setStatus("Error");
			if (!combinedStdout && combinedStderr) {
				this.updateMessageContent(assistantId, "Codex exited with an error. See Debug for details.");
			}
			if (result.error) {
				const friendly =
					result.error && result.error.includes("ENOENT")
						? "Codex not found. Check the executable path in settings."
						: "Failed to start Codex.";
				this.updateMessageContent(assistantId, friendly);
			}
		}

		this.updateMessageContent(
			debugId,
			this.buildDebugText({
				exe,
				args,
				cwd,
				addDirs,
				exitCode: result.exitCode ?? "(unknown)",
				stderr: combinedStderr || "(empty)",
				error: result.error ?? "(none)",
			})
		);

		this.setTyping(false);
	}

	// -------------------------
	// Vault path helper (desktop)
	// -------------------------
	private getVaultBasePathAbs(app: App): string | null {
		const adapter = app.vault.adapter;
		const adapterWithBasePath = adapter as { getBasePath?: () => string } | null;
		const basePath = typeof adapterWithBasePath?.getBasePath === "function" ? adapterWithBasePath.getBasePath() : null;
		return typeof basePath === "string" && basePath.length > 0 ? basePath : null;
	}
}
