import axios from 'axios';

const API_URL = 'https://latexworkshop.irishof.cloud/api';
const MOCK_TOKEN = 'mock-token'; // Enabled only when NODE_ENV=test

async function runFullTest() {
    console.log('🚀 Starting Full Smoke Test for LaTeX Workshop...');
    const headers = { Authorization: `Bearer ${MOCK_TOKEN}` };

    try {
        console.log('1. Creating New Project (LaTeX)...');
        const projRes = await axios.post(`${API_URL}/projects`, { name: 'Smoke Test Proj', type: 'latex' }, { headers });
        const projectId = projRes.data._id;
        console.log(`✅ Project created: ${projectId}`);

        console.log('2. Fetching Project Details...');
        const detailsRes = await axios.get(`${API_URL}/projects/${projectId}`, { headers });
        if (detailsRes.data.documents.length > 0) {
            console.log('✅ Documents found.');
        } else {
            throw new Error('No documents created for new project.');
        }

        console.log('3. Compiling Project (checking PDF)...');
        const compileRes = await axios.post(`${API_URL}/compile/${projectId}`, {}, { 
            headers,
            responseType: 'arraybuffer'
        });
        
        if (compileRes.status === 200 && compileRes.headers['content-type'] === 'application/pdf') {
            console.log('✅ Compilation successful (PDF received).');
        } else {
            throw new Error(`Compilation failed. Status: ${compileRes.status}, Type: ${compileRes.headers['content-type']}`);
        }

        console.log('4. Deleting Project...');
        const delRes = await axios.delete(`${API_URL}/projects/${projectId}`, { headers });
        if (delRes.data.success) {
            console.log('✅ Project deleted successfully.');
        } else {
            throw new Error('Project deletion failed.');
        }

        console.log('✨ All Smoke Tests Passed!');
    } catch (err) {
        console.error('❌ Smoke Test Failed:', err.response?.data?.error || err.message);
        if (err.response?.data?.logs) {
            console.error('--- COMPILE LOGS ---');
            console.error(err.response.data.logs);
        }
        process.exit(1);
    }
}

runFullTest();
