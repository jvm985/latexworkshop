import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { Layout } from 'lucide-react';
import EditorView from './Editor';
import Dashboard from './Dashboard';

const API_URL = '/api';

function Login() {
  const navigate = useNavigate();
  const handleLogin = async (res: any) => {
    console.log('Google login success, sending to backend...');
    try {
        const { data } = await axios.post(`${API_URL}/auth/google`, { credential: res.credential });
        console.log('Backend auth success:', data.user.email);
        localStorage.setItem('latex_token', data.token);
        localStorage.setItem('latex_user', JSON.stringify(data.user));
        navigate('/');
    } catch (e: any) {
        console.error('Backend auth failed:', e.response?.data || e.message);
        alert('Inloggen mislukt. Zie console voor details.');
    }
  };
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f' }}>
      <div style={{ background: '#1e1e1e', padding: '60px', borderRadius: '24px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', textAlign: 'center', border: '1px solid #333', width: '400px' }}>
        <div style={{ background: 'linear-gradient(135deg, #0071e3 0%, #003f8c 100%)', width: '80px', height: '80px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px' }}>
          <Layout color="white" size={40} />
        </div>
        <h1 style={{ color: 'white', marginBottom: '8px', fontSize: '32px', fontWeight: 800 }}>LaTeX Workshop</h1>
        <p style={{ color: '#888', marginBottom: '48px' }}>Professional typesetting reinvented.</p>
        <GoogleLogin onSuccess={handleLogin} theme="filled_blue" shape="pill" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/project/:id" element={<EditorView />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
