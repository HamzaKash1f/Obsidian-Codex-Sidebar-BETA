import {
	App,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import * as path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

import type { Plugin } from "obsidian";
import type { CodexSettings } from "../settings";

export const CODEX_VIEW_TYPE = "codex-view";

type RunStatus = "Idle" | "Running" | "Error";
type MessageRole = "user" | "assistant" | "debug" | "system";

interface ChatMessage {
	id: string;
	role: MessageRole;
	content: string;
	createdAt: number;
}

type CodexPlugin = Plugin & { settings: CodexSettings };

export class CodexView extends ItemView {
	private plugin: CodexPlugin;

	// UI refs
	private hintEl!: HTMLDivElement;
	private statusEl!: HTMLDivElement;
	private cwdEl!: HTMLDivElement;
	private inlineMsgEl!: HTMLDivElement;
	private promptEl!: HTMLTextAreaElement;
	private runBtnEl!: HTMLButtonElement;
	private newChatBtnEl!: HTMLButtonElement;
	private messageListEl!: HTMLDivElement;
	private typingEl!: HTMLDivElement;
	private contextBarFillEl!: HTMLDivElement;
	private contextBarTextEl!: HTMLDivElement;
	private historyBarFillEl!: HTMLDivElement;
	private historyBarTextEl!: HTMLDivElement;

	// State
	private status: RunStatus = "Idle";
	private cwdAbs: string;
	private basePathAbs: string | null;
	private currentChild: ChildProcessWithoutNullStreams | null = null;
	private messageMap = new Map<string, ChatMessage>();
	private messageContentEls = new Map<string, HTMLElement>();
	private messageOrder: string[] = [];
	private sessionStartIndex = 0;
	private messageIdCounter = 0;
	private readonly historyTokenCap = 12000;
	private readonly textDecoder = new TextDecoder();

	private readonly onRunRequested = () => void this.runCodex();

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
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("codex-root");

		const layout = contentEl.createEl("div", { cls: "codex-layout" });
		const column = layout.createEl("div", { cls: "codex-column" });

		const header = column.createEl("div", { cls: "codex-header" });
		const titleRow = header.createEl("div", { cls: "codex-title-row" });
		const titleWrap = titleRow.createEl("div", { cls: "codex-title-wrap" });
		const titleIcon = titleWrap.createEl("span", { cls: "codex-title-icon" });
		setIcon(titleIcon, "codex-logo");
		titleWrap.createEl("h2", { text: "Codex", cls: "codex-title" });
		this.newChatBtnEl = titleRow.createEl("button", { cls: "codex-new-chat", text: "New chat" });
		this.newChatBtnEl.setAttr("aria-label", "Start a new chat");

		this.hintEl = header.createEl("div", {
			text: "Tab to move to current note",
			cls: "codex-hint",
		});

		const statusWrap = header.createEl("div", { cls: "codex-status" });
		this.statusEl = statusWrap.createEl("div", { cls: "codex-status-text" });
		this.cwdEl = statusWrap.createEl("div", { cls: "codex-cwd-text" });

		this.inlineMsgEl = column.createEl("div", { cls: "codex-inline-msg" });

		// Messages
		this.messageListEl = column.createEl("div", { cls: "codex-message-list" });
		this.messageListEl.setAttr("role", "log");

		this.typingEl = this.messageListEl.createEl("div", {
			cls: "codex-typing",
			text: "Typing...",
		});
		this.typingEl.setAttr("role", "status");
		this.typingEl.setAttr("aria-live", "polite");
		this.typingEl.setAttr("aria-atomic", "true");

		// Context + history bars (bottom)
		const barsWrap = column.createEl("div", { cls: "codex-bars" });

		const contextWrap = barsWrap.createEl("div", { cls: "codex-context" });
		this.contextBarTextEl = contextWrap.createEl("div", { cls: "codex-context-text" });
		const barOuter = contextWrap.createEl("div", { cls: "codex-context-bar" });
		this.contextBarFillEl = barOuter.createEl("div", { cls: "codex-context-fill" });

		const historyWrap = barsWrap.createEl("div", { cls: "codex-context" });
		this.historyBarTextEl = historyWrap.createEl("div", { cls: "codex-context-text" });
		const historyOuter = historyWrap.createEl("div", { cls: "codex-context-bar" });
		this.historyBarFillEl = historyOuter.createEl("div", { cls: "codex-context-fill" });

		// Composer
		const composer = column.createEl("div", { cls: "codex-composer" });
		this.promptEl = composer.createEl("textarea", { cls: "codex-input" });
		this.promptEl.rows = 3;
		this.promptEl.setAttr("placeholder", "Send a message");

		this.runBtnEl = composer.createEl("button", { cls: "codex-run" });
		this.runBtnEl.setAttr("aria-label", "Run");
		this.runBtnEl.setAttr("title", "Run");
		setIcon(this.runBtnEl, "arrow-up");

		// Initial state render
		this.setStatus("Idle");
		this.setInlineMessage("");
		this.setCwdToVaultRoot();
		this.updateContextUsage();
		this.updateHistoryUsage();
		this.setTyping(false);

		// Events
		this.runBtnEl.addEventListener("click", this.onRunRequested);
		this.newChatBtnEl.addEventListener("click", () => this.startNewChat());
		this.promptEl.addEventListener("keydown", (evt) => this.onPromptKeyDown(evt));
		this.promptEl.addEventListener("input", () => this.updateContextUsage());
	}

	async onClose() {
		// No-op for now.
	}

	// -------------------------
	// UI state helpers
	// -------------------------
	private setStatus(status: RunStatus) {
		this.status = status;
		this.statusEl.setText(`Status: ${status}`);
		this.runBtnEl.disabled = status === "Running";
	}

	private setInlineMessage(msg: string) {
		this.inlineMsgEl.setText(msg);
		this.inlineMsgEl.toggleClass("is-hidden", !msg.length);
	}

	private setTyping(isTyping: boolean) {
		this.typingEl.toggleClass("is-hidden", !isTyping);
	}

	private updateContextUsage() {
		const budget = this.plugin.settings.contextMaxTokens || 8000;
		const approxTokens = this.estimateTokens(this.promptEl.value ?? "");
		const pct = Math.min(100, Math.round((approxTokens / budget) * 100));
		this.contextBarFillEl.style.width = `${pct}%`;
		this.contextBarTextEl.setText(
			`Context (approx): ~${approxTokens} tokens / ${budget} (${pct}%)`
		);
	}

	private updateHistoryUsage() {
		const context = this.buildConversationContext();
		const approxTokens = this.estimateTokens(context);
		const pct = Math.min(100, Math.round((approxTokens / this.historyTokenCap) * 100));
		this.historyBarFillEl.style.width = `${pct}%`;
		this.historyBarTextEl.setText(
			`History (approx): ~${approxTokens} tokens / ${this.historyTokenCap} (${pct}%)`
		);
	}

	private estimateTokens(text: string) {
		const length = text?.length ?? 0;
		return Math.max(1, Math.ceil(length / 4));
	}

	private setCwdDisplayFromAbs(cwdAbs: string) {
		if (this.basePathAbs) {
			const rel = path.relative(this.basePathAbs, cwdAbs);
			const pretty = rel && rel !== "" ? rel : "(vault root)";
			this.cwdEl.setText(`cwd: ${pretty}`);
		} else {
			this.cwdEl.setText(`cwd: ${cwdAbs || "(unknown vault root)"}`);
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
	private createMessageId() {
		this.messageIdCounter += 1;
		return `codex-msg-${Date.now()}-${this.messageIdCounter}`;
	}

	private addMessage(role: MessageRole, content: string): string {
		const message: ChatMessage = {
			id: this.createMessageId(),
			role,
			content,
			createdAt: Date.now(),
		};
		this.messageMap.set(message.id, message);
		this.messageOrder.push(message.id);

		const row = document.createElement("div");
		row.classList.add("codex-message", `codex-${role}`);
		row.setAttribute("data-role", role);

		const bubble = row.createDiv({ cls: "codex-bubble" });
		let contentEl: HTMLElement;

		if (role === "debug") {
			const details = bubble.createEl("details", { cls: "codex-debug-details" });
			const summary = details.createEl("summary", { cls: "codex-debug-summary" });
			summary.setText("Debug");
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

		this.messageListEl.insertBefore(row, this.typingEl);
		this.scrollToBottom();
		this.updateHistoryUsage();
		return message.id;
	}

	private updateMessageContent(messageId: string, content: string) {
		const message = this.messageMap.get(messageId);
		if (!message) return;
		message.content = content;

		const contentEl = this.messageContentEls.get(messageId);
		if (!contentEl) return;

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
		const message = this.messageMap.get(messageId);
		if (!message) return;
		this.updateMessageContent(messageId, message.content + chunk);
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
			this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
		});
	}

	private startNewChat() {
		this.sessionStartIndex = this.messageOrder.length;
		this.addMessage("system", "New chat");
		this.updateHistoryUsage();
	}

	private buildConversationContext(): string {
		const lines: string[] = [];
		for (const id of this.messageOrder.slice(this.sessionStartIndex)) {
			const message = this.messageMap.get(id);
			if (!message) continue;
			if (message.role !== "user" && message.role !== "assistant") continue;
			const label = message.role === "user" ? "USER" : "ASSISTANT";
			lines.push(`${label}: ${message.content}`);
		}
		if (!lines.length) return "";
		return `Conversation so far:\n${lines.join("\n\n")}`;
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
		if (this.promptEl.value.trim().length > 0) return;

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

	private async runCodex() {
		if (this.status === "Running") return;

		this.setInlineMessage("");

		const exe = (this.plugin.settings.codexExecutablePath || "codex").trim();
		const promptRaw = this.promptEl.value ?? "";
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
		this.promptEl.value = "";
		this.updateContextUsage();

		const cwd = this.cwdAbs || this.basePathAbs || undefined;

		const args: string[] = ["exec", promptWithContext];
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

		// MOCK MODE
		if (this.plugin.settings.mockRun) {
			window.setTimeout(() => {
				this.addMessage(
					"assistant",
					`MOCK RESULT\n\nPrompt:\n${prompt}\n\n(cwd: ${this.cwdEl.getText() ?? ""})\n`
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
			}, 400);
			return;
		}

		let combinedStdout = "";
		let combinedStderr = "";

		const assistantId = this.addMessage("assistant", "");

		try {
			const child = spawn(exe, args, {
				cwd,
				shell: false,
				windowsHide: true,
			});
			this.currentChild = child;

			child.stdout?.on("data", (buf: Uint8Array) => {
				const s = this.textDecoder.decode(buf);
				combinedStdout += s;
				this.appendMessageContent(assistantId, s);
			});

			child.stderr?.on("data", (buf: Uint8Array) => {
				const s = this.textDecoder.decode(buf);
				combinedStderr += s;
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
			});

			child.on("error", (err: Error & { code?: string }) => {
				this.setStatus("Error");
				this.setTyping(false);
				this.currentChild = null;

				const friendly =
					err.code === "ENOENT"
						? "Codex not found. Check the executable path in settings."
						: "Failed to start Codex.";

				this.updateMessageContent(assistantId, friendly);

				this.updateMessageContent(
					debugId,
					this.buildDebugText({
						exe,
						args,
						cwd,
						addDirs,
						exitCode: "(spawn error)",
						stderr: combinedStderr || "(empty)",
						error: err.message || "Unknown error",
					})
				);
			});

			child.on("close", (code) => {
				this.currentChild = null;

				if (code === 0) {
					this.setStatus("Idle");
				} else {
					this.setStatus("Error");
					if (!combinedStdout && combinedStderr) {
						this.updateMessageContent(
							assistantId,
							"Codex exited with an error. See Debug for details."
						);
					}
				}

				this.updateMessageContent(
					debugId,
					this.buildDebugText({
						exe,
						args,
						cwd,
						addDirs,
						exitCode: code ?? "(unknown)",
						stderr: combinedStderr || "(empty)",
						error: "(none)",
					})
				);

				this.setTyping(false);
			});
		} catch (err: unknown) {
			this.setStatus("Error");
			this.setTyping(false);
			this.currentChild = null;

			const errorText =
				err instanceof Error
					? err.message
					: typeof err === "string"
						? err
						: JSON.stringify(err);
			this.updateMessageContent(assistantId, "Failed to run Codex. See Debug for details.");
			this.updateMessageContent(
				debugId,
				this.buildDebugText({
					exe,
					args,
					cwd,
					addDirs,
					exitCode: "(exception)",
					stderr: combinedStderr || "(empty)",
					error: errorText,
				})
			);
		}
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
