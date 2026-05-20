const test = require("node:test");
const assert = require("node:assert/strict");
const {
	createResponse,
	setupRuntime,
	loadAgentChatApi,
} = require("./agent-chat.test-utils.js");

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

test("downloadAgentArtifact fetches binary artifacts and starts a browser download", async () => {
	let requestUrl = "";
	let requestInit = null;
	let clicked = false;
	let revokedUrl = "";
	const anchor = {
		download: "",
		href: "",
		style: {},
		click() {
			clicked = true;
		},
		remove() {},
	};
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return {
				ok: true,
				status: 200,
				async blob() {
					return new Blob([new Uint8Array([1, 2, 3])], {
						type: "image/jpeg",
					});
				},
			};
		},
	});
	global.window.document = {
		body: {
			appendChild(node) {
				assert.equal(node, anchor);
			},
		},
		createElement(tagName) {
			assert.equal(tagName, "a");
			return anchor;
		},
	};
	global.window.URL = {
		createObjectURL(blob) {
			assert.equal(blob.type, "image/jpeg");
			return "blob:artifact";
		},
		revokeObjectURL(url) {
			revokedUrl = url;
		},
	};
	global.window.setTimeout = (callback) => {
		callback();
		return 1;
	};
	const AgentChatAPI = loadAgentChatApi();

	await AgentChatAPI.downloadAgentArtifact({
		jobId: "job-1",
		artifact: {
			id: "artifact-1",
			jobId: "job-1",
			meta: { filename: "result.jpg" },
		},
	});

	assert.equal(
		requestUrl,
		"https://license.test/api/agent/jobs/job-1/artifacts/artifact-1/download"
	);
	assert.equal(requestInit.method, "GET");
	assert.equal(requestInit.headers.Authorization, "Bearer token-abc");
	assert.equal(requestInit.headers.Accept, "application/octet-stream");
	assert.equal(anchor.href, "blob:artifact");
	assert.equal(anchor.download, "result.jpg");
	assert.equal(clicked, true);
	assert.equal(revokedUrl, "blob:artifact");
});

test("downloadAgentArtifact uses virtual session file routes for sandbox files", async () => {
	let requestUrl = "";
	const anchor = {
		download: "",
		href: "",
		style: {},
		click() {},
		remove() {},
	};
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url) => {
			requestUrl = url;
			return {
				ok: true,
				status: 200,
				async blob() {
					return new Blob([new Uint8Array([1, 2, 3])], {
						type: "image/png",
					});
				},
			};
		},
	});
	global.window.document = {
		body: { appendChild() {} },
		createElement() {
			return anchor;
		},
	};
	global.window.URL = {
		createObjectURL() {
			return "blob:session-file";
		},
		revokeObjectURL() {},
	};
	global.window.setTimeout = (callback) => {
		callback();
		return 1;
	};
	const AgentChatAPI = loadAgentChatApi();

	await AgentChatAPI.downloadAgentArtifact({
		jobId: null,
		artifact: {
			id: "input/source.png",
			sessionId: "agent-session-1",
			meta: { filename: "source.png", folder: "input" },
		},
	});

	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/agent-session-1/files/input/source.png/download"
	);
	assert.equal(anchor.download, "source.png");
});

test("downloadAgentArtifact uses full filesystem path routes for sandbox explorer files", async () => {
	let requestUrl = "";
	const anchor = {
		download: "",
		href: "",
		style: {},
		click() {},
		remove() {},
	};
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url) => {
			requestUrl = url;
			return {
				ok: true,
				status: 200,
				async blob() {
					return new Blob([new Uint8Array([1, 2, 3])], {
						type: "image/png",
					});
				},
			};
		},
	});
	global.window.document = {
		body: { appendChild() {} },
		createElement() {
			return anchor;
		},
	};
	global.window.URL = {
		createObjectURL() {
			return "blob:filesystem-file";
		},
		revokeObjectURL() {},
	};
	global.window.setTimeout = (callback) => {
		callback();
		return 1;
	};
	const AgentChatAPI = loadAgentChatApi();

	await AgentChatAPI.downloadAgentArtifact({
		jobId: null,
		artifact: {
			id: "/tmp/qcut-output/result.png",
			sessionId: "agent-session-1",
			storagePath: "/tmp/qcut-output/result.png",
			meta: {
				filename: "result.png",
				folder: "filesystem",
				isDir: false,
				path: "/tmp/qcut-output/result.png",
			},
		},
	});

	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/agent-session-1/files/download?path=%2Ftmp%2Fqcut-output%2Fresult.png"
	);
	assert.equal(anchor.download, "result.png");
});

