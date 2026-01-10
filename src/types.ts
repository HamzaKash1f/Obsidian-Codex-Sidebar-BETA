export type RunStatus = "Idle" | "Running" | "Error";

export type MessageRole = "user" | "assistant" | "debug" | "system";

export interface ChatMessage {
	id: string;
	role: MessageRole;
	content: string;
	createdAt: number;
}
