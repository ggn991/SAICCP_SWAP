import { WagmiProvider, createConfig, http } from "wagmi";
import type { Chain } from "viem";
import { mainnet, bsc, arbitrum, polygon, avalanche, base, optimism, scroll, blast, linea, fantom, moonbeam, gnosis } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig } from "connectkit";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { WalletProvider } from "@tronweb3/tronwallet-adapter-react-hooks";
import { TronLinkAdapter } from "@tronweb3/tronwallet-adapter-tronlink";
import { WalletModalProvider } from "@tronweb3/tronwallet-adapter-react-ui";
import "@tronweb3/tronwallet-adapter-react-ui/style.css";
import { tronLink } from "../utils/tronConnector";
import { createContext, useContext, useState } from "react";

interface ChainContextType {
    targetChainId: number | undefined;
    setTargetChainId: (id: number | undefined) => void;
}

const ChainContext = createContext<ChainContextType | undefined>(undefined);

export function useTargetChain() {
    const context = useContext(ChainContext);
    if (!context) throw new Error("useTargetChain must be used within a Web3Provider");
    return context;
}

const tron = {
    id: 728126428,
    name: 'Tron',
    nativeCurrency: { name: 'TRX', symbol: 'TRX', decimals: 6 },
    rpcUrls: {
        default: { http: ['https://api.trongrid.io'] },
    },
    blockExplorers: {
        default: { name: 'Tronscan', url: 'https://tronscan.org' },
    },
} as const satisfies Chain;

const queryClient = new QueryClient();

const alchemyId = import.meta.env.VITE_ALCHEMY_API_KEY;

const configParameters = getDefaultConfig({
    // Enable most common chains
    chains: [bsc, mainnet, arbitrum, polygon, avalanche, base, optimism, scroll, blast, linea, fantom, moonbeam, gnosis, tron],
    transports: {
        [mainnet.id]: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyId}`),
        [bsc.id]: http(),
        [arbitrum.id]: http(`https://arb-mainnet.g.alchemy.com/v2/${alchemyId}`),
        [polygon.id]: http(`https://polygon-mainnet.g.alchemy.com/v2/${alchemyId}`),
        [avalanche.id]: http(),
        [base.id]: http(`https://base-mainnet.g.alchemy.com/v2/${alchemyId}`),
        [optimism.id]: http(`https://opt-mainnet.g.alchemy.com/v2/${alchemyId}`),
        [tron.id]: http(),
    },

    walletConnectProjectId: "", // We can leave this empty if not using WalletConnect specifically or provide a fallback

    // Required App Info
    appName: "M5Dex Swap",

    // Optional App Info
    appDescription: "M5Dex Premium Swap Interface",
    appUrl: "https://m5dex.io", // updated URL
    appIcon: "https://avatars.githubusercontent.com/u/179229932", // your app's icon
});

export const config = createConfig({
    ...configParameters,
    connectors: [
        ...(configParameters.connectors as any ?? []),
        tronLink(),
    ],
});

interface Web3ProviderProps {
    children: ReactNode;
}

export function Web3Provider({ children }: Web3ProviderProps) {
    const adapters = useMemo(() => [new TronLinkAdapter()], []);
    const [targetChainId, setTargetChainId] = useState<number | undefined>();

    return (
        <ChainContext.Provider value={{ targetChainId, setTargetChainId }}>
            <WagmiProvider config={config}>
                <QueryClientProvider client={queryClient}>
                    <ConnectKitProvider mode="dark" options={{ initialChainId: targetChainId }}>
                        <WalletProvider adapters={adapters} autoConnect={false}>
                            <WalletModalProvider>
                                {children}
                            </WalletModalProvider>
                        </WalletProvider>
                    </ConnectKitProvider>
                </QueryClientProvider>
            </WagmiProvider>
        </ChainContext.Provider>
    );
}
