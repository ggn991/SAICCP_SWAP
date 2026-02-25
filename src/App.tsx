import SwapWidget from './components/SwapWidget';
import { Web3Provider } from './components/Web3Provider';
import { ConnectKitButton } from 'connectkit';


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
          <div>
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
