import { setIcon } from "obsidian";

export interface CodexLayout {
	hintEl: HTMLDivElement;
	statusEl: HTMLDivElement;
	cwdEl: HTMLDivElement;
	inlineMsgEl: HTMLDivElement;
	promptEl: HTMLTextAreaElement;
	runBtnEl: HTMLButtonElement;
	newChatBtnEl: HTMLButtonElement;
	messageListEl: HTMLDivElement;
	typingEl: HTMLDivElement;
	contextBarFillEl: HTMLDivElement;
	contextBarTextEl: HTMLDivElement;
	historyBarFillEl: HTMLDivElement;
	historyBarTextEl: HTMLDivElement;
}

export function createCodexLayout(contentEl: HTMLElement, iconName: string): CodexLayout {
	contentEl.empty();
	contentEl.addClass("codex-root");

	const layout = contentEl.createEl("div", { cls: "codex-layout" });
	const column = layout.createEl("div", { cls: "codex-column" });

	const header = column.createEl("div", { cls: "codex-header" });
	const titleRow = header.createEl("div", { cls: "codex-title-row" });
	const titleWrap = titleRow.createEl("div", { cls: "codex-title-wrap" });
	const titleIcon = titleWrap.createEl("span", { cls: "codex-title-icon" });
	setIcon(titleIcon, iconName);
	titleWrap.createEl("h2", { text: "Codex", cls: "codex-title" });
	const newChatBtnEl = titleRow.createEl("button", { cls: "codex-new-chat", text: "New chat" });
	newChatBtnEl.setAttr("aria-label", "Start a new chat");

	const hintEl = header.createEl("div", {
		text: "Tab to move to current note",
		cls: "codex-hint",
	});

	const statusWrap = header.createEl("div", { cls: "codex-status" });
	const statusEl = statusWrap.createEl("div", { cls: "codex-status-text" });
	const cwdEl = statusWrap.createEl("div", { cls: "codex-cwd-text" });

	const inlineMsgEl = column.createEl("div", { cls: "codex-inline-msg" });

	// Messages
	const messageListEl = column.createEl("div", { cls: "codex-message-list" });
	messageListEl.setAttr("role", "log");

	const typingEl = messageListEl.createEl("div", {
		cls: "codex-typing",
		text: "Typing...",
	});
	typingEl.setAttr("role", "status");
	typingEl.setAttr("aria-live", "polite");
	typingEl.setAttr("aria-atomic", "true");

	// Context + history bars (bottom)
	const barsWrap = column.createEl("div", { cls: "codex-bars" });

	const contextWrap = barsWrap.createEl("div", { cls: "codex-context" });
	const contextBarTextEl = contextWrap.createEl("div", { cls: "codex-context-text" });
	const barOuter = contextWrap.createEl("div", { cls: "codex-context-bar" });
	const contextBarFillEl = barOuter.createEl("div", { cls: "codex-context-fill" });

	const historyWrap = barsWrap.createEl("div", { cls: "codex-context" });
	const historyBarTextEl = historyWrap.createEl("div", { cls: "codex-context-text" });
	const historyOuter = historyWrap.createEl("div", { cls: "codex-context-bar" });
	const historyBarFillEl = historyOuter.createEl("div", { cls: "codex-context-fill" });

	// Composer
	const composer = column.createEl("div", { cls: "codex-composer" });
	const promptEl = composer.createEl("textarea", { cls: "codex-input" });
	promptEl.rows = 3;
	promptEl.setAttr("placeholder", "Send a message");

	const runBtnEl = composer.createEl("button", { cls: "codex-run" });
	runBtnEl.setAttr("aria-label", "Run");
	runBtnEl.setAttr("title", "Run");
	setIcon(runBtnEl, "arrow-up");

	return {
		hintEl,
		statusEl,
		cwdEl,
		inlineMsgEl,
		promptEl,
		runBtnEl,
		newChatBtnEl,
		messageListEl,
		typingEl,
		contextBarFillEl,
		contextBarTextEl,
		historyBarFillEl,
		historyBarTextEl,
	};
}
