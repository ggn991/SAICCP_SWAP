import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ArrowDownUp, Loader2 } from 'lucide-react';
import { getTokens, getQuote, buildSwapTransaction, getTokenPriceUSD, resolveCoinGeckoId } from '../services/api';
import type { Token } from '../services/api';
import { useAccount, useSendTransaction, useSwitchChain, useBalance } from 'wagmi';
import { useWallet } from '@tronweb3/tronwallet-adapter-react-hooks';
import { useModal } from 'connectkit';
import { useTargetChain } from './Web3Provider';

export default function SwapWidget() {
    const { address: evmAddress, connector, chainId: currentChainId } = useAccount();
    const { address: tronAddress, signTransaction } = useWallet();
    const { sendTransactionAsync } = useSendTransaction();
    const { switchChainAsync } = useSwitchChain();
    const { setOpen: openConnectKit } = useModal();

    const EVM_CHAINS = ['ETH', 'BSC', 'ARB', 'OP', 'BASE', 'POL', 'AVAX', 'SCROLL', 'BLAST', 'LINEA', 'FANTOM', 'MOONBEAM', 'GNOSIS', 'GNO', 'ZKSYNC', 'POLYGON_ZKEVM'];
    const isEVM = (chain?: string) => EVM_CHAINS.includes(chain?.toUpperCase() || '');

    // Helpers
    const getWagmiChainId = (chain?: string) => {
        const uChain = chain?.toUpperCase();
        const chainMap: Record<string, number> = {
            'ETH': 1, 'BSC': 56, 'ARB': 42161, 'OP': 10, 'BASE': 8453,
            'POL': 137, 'AVAX': 43114, 'SCROLL': 534352, 'BLAST': 81457,
            'LINEA': 59144, 'FANTOM': 250, 'MOONBEAM': 1284, 'GNOSIS': 100, 'GNO': 100,
            'ZKSYNC': 324, 'POLYGON_ZKEVM': 1101
        };
        return chainMap[uChain || ''] || undefined;
    };

    // State
    const [multiChainAddresses, setMultiChainAddresses] = useState<Record<string, string>>({});
    const [isConnectingFlow, setIsConnectingFlow] = useState(false);

    // We no longer silently fetch ANY addresses on load. 
    // The user ONLY wants addresses to be fetched when they explicitly click "Connect Wallet".

    const getAddressForChain = (chain?: string) => {
        const uChain = chain?.toUpperCase();
        if (!uChain) return '';

        // 1. EVM chains use wagmi
        if (isEVM(uChain)) {
            if (connector?.id === 'tronLink') return ''; // Safety check if TronLink adapter leaked into EVM
            return evmAddress || '';
        }

        // 2. Tron uses multiChain state to ensure explicit connection flow if not tracked
        if (uChain === 'TRON') {
            return multiChainAddresses['TRON'] || '';
        }

        // 3. All other chains (BTC, DOGE, SOL, etc.) use multiChain state
        return multiChainAddresses[uChain] || '';
    };

    const getTokenSymbol = (t: Token | null) => {
        if (!t) return 'Select';
        if (t.identifier) {
            const parts = t.identifier.split('.');
            if (parts.length > 1) return parts[1].split('-')[0];
        }
        return t.symbol || t.name || 'Unknown';
    };

    // State
    const [tokens, setTokens] = useState<Token[]>([]);
    const [fromToken, setFromToken] = useState<Token | null>(null);
    const [toToken, setToToken] = useState<Token | null>(null);
    const [fromBalance, setFromBalance] = useState<string>('0');
    const [toBalance, setToBalance] = useState<string>('0');
    const [sellAmount, setSellAmount] = useState('');
    const [fromTokenPrice, setFromTokenPrice] = useState<number | null>(null);
    const [toTokenPrice, setToTokenPrice] = useState<number | null>(null);
    const [quote, setQuote] = useState<any>(null);
    const [loadingQuote, setLoadingQuote] = useState(false);
    const [quoteTimer, setQuoteTimer] = useState(0);
    const [isSwapping, setIsSwapping] = useState(false);
    const [swapResult, setSwapResult] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);

    const truncateAddress = (addr: string) => {
        if (!addr) return '';
        if (addr.length <= 10) return addr;
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    };

    const [modalOpen, setModalOpen] = useState<'from' | 'to' | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedChain, setSelectedChain] = useState<string>('');
    const [loadingTokens, setLoadingTokens] = useState(true);

    // Balance Hooks (EVM)
    const evmFromBal = useBalance({
        address: (fromToken?.chain !== 'TRON' ? getAddressForChain(fromToken?.chain) : undefined) as `0x${string}`,
        token: (fromToken?.address?.startsWith('0x') ? fromToken.address : undefined) as `0x${string}`,
        chainId: getWagmiChainId(fromToken?.chain),
    });
    const evmToBal = useBalance({
        address: (toToken?.chain !== 'TRON' ? getAddressForChain(toToken?.chain) : undefined) as `0x${string}`,
        token: (toToken?.address?.startsWith('0x') ? toToken.address : undefined) as `0x${string}`,
        chainId: getWagmiChainId(toToken?.chain),
    });

    useEffect(() => {
        const fetchTokens = async () => {
            try {
                const data = await getTokens();
                let tokenList: Token[] = [];
                // The API actually returns an array of objects where each object is a Provider
                // e.g. [{"provider": "ONEINCH", "tokens": [...]}]
                if (data && Array.isArray(data)) {
                    const allTokens: Token[] = [];

                    data.forEach((providerObj: any) => {
                        if (providerObj && Array.isArray(providerObj.tokens)) {
                            allTokens.push(...providerObj.tokens);
                        }
                    });

                    // Deduplicate by string identifier ONLY (so 'From' side has all variants)
                    const uniqueMap = new Map<string, Token>();

                    allTokens.forEach(t => {
                        if (t && t.identifier && !uniqueMap.has(t.identifier)) {
                            // Ensure address is present for EVM tokens if encoded in identifier
                            if (!t.address && t.identifier.includes('-0x')) {
                                t.address = t.identifier.split('-')[1];
                            }
                            uniqueMap.set(t.identifier, t);
                        }
                    });

                    tokenList = Array.from(uniqueMap.values());
                }

                setTokens(tokenList);

                // Default selection
                const defaultFrom = tokenList.find((t: Token) =>
                    t.chain === 'TRON' && (t.symbol?.includes('USDT') || t.ticker?.includes('USDT') || t.identifier?.includes('USDT'))
                );
                if (defaultFrom) setFromToken(defaultFrom);

                const bscUsdt = tokenList.find((t: Token) => t.identifier === 'BSC.USDT' || t.identifier === 'BSC.USDT-0x55d398326f99059fF775485246999027B3197955');
                if (bscUsdt) setToToken(bscUsdt);
            } catch (err) {
                console.error('Failed to fetch tokens', err);
                setError('Failed to load tokens.');
            } finally {
                setLoadingTokens(false);
            }
        };
        fetchTokens();
    }, []);

    useEffect(() => {
        setError(null);
        setSwapResult(null);
        setFromBalance('0');
        setQuote(null);
    }, [fromToken]);

    useEffect(() => {
        setError(null);
        setSwapResult(null);
        setToBalance('0');
        setQuote(null);
    }, [toToken]);

    useEffect(() => {
        if (sellAmount && Number(sellAmount) > 0 && fromToken && toToken) {
            setSwapResult(null);
            setError(null);
            const fetchQuote = async () => {
                setLoadingQuote(true);
                setError(null);
                try {
                    const data = await getQuote(fromToken.identifier, toToken.identifier, sellAmount);
                    if (!data || !data.routes || data.routes.length === 0) {
                        throw new Error('No routes available for this swap pair.');
                    }
                    setQuote(data);
                    setQuoteTimer(60);
                } catch (err: any) {
                    console.error(err);
                    setError(err?.response?.data?.message || err?.message || 'Failed to fetch quote');
                    setQuote(null);
                    setQuoteTimer(0);
                } finally {
                    setLoadingQuote(false);
                }
            };

            const timeoutId = setTimeout(fetchQuote, 500); // debounce
            return () => clearTimeout(timeoutId);
        } else {
            setQuote(null);
            setQuoteTimer(0);
        }
    }, [sellAmount, fromToken, toToken]);

    // Timer countdown and refresh
    useEffect(() => {
        let interval: any;
        if (quote && quoteTimer > 0) {
            interval = setInterval(() => {
                setQuoteTimer((prev) => prev - 1);
            }, 1000);
        } else if (quoteTimer === 0 && quote && !loadingQuote && !error) {
            const reFetchQuote = async () => {
                setLoadingQuote(true);
                setError(null);
                try {
                    const data = await getQuote(fromToken!.identifier, toToken!.identifier, sellAmount);
                    if (!data || !data.routes || data.routes.length === 0) {
                        throw new Error('No routes available for this swap pair.');
                    }
                    setQuote(data);
                    setQuoteTimer(60);
                } catch (err: any) {
                    console.error(err);
                    setError(err?.response?.data?.message || err?.message || 'Failed to re-fetch quote');
                    setQuote(null);
                } finally {
                    setLoadingQuote(false);
                }
            };
            reFetchQuote();
        }
        return () => clearInterval(interval);
    }, [quoteTimer, quote, loadingQuote, error, fromToken, toToken, sellAmount]);

    useEffect(() => {
        const id = fromToken ? resolveCoinGeckoId(fromToken) : undefined;
        if (id) {
            getTokenPriceUSD(id).then(setFromTokenPrice);
        } else {
            setFromTokenPrice(null);
        }
    }, [fromToken]);

    useEffect(() => {
        const id = toToken ? resolveCoinGeckoId(toToken) : undefined;
        if (id) {
            getTokenPriceUSD(id).then(setToTokenPrice);
        } else {
            setToTokenPrice(null);
        }
    }, [toToken]);

    useEffect(() => {
        if (fromToken?.chain !== 'TRON') {
            if (evmFromBal.data && !evmFromBal.isLoading) {
                setFromBalance(evmFromBal.data.formatted);
            } else if (!evmAddress || evmFromBal.error) {
                setFromBalance('0');
            }
        }
    }, [evmFromBal.data, evmFromBal.isLoading, evmFromBal.error, fromToken, evmAddress]);

    useEffect(() => {
        if (toToken?.chain !== 'TRON') {
            if (evmToBal.data && !evmToBal.isLoading) {
                setToBalance(evmToBal.data.formatted);
            } else if (!evmAddress || evmToBal.error) {
                setToBalance('0');
            }
        }
    }, [evmToBal.data, evmToBal.isLoading, evmToBal.error, toToken, evmAddress]);

    useEffect(() => {
        const fetchTronBalance = async (token: Token | null, setBal: (val: string) => void) => {
            if (token?.chain !== 'TRON') return;
            const address = getAddressForChain('TRON');
            // Strict check for Base58 to prevent weird contract queries
            if (!address || !address.startsWith('T')) { setBal('0'); return; }
            try {
                const tronWeb = (window as any).tronWeb;
                if (!tronWeb) return;
                const tokenAddr = token.identifier.split('-')[1];
                if (tokenAddr) {
                    const contract = await tronWeb.contract().at(tokenAddr);
                    const balance = await contract.balanceOf(address).call();
                    const decimals = await contract.decimals().call();
                    setBal((Number(balance) / Math.pow(10, decimals)).toString());
                } else {
                    const balance = await tronWeb.trx.getBalance(address);
                    setBal((Number(balance) / 1000000).toString());
                }
            } catch (err) { console.error('Tron balance failed', err); setBal('0'); }
        };
        fetchTronBalance(fromToken, setFromBalance);
        fetchTronBalance(toToken, setToBalance);
    }, [fromToken, toToken, multiChainAddresses['TRON'], tronAddress]);


    // Cleanup state on wallet disconnect
    useEffect(() => {
        if (!evmAddress) {
            setFromBalance(prev => fromToken?.chain !== 'TRON' ? '0' : prev);
            setToBalance(prev => toToken?.chain !== 'TRON' ? '0' : prev);
        }
        if (!tronAddress) {
            setFromBalance(prev => fromToken?.chain === 'TRON' ? '0' : prev);
            setToBalance(prev => toToken?.chain === 'TRON' ? '0' : prev);

            // Clear TRON from multi-chain addresses if it was manually added
            setMultiChainAddresses(prev => {
                if (!prev['TRON']) return prev;
                const next = { ...prev };
                delete next['TRON'];
                return next;
            });
        }

        // If everything is disconnected, reset all multi-chain addresses
        if (!evmAddress && !tronAddress) {
            setMultiChainAddresses({});
        }
    }, [evmAddress, tronAddress, fromToken?.chain, toToken?.chain]);

    // Explicit function to connect a specific chain wallet (triggered by button)
    const connectCrossChainWallet = async (chainName: string) => {
        const uChain = chainName.toUpperCase();
        const win = window as any;

        try {
            let newAddress = '';

            // Determine user's preferred wallet from Wagmi if they already connected EVM
            const cName = connector?.name?.toLowerCase() || '';
            const cId = connector?.id?.toLowerCase() || '';

            const isCtrl = cName.includes('ctrl') || cName.includes('xdefi') || cId.includes('xdefi');
            const isPhantom = cName.includes('phantom') || cId.includes('phantom');
            const isVultisig = cName.includes('vultisig') || cId.includes('vultisig');

            if (uChain === 'TRON') {
                if (!win.tronWeb && !win.xfi?.tron && !win.vultisig?.tron && !win.tronLink) {
                    throw new Error('Tron wallet extension not found. Please install a compatible wallet.');
                }

                // Force an explicit request to trigger the popup
                try {
                    if (win.tronLink?.request) {
                        await win.tronLink.request({ method: 'tron_requestAccounts' });
                        if (win.tronWeb?.defaultAddress?.base58) newAddress = win.tronWeb.defaultAddress.base58;
                    } else if (isCtrl && win.xfi?.tron) {
                        const res = await win.xfi.tron.request({ method: 'request_accounts', params: [] });
                        if (res?.[0]) newAddress = res[0];
                    } else if (isVultisig && win.vultisig?.tron) {
                        const res = await win.vultisig.tron.request({ method: 'tron_requestAccounts' });
                        if (res?.[0]) newAddress = res[0];
                    } else if (win.tronWeb) {
                        // Background sync if extension is already unlocked but site not connected
                        newAddress = win.tronWeb.defaultAddress?.base58 || '';
                    }
                } catch (trErr) {
                    console.error('TRON connection failed:', trErr);
                    throw new Error('Failed to connect TRON wallet. Please ensure it is unlocked.');
                }

                if (!newAddress) throw new Error('TRON is not enabled in the wallet, please enable.');
            } else if (uChain === 'SOL') {
                if (!win.phantom?.solana && !win.xfi?.solana && !win.vultisig?.solana) {
                    throw new Error('Solana wallet extension not found. Please install a compatible wallet.');
                }

                try {
                    if (isPhantom && win.phantom?.solana) {
                        const resp = await win.phantom.solana.connect();
                        newAddress = resp.publicKey.toString();
                    } else if (isCtrl && win.xfi?.solana) {
                        const res = await win.xfi.solana.connect();
                        if (res?.publicKey) newAddress = res.publicKey.toString();
                        else if (res?.[0]) newAddress = res[0];
                    } else if (isVultisig && win.vultisig?.solana) {
                        const res = await win.vultisig.solana.connect();
                        if (res?.publicKey) newAddress = res.publicKey.toString();
                    } else {
                        // Final fallback for SOL
                        const provider = win.phantom?.solana || win.xfi?.solana || win.vultisig?.solana;
                        const resp = await provider.connect();
                        newAddress = resp.publicKey?.toString() || resp[0];
                    }
                } catch (solErr) {
                    console.error('SOL connection failed:', solErr);
                    throw new Error('Failed to connect SOL wallet. Please ensure it is unlocked.');
                }

                if (!newAddress) throw new Error('Solana is not enabled in the wallet, please enable.');
            }
            else if (['BTC', 'DOGE', 'LTC', 'BCH', 'THOR', 'MAYA', 'KUJI', 'DASH', 'GAIA', 'NEAR', 'DOT'].includes(uChain)) {
                let chainKey = uChain.toLowerCase();
                if (uChain === 'GAIA') chainKey = 'cosmos';
                if (uChain === 'BCH') chainKey = 'bitcoincash';
                if (uChain === 'THOR') chainKey = 'thorchain';
                if (uChain === 'MAYA') chainKey = 'mayachain';

                if (!win.xfi?.[chainKey] && !win.vultisig?.[chainKey]) {
                    throw new Error(`${uChain} wallet extension not found. Please ensure it is supported or enabled in your wallet.`);
                }
                let provider = (isCtrl && win.xfi?.[chainKey]) ? win.xfi[chainKey] :
                    (isVultisig && win.vultisig?.[chainKey]) ? win.vultisig[chainKey] : null;

                if (provider) {
                    const res = await provider.request({ method: 'request_accounts', params: [] });
                    if (res?.[0]) newAddress = res[0];
                } else if (isCtrl || isVultisig) {
                    const parent = isCtrl ? (win.xfi?.ethereum || win.xfi?.bitcoin || Object.values(win.xfi).find((p: any) => p.request)) :
                        (win.vultisig?.ethereum || win.vultisig?.bitcoin || Object.values(win.vultisig).find((p: any) => p.request));

                    if (parent?.request) {
                        try {
                            const res = await parent.request({
                                method: 'request_accounts',
                                params: [{ chain: chainKey }]
                            });
                            if (res?.[0]) newAddress = res[0];
                            else if (Array.isArray(res) && res.length > 0) newAddress = res[0];
                        } catch (fallbackErr) {
                            console.error(`Fallback connection for ${chainName} failed:`, fallbackErr);
                            throw new Error(`Please ensure ${chainName} is enabled in your wallet and try again.`);
                        }
                    } else {
                        throw new Error(`${chainName} is not enabled in the wallet, please enable.`);
                    }
                } else {
                    if (!isVultisig && !isCtrl && win.xfi?.[chainKey]) {
                        const res = await win.xfi[chainKey].request({ method: 'request_accounts', params: [] });
                        if (res?.[0]) newAddress = res[0];
                    }

                    if (!newAddress) throw new Error(`${chainName} is not enabled in the wallet, please enable.`);
                }
            } else {
                if (isCtrl || isVultisig) {
                    const parent = isCtrl ? (win.xfi?.ethereum || win.xfi?.bitcoin || Object.values(win.xfi || {}).find((p: any) => p.request)) :
                        (win.vultisig?.ethereum || win.vultisig?.bitcoin || Object.values(win.vultisig || {}).find((p: any) => p.request));

                    if (parent?.request) {
                        try {
                            const res = await parent.request({
                                method: 'request_accounts',
                                params: [{ chain: chainName.toLowerCase() }]
                            });
                            if (res?.[0]) newAddress = res[0];
                            else if (Array.isArray(res) && res.length > 0) newAddress = res[0];
                        } catch (fallbackErr) {
                            console.error(`Generic fallback connection for ${chainName} failed:`, fallbackErr);
                        }
                    }
                }

                if (!newAddress) {
                    throw new Error(`${chainName} is not enabled in the wallet, please enable.`);
                }
            }

            if (newAddress) {
                setMultiChainAddresses(prev => ({ ...prev, [uChain]: newAddress }));
            }
        } catch (err: any) {
            console.error(`Failed to connect ${chainName} wallet:`, err);
            setError(err?.message || `Failed to connect ${chainName} wallet`);
        }
    };

    const { setTargetChainId } = useTargetChain();

    const handleUnifiedConnect = async () => {
        const chainsToConnect = [];
        if (fromToken && !getAddressForChain(fromToken.chain)) chainsToConnect.push(fromToken.chain);
        if (toToken && !getAddressForChain(toToken.chain) && toToken.chain !== fromToken?.chain) chainsToConnect.push(toToken.chain);

        const hasEVM = chainsToConnect.some(c => isEVM(c));
        const nonEVM = chainsToConnect.filter(c => !isEVM(c));

        if (hasEVM && !evmAddress) {
            const evmChain = chainsToConnect.find(c => isEVM(c));
            const targetId = getWagmiChainId(evmChain);
            if (targetId) setTargetChainId(targetId);

            setIsConnectingFlow(true); // Mark that user initiated a unified flow
            openConnectKit(true);
        } else {
            // If EVM is already connected or not needed, fetch non-EVM immediately
            for (const chainName of nonEVM) {
                await connectCrossChainWallet(chainName);
            }
        }
    };

    // When Wagmi Connects via the user flow, sequentially prompt for any pending non-EVM chains
    useEffect(() => {
        if (evmAddress && isConnectingFlow) {
            setIsConnectingFlow(false); // Reset flow state

            const chainsToConnect = [];
            if (fromToken && !getAddressForChain(fromToken.chain)) chainsToConnect.push(fromToken.chain);
            if (toToken && !getAddressForChain(toToken.chain) && toToken.chain !== fromToken?.chain) chainsToConnect.push(toToken.chain);

            const nonEVM = chainsToConnect.filter(c => !isEVM(c));

            if (nonEVM.length > 0) {
                // Execute sequentially
                (async () => {
                    for (const chain of nonEVM) {
                        // Short delay to allow ConnectKit modal to completely close
                        await new Promise(r => setTimeout(r, 500));
                        await connectCrossChainWallet(chain);
                    }
                })();
            }
        }
    }, [evmAddress, isConnectingFlow, fromToken, toToken]);

    const handleSwap = async () => {
        if (!quote?.routes?.[0]?.routeId) return;
        setIsSwapping(true);
        setError(null);
        setSwapResult(null);

        try {
            const sourceAddress = getAddressForChain(fromToken?.chain);
            const destinationAddress = getAddressForChain(toToken?.chain);

            if (!sourceAddress) throw new Error(`Please connect a ${fromToken?.chain} wallet to swap from ${fromToken?.symbol}.`);
            if (!destinationAddress) throw new Error(`Please connect a ${toToken?.chain} wallet to receive ${toToken?.symbol}.`);

            // Basic check for Tron address format if it's the source
            if (fromToken?.chain === 'TRON' && !sourceAddress.startsWith('T')) {
                // If it's hex, try to warn or convert
                if (sourceAddress.startsWith('41') || sourceAddress.startsWith('0x')) {
                    throw new Error('Invalid Tron address format. Please ensure your Tron wallet is fully connected and initialized (Base58 format required).');
                }
            }

            console.log('STEP 1: Building transaction...');
            const res = await buildSwapTransaction(quote.routes[0].routeId, sourceAddress, destinationAddress);
            console.log('Build Swap Transaction Result:', res);

            // 1. Handle signing/broadcasting
            const cName = connector?.name?.toLowerCase() || '';
            const cId = connector?.id?.toLowerCase() || '';
            const isCtrl = cName.includes('ctrl') || cName.includes('xdefi') || cId.includes('xdefi');
            const isPhantom = cName.includes('phantom') || cId.includes('phantom');
            const isVultisig = cName.includes('vultisig') || cId.includes('vultisig');

            if (fromToken?.chain === 'TRON') {
                console.log('STEP 2: Signing Tron transaction...');
                const win = window as any;
                let signedTx;
                let txToSign = res.tx || res.transaction;

                if (!txToSign) {
                    console.error('No transaction found in response:', res);
                    throw new Error('API response missing transaction data');
                }

                // Deep unwrap for SwapKit/Tron responses
                if (txToSign.transaction && typeof txToSign.transaction === 'object') {
                    txToSign = txToSign.transaction;
                }

                // Ensure raw_data_hex is present if needed by some wallets
                if (!txToSign.raw_data_hex && txToSign.raw_data) {
                    // Logic to ensure tronWeb can handle it or convert if needed
                }

                try {
                    // Try various signing methods in order of compatibility
                    if (win.tronLink?.request) {
                        try {
                            const signRes = await win.tronLink.request({
                                method: 'tron_signTransaction',
                                params: [txToSign]
                            });
                            signedTx = signRes;
                        } catch (tlErr: any) {
                            console.warn('tronLink.request failed, falling back...', tlErr);
                            // If unauthorized, re-request accounts
                            if (tlErr?.code === 4100) {
                                await win.tronLink.request({ method: 'tron_requestAccounts' });
                                signedTx = await win.tronLink.request({
                                    method: 'tron_signTransaction',
                                    params: [txToSign]
                                });
                            } else throw tlErr;
                        }
                    } else if (win.tronWeb?.trx?.sign) {
                        signedTx = await win.tronWeb.trx.sign(txToSign);
                    } else if (isCtrl && win.xfi?.tron) {
                        signedTx = await win.xfi.tron.request({ method: 'transfer', params: [txToSign] });
                    } else if (isVultisig && win.vultisig?.tron) {
                        signedTx = await win.vultisig.tron.request({ method: 'transfer', params: [txToSign] });
                    } else if (isVultisig && win.tronWeb?.request) {
                        const res = await win.tronWeb.request({ method: 'tron_signTransaction', params: [txToSign] });
                        signedTx = res;
                    } else if (signTransaction) {
                        signedTx = await signTransaction(txToSign);
                    } else {
                        throw new Error('Please connect using a Tron wallet to sign this transaction.');
                    }
                } catch (err: any) {
                    console.error('Tron signing failed:', err);
                    const errMsg = err?.message?.toLowerCase() || '';
                    if (errMsg.includes('unauthorized') || err?.code === 4100 || err?.name === 'UserRejectedRequestError') {
                        throw new Error("Transaction rejected or unauthorized. Please ensure your Tron wallet is unlocked and connected to this site.");
                    }
                    throw err;
                }

                if (!signedTx) throw new Error('Transaction was not signed');
                console.log('STEP 3: Broadcasting Tron transaction...', signedTx);

                // Handle both pre-broadcast and post-broadcast formats
                if (typeof signedTx === 'string') {
                    setSwapResult({ ...res, txHash: signedTx });
                } else {
                    const txHash = signedTx.txID || signedTx.txid || signedTx.hash || signedTx.signature ||
                        (typeof signedTx === 'object' && signedTx.result === true ? signedTx.txid || signedTx.transaction?.txID : null);

                    if (typeof txHash === 'string') {
                        setSwapResult({ ...res, txHash });
                    } else if (win.tronWeb?.trx?.sendRawTransaction) {
                        const broadcastRes = await win.tronWeb.trx.sendRawTransaction(signedTx);
                        if (broadcastRes.result) {
                            setSwapResult({ ...res, txHash: broadcastRes.txid || broadcastRes.transaction?.txID });
                        } else {
                            throw new Error(broadcastRes.message || 'Failed to broadcast Tron transaction');
                        }
                    } else {
                        throw new Error('Transaction was signed but could not be broadcasted.');
                    }
                }
            }
            else if (['BTC', 'DOGE', 'LTC', 'BCH', 'THOR', 'MAYA', 'DASH', 'KUJI', 'GAIA', 'NEAR', 'DOT'].includes(fromToken?.chain || '')) {
                // Shared logic for UTXO and Cosmos
                let chainKey = fromToken!.chain.toLowerCase();
                if (chainKey === 'gaia') chainKey = 'cosmos';
                if (chainKey === 'bch') chainKey = 'bitcoincash';
                if (chainKey === 'thor') chainKey = 'thorchain';
                if (chainKey === 'maya') chainKey = 'mayachain';

                const win = window as any;
                let provider = null;

                if (isCtrl && win.xfi?.[chainKey]) provider = win.xfi[chainKey];
                else if (isVultisig && win.vultisig?.[chainKey]) provider = win.vultisig[chainKey];
                else if (isCtrl || isVultisig) {
                    provider = isCtrl ? (win.xfi?.ethereum || win.xfi?.bitcoin || Object.values(win.xfi).find((p: any) => p.request)) :
                        (win.vultisig?.ethereum || win.vultisig?.bitcoin || Object.values(win.vultisig).find((p: any) => p.request));
                }

                if (!provider) provider = win.xfi?.[chainKey] || win.vultisig?.[chainKey] || win.phantom?.[chainKey];

                if (!provider) {
                    throw new Error(`Your wallet does not support ${fromToken?.chain} transactions or is not connected.`);
                }

                let txToSign = res.tx || res.transaction;
                if (!txToSign) throw new Error('API response missing transaction data');
                if (txToSign.transaction && typeof txToSign.transaction === 'object') {
                    txToSign = txToSign.transaction;
                }

                try {
                    console.log(`STEP 2: Signing ${fromToken?.chain} transaction...`);
                    let signedTx;
                    if (provider.request) {
                        try {
                            // Try standard sign_transaction first
                            signedTx = await provider.request({ method: 'sign_transaction', params: [txToSign] });
                        } catch (reqErr) {
                            // Fallback to transfer or direct sign
                            if (provider.signTransaction) signedTx = await provider.signTransaction(txToSign);
                            else {
                                // Last resort: try 'transfer' which some wallets use for auto-sign+broadcast
                                const txHash = await provider.request({ method: 'transfer', params: [txToSign] });
                                if (txHash) {
                                    setSwapResult({ ...res, txHash: typeof txHash === 'string' ? txHash : txHash.txid || txHash.hash });
                                    return; // Finished
                                }
                                throw reqErr;
                            }
                        }
                    } else if (provider.signTransaction) {
                        signedTx = await provider.signTransaction(txToSign);
                    } else {
                        throw new Error(`Wallet provider for ${fromToken?.chain} does not support standard signing methods.`);
                    }

                    if (!signedTx) throw new Error('Transaction was not signed');
                    console.log(`STEP 3: Broadcasting ${fromToken?.chain} transaction...`);

                    const txHash = signedTx.txHash || signedTx.hash || signedTx.txid || signedTx.txID ||
                        (typeof signedTx === 'string' ? signedTx : null);

                    if (txHash) {
                        setSwapResult({ ...res, txHash });
                    } else if (provider.sendTransaction) {
                        const broadcastRes = await provider.sendTransaction(signedTx);
                        setSwapResult({ ...res, txHash: broadcastRes.hash || broadcastRes.txid || (typeof broadcastRes === 'string' ? broadcastRes : 'Success') });
                    } else {
                        setSwapResult({ ...res, txHash: 'Pending Broadcast' });
                    }
                } catch (signErr: any) {
                    console.error(`${fromToken?.chain} signing failed:`, signErr);
                    throw new Error(signErr?.message || `Failed to sign ${fromToken?.chain} transaction.`);
                }
            } else if (fromToken?.chain === 'SOL') {
                console.log('STEP 2: Signing SOL transaction...');
                const win = window as any;
                let solProvider = win.phantom?.solana || win.xfi?.solana || win.vultisig?.solana;

                if (isCtrl && win.xfi?.solana) solProvider = win.xfi.solana;
                else if (isVultisig && win.vultisig?.solana) solProvider = win.vultisig.solana;
                else if (isPhantom && win.phantom?.solana) solProvider = win.phantom.solana;

                if (!solProvider) throw new Error('No Solana wallet available to sign.');

                let txBuffer = res.tx || res.transaction;
                if (txBuffer?.transaction && typeof txBuffer.transaction === 'object') txBuffer = txBuffer.transaction;

                try {
                    // Try signAndSendTransaction first as it's the standard for atomic sign+broadcast
                    let sig;
                    if (solProvider.signAndSendTransaction) {
                        const response = await solProvider.signAndSendTransaction(txBuffer);
                        sig = response.signature || response;
                    } else if (solProvider.request) {
                        const response = await solProvider.request({
                            method: 'signAndSendTransaction',
                            params: { transaction: txBuffer }
                        });
                        sig = response.signature || response;
                    } else {
                        const signed = await solProvider.signTransaction(txBuffer);
                        sig = signed.signature || (typeof signed === 'string' ? signed : null);
                    }

                    if (!sig) throw new Error('Failed to get signature from Solana wallet');
                    setSwapResult({ ...res, txHash: sig });
                } catch (err: any) {
                    console.error('Solana transaction failed:', err);
                    throw new Error(err.message || 'Solana transaction failed.');
                }
            }
            else {
                // EVM
                let txData = res.tx || res.transaction;
                if (!txData) throw new Error('API response missing transaction data');

                // Unwrap nested transaction object if present
                if (txData.transaction && typeof txData.transaction === 'object') {
                    txData = txData.transaction;
                }

                const targetChainId = txData.chainId || getWagmiChainId(fromToken?.chain);
                console.log(`STEP 2: Signing EVM transaction on chain ${targetChainId}...`, txData);

                if (targetChainId && currentChainId !== targetChainId) {
                    try {
                        console.log(`Switching chain from ${currentChainId} to ${targetChainId}`);
                        await switchChainAsync({ chainId: targetChainId });
                    } catch (err: any) {
                        // Ignore user denial if they already approved the network in wallet
                        if (!err?.message?.includes('User rejected')) throw err;
                    }
                }

                const evmTxPayload: any = {
                    to: txData.to as `0x${string}`,
                    data: txData.data as `0x${string}`,
                    value: txData.value ? BigInt(txData.value) : undefined,
                    chainId: targetChainId
                };

                // Only attach gas parameters if they exist and are non-zero,
                // letting the wallet estimate gas naturally if SwapKit didn't provide strict limits
                if (txData.gasLimit && txData.gasLimit !== '0' && txData.gasLimit !== 0) {
                    evmTxPayload.gas = BigInt(txData.gasLimit);
                }

                // For EIP-1559 transactions
                if (txData.maxFeePerGas && txData.maxFeePerGas !== '0') {
                    evmTxPayload.maxFeePerGas = BigInt(txData.maxFeePerGas);
                }
                if (txData.maxPriorityFeePerGas && txData.maxPriorityFeePerGas !== '0') {
                    evmTxPayload.maxPriorityFeePerGas = BigInt(txData.maxPriorityFeePerGas);
                }

                // For Legacy transactions
                if (!evmTxPayload.maxFeePerGas && txData.gasPrice && txData.gasPrice !== '0') {
                    evmTxPayload.gasPrice = BigInt(txData.gasPrice);
                }

                const txHash = await sendTransactionAsync(evmTxPayload);
                setSwapResult({ ...res, txHash });
            }
        } catch (err: any) {
            console.error('Swap Error:', err);
            // Enhanced error message extraction
            let msg = err?.message || 'Failed to complete swap';

            if (err?.response?.data) {
                const apiError = err.response.data.message || err.response.data.error || err.response.data.details;
                if (apiError) msg = apiError;
            } else if (err?.response?.status) {
                msg = `API Error ${err.response.status}: ${err.response.statusText}`;
            } else if (typeof err === 'string') {
                msg = err;
            }

            // Map cryptic messages to user-friendly ones
            if (msg.toLowerCase().includes('the wallet is disconnected') || msg.toLowerCase().includes('connect first')) {
                msg = 'Your Tron wallet is disconnected. Please ensure TronLink is logged in and connected.';
            }

            setError(msg);
        } finally {
            setIsSwapping(false);
        }
    };

    // Strictly filter receive tokens to only the true BSC stablecoins (no overnight/bridged)
    const allowedToTokens = tokens.filter(t =>
        t.identifier === 'BSC.USDT-0x55d398326f99059fF775485246999027B3197955' ||
        t.identifier === 'BSC.USDC-0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' ||
        t.identifier === 'BSC.BNB' ||
        t.identifier === 'BSC.USDT' ||
        t.identifier === 'BSC.USDC'
    );

    const uniqueChains = useMemo(() => {
        const chains = new Set<string>();
        tokens.forEach(t => { if (t.chain) chains.add(t.chain); });
        return Array.from(chains).sort();
    }, [tokens]);

    const renderedTokens = useMemo(() => {
        let list = modalOpen === 'to' ? allowedToTokens : tokens;

        if (selectedChain && modalOpen === 'from') {
            list = list.filter(t => t.chain === selectedChain);
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            list = list.filter(t =>
                (t.identifier && t.identifier.toLowerCase().includes(query)) ||
                (t.name && t.name.toLowerCase().includes(query)) ||
                (t.symbol && t.symbol.toLowerCase().includes(query))
            );
        }

        // Limit to 100 to prevent rendering lag (glitches)
        return list.slice(0, 100);
    }, [tokens, allowedToTokens, modalOpen, selectedChain, searchQuery]);

    const CHAIN_LOGO_OVERRIDES: Record<string, string> = {
        'ARB': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png',
        'AVAX': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png',
        'BASE': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/info/logo.png',
        'BSC': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png',
        'BTC': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png',
        'ETH': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
        'OP': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png',
        'POL': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png',
        'SOL': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png',
        'TRON': 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/tron/info/logo.png',
    };

    // Helper to get a logo for a chain
    const getChainLogo = (chainName: string) => {
        const uChain = chainName.toUpperCase();
        if (CHAIN_LOGO_OVERRIDES[uChain]) return CHAIN_LOGO_OVERRIDES[uChain];

        // 1. Try to find a specific token whose symbol exactly matches the chain name
        let token = tokens.find(t => t.chain === chainName && t.symbol?.toUpperCase() === uChain && t.logoURI);

        // 2. Fallback: find any token on that chain with a logo
        if (!token) {
            token = tokens.find(t => t.chain === chainName && t.logoURI);
        }
        return token?.logoURI;
    };

    return (
        <div className="w-full max-w-[480px] mx-auto">
            <div className="glass rounded-[32px] p-4 flex flex-col gap-2 relative z-10 overflow-hidden">
                {/* Glow effect */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[200px] h-[200px] bg-primary/20 blur-[100px] rounded-full pointer-events-none" />

                <div className="flex justify-between items-center px-4 py-2 relative z-10">
                    <h2 className="text-xl font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">Swap</h2>
                    <div className="flex items-center gap-2">
                        {quote && quoteTimer > 0 && !loadingQuote && !error && (
                            <div className="relative w-8 h-8 flex items-center justify-center shrink-0">
                                <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 36 36">
                                    <circle cx="18" cy="18" r="16" fill="none" className="stroke-white/10" strokeWidth="3" />
                                    <circle cx="18" cy="18" r="16" fill="none" className="stroke-primary" strokeWidth="3" strokeDasharray="100" strokeDashoffset={100 - (quoteTimer / 60) * 100} strokeLinecap="round" />
                                </svg>
                                <span className="absolute text-[10px] font-bold text-white/90">{quoteTimer}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* From Input */}
                <div className="bg-surface/50 rounded-2xl p-4 border border-white/5 relative z-10 group focus-within:border-primary/50 transition-colors">
                    <label className="text-sm text-white/50 mb-2 block">You pay</label>
                    <div className="flex justify-between items-center">
                        <input
                            type="number"
                            min="0"
                            placeholder="0.0"
                            className="bg-transparent text-4xl font-medium outline-none w-full placeholder:text-white/20 text-white appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            value={sellAmount}
                            onWheel={(e) => (e.target as HTMLElement).blur()}
                            onKeyDown={(e) => {
                                // Prevent negative sign, scientific notation 'e', and '+' symbol
                                if (e.key === '-' || e.key === 'e' || e.key === 'E' || e.key === '+') {
                                    e.preventDefault();
                                }
                            }}
                            onChange={(e) => {
                                // Double check the value is valid
                                const val = e.target.value;
                                if (Number(val) >= 0 || val === '') {
                                    setSellAmount(val);
                                }
                            }}
                        />
                        <button
                            onClick={() => setModalOpen('from')}
                            className="glass-button rounded-full py-2 px-4 pr-3 flex items-center gap-3 shrink-0 ml-4 hover:scale-105 active:scale-95 transition-all"
                        >
                            {loadingTokens && !fromToken ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            {fromToken && (
                                <div className="flex items-center gap-3">
                                    <div className="relative shrink-0">
                                        {fromToken.logoURI ? (
                                            <img src={fromToken.logoURI} className="w-8 h-8 rounded-full bg-white/10" alt="" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                                                <span className="text-[10px]">{getTokenSymbol(fromToken).slice(0, 3)}</span>
                                            </div>
                                        )}
                                        {fromToken.chain && getChainLogo(fromToken.chain) && (
                                            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border border-[rgb(20,20,20)] overflow-hidden bg-[rgb(20,20,20)]">
                                                <img src={getChainLogo(fromToken.chain)!} alt={fromToken.chain} className="w-full h-full object-cover" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col items-start leading-none gap-1">
                                        <span className="font-bold text-base">{getTokenSymbol(fromToken)}</span>
                                        <span className="text-[10px] text-white/50 font-medium uppercase">{fromToken.chain}</span>
                                    </div>
                                </div>
                            )}
                            {(!fromToken && !loadingTokens) && <span className="font-bold">Select</span>}
                            <ChevronDown className="w-4 h-4 text-white/50 ml-1" />
                        </button>
                    </div>
                    <div className="flex justify-between items-center mt-2 h-5">
                        <div className="flex flex-col items-start">
                            <span className="text-sm font-medium text-white/50 leading-none">
                                {sellAmount && fromTokenPrice ? `$${(Number(sellAmount) * fromTokenPrice).toFixed(2)}` : ''}
                            </span>
                            {getAddressForChain(fromToken?.chain) && (
                                <span className="text-[10px] text-white/30 font-mono mt-1">
                                    {truncateAddress(getAddressForChain(fromToken?.chain))}
                                </span>
                            )}
                        </div>
                        {getAddressForChain(fromToken?.chain) && (
                            <span className="text-sm font-medium text-white/40">
                                Balance: {parseFloat(fromBalance || '0').toFixed(4)}
                            </span>
                        )}
                    </div>
                </div>

                {/* Swap Direction Button */}
                <div className="relative h-2 my-[-8px] z-20 flex justify-center">
                    <button
                        className="absolute top-1/2 -translate-y-1/2 bg-surface border-4 border-[#0a0a0a] rounded-xl p-2 hover:bg-white/10 transition-colors group"
                        onClick={() => {
                            if (fromToken && allowedToTokens.find(t => t.identifier === fromToken.identifier)) {
                                const temp = fromToken;
                                setFromToken(toToken);
                                setToToken(temp);
                            }
                        }}
                    >
                        <ArrowDownUp className="w-4 h-4 text-white/70 group-hover:rotate-180 transition-transform duration-300" />
                    </button>
                </div>

                {/* To Input */}
                <div className="bg-surface/50 rounded-2xl p-4 border border-white/5 relative z-10 group focus-within:border-primary/50 transition-colors">
                    <label className="text-sm text-white/50 mb-2 block">You receive</label>
                    <div className="flex justify-between items-center">
                        <input
                            type="number"
                            placeholder="0.0"
                            readOnly
                            className="bg-transparent text-4xl font-medium outline-none w-full placeholder:text-white/20 text-white cursor-not-allowed"
                            value={quote?.routes?.[0]?.expectedBuyAmount ? Number(quote.routes[0].expectedBuyAmount).toFixed(5) : ''}
                            onWheel={(e) => (e.target as HTMLElement).blur()}
                        />
                        <button
                            onClick={() => setModalOpen('to')}
                            className="glass-button rounded-full py-2 px-4 pr-3 flex items-center gap-3 shrink-0 ml-4 hover:scale-105 active:scale-95 transition-all"
                        >
                            {toToken && (
                                <div className="flex items-center gap-3">
                                    <div className="relative shrink-0">
                                        {toToken.logoURI ? (
                                            <img src={toToken.logoURI} className="w-8 h-8 rounded-full bg-white/10" alt="" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                                                <span className="text-[10px]">{getTokenSymbol(toToken).slice(0, 3)}</span>
                                            </div>
                                        )}
                                        {toToken.chain && getChainLogo(toToken.chain) && (
                                            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border border-[rgb(20,20,20)] overflow-hidden bg-[rgb(20,20,20)]">
                                                <img src={getChainLogo(toToken.chain)!} alt={toToken.chain} className="w-full h-full object-cover" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col items-start leading-none gap-1">
                                        <span className="font-bold text-base">{getTokenSymbol(toToken)}</span>
                                        <span className="text-[10px] text-white/50 font-medium uppercase">{toToken.chain}</span>
                                    </div>
                                </div>
                            )}
                            {!toToken && <span className="font-bold">Select</span>}
                            <ChevronDown className="w-4 h-4 text-white/50 ml-1" />
                        </button>
                    </div>
                    <div className="flex justify-between items-center mt-2 h-5">
                        <div className="flex flex-col items-start">
                            <span className="text-sm font-medium text-white/50 leading-none">
                                {quote?.routes?.[0]?.expectedBuyAmount && toTokenPrice ? `$${(Number(quote.routes[0].expectedBuyAmount) * toTokenPrice).toFixed(2)}` : ''}
                            </span>
                            {getAddressForChain(toToken?.chain) && (
                                <span className="text-[10px] text-white/30 font-mono mt-1">
                                    {truncateAddress(getAddressForChain(toToken?.chain))}
                                </span>
                            )}
                        </div>
                        {getAddressForChain(toToken?.chain) && (
                            <span className="text-sm font-medium text-white/40">
                                Balance: {parseFloat(toBalance || '0').toFixed(4)}
                            </span>
                        )}
                    </div>
                </div>

                {/* Error / Quote Data */}
                {error && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm mt-2 relative z-10">
                        {error}
                    </div>
                )}

                {quote?.routes?.[0] && !error && (
                    <div className="flex flex-col gap-1 px-4 py-2 relative z-10 text-sm text-white/50">
                        <div className="flex justify-between">
                            <span>Expected Output</span>
                            <span className="text-white">{Number(quote.routes[0].expectedBuyAmount).toFixed(5)} {toToken?.symbol}</span>
                        </div>
                        <div className="flex justify-between items-start w-full">
                            <span className="whitespace-nowrap">Total Fees</span>
                            <div className="flex flex-col items-end gap-1 text-white w-full ml-4">
                                {(() => {
                                    const groupedFees: Record<string, { amount: number; asset: string; name: string }> = {};
                                    quote.routes[0].fees?.forEach((f: any) => {
                                        const amount = parseFloat(f.amount);
                                        if (amount > 0) {
                                            let typeName = f.type ? f.type.charAt(0).toUpperCase() + f.type.slice(1).replace(/_/g, ' ') + ' Fee' : 'Fee';
                                            if (f.type === 'affiliate' || f.type === 'service') {
                                                typeName = 'Platform Fee'; // Combine affiliate and service fees
                                            }
                                            const tokenSymbol = f.asset.split('.')[1]?.split('-')[0] || f.asset;
                                            const key = `${typeName}-${tokenSymbol}`;

                                            if (!groupedFees[key]) {
                                                groupedFees[key] = { amount: 0, asset: tokenSymbol, name: typeName };
                                            }
                                            groupedFees[key].amount += amount;
                                        }
                                    });

                                    return Object.values(groupedFees).map((fee, i) => (
                                        <div key={i} className="flex justify-between w-full gap-4">
                                            <span className="text-white/50">{fee.name}</span>
                                            <span>
                                                {fee.amount.toPrecision(3)} {fee.asset}
                                            </span>
                                        </div>
                                    ));
                                })()}
                                {!quote.routes[0].fees?.some((f: any) => parseFloat(f.amount) > 0) && (
                                    <span>$0.00</span>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-between">
                            <span>Estimated Time</span>
                            <span className="text-white">{Math.floor((quote.routes[0].estimatedTime?.total || 0) / 60)} min</span>
                        </div>
                    </div>
                )}

                {/* Swap Result Status */}
                {swapResult && (
                    <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-500 text-sm mt-2 relative z-10 overflow-hidden break-all">
                        <div className="font-bold text-green-400 mb-1">Swap Successful!</div>
                        {swapResult.txHash && <div className="mb-1">Transaction Hash: <span className="text-white font-mono">{swapResult.txHash}</span></div>}
                        Target Address: {swapResult.targetAddress || swapResult.destinationAddress}
                    </div>
                )}

                {(() => {
                    const fromChain = fromToken?.chain;
                    const fromAddress = getAddressForChain(fromChain);
                    const toChain = toToken?.chain;
                    const toAddress = getAddressForChain(toChain);
                    const fromChainId = getWagmiChainId(fromChain);

                    const needsFromConnect = fromChain && !fromAddress;
                    const needsToConnect = toChain && !toAddress && toChain !== fromChain;
                    const needsEvmSwitch = fromAddress && isEVM(fromChain) && fromChainId && currentChainId !== fromChainId;
                    const hasInsufficientBalance = fromAddress && sellAmount && Number(sellAmount) > Number(fromBalance);

                    if (needsFromConnect || needsToConnect) {
                        return (
                            <button
                                onClick={handleUnifiedConnect}
                                className="w-full bg-primary hover:bg-primary/90 text-white text-lg font-bold py-4 rounded-2xl mt-2 transition-all active:scale-[0.98] relative z-10 flex items-center justify-center gap-2"
                            >
                                {(() => {
                                    if (needsFromConnect && needsToConnect) return 'Connect Wallets';
                                    if (needsFromConnect) return `Connect ${fromChain} Wallet`;
                                    if (needsToConnect) return `Connect ${toChain} Wallet`;
                                    return 'Connect Wallet';
                                })()}
                            </button>
                        );
                    }

                    if (needsEvmSwitch) {
                        return (
                            <button
                                onClick={async () => {
                                    try {
                                        await switchChainAsync({ chainId: fromChainId! });
                                    } catch (err) {
                                        console.error('Failed to switch chain:', err);
                                    }
                                }}
                                className="w-full bg-amber-500 hover:bg-amber-600 text-white text-lg font-bold py-4 rounded-2xl mt-2 transition-all active:scale-[0.98] relative z-10 flex items-center justify-center gap-2"
                            >
                                Switch to {fromChain}
                            </button>
                        );
                    }

                    return (
                        <button
                            onClick={handleSwap}
                            disabled={!!(!fromToken || !toToken || !quote || isSwapping || loadingQuote || hasInsufficientBalance)}
                            className={`w-full text-white text-lg font-bold py-4 rounded-2xl mt-2 transition-all active:scale-[0.98] relative z-10 flex items-center justify-center gap-2 ${hasInsufficientBalance ? 'bg-red-500/50 cursor-not-allowed' : 'bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:cursor-not-allowed'}`}
                        >
                            {loadingQuote ? (
                                <Loader2 className="w-6 h-6 animate-spin" />
                            ) : isSwapping ? (
                                <Loader2 className="w-6 h-6 animate-spin" />
                            ) : !fromToken || !toToken ? (
                                'Select Tokens'
                            ) : !quote ? (
                                'Enter Amount'
                            ) : hasInsufficientBalance ? (
                                'Insufficient Balance'
                            ) : (
                                'Swap'
                            )}
                        </button>
                    );
                })()}
            </div>

            {/* Token Modal */}
            {modalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModalOpen(null)} />
                    <div className="glass rounded-[32px] w-full max-w-[500px] h-[650px] flex flex-col relative z-10 border border-white/10 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center shrink-0">
                            <h3 className="font-bold text-lg">Select Token</h3>
                            <button onClick={() => setModalOpen(null)} className="text-white/50 hover:text-white p-2">✕</button>
                        </div>
                        <div className="p-4 border-b border-white/10 shrink-0">
                            <input
                                type="text"
                                placeholder="Search name or paste address"
                                className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 outline-none focus:border-primary/50 text-white placeholder:text-white/30"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        {/* Chain filters (75% height, scrollable) */}
                        {modalOpen === 'from' && uniqueChains.length > 0 && (
                            <div className="flex-1 overflow-y-auto border-b border-white/10 p-4 shrink-0">
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <button
                                        onClick={() => setSelectedChain('')}
                                        className={`flex items-center justify-center px-4 py-3 rounded-2xl text-sm font-bold transition-all ${selectedChain === '' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/70 hover:bg-white/10 disabled:opacity-50'}`}
                                    >
                                        <span>ALL</span>
                                    </button>
                                    {uniqueChains.filter(chain => getChainLogo(chain)).map(chain => {
                                        const logo = getChainLogo(chain);
                                        return (
                                            <button
                                                key={chain}
                                                onClick={() => setSelectedChain(chain)}
                                                className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-sm font-bold transition-all ${selectedChain === chain ? 'bg-primary/20 text-white border border-primary/30' : 'bg-transparent text-white/90 hover:bg-white/5 border border-transparent'}`}
                                            >
                                                <div className="w-6 h-6 rounded-full overflow-hidden shrink-0 flex items-center justify-center">
                                                    <img src={logo} alt={chain} className="w-full h-full object-cover" />
                                                </div>
                                                <span className="text-left leading-tight text-sm whitespace-normal break-words">{chain}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Tokens list (25% height when chains shown, else flex-1) */}
                        <div className={`${modalOpen === 'from' && uniqueChains.length > 0 ? 'h-[25%] min-h-[150px]' : 'flex-1'} overflow-y-auto p-2 bg-black/20 shrink-0`}>
                            {renderedTokens.length === 0 ? (
                                <div className="p-8 text-center text-white/40">No tokens found.</div>
                            ) : (
                                renderedTokens.map((t) => {
                                    const chainLogo = getChainLogo(t.chain || '');
                                    return (
                                        <button
                                            key={t.identifier}
                                            className="w-full flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl transition-colors text-left"
                                            onClick={() => {
                                                if (modalOpen === 'from') {
                                                    setFromToken(t);
                                                    if (!getAddressForChain(t.chain)) {
                                                        // Auto-connect if not connected
                                                        if (isEVM(t.chain)) {
                                                            const tid = getWagmiChainId(t.chain);
                                                            if (tid) setTargetChainId(tid);
                                                            openConnectKit(true);
                                                        } else {
                                                            connectCrossChainWallet(t.chain);
                                                        }
                                                    }
                                                } else {
                                                    setToToken(t);
                                                    if (!getAddressForChain(t.chain) && t.chain !== fromToken?.chain) {
                                                        // Auto-connect if not connected
                                                        if (isEVM(t.chain)) {
                                                            const tid = getWagmiChainId(t.chain);
                                                            if (tid) setTargetChainId(tid);
                                                            openConnectKit(true);
                                                        } else {
                                                            connectCrossChainWallet(t.chain);
                                                        }
                                                    }
                                                }
                                                setModalOpen(null);
                                                setSearchQuery('');
                                            }}
                                        >
                                            <div className="relative shrink-0">
                                                <div className="w-10 h-10 rounded-full bg-white/10 overflow-hidden flex items-center justify-center">
                                                    {t.logoURI ? (
                                                        <img src={t.logoURI} alt={t.symbol} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <span className="text-white/50 text-xs">{t.symbol?.slice(0, 3)}</span>
                                                    )}
                                                </div>
                                                {/* Mini chain badge */}
                                                {chainLogo && (
                                                    <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border border-black overflow-hidden bg-black">
                                                        <img src={chainLogo} alt={t.chain} className="w-full h-full object-cover" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-bold text-lg leading-none">{getTokenSymbol(t)}</span>
                                                <span className="text-sm text-white/50 mt-1">{t.chain}</span>
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
