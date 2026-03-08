const test = require("node:test");
const assert = require("node:assert/strict");

function createLocalStorageMock() {
	const store = new Map();
	return {
		getItem(key) {
			return store.has(key) ? store.get(key) : null;
		},
		setItem(key, value) {
			store.set(key, String(value));
		},
		removeItem(key) {
			store.delete(key);
		},
		clear() {
			store.clear();
		},
	};
}

function createResponse({ status, payload }) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async text() {
			if (typeof payload === "string") {
				return payload;
			}
			return JSON.stringify(payload);
		},
	};
}

function setupRuntime({ fetchImpl, search }) {
	const localStorage = createLocalStorageMock();
	global.window = {
		location: { search: search || "" },
		localStorage,
		document: {
			cookie: "",
			querySelector() {
				return null;
			},
		},
	};
	global.fetch = fetchImpl;
	return { localStorage };
}

function loadPaymentApi() {
	const modulePath = "./payment.js";
	delete require.cache[require.resolve(modulePath)];
	return require(modulePath);
}

test.afterEach(() => {
	delete global.window;
	delete global.fetch;
});

test("setAuthToken/getAuthToken/clearAuthToken flow", async () => {
	setupRuntime({
		search: "",
		fetchImpl: async () => createResponse({ status: 200, payload: {} }),
	});
	const PaymentAPI = loadPaymentApi();

	assert.equal(PaymentAPI.setAuthToken({ token: "token-abc" }), true);
	assert.equal(PaymentAPI.getAuthToken(), "token-abc");
	assert.equal(PaymentAPI.isAuthenticated(), true);
	assert.equal(PaymentAPI.clearAuthToken(), true);
	assert.equal(PaymentAPI.getAuthToken(), "");
});

test("createCheckout posts to /api/stripe/checkout with auth + idempotency key", async () => {
	let requestUrl = "";
	let requestInit = null;
	setupRuntime({
		search: "?auth_token=query-auth-token",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return createResponse({
				status: 200,
				payload: { url: "https://checkout.stripe.com/session_123" },
			});
		},
	});
	const PaymentAPI = loadPaymentApi();

	const session = await PaymentAPI.createCheckout({
		planId: PaymentAPI.PLAN.PRO,
		interval: PaymentAPI.BILLING_INTERVAL.MONTHLY,
	});

	assert.equal(session.url, "https://checkout.stripe.com/session_123");
	assert.match(requestUrl, /\/api\/stripe\/checkout$/);
	assert.equal(requestInit.method, "POST");
	assert.equal(requestInit.headers.Authorization, "Bearer query-auth-token");
	assert.ok(
		requestInit.headers["Idempotency-Key"].startsWith("qcut-checkout-")
	);
	assert.equal(
		requestInit.body,
		JSON.stringify({
			plan: PaymentAPI.PLAN.PRO,
			interval: PaymentAPI.BILLING_INTERVAL.MONTHLY,
		})
	);
});

test("createTopUpCheckout posts to /api/stripe/topup", async () => {
	let requestUrl = "";
	let requestInit = null;
	setupRuntime({
		search: "",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return createResponse({
				status: 200,
				payload: { url: "https://checkout.stripe.com/topup_123" },
			});
		},
	});
	const PaymentAPI = loadPaymentApi();
	PaymentAPI.setAuthToken({ token: "topup-token" });

	const session = await PaymentAPI.createTopUpCheckout({
		pack: PaymentAPI.TOP_UP_PACK.STANDARD,
	});

	assert.equal(session.url, "https://checkout.stripe.com/topup_123");
	assert.match(requestUrl, /\/api\/stripe\/topup$/);
	assert.equal(requestInit.method, "POST");
	assert.equal(requestInit.headers.Authorization, "Bearer topup-token");
	assert.equal(
		requestInit.body,
		JSON.stringify({ pack: PaymentAPI.TOP_UP_PACK.STANDARD })
	);
});

test("createCheckout surfaces 401 as sign-in error", async () => {
	setupRuntime({
		search: "",
		fetchImpl: async () =>
			createResponse({ status: 401, payload: { error: "Invalid token" } }),
	});
	const PaymentAPI = loadPaymentApi();
	PaymentAPI.setAuthToken({ token: "bad-token" });

	await assert.rejects(
		PaymentAPI.createCheckout({
			planId: PaymentAPI.PLAN.PRO,
			interval: PaymentAPI.BILLING_INTERVAL.MONTHLY,
		}),
		/error:|Sign in required|Invalid token/i
	);
});
