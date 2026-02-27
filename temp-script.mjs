import axios from 'axios';

async function testSwap() {
    try {
        const payload = {
            sourceAddress: "0xa52B0ab62f83134909a34Cdb2156828C5C864Af3", // User's address from screenshot
            destinationAddress: "0xa52B0ab62f83134909a34Cdb2156828C5C864Af3"
        };

        // 1. Get Quote
        const quoteRes = await axios.post('https://api.swapkit.dev/v3/quote', {
            sellAsset: 'BSC.BNB',
            buyAsset: 'BSC.USDT-0x55d398326f99059ff775485246999027b3197955',
            sellAmount: '0.01',
            slippage: 3
        }, {
            headers: { 'x-api-key': 'dd9505c9-a6ae-475b-843b-19f32116c7e9' }
        });

        if (!quoteRes.data.routes || quoteRes.data.routes.length === 0) {
            console.log("No routes found for testing");
            return;
        }

        const routeId = quoteRes.data.routes[0].routeId;
        console.log("Got Route ID:", routeId);

        // 2. Build Swap
        const swapRes = await axios.post('https://api.swapkit.dev/v3/swap', {
            routeId,
            sourceAddress: payload.sourceAddress,
            destinationAddress: payload.destinationAddress,
            disableBalanceCheck: true
        }, {
            headers: { 'x-api-key': 'dd9505c9-a6ae-475b-843b-19f32116c7e9' }
        });

        console.log("\nSwap Transaction Payload (EVM):");
        console.dir(swapRes.data.tx || swapRes.data.transaction, { depth: null });

    } catch (err) {
        console.error("Error:", err.response ? err.response.data : err.message);
    }
}

testSwap();
