const test = require("node:test");
const assert = require("node:assert/strict");

function createResponse({ status, payload }) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async text() {
			return JSON.stringify(payload);
		},
	};
}

function setupRuntime({ fetchImpl, token }) {
	global.window = {
		PaymentAPI: {
			getApiBaseUrl() {
				return "https://license.test";
			},
			getAuthToken() {
				return token || "";
			},
			setAuthToken() {
				return true;
			},
		},
	};
	global.fetch = fetchImpl;
}

function loadAgentChatApi() {
	const modulePath = "./agent-chat.js";
	delete require.cache[require.resolve(modulePath)];
	return require(modulePath);
}

test.afterEach(() => {
	delete global.window;
	delete global.fetch;
});

test("buildImageCommand normalizes prompt into worker-safe tokens", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.equal(
		AgentChatAPI.buildImageCommand({
			prompt: "Small blue square icon on white background!",
		}),
		"qcut gen image -t small-blue-square-icon-on-white-background -m flux_dev --json"
	);
});

test("buildAgentRequest keeps codex prompts out of the shell command", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.deepEqual(
		AgentChatAPI.buildAgentRequest({
			mode: "codex",
			prompt: "Explain how the Daytona worker runs qcut.",
		}),
		{
			command: "codex exec --skip-git-repo-check --json -",
			args: {
				source: "qcut_website_chat_agent",
				codexPrompt: "Explain how the Daytona worker runs qcut.",
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

test("createAgentJob posts to the license server agent route", async () => {
	let requestUrl = "";
	let requestInit = null;
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return createResponse({
				status: 201,
				payload: {
					job: {
						id: "job-1",
						status: "queued",
						command: "qcut system doctor --json",
					},
				},
			});
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const job = await AgentChatAPI.createAgentJob({
		command: "qcut system doctor --json",
		args: { source: "qcut_website_chat_agent" },
	});

	assert.equal(job.id, "job-1");
	assert.equal(requestUrl, "https://license.test/api/agent/jobs");
	assert.equal(requestInit.method, "POST");
	assert.equal(requestInit.headers.Authorization, "Bearer token-abc");
	assert.equal(
		requestInit.body,
		JSON.stringify({
			command: "qcut system doctor --json",
			args: { source: "qcut_website_chat_agent" },
		})
	);
});

test("getAgentArtifactText reads text artifacts from the license server", async () => {
	let requestUrl = "";
	let requestInit = null;
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return {
				ok: true,
				status: 200,
				async text() {
					return "Hello from Codex.";
				},
			};
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const text = await AgentChatAPI.getAgentArtifactText({
		jobId: "job-1",
		artifactId: "artifact-1",
	});

	assert.equal(text, "Hello from Codex.");
	assert.equal(
		requestUrl,
		"https://license.test/api/agent/jobs/job-1/artifacts/artifact-1/text"
	);
	assert.equal(requestInit.method, "GET");
	assert.equal(requestInit.headers.Accept, "text/plain");
});

test("createAgentJob can use the server-side default agent account", async () => {
	let requestInit = null;
	setupRuntime({
		token: "",
		fetchImpl: async (_url, init) => {
			requestInit = init;
			return createResponse({ status: 201, payload: { job: { id: "job-1" } } });
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const job = await AgentChatAPI.createAgentJob({
		command: "qcut system doctor --json",
	});

	assert.equal(job.id, "job-1");
	assert.equal(requestInit.headers.Authorization, undefined);
});
