import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

export interface CodexRunOptions {
	exe: string;
	args: string[];
	cwd?: string;
	mockOutput?: string;
	mockDelayMs?: number;
}

export interface CodexRunCallbacks {
	onStdout?: (chunk: string) => void;
	onStderr?: (chunk: string) => void;
	onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
}

export interface CodexRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	error?: string;
}

export function runCodex(
	options: CodexRunOptions,
	callbacks: CodexRunCallbacks = {}
): Promise<CodexRunResult> {
	const { mockOutput, mockDelayMs } = options;

	if (typeof mockOutput === "string") {
		return new Promise((resolve) => {
			window.setTimeout(() => {
				callbacks.onStdout?.(mockOutput);
				resolve({ exitCode: 0, stdout: mockOutput, stderr: "" });
			}, mockDelayMs ?? 300);
		});
	}

	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";

		try {
			const child = spawn(options.exe, options.args, {
				cwd: options.cwd,
				shell: false,
				windowsHide: true,
			});

			callbacks.onSpawn?.(child);

			child.stdout?.on("data", (buf: Uint8Array) => {
				const chunk = buf.toString();
				stdout += chunk;
				callbacks.onStdout?.(chunk);
			});

			child.stderr?.on("data", (buf: Uint8Array) => {
				const chunk = buf.toString();
				stderr += chunk;
				callbacks.onStderr?.(chunk);
			});

			child.on("error", (err) => {
				resolve({
					exitCode: null,
					stdout,
					stderr,
					error: err?.message ?? "Unknown spawn error",
				});
			});

			child.on("close", (code) => {
				resolve({
					exitCode: code ?? null,
					stdout,
					stderr,
				});
			});
		} catch (err: unknown) {
			const message =
				err instanceof Error
					? err.message
					: typeof err === "string"
						? err
						: JSON.stringify(err);
			resolve({
				exitCode: null,
				stdout,
				stderr,
				error: message,
			});
		}
	});
}