test("downloadAgentArtifact downloads sandbox folders as archives", async () => {
	let requestUrl = "";
	const anchor = {
		download: "",
		href: "",
		style: {},
		click() {},
		remove() {},
	};
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url) => {
			requestUrl = url;
			return {
				ok: true,
				status: 200,
				async blob() {
					return new Blob([new Uint8Array([1, 2, 3])], {
						type: "application/gzip",
					});
				},
			};
		},
	});
	global.window.document = {
		body: { appendChild() {} },
		createElement() {
			return anchor;
		},
	};
	global.window.URL = {
		createObjectURL() {
			return "blob:filesystem-folder";
		},
		revokeObjectURL() {},
	};
	global.window.setTimeout = (callback) => {
		callback();
		return 1;
	};
	const AgentChatAPI = loadAgentChatApi();

	await AgentChatAPI.downloadAgentArtifact({
		jobId: null,
		artifact: {
			id: "/tmp/qcut-output/renders",
			sessionId: "agent-session-1",
			storagePath: "/tmp/qcut-output/renders",
			meta: {
				filename: "renders",
				folder: "filesystem",
				isDir: true,
				path: "/tmp/qcut-output/renders",
			},
		},
	});

	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/agent-session-1/files/download?path=%2Ftmp%2Fqcut-output%2Frenders&archive=tar"
	);
	assert.equal(anchor.download, "renders.tar.gz");
});

test("buildAgentArtifactDownloadPath encodes job and artifact ids", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildAgentArtifactDownloadPath({
			jobId: "job / 1",
			artifactId: "artifact / 1",
		}),
		"/api/agent/jobs/job%20%2F%201/artifacts/artifact%20%2F%201/download"
	);
});

test("buildAgentSessionFileDownloadPath encodes session folder and filename", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildAgentSessionFileDownloadPath({
			sessionId: "session / 1",
			folder: "output",
			filename: "clip final.mp4",
		}),
		"/api/agent/sessions/session%20%2F%201/files/output/clip%20final.mp4/download"
	);
});

test("buildAgentSessionFilesystemDownloadPath encodes full sandbox paths", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildAgentSessionFilesystemDownloadPath({
			sessionId: "session / 1",
			path: "/tmp/qcut-output/clip final.mp4",
		}),
		"/api/agent/sessions/session%20%2F%201/files/download?path=%2Ftmp%2Fqcut-output%2Fclip%20final.mp4"
	);
	assert.equal(
		AgentChatAPI.buildAgentSessionFilesystemDownloadPath({
			sessionId: "session / 1",
			path: "/tmp/qcut-output/renders",
			archive: "tar",
		}),
		"/api/agent/sessions/session%20%2F%201/files/download?path=%2Ftmp%2Fqcut-output%2Frenders&archive=tar"
	);
});

test("buildAgentArtifactDownloadRequest reuses filesystem download routing", () => {
	const AgentChatAPI = loadAgentChatApi();

	const request = AgentChatAPI.buildAgentArtifactDownloadRequest({
		jobId: null,
		artifact: {
			sessionId: "session-1",
			storagePath: "/tmp/qcut-output/scenes.json",
			meta: {
				filename: "scenes.json",
				folder: "filesystem",
				path: "/tmp/qcut-output/scenes.json",
			},
		},
	});

	assert.deepEqual(request, {
		filename: "scenes.json",
		path: "/api/agent/sessions/session-1/files/download?path=%2Ftmp%2Fqcut-output%2Fscenes.json",
	});
});

test("getArtifactCopyPath prefers sandbox filesystem paths", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.getArtifactCopyPath({
			artifact: {
				id: "artifact-1",
				storagePath: "storage/result.json",
				meta: { path: "/tmp/qcut-output/result.json" },
			},
		}),
		"/tmp/qcut-output/result.json"
	);
	assert.equal(
		AgentChatAPI.getArtifactCopyPath({
			artifact: {
				id: "artifact-2",
				storagePath: "storage/result.json",
				meta: {},
			},
		}),
		"storage/result.json"
	);
});

test("getArtifactPreviewKind detects image and text artifacts", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.getArtifactPreviewKind({
			artifact: {
				kind: "image",
				meta: { filename: "portrait.png" },
			},
		}),
		"image"
	);
	assert.equal(
		AgentChatAPI.getArtifactPreviewKind({
			artifact: {
				kind: "log",
				meta: { filename: "notes.md" },
			},
		}),
		"text"
	);
	assert.equal(
		AgentChatAPI.getArtifactPreviewKind({
			artifact: {
				kind: "json",
				meta: { filename: "scenes.json" },
			},
		}),
		"json"
	);
	assert.equal(
		AgentChatAPI.getArtifactPreviewKind({
			artifact: {
				kind: "video",
				meta: { filename: "clip.mp4" },
			},
		}),
		"none"
	);
});

test("buildStandalonePreviewHtml escapes preview content", () => {
	const AgentChatAPI = loadAgentChatApi();

	const html = AgentChatAPI.buildStandalonePreviewHtml({
		filename: 'result"<json>.md',
		text: '<script>alert("x")</script>',
	});

	assert.match(html, /result&quot;&lt;json&gt;\.md/);
	assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
	assert.doesNotMatch(html, /<script>alert/);
});

