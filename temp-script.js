const axios = require('axios');

async function test() {
    try {
        const res = await axios.post('https://api.swapkit.dev/quote', {
            sellAsset: 'ETH.ETH',
            buyAsset: 'BTC.BTC',
            sellAmount: '1',
            slippage: 3
        }, {
            headers: { 'x-api-key': 'dd9505c9-a6ae-475b-843b-19f32116c7e9' }
        });
        console.log("QUOTE EXPECTED:", res.data.routes[0].expectedBuyAmount);
        console.log("QUOTE USD:", res.data.routes[0].expectedBuyAmountUSD || res.data.routes[0].buyAmountUSD || res.data.routes[0].expectedOutputUSD || Object.keys(res.data.routes[0]));

        const tokens = await axios.get('https://api.swapkit.dev/tokens', {
            headers: { 'x-api-key': 'dd9505c9-a6ae-475b-843b-19f32116c7e9' }
        });

        const eth = tokens.data[0].tokens.find(t => t.identifier === 'ETH.ETH');
        console.log("TOKEN KEYS:", eth ? Object.keys(eth) : 'not found');
        console.log("TOKEN USD:", eth.priceUSD || eth.price || eth.usdPrice || 'not found');
    } catch (err) {
        console.error(err.message);
    }
}
test();
