import { setIcon } from "obsidian";

export interface CodexLayout {
	statusEl: HTMLDivElement;
	cwdEl: HTMLDivElement;
	inlineMsgEl: HTMLDivElement;
	promptEl: HTMLTextAreaElement;
	runBtnEl: HTMLButtonElement;
	newChatBtnEl: HTMLButtonElement;
	messageListEl: HTMLDivElement;
	historyBarFillEl: HTMLDivElement;
}

export function createCodexLayout(contentEl: HTMLElement, iconName: string): CodexLayout {
	contentEl.empty();
	contentEl.addClass("codex-root");

	const layout = contentEl.createEl("div", { cls: "codex-layout" });
	const column = layout.createEl("div", { cls: "codex-column" });

	const header = column.createEl("div", { cls: "codex-header" });
	const controls = header.createEl("div", { cls: "codex-controls" });
	const newChatBtnEl = controls.createEl("button", { cls: "codex-new-chat", text: "New chat" });
	newChatBtnEl.setAttr("aria-label", "Start a new chat");

	const statusWrap = header.createEl("div", { cls: "codex-status" });
	const statusEl = statusWrap.createEl("div", { cls: "codex-status-text" });
	const cwdEl = statusWrap.createEl("div", { cls: "codex-cwd-text" });

	const historyOuter = column.createEl("div", { cls: "codex-history-bar" });
	const historyBarFillEl = historyOuter.createEl("div", { cls: "codex-history-fill" });
	historyOuter.setAttr("role", "progressbar");
	historyOuter.setAttr("aria-label", "Conversation history usage");

	const inlineMsgEl = column.createEl("div", { cls: "codex-inline-msg" });

	// Messages
	const messageListEl = column.createEl("div", { cls: "codex-message-list" });
	messageListEl.setAttr("role", "log");

	// Composer
	const composer = column.createEl("div", { cls: "codex-composer" });
	const promptEl = composer.createEl("textarea", { cls: "codex-input" });
	promptEl.rows = 3;
	promptEl.setAttr("placeholder", "Type a message…");

	const runBtnEl = composer.createEl("button", { cls: "codex-run" });
	runBtnEl.setAttr("aria-label", "Run");
	runBtnEl.setAttr("title", "Run");
	setIcon(runBtnEl, "arrow-up");

	return {
		statusEl,
		cwdEl,
		inlineMsgEl,
		promptEl,
		runBtnEl,
		newChatBtnEl,
		messageListEl,
		historyBarFillEl,
	};
}
