import { createConnector } from 'wagmi';

export function tronLink() {
    return createConnector((_config) => ({
        id: 'tronLink',
        name: 'TronLink',
        type: 'injected',
        async connect({ chainId: _chainId } = {}) {
            const provider = (window as any).tronLink;
            if (!provider) throw new Error('TronLink not found');

            const res = await provider.request({ method: 'tron_requestAccounts' });
            if (res.code !== 200) throw new Error('User rejected connection');

            const tronWeb = (window as any).tronWeb;
            const base58Address = tronWeb.defaultAddress.base58;

            // Wagmi/Viem strictly requires 0xPrefix 20-byte addresses.
            // Tron addresses are 21 bytes (starting with 0x41).
            // We convert to Hex and use a "fake" 0x mapping for Wagmi compatibility.
            // We'll convert it back to Base58 in the SwapWidget.
            const hexAddress = tronWeb.address.toHex(base58Address).replace(/^41/, '0x');

            return {
                accounts: [hexAddress as `0x${string}`],
                chainId: 728126428,
            } as any;
        },
        async disconnect() {
            // TronLink doesn't have a formal disconnect for dApps usually, 
            // but we can clear local state.
        },
        async getAccounts() {
            const tronWeb = (window as any).tronWeb;
            if (!tronWeb || !tronWeb.defaultAddress.base58) return [];
            const hexAddress = tronWeb.address.toHex(tronWeb.defaultAddress.base58).replace(/^41/, '0x');
            return [hexAddress as `0x${string}`];
        },
        async getChainId() {
            return 728126428;
        },
        async getProvider() {
            return (window as any).tronLink;
        },
        async isAuthorized() {
            const tronWeb = (window as any).tronWeb;
            return !!(tronWeb && tronWeb.defaultAddress.base58);
        },
        onAccountsChanged(_accounts) {
            // Implementation for account changes
        },
        onChainChanged(_chainId) {
            // Implementation for chain changes
        },
        onDisconnect(_error) {
            // Implementation for disconnect
        },
    }));
}
