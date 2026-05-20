const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const {
	createResponse,
	setupRuntime,
	loadAgentChatApi,
} = require("./agent-chat.test-utils.js");

test("chat-agent page loads split script parts before module setup", () => {
	const html = readFileSync(require.resolve("../chat-agent.html"), "utf8");
	const runtimeIndex = html.indexOf(
		'<script src="js/agent-chat/01-runtime-api.js"></script>'
	);
	const uiIndex = html.indexOf(
		'<script src="js/agent-chat/02-ui-files.js"></script>'
	);
	const terminalIndex = html.indexOf(
		'<script src="js/agent-chat/03-terminal-job.js"></script>'
	);
	const bootstrapIndex = html.indexOf(
		'<script src="js/agent-chat/04-bootstrap.js"></script>'
	);
	const uppyIndex = html.indexOf('<script type="module">');

	assert.ok(runtimeIndex > -1);
	assert.ok(runtimeIndex < uiIndex);
	assert.ok(uiIndex < terminalIndex);
	assert.ok(terminalIndex < bootstrapIndex);
	assert.ok(bootstrapIndex < uppyIndex);
	assert.equal(
		html.includes('<script src="js/agent-chat.js"></script>'),
		false
	);
});

test("buildAgentRequest keeps codex prompts out of the shell command", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.deepEqual(
		AgentChatAPI.buildAgentRequest({
			prompt: "Explain how the Daytona worker runs qcut.",
		}),
		{
			command: "codex exec --skip-git-repo-check --json -",
			args: {
				source: "qcut_website_chat_agent",
				codexPrompt: [
					"You are running inside QCut's Daytona CLI image.",
					"The QCut native CLI skill is available at /home/qcut/qcut/.claude/skills/native-cli/SKILL.md.",
					"Read that skill before running nontrivial QCut CLI workflows or when command syntax is unclear.",
					"Use shell commands when the user asks you to inspect or run QCut.",
					"For image generation requests, run the QCut CLI rather than any external image tool.",
					"Uploaded user files are available under /tmp/qcut-input.",
					"When the user mentions an uploaded file or image, inspect /tmp/qcut-input first.",
					"Write generated files under /tmp/qcut-output so the website can list and download them.",
					"The QCut CLI default output directory is QCUT_OUTPUT_DIR=/tmp/qcut-output in this sandbox.",
					"The default image model is gpt_image_2_ima. For image generation, do not pass --model/-m unless the user explicitly asks for a specific model.",
					"yt-dlp and deno are available for authorized video download probes.",
					"For long-running shell commands, stream user-visible stdout with tee -a /tmp/qcut-output/codex-live-stdout.log.",
					"Put temporary tools, caches, and package installs under /tmp/qcut-tools or /tmp, not /tmp/qcut-output.",
					"Write only final user-requested files and small diagnostic summaries/logs under /tmp/qcut-output.",
					"Example: qcut gen image -t 'small blue square icon on a clean white background' --json -o /tmp/qcut-output",
					"Report the command you ran and the resulting artifact paths.",
					"",
					"Latest user message:",
					"Explain how the Daytona worker runs qcut.",
				].join("\n"),
			},
		}
	);
});

test("buildCodexChatPrompt includes prior turns for follow-up messages", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.equal(
		AgentChatAPI.buildCodexChatPrompt({
			messages: [
				{ role: "user", content: "What changed in the worker?" },
				{ role: "assistant", content: "It now runs Codex in Daytona." },
			],
			prompt: "What should we test next?",
		}),
		[
			"You are running inside QCut's Daytona CLI image.",
			"The QCut native CLI skill is available at /home/qcut/qcut/.claude/skills/native-cli/SKILL.md.",
			"Read that skill before running nontrivial QCut CLI workflows or when command syntax is unclear.",
			"Use shell commands when the user asks you to inspect or run QCut.",
			"For image generation requests, run the QCut CLI rather than any external image tool.",
			"Uploaded user files are available under /tmp/qcut-input.",
			"When the user mentions an uploaded file or image, inspect /tmp/qcut-input first.",
			"Write generated files under /tmp/qcut-output so the website can list and download them.",
			"The QCut CLI default output directory is QCUT_OUTPUT_DIR=/tmp/qcut-output in this sandbox.",
			"The default image model is gpt_image_2_ima. For image generation, do not pass --model/-m unless the user explicitly asks for a specific model.",
			"yt-dlp and deno are available for authorized video download probes.",
			"For long-running shell commands, stream user-visible stdout with tee -a /tmp/qcut-output/codex-live-stdout.log.",
			"Put temporary tools, caches, and package installs under /tmp/qcut-tools or /tmp, not /tmp/qcut-output.",
			"Write only final user-requested files and small diagnostic summaries/logs under /tmp/qcut-output.",
			"Example: qcut gen image -t 'small blue square icon on a clean white background' --json -o /tmp/qcut-output",
			"Report the command you ran and the resulting artifact paths.",
			"",
			"Continue this QCut website chat. Answer the latest user message.",
			"",
			"Conversation so far:",
			"User: What changed in the worker?",
			"",
			"Assistant: It now runs Codex in Daytona.",
			"",
			"Latest user message:",
			"What should we test next?",
		].join("\n")
	);
});

