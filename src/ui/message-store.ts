import { ChatMessage, MessageRole } from "../types";

export class MessageStore {
	private messageMap = new Map<string, ChatMessage>();
	private messageOrder: string[] = [];
	private sessionStartIndex = 0;
	private messageIdCounter = 0;

	get(id: string): ChatMessage | undefined {
		return this.messageMap.get(id);
	}

	addMessage(role: MessageRole, content: string): ChatMessage {
		const message: ChatMessage = {
			id: this.createMessageId(),
			role,
			content,
			createdAt: Date.now(),
		};
		this.messageMap.set(message.id, message);
		this.messageOrder.push(message.id);
		return message;
	}

	updateContent(id: string, content: string) {
		const msg = this.messageMap.get(id);
		if (!msg) return;
		msg.content = content;
	}

	appendContent(id: string, chunk: string) {
		const msg = this.messageMap.get(id);
		if (!msg) return;
		msg.content += chunk;
	}

	startNewChat() {
		this.sessionStartIndex = this.messageOrder.length;
	}

	buildConversationContext(): string {
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

	private createMessageId() {
		this.messageIdCounter += 1;
		return `codex-msg-${Date.now()}-${this.messageIdCounter}`;
	}
}
