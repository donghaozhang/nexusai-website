function initAgentChatPage() {
	const newSessionButton = getElement({ id: "agent-new-session" });
	const terminalConnectButton = getElement({ id: "agent-terminal-connect" });
	const terminalDisconnectButton = getElement({
		id: "agent-terminal-disconnect",
	});
	const refreshArtifactsButton = getElement({
		id: "agent-refresh-artifacts",
	});
	const uploadFilesButton = getElement({ id: "agent-upload-submit" });
	const fsRootButton = getElement({ id: "agent-fs-root" });
	const fsUpButton = getElement({ id: "agent-fs-up" });

	setValue({ id: "agent-token", value: readAuthToken() });
	renderAgentSession({ session: null });
	renderSandboxPath();
	if (newSessionButton) {
		newSessionButton.addEventListener("click", resetAgentSession);
	}
	if (terminalConnectButton) {
		terminalConnectButton.addEventListener("click", () => {
			void connectAgentTerminal().catch((error) => {
				showError({
					message:
						error instanceof Error
							? `Terminal connect failed: ${error.message}`
							: "Terminal connect failed",
				});
			});
		});
	}
	if (terminalDisconnectButton) {
		terminalDisconnectButton.addEventListener("click", disconnectAgentTerminal);
	}
	if (refreshArtifactsButton) {
		refreshArtifactsButton.addEventListener("click", () => {
			setSandboxPath({ path: DEFAULT_SANDBOX_ARTIFACT_PATH });
		});
	}
	if (uploadFilesButton) {
		uploadFilesButton.addEventListener("click", () => {
			void uploadSelectedAgentFiles();
		});
	}
	if (fsRootButton) {
		fsRootButton.addEventListener("click", () => {
			setSandboxPath({ path: "/" });
		});
	}
	if (fsUpButton) {
		fsUpButton.addEventListener("click", () => {
			setSandboxPath({
				path: getSandboxParentPath({ path: currentSandboxPath }),
			});
		});
	}
}

const AgentChatAPI = {
	buildLiveCodexStatus,
	buildAgentArtifactDownloadPath,
	buildAgentArtifactDownloadRequest,
	buildAgentSessionFilesystemDownloadPath,
	buildAgentSessionFileDownloadPath,
	buildAgentSessionArtifactDownloadPath,
	buildAgentRequest,
	buildCodexChatPrompt,
	buildCodexCommand,
	buildTerminalPromptCommand,
	buildStandalonePreviewHtml,
	CODEX_AGENT_COMMAND,
	CODEX_TERMINAL_COMMAND,
	clearStoredAgentSessionId,
	canPreviewArtifact,
	createAgentJob,
	createAgentPtyToken,
	createAgentSession,
	downloadAgentArtifact,
	endAgentSession,
	ensureAgentSession,
	findCodexLastMessageArtifact,
	formatArtifactSize,
	formatPreviewText,
	formatUploadProgress,
	formatUploadSelectionStatus,
	getArtifactFilename,
	getArtifactCopyPath,
	getArtifactPreviewKind,
	getAgentArtifactText,
	getAgentJobDetail,
	getAgentSessionArtifacts,
	getAgentSessionFiles,
	loadAgentArtifactPreview,
	openAgentArtifactPreviewInNewTab,
	getLatestCodexAgentMessage,
	getSandboxParentPath,
	initUppyUploader,
	isTerminalStatus,
	normalizeSandboxPath,
	extractUppyUploadFiles,
	readStoredAgentSessionId,
	saveStoredAgentSessionId,
	uploadAgentSessionFiles,
};

if (typeof module !== "undefined" && module.exports) {
	module.exports = AgentChatAPI;
}

if (
	typeof window !== "undefined" &&
	typeof window.addEventListener === "function"
) {
	window.AgentChatAPI = AgentChatAPI;
	if (document.readyState === "loading") {
		window.addEventListener("DOMContentLoaded", initAgentChatPage);
	} else {
		initAgentChatPage();
	}
}
