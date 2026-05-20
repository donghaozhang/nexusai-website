(() => {
	const PARTS = [
		"01-runtime-api.js",
		"02-ui-files.js",
		"03-terminal-job.js",
		"04-bootstrap.js",
	];

	if (typeof module !== "undefined" && module.exports) {
		const fs = require("node:fs");
		const path = require("node:path");
		const vm = require("node:vm");
		const source = PARTS.map((part) =>
			fs.readFileSync(path.join(__dirname, "agent-chat", part), "utf8")
		).join("\n");
		const factory = vm.runInThisContext(
			`(function(module, exports, require) {
${source}
})`,
			{
				filename: "agent-chat.parts.js",
			}
		);
		factory(module, module.exports, require);
		return;
	}

	if (typeof document === "undefined") {
		return;
	}
	const currentScript = document.currentScript;
	const baseUrl = currentScript?.src
		? new URL("./agent-chat/", currentScript.src).toString()
		: "js/agent-chat/";
	const loadParts = async () => {
		const source = (
			await Promise.all(
				PARTS.map(async (part) => {
					const response = await fetch(`${baseUrl}${part}`);
					if (!response.ok) {
						throw new Error(`Failed to load ${part}: ${response.status}`);
					}
					return response.text();
				})
			)
		).join("\n");
		Function(`${source}\n//# sourceURL=agent-chat.parts.js`)();
	};
	const runtimeWindow = typeof window !== "undefined" ? window : globalThis;
	runtimeWindow.AgentChatReady = loadParts().catch((error) => {
		console.error("Agent chat failed to load.", error);
		throw error;
	});
})();
