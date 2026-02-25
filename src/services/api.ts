import axios from 'axios';

const API_KEY = import.meta.env.VITE_SWAPKIT_API_KEY;
const BASE_URL = 'https://api.swapkit.dev';

export const apiClient = axios.create({
    baseURL: BASE_URL,
    headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
    },
});

export interface Token {
    identifier: string;
    chain: string;
    ticker: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI?: string;
    address?: string;
    coingeckoId?: string;
}

const COMMON_CG_IDS: Record<string, string> = {
    'USDT': 'tether',
    'USDC': 'usd-coin',
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'BNB': 'binancecoin',
    'SOL': 'solana',
    'AVAX': 'avalanche-2',
    'MATIC': 'matic-network',
    'POL': 'matic-network',
    'TRX': 'tron',
    'ARB': 'arbitrum',
    'OP': 'optimism',
    'WBTC': 'wrapped-bitcoin',
    'WETH': 'weth',
    'DAI': 'dai',
    'LINK': 'chainlink',
    'UNI': 'uniswap',
};

export const resolveCoinGeckoId = (token: Token): string | undefined => {
    if (token.coingeckoId) return token.coingeckoId;
    const symbol = (token.ticker || token.symbol)?.toUpperCase();
    if (symbol && COMMON_CG_IDS[symbol]) return COMMON_CG_IDS[symbol];
    if (token.identifier?.includes('USDT')) return 'tether';
    if (token.identifier?.includes('USDC')) return 'usd-coin';
    return undefined;
};

const priceCache: Record<string, { price: number; timestamp: number }> = {};
const pendingRequests: Record<string, Promise<number | null>> = {};
const CACHE_TTL = 60000; // 1 minute

export const getTokenPriceUSD = async (coingeckoId: string): Promise<number | null> => {
    const now = Date.now();
    if (priceCache[coingeckoId] && now - priceCache[coingeckoId].timestamp < CACHE_TTL) {
        return priceCache[coingeckoId].price;
    }
    if (pendingRequests[coingeckoId] !== undefined) {
        return pendingRequests[coingeckoId];
    }

    const req = (async () => {
        try {
            const { data } = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`);
            const price = data[coingeckoId]?.usd;
            if (price) {
                priceCache[coingeckoId] = { price, timestamp: Date.now() };
                return price;
            }
            return null;
        } catch {
            return null;
        } finally {
            delete pendingRequests[coingeckoId];
        }
    })();

    pendingRequests[coingeckoId] = req;
    return req;
};

export const getTokens = async (): Promise<Token[]> => {
    const { data } = await apiClient.get('/tokens');
    return data;
};

// Returns quote details
export const getQuote = async (sellAsset: string, buyAsset: string, sellAmount: string, senderAddress?: string, recipientAddress?: string, slippage: number = 3) => {
    const payload: any = {
        sellAsset,
        buyAsset,
        sellAmount,
        slippage,
    };

    if (senderAddress) payload.sourceAddress = senderAddress;
    if (recipientAddress) payload.destinationAddress = recipientAddress;

    const { data } = await apiClient.post('/v3/quote', payload);
    return data;
};

export const buildSwapTransaction = async (routeId: string, sourceAddress: string, destinationAddress: string) => {
    const { data } = await apiClient.post('/v3/swap', {
        routeId,
        sourceAddress,
        destinationAddress,
        disableBalanceCheck: true,
    });
    return data;
};
