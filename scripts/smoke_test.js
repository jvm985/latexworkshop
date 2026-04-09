import axios from 'axios';

const API_URL = 'https://latexworkshop.irishof.cloud/api';
// You would need a valid token to run this test properly. 
// For this smoke test, we'll check if endpoints exist and handle auth correctly.

async function runTest() {
    console.log('🚀 Starting Smoke Test for LaTeX Workshop...');

    try {
        console.log('1. Testing Public Auth Endpoint...');
        const authRes = await axios.post(`${API_URL}/auth/google`, { credential: 'dummy_token' });
        // Should return 400 since token is dummy
        console.log('✅ Auth endpoint responds.');
    } catch (err) {
        if (err.response?.status === 400) console.log('✅ Auth endpoint correctly rejected dummy token.');
        else console.error('❌ Auth endpoint error:', err.message);
    }

    try {
        console.log('2. Testing Protected Endpoint (expect 401)...');
        await axios.get(`${API_URL}/projects`);
    } catch (err) {
        if (err.response?.status === 401) console.log('✅ Protected endpoint correctly returned 401.');
        else console.error('❌ Protected endpoint error:', err.message);
    }

    console.log('✨ Smoke test baseline complete. Further tests require valid Google session tokens.');
}

runTest();