test("buildTerminalPromptCommand wraps prompts for visible PTY Codex runs", () => {
	const AgentChatAPI = loadAgentChatApi();
	const command = AgentChatAPI.buildTerminalPromptCommand({
		prompt: "Generate a small blue icon.",
		messages: [],
		marker: "TEST_MARKER",
	});

	assert.match(
		command,
		/cat > \/tmp\/qcut-terminal-prompt\.md <<'TEST_MARKER'/
	);
	assert.match(command, /Generate a small blue icon\./);
	assert.match(command, /mkdir -p \/tmp\/qcut-input \/tmp\/qcut-output/);
	assert.match(
		command,
		/codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-last-message \/tmp\/qcut-output\/codex-last-message\.md - < \/tmp\/qcut-terminal-prompt\.md/
	);
	assert.match(command, /find \/tmp\/qcut-input/);
	assert.match(command, /find \/tmp\/qcut-output/);
});

test("buildInteractiveCodexInput pastes prompts into the persistent Codex session", () => {
	const AgentChatAPI = loadAgentChatApi();
	const input = AgentChatAPI.buildInteractiveCodexInput({
		prompt: "Generate a small blue icon.",
	});

	assert.equal(input, "\u001b[200~Generate a small blue icon.\u001b[201~\r");
});

test("buildCommandPreviewText sanitizes and flags long Codex input", () => {
	const AgentChatAPI = loadAgentChatApi();
	const preview = AgentChatAPI.buildCommandPreviewText({
		prompt: `Generate storyboard frames.\u001b[200~\n${"shot ".repeat(240)}`,
	});

	assert.match(preview, /^Interactive Codex input:\n/);
	assert.doesNotMatch(preview, /\u001b\[200~/);
	assert.equal(AgentChatAPI.isLongCommandPreview({ text: preview }), true);
});

test("isLongCommandPreview keeps short Codex input uncollapsed", () => {
	const AgentChatAPI = loadAgentChatApi();
	const preview = AgentChatAPI.buildCommandPreviewText({
		prompt: "Generate a small blue icon.",
	});

	assert.equal(AgentChatAPI.isLongCommandPreview({ text: preview }), false);
});

test("findCodexLastMessageArtifact selects the Codex final response", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.deepEqual(
		AgentChatAPI.findCodexLastMessageArtifact({
			artifacts: [
				{ id: "events", meta: { filename: "codex-events.jsonl" } },
				{ id: "last", meta: { filename: "codex-last-message.md" } },
			],
		}),
		{ id: "last", meta: { filename: "codex-last-message.md" } }
	);
});

test("buildLiveCodexStatus summarizes recent worker events", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildLiveCodexStatus({
			events: [
				{
					kind: "daytona_command_started",
					createdAt: "2026-05-15T00:00:02.000Z",
					payload: { sessionId: "session-1" },
				},
				{
					kind: "daytona_sandbox_ready",
					createdAt: "2026-05-15T00:00:01.000Z",
					payload: { message: "sandbox ready" },
				},
			],
		}),
		[
			"Running Codex in the Daytona sandbox...",
			"",
			"daytona_sandbox_ready: sandbox ready",
			'daytona_command_started: {"sessionId":"session-1"}',
		].join("\n")
	);
});

test("buildLiveCodexStatus surfaces streamed Codex stdout lines", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildLiveCodexStatus({
			events: [
				{
					kind: "codex_stdout",
					createdAt: "2026-05-15T00:00:03.000Z",
					payload: { message: "STREAM_STEP_1" },
				},
			],
		}),
		[
			"Running Codex in the Daytona sandbox...",
			"",
			"codex_stdout: STREAM_STEP_1",
		].join("\n")
	);
});

test("buildLiveCodexStatus shows real Codex agent messages as soon as event arrives", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildLiveCodexStatus({
			events: [
				{
					kind: "codex_stdout",
					createdAt: "2026-05-15T00:00:03.000Z",
					payload: { message: "still working" },
				},
				{
					kind: "codex_event",
					createdAt: "2026-05-15T00:00:04.000Z",
					payload: {
						type: "item.completed",
						item: {
							type: "agent_message",
							text: "This is the real Codex answer.",
						},
					},
				},
			],
		}),
		"This is the real Codex answer."
	);
});
