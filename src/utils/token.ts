// Rough heuristic: ~4 chars per token. Keeps UI-only counters simple.
export function estimateTokens(text: string): number {
	const length = text?.length ?? 0;
	return Math.max(1, Math.ceil(length / 4));
}