test("formatPreviewText pretty prints valid JSON", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.formatPreviewText({
			filename: "scenes.json",
			text: '{"title":"Demo","scenes":[1]}',
		}),
		'{\n  "title": "Demo",\n  "scenes": [\n    1\n  ]\n}'
	);
	assert.equal(
		AgentChatAPI.formatPreviewText({
			filename: "notes.txt",
			text: '{"title":"Raw"}',
		}),
		'{"title":"Raw"}'
	);
});

test("loadAgentArtifactPreview fetches and formats text previews", async () => {
	let requestUrl = "";
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url) => {
			requestUrl = url;
			return {
				ok: true,
				status: 200,
				async blob() {
					return new Blob(['{"ok":true}'], {
						type: "application/json",
					});
				},
			};
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const preview = await AgentChatAPI.loadAgentArtifactPreview({
		jobId: null,
		artifact: {
			sessionId: "session-1",
			bytes: 11,
			storagePath: "/tmp/qcut-output/result.json",
			meta: {
				filename: "result.json",
				folder: "filesystem",
				path: "/tmp/qcut-output/result.json",
			},
		},
	});

	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/session-1/files/download?path=%2Ftmp%2Fqcut-output%2Fresult.json"
	);
	assert.equal(preview.kind, "json");
	assert.equal(preview.filename, "result.json");
	assert.equal(preview.text, '{\n  "ok": true\n}');
});

test("openAgentArtifactPreviewInNewTab opens text previews as blob HTML", async () => {
	let requestUrl = "";
	let openedUrl = "";
	let revokedUrl = "";
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url) => {
			requestUrl = url;
			return {
				ok: true,
				status: 200,
				async blob() {
					return new Blob(["# Hello"], {
						type: "text/markdown",
					});
				},
			};
		},
	});
	global.window.URL = {
		createObjectURL(blob) {
			assert.equal(blob.type, "text/html");
			return "blob:preview-tab";
		},
		revokeObjectURL(url) {
			revokedUrl = url;
		},
	};
	global.window.open = (url, target) => {
		openedUrl = url;
		assert.equal(target, "_blank");
		return { location: { href: "" } };
	};
	global.window.setTimeout = (callback) => {
		callback();
		return 1;
	};
	const AgentChatAPI = loadAgentChatApi();

	const objectUrl = await AgentChatAPI.openAgentArtifactPreviewInNewTab({
		jobId: null,
		artifact: {
			sessionId: "session-1",
			bytes: 7,
			storagePath: "/tmp/qcut-output/notes.md",
			meta: {
				filename: "notes.md",
				folder: "filesystem",
				path: "/tmp/qcut-output/notes.md",
			},
		},
	});

	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/session-1/files/download?path=%2Ftmp%2Fqcut-output%2Fnotes.md"
	);
	assert.equal(objectUrl, "blob:preview-tab");
	assert.equal(openedUrl, "about:blank");
	assert.equal(revokedUrl, "blob:preview-tab");
});

test("openAgentArtifactPreviewInNewTab can use a pre-opened user tab", async () => {
	let previewHref = "";
	setupRuntime({
		token: "token-abc",
		fetchImpl: async () => ({
			ok: true,
			status: 200,
			async blob() {
				return new Blob(["hello"], {
					type: "text/plain",
				});
			},
		}),
	});
	global.window.URL = {
		createObjectURL() {
			return "blob:pre-opened-preview";
		},
		revokeObjectURL() {},
	};
	global.window.setTimeout = (callback) => {
		callback();
		return 1;
	};
	const previewWindow = {
		location: {
			set href(value) {
				previewHref = value;
			},
		},
	};
	const AgentChatAPI = loadAgentChatApi();

	await AgentChatAPI.openAgentArtifactPreviewInNewTab({
		jobId: null,
		previewWindow,
		artifact: {
			sessionId: "session-1",
			bytes: 5,
			storagePath: "/tmp/qcut-output/notes.txt",
			meta: {
				filename: "notes.txt",
				folder: "filesystem",
				path: "/tmp/qcut-output/notes.txt",
			},
		},
	});

	assert.equal(previewHref, "blob:pre-opened-preview");
});

test("loadAgentArtifactPreview blocks oversized text before downloading", async () => {
	setupRuntime({
		token: "token-abc",
		fetchImpl: async () => {
			throw new Error("fetch should not run");
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	await assert.rejects(
		AgentChatAPI.loadAgentArtifactPreview({
			jobId: null,
			artifact: {
				sessionId: "session-1",
				bytes: 2 * 1024 * 1024,
				storagePath: "/tmp/qcut-output/big.log",
				meta: {
					filename: "big.log",
					folder: "filesystem",
					path: "/tmp/qcut-output/big.log",
				},
			},
		}),
		/Preview is limited/
	);
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
