import axios from 'axios';

const API_URL = 'https://latexworkshop.irishof.cloud/api';
const MOCK_TOKEN = 'mock-token'; // Enabled only when NODE_ENV=test

async function runFullTest() {
    console.log('🚀 Starting Full Smoke Test for LaTeX Workshop...');
    const headers = { Authorization: `Bearer ${MOCK_TOKEN}` };

    try {
        console.log('1. Testing LaTeX Project...');
        const projRes = await axios.post(`${API_URL}/projects`, { name: 'LaTeX Test', type: 'latex' }, { headers });
        const latId = projRes.data._id;
        console.log(`✅ LaTeX Project created: ${latId}`);

        const compileLat = await axios.post(`${API_URL}/compile/${latId}`, {}, { headers, responseType: 'arraybuffer' });
        if (compileLat.status === 200 && compileLat.headers['content-type'] === 'application/pdf') {
            console.log('✅ LaTeX Compilation successful.');
        }
        await axios.delete(`${API_URL}/projects/${latId}`, { headers });

        console.log('2. Testing Typst Project...');
        const typRes = await axios.post(`${API_URL}/projects`, { name: 'Typst Test', type: 'typst' }, { headers });
        const typId = typRes.data._id;
        console.log(`✅ Typst Project created: ${typId}`);

        const compileTyp = await axios.post(`${API_URL}/compile/${typId}`, {}, { headers, responseType: 'arraybuffer' });
        if (compileTyp.status === 200 && compileTyp.headers['content-type'] === 'application/pdf') {
            console.log('✅ Typst Compilation successful.');
        } else {
            console.error('❌ Typst Compilation failed. Content-Type:', compileTyp.headers['content-type']);
        }
        await axios.delete(`${API_URL}/projects/${typId}`, { headers });

        console.log('✨ All Smoke Tests Passed!');
    } catch (err) {
        console.error('❌ Smoke Test Failed:', err.response?.data?.error || err.message);
        if (err.response?.data instanceof Buffer) {
            // If it's an arraybuffer, try to parse as JSON to see logs
            try {
                const text = Buffer.from(err.response.data).toString();
                const json = JSON.parse(text);
                console.error('--- COMPILE LOGS ---');
                console.error(json.logs);
            } catch(e) {}
        }
        process.exit(1);
    }
}

runFullTest();
