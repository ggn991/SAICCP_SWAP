import SwapWidget from './components/SwapWidget';
import { Web3Provider } from './components/Web3Provider';
import { ConnectKitButton } from 'connectkit';
import { useAccount } from 'wagmi';
import { useWallet } from '@tronweb3/tronwallet-adapter-react-hooks';

function ConnectedNetwork() {
  const { chain, isConnected: isEvmConnected } = useAccount();
  const { connected: isTronConnected, address: tronAddress } = useWallet();

  const isTronActive = isTronConnected && !!tronAddress;

  if (!isEvmConnected && !isTronActive) {
    return (
      <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 opacity-50">
        <div className="w-2 h-2 rounded-full bg-white/20" />
        <span className="text-xs font-medium text-white/40">No Wallet Connected</span>
      </div>
    );
  }

  return (
    <div className="hidden md:flex flex-col items-end gap-1">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-xs font-medium text-green-400">
          {isEvmConnected ? (chain?.name || 'EVM Connected') : ''}
          {isEvmConnected && isTronActive ? ' & ' : ''}
          {isTronActive ? 'TRON Network' : ''}
        </span>
      </div>
    </div>
  );
}


function App() {
  return (
    <Web3Provider>
      <div className="min-h-screen app-bg text-white font-sans flex flex-col relative overflow-hidden">
        {/* Ambient background glows */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-secondary/20 blur-[120px] rounded-full pointer-events-none" />

        <header className="p-6 flex justify-between items-center relative z-10 w-full max-w-6xl mx-auto">
          <div className="flex items-center gap-2">
            {/* <span className="font-bold text-xl tracking-tight">M5Dex</span> */}
          </div>
          <div className="flex items-center gap-4">
            <ConnectedNetwork />
            <ConnectKitButton />
          </div>
        </header>

        <main className="flex-grow flex flex-col items-center justify-center p-4 relative z-10 w-full max-w-6xl mx-auto">
          <div className="text-center">
            <h1 className="text-5xl font-extrabold tracking-tight mb-4 bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
              Cross-Chain Swap
            </h1>
            <p className="text-white/50 text-lg max-w-md mx-auto">
              Swap incredibly fast from any token
            </p>
          </div>

          <SwapWidget />
        </main>
      </div>
    </Web3Provider>
  );
}

export default App;
