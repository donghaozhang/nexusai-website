// QCut payment API helpers for static website pages.

const PLAN = {
	FREE: "free",
	PRO: "pro",
	TEAM: "team",
};

const BILLING_INTERVAL = {
	MONTHLY: "month",
	YEARLY: "year",
};

const TOP_UP_PACK = {
	STARTER: "starter",
	STANDARD: "standard",
	PRO: "pro",
	MEGA: "mega",
};

const STORAGE_KEY = {
	AUTH_TOKEN: "qcut.authToken",
	API_BASE_URL: "qcut.paymentApiBaseUrl",
};

const DEFAULT_LICENSE_SERVER_URL =
	"https://qcut-license-server.zdhpeter.workers.dev";

function getRuntimeGlobal() {
	try {
		if (typeof globalThis !== "undefined") {
			return globalThis;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function getRuntimeWindow() {
	try {
		const runtime = getRuntimeGlobal();
		const win = runtime?.window;
		if (!win) {
			return undefined;
		}
		return win;
	} catch {
		return undefined;
	}
}

function getRuntimeFetch() {
	try {
		const runtime = getRuntimeGlobal();
		if (runtime && typeof runtime.fetch === "function") {
			return runtime.fetch.bind(runtime);
		}
		return null;
	} catch {
		return null;
	}
}

function normalizeBaseUrl({ value }) {
	try {
		if (typeof value !== "string") {
			return "";
		}
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return "";
		}
		if (trimmed.endsWith("/")) {
			return trimmed.slice(0, -1);
		}
		return trimmed;
	} catch {
		return "";
	}
}

function readFromLocalStorage({ key }) {
	try {
		const win = getRuntimeWindow();
		const localStorageRef = win?.localStorage;
		if (!localStorageRef) {
			return "";
		}
		const value = localStorageRef.getItem(key);
		if (typeof value !== "string") {
			return "";
		}
		return value.trim();
	} catch {
		return "";
	}
}

function writeToLocalStorage({ key, value }) {
	try {
		const win = getRuntimeWindow();
		const localStorageRef = win?.localStorage;
		if (!localStorageRef) {
			return false;
		}
		localStorageRef.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

function removeFromLocalStorage({ key }) {
	try {
		const win = getRuntimeWindow();
		const localStorageRef = win?.localStorage;
		if (!localStorageRef) {
			return false;
		}
		localStorageRef.removeItem(key);
		return true;
	} catch {
		return false;
	}
}

function readMetaContent({ name }) {
	try {
		const win = getRuntimeWindow();
		const documentRef = win?.document;
		if (!documentRef || typeof documentRef.querySelector !== "function") {
			return "";
		}
		const metaElement = documentRef.querySelector(`meta[name="${name}"]`);
		const content =
			typeof metaElement?.getAttribute === "function"
				? metaElement.getAttribute("content")
				: "";
		if (typeof content !== "string") {
			return "";
		}
		return content.trim();
	} catch {
		return "";
	}
}

function readCookieValue({ name }) {
	try {
		const win = getRuntimeWindow();
		const documentRef = win?.document;
		if (!documentRef || typeof documentRef.cookie !== "string") {
			return "";
		}

		const cookieParts = documentRef.cookie.split(";");
		for (const cookiePart of cookieParts) {
			const trimmed = cookiePart.trim();
			if (!trimmed.startsWith(`${name}=`)) {
				continue;
			}
			const value = trimmed.slice(name.length + 1);
			return decodeURIComponent(value).trim();
		}
		return "";
	} catch {
		return "";
	}
}

function readSearchParam({ name }) {
	try {
		const win = getRuntimeWindow();
		const search = win?.location?.search;
		if (typeof search !== "string" || search.length === 0) {
			return "";
		}
		const params = new URLSearchParams(search);
		const value = params.get(name);
		if (typeof value !== "string") {
			return "";
		}
		return value.trim();
	} catch {
		return "";
	}
}

function readGlobalValue({ name }) {
	try {
		const runtime = getRuntimeGlobal();
		const value = runtime?.[name];
		if (typeof value !== "string") {
			return "";
		}
		return value.trim();
	} catch {
		return "";
	}
}

function resolveApiBaseUrl() {
	try {
		const fromGlobal = readGlobalValue({ name: "QCUT_LICENSE_SERVER_URL" });
		const fromQuery = readSearchParam({ name: "license_server" });
		const fromStorage = readFromLocalStorage({ key: STORAGE_KEY.API_BASE_URL });
		const fromMeta = readMetaContent({ name: "qcut-license-server-url" });
		const resolved =
			fromGlobal ||
			fromQuery ||
			fromStorage ||
			fromMeta ||
			DEFAULT_LICENSE_SERVER_URL;
		return normalizeBaseUrl({ value: resolved });
	} catch {
		return DEFAULT_LICENSE_SERVER_URL;
	}
}

function buildApiUrl({ path }) {
	try {
		const baseUrl = resolveApiBaseUrl();
		const normalizedPath = path.startsWith("/") ? path : `/${path}`;
		return `${baseUrl}${normalizedPath}`;
	} catch {
		return `${DEFAULT_LICENSE_SERVER_URL}${path}`;
	}
}

function createIdempotencyKey({ scope }) {
	try {
		const runtime = getRuntimeGlobal();
		const cryptoRef = runtime?.crypto;
		if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
			return `qcut-${scope}-${cryptoRef.randomUUID()}`;
		}
		const random = Math.random().toString(36).slice(2);
		return `qcut-${scope}-${Date.now()}-${random}`;
	} catch {
		return `qcut-${scope}-${Date.now()}`;
	}
}

function sanitizeErrorMessage({ error, fallback }) {
	try {
		if (error instanceof Error && error.message.trim().length > 0) {
			return error.message;
		}
		return fallback;
	} catch {
		return fallback;
	}
}

async function parsePayload({ response }) {
	try {
		const rawText = await response.text();
		if (rawText.length === 0) {
			return null;
		}
		try {
			return JSON.parse(rawText);
		} catch {
			return { message: rawText };
		}
	} catch {
		return null;
	}
}

function getErrorMessageFromPayload({ payload }) {
	try {
		if (!payload || typeof payload !== "object") {
			return "";
		}
		if (typeof payload.error === "string" && payload.error.trim().length > 0) {
			return payload.error.trim();
		}
		if (
			typeof payload.message === "string" &&
			payload.message.trim().length > 0
		) {
			return payload.message.trim();
		}
		return "";
	} catch {
		return "";
	}
}

function buildResponseError({ response, payload }) {
	try {
		const payloadMessage = getErrorMessageFromPayload({ payload });
		if (payloadMessage.length > 0) {
			if (response.status === 401) {
				return `Sign in required: ${payloadMessage}`;
			}
			return payloadMessage;
		}
		if (response.status === 401) {
			return "Sign in required. Add your auth token on this page and try again.";
		}
		if (response.status === 403) {
			return "Payment access is restricted for this account (canary guardrail).";
		}
		if (response.status === 503) {
			return "Payments are temporarily disabled. Please retry later.";
		}
		return `Request failed (${response.status})`;
	} catch {
		return "Request failed";
	}
}

function resolveAuthToken() {
	try {
		const fromGlobal = readGlobalValue({ name: "QCUT_AUTH_TOKEN" });
		if (fromGlobal.length > 0) {
			return fromGlobal;
		}

		const fromQueryToken = readSearchParam({ name: "token" });
		if (fromQueryToken.length > 0) {
			writeToLocalStorage({
				key: STORAGE_KEY.AUTH_TOKEN,
				value: fromQueryToken,
			});
			return fromQueryToken;
		}

		const fromQueryAuthToken = readSearchParam({ name: "auth_token" });
		if (fromQueryAuthToken.length > 0) {
			writeToLocalStorage({
				key: STORAGE_KEY.AUTH_TOKEN,
				value: fromQueryAuthToken,
			});
			return fromQueryAuthToken;
		}

		const fromStorage = readFromLocalStorage({ key: STORAGE_KEY.AUTH_TOKEN });
		if (fromStorage.length > 0) {
			return fromStorage;
		}

		const cookieCandidates = [
			"better-auth.session_token",
			"better-auth.session-token",
			"session_token",
			"auth_token",
		];
		for (const cookieName of cookieCandidates) {
			const cookieValue = readCookieValue({ name: cookieName });
			if (cookieValue.length === 0) {
				continue;
			}
			writeToLocalStorage({ key: STORAGE_KEY.AUTH_TOKEN, value: cookieValue });
			return cookieValue;
		}

		return "";
	} catch {
		return "";
	}
}

async function requestApi({
	path,
	method,
	body,
	requiresAuth,
	idempotencyScope,
}) {
	try {
		const fetcher = getRuntimeFetch();
		if (!fetcher) {
			throw new Error("Fetch API is unavailable in this runtime");
		}

		const headers = {
			Accept: "application/json",
		};

		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}

		if (requiresAuth) {
			const token = resolveAuthToken();
			if (token.length === 0) {
				throw new Error(
					"Sign in required. Add your auth token on this page and try again."
				);
			}
			headers.Authorization = `Bearer ${token}`;
		}

		if (
			typeof idempotencyScope === "string" &&
			idempotencyScope.length > 0 &&
			method !== "GET"
		) {
			headers["Idempotency-Key"] = createIdempotencyKey({
				scope: idempotencyScope,
			});
		}

		const response = await fetcher(buildApiUrl({ path }), {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		const payload = await parsePayload({ response });
		if (!response.ok) {
			throw new Error(buildResponseError({ response, payload }));
		}
		return payload;
	} catch (error) {
		throw new Error(
			sanitizeErrorMessage({
				error,
				fallback: "Payment request failed",
			})
		);
	}
}

const PaymentAPI = {
	PLAN,
	BILLING_INTERVAL,
	TOP_UP_PACK,

	getApiBaseUrl() {
		try {
			return resolveApiBaseUrl();
		} catch {
			return DEFAULT_LICENSE_SERVER_URL;
		}
	},

	setApiBaseUrl({ baseUrl }) {
		try {
			const normalized = normalizeBaseUrl({ value: baseUrl });
			if (normalized.length === 0) {
				return false;
			}
			return writeToLocalStorage({
				key: STORAGE_KEY.API_BASE_URL,
				value: normalized,
			});
		} catch {
			return false;
		}
	},

	getAuthToken() {
		try {
			return resolveAuthToken();
		} catch {
			return "";
		}
	},

	setAuthToken({ token }) {
		try {
			if (typeof token !== "string") {
				return false;
			}
			const normalized = token.trim();
			if (normalized.length === 0) {
				return false;
			}
			return writeToLocalStorage({
				key: STORAGE_KEY.AUTH_TOKEN,
				value: normalized,
			});
		} catch {
			return false;
		}
	},

	clearAuthToken() {
		try {
			return removeFromLocalStorage({ key: STORAGE_KEY.AUTH_TOKEN });
		} catch {
			return false;
		}
	},

	captureAuthTokenFromUrl() {
		try {
			const token =
				readSearchParam({ name: "token" }) ||
				readSearchParam({ name: "auth_token" });
			if (token.length === 0) {
				return false;
			}
			return PaymentAPI.setAuthToken({ token });
		} catch {
			return false;
		}
	},

	isAuthenticated() {
		try {
			return PaymentAPI.getAuthToken().length > 0;
		} catch {
			return false;
		}
	},

	async getPlans() {
		try {
			return {
				plans: [
					{
						id: PLAN.FREE,
						name: "Free",
						price: 0,
						interval: BILLING_INTERVAL.MONTHLY,
					},
					{
						id: PLAN.PRO,
						name: "Pro",
						price: 9.99,
						interval: BILLING_INTERVAL.MONTHLY,
						yearlyPrice: 99,
					},
					{
						id: PLAN.TEAM,
						name: "Team",
						price: 29.99,
						interval: BILLING_INTERVAL.MONTHLY,
						yearlyPrice: 299,
					},
				],
				topUpPacks: [
					{ id: TOP_UP_PACK.STARTER, credits: 50 },
					{ id: TOP_UP_PACK.STANDARD, credits: 120 },
					{ id: TOP_UP_PACK.PRO, credits: 350 },
					{ id: TOP_UP_PACK.MEGA, credits: 800 },
				],
			};
		} catch (error) {
			throw new Error(
				sanitizeErrorMessage({
					error,
					fallback: "Failed to load plans",
				})
			);
		}
	},

	async createCheckout({ planId, interval }) {
		try {
			if (planId !== PLAN.PRO && planId !== PLAN.TEAM) {
				throw new Error("Invalid plan selected");
			}
			if (
				interval !== BILLING_INTERVAL.MONTHLY &&
				interval !== BILLING_INTERVAL.YEARLY
			) {
				throw new Error("Invalid billing interval selected");
			}

			const payload = await requestApi({
				path: "/api/stripe/checkout",
				method: "POST",
				body: { plan: planId, interval },
				requiresAuth: true,
				idempotencyScope: "checkout",
			});
			if (!payload || typeof payload.url !== "string") {
				throw new Error("Checkout session URL was not returned");
			}
			return payload;
		} catch (error) {
			throw new Error(
				sanitizeErrorMessage({
					error,
					fallback: "Failed to create checkout session",
				})
			);
		}
	},

	async createTopUpCheckout({ pack }) {
		try {
			const validPacks = [
				TOP_UP_PACK.STARTER,
				TOP_UP_PACK.STANDARD,
				TOP_UP_PACK.PRO,
				TOP_UP_PACK.MEGA,
			];
			if (!validPacks.includes(pack)) {
				throw new Error("Invalid top-up pack selected");
			}

			const payload = await requestApi({
				path: "/api/stripe/topup",
				method: "POST",
				body: { pack },
				requiresAuth: true,
				idempotencyScope: "topup",
			});
			if (!payload || typeof payload.url !== "string") {
				throw new Error("Top-up checkout URL was not returned");
			}
			return payload;
		} catch (error) {
			throw new Error(
				sanitizeErrorMessage({
					error,
					fallback: "Failed to create top-up checkout session",
				})
			);
		}
	},

	async createPortalSession() {
		try {
			const payload = await requestApi({
				path: "/api/stripe/portal",
				method: "POST",
				requiresAuth: true,
				idempotencyScope: "portal",
			});
			if (!payload || typeof payload.url !== "string") {
				throw new Error("Billing portal URL was not returned");
			}
			return payload;
		} catch (error) {
			throw new Error(
				sanitizeErrorMessage({
					error,
					fallback: "Failed to create billing portal session",
				})
			);
		}
	},

	async getLicense() {
		try {
			const payload = await requestApi({
				path: "/api/license",
				method: "GET",
				requiresAuth: true,
			});
			if (!payload || typeof payload !== "object") {
				throw new Error("License payload is invalid");
			}
			return payload;
		} catch (error) {
			throw new Error(
				sanitizeErrorMessage({
					error,
					fallback: "Failed to load license",
				})
			);
		}
	},

	async getUsage() {
		try {
			const payload = await requestApi({
				path: "/api/usage",
				method: "GET",
				requiresAuth: true,
			});
			if (!payload || typeof payload !== "object") {
				throw new Error("Usage payload is invalid");
			}
			return payload;
		} catch (error) {
			throw new Error(
				sanitizeErrorMessage({
					error,
					fallback: "Failed to load usage",
				})
			);
		}
	},
};

try {
	PaymentAPI.captureAuthTokenFromUrl();
} catch {
	// Non-fatal in environments without location/search support.
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = PaymentAPI;
}

if (typeof window !== "undefined") {
	window.PaymentAPI = PaymentAPI;
}
