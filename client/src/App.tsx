import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { FileText, LogOut, Plus, Layout, Grid, List, Clock, FolderPlus } from 'lucide-react';
import EditorView from './Editor';

const API_URL = '/api';

function Login() {
  const navigate = useNavigate();
  const handleLogin = async (res: any) => {
    const { data } = await axios.post(`${API_URL}/auth/google`, { credential: res.credential });
    localStorage.setItem('latex_token', data.token);
    localStorage.setItem('latex_user', JSON.stringify(data.user));
    navigate('/');
  };
  return (
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#181818' }}>
      <div style={{ background: '#252526', padding: '60px', borderRadius: '16px', boxShadow: '0 10px 40px rgba(0,0,0,0.4)', textAlign: 'center', border: '1px solid #333' }}>
        <div style={{ background: '#0071e3', width: '64px', height: '64px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
          <Layout color="white" size={32} />
        </div>
        <h1 style={{ color: 'white', marginBottom: '8px', fontSize: '28px' }}>LaTeX Workshop</h1>
        <p style={{ color: '#aaa', marginBottom: '40px' }}>Modern typesetting for everyone</p>
        <GoogleLogin onSuccess={handleLogin} theme="filled_blue" shape="pill" />
      </div>
    </div>
  );
}

function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('latex');
  const navigate = useNavigate();
  const token = localStorage.getItem('latex_token');
  const user = JSON.parse(localStorage.getItem('latex_user') || '{}');

  useEffect(() => {
    if (!token) return navigate('/login');
    axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } }).then(res => setProjects(res.data));
  }, [token, navigate]);

  const create = async () => {
    if (!name) return;
    const res = await axios.post(`${API_URL}/projects`, { name, type }, { headers: { Authorization: `Bearer ${token}` } });
    navigate(`/project/${res.data._id}`);
  };

  return (
    <div style={{ minHeight: '100vh', background: '#1e1e1e', color: 'white', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top Header */}
      <header style={{ background: '#252526', borderBottom: '1px solid #333', padding: '0 40px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Layout color="#0071e3" size={24} />
          <span style={{ fontWeight: 700, fontSize: '18px' }}>LaTeX Workshop</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <span style={{ fontSize: '14px', color: '#aaa' }}>{user.name}</span>
          <button onClick={() => { localStorage.clear(); navigate('/login'); }} style={{ background: '#333', border: 'none', color: '#ccc', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LogOut size={16}/> Logout
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '48px' }}>
          <div>
            <h1 style={{ margin: '0 0 8px 0', fontSize: '32px' }}>Welcome back!</h1>
            <p style={{ color: '#aaa', margin: 0 }}>You have {projects.length} active projects.</p>
          </div>
          <div style={{ display: 'flex', gap: '12px', background: '#252526', padding: '16px', borderRadius: '12px', border: '1px solid #333' }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Project title..." style={{ background: '#1e1e1e', border: '1px solid #444', color: 'white', padding: '10px 16px', borderRadius: '8px', width: '240px' }}/>
            <select value={type} onChange={e => setType(e.target.value)} style={{ background: '#1e1e1e', border: '1px solid #444', color: 'white', padding: '10px', borderRadius: '8px' }}>
              <option value="latex">LaTeX</option>
              <option value="typst">Typst</option>
            </select>
            <button onClick={create} style={{ background: '#0071e3', border: 'none', color: 'white', padding: '10px 24px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderPlus size={18}/> Create
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
          {projects.map((p: any) => (
            <div key={p._id} onClick={() => navigate(`/project/${p._id}`)} style={{ background: '#252526', padding: '24px', borderRadius: '16px', cursor: 'pointer', border: '1px solid #333', transition: 'all 0.2s', position: 'relative' }} onMouseOver={e => e.currentTarget.style.borderColor = '#444'} onMouseOut={e => e.currentTarget.style.borderColor = '#333'}>
              <div style={{ position: 'absolute', top: '24px', right: '24px', fontSize: '10px', background: '#333', color: '#aaa', padding: '4px 8px', borderRadius: '6px', fontWeight: 700, letterSpacing: '0.5px' }}>{p.type.toUpperCase()}</div>
              <FileText size={32} color="#0071e3" style={{ marginBottom: '20px' }}/>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>{p.name}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#888', fontSize: '13px' }}>
                <Clock size={14}/>
                <span>{new Date(p.lastModified).toLocaleDateString()}</span>
                <span>•</span>
                <span>{p.owner.email === user.email ? 'Owner' : 'Shared'}</span>
              </div>
            </div>
          ))}
        </div>
      </main>
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
