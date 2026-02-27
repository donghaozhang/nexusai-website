// QCut Payment API helpers
// Backend not yet available - all functions return mock data

const PAYMENT_API = ''; // TODO: Set when license server is deployed

const PaymentAPI = {
    async getPlans() {
        return [
            { id: 'free', name: 'Free', price: 0, interval: 'month' },
            { id: 'pro', name: 'Pro', price: 9.99, interval: 'month', yearlyPrice: 99 },
            { id: 'team', name: 'Team', price: 29.99, interval: 'month', yearlyPrice: 299 },
        ];
    },
    async createCheckout(planId, interval) {
        console.warn('Payment backend not available yet');
        return null;
    },
    async getLicense() {
        return { plan: 'free', status: 'active', aiGenerationsUsed: 2, aiGenerationsLimit: 5 };
    },
    async getUsage() {
        return { ai_generation: 2, export: 5, render: 3 };
    },
};

if (typeof module !== 'undefined') module.exports = PaymentAPI;
