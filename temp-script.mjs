import axios from 'axios';

async function test() {
    try {
        const cg = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd');
        console.log("CG PRICES:", cg.data);
    } catch (err) {
        console.error("CG ERR", err.response ? err.response.data : err.message);
    }

    try {
        const sk = await axios.get('https://api.swapkit.dev/price', {
            headers: { 'x-api-key': 'dd9505c9-a6ae-475b-843b-19f32116c7e9' }
        });
        console.log("SK PRICES:", sk.data);
    } catch (err) {
        console.error("SK ERR", err.response ? err.response.status : err.message);
    }
}
test();
