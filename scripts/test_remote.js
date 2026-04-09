import axios from 'axios';

// Remote URL
const API_URL = 'https://latexworkshop.irishof.cloud/api';
// Use the mock token if NODE_ENV=test is set on the server
const MOCK_TOKEN = 'mock-token'; 

async function runRemoteTest() {
    console.log('🚀 Starting REMOTE Smoke Test from local PC...');
    const headers = { Authorization: `Bearer ${MOCK_TOKEN}` };

    try {
        console.log('1. Testing Connection to Irishof.cloud...');
        const projectsRes = await axios.get(`${API_URL}/projects`, { headers });
        console.log(`✅ Connection successful. Found ${projectsRes.data.length} projects.`);

        console.log('2. Creating New Project...');
        const createRes = await axios.post(`${API_URL}/projects`, { name: 'Remote Smoke Test', type: 'latex' }, { headers });
        const projectId = createRes.data._id;
        console.log(`✅ Project created: ${projectId}`);

        console.log('3. Compiling Project (expecting PDF)...');
        const compileRes = await axios.post(`${API_URL}/compile/${projectId}`, {}, { 
            headers,
            responseType: 'arraybuffer'
        });
        
        if (compileRes.status === 200 && compileRes.headers['content-type'] === 'application/pdf') {
            console.log('✅ Compilation successful (PDF received remotely).');
        } else {
            throw new Error(`Unexpected response: ${compileRes.status}, ${compileRes.headers['content-type']}`);
        }

        console.log('4. Deleting Test Project...');
        await axios.delete(`${API_URL}/projects/${projectId}`, { headers });
        console.log('✅ Project deleted.');

        console.log('✨ Remote Smoke Test Passed!');
    } catch (err) {
        console.error('❌ Remote Test Failed:', err.response?.data?.error || err.message);
        process.exit(1);
    }
}

runRemoteTest();
