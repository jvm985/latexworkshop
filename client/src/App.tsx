import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { FileText, LogOut, Plus, Layout } from 'lucide-react';
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
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#f5f5f7' }}>
      <div style={{ background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '20px' }}><Layout style={{ marginRight: '10px', verticalAlign: 'middle' }}/> Workshop</h1>
        <GoogleLogin onSuccess={handleLogin} />
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

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    const fetchProjects = async () => {
      const res = await axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } });
      setProjects(res.data);
    };
    fetchProjects();
  }, [token, navigate]);

  const create = async () => {
    if (!name) return;
    const res = await axios.post(`${API_URL}/projects`, { name, type }, { headers: { Authorization: `Bearer ${token}` } });
    navigate(`/project/${res.data._id}`);
  };

  return (
    <div style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
        <h1>Mijn Projecten</h1>
        <button onClick={() => { localStorage.clear(); navigate('/login'); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', background: '#eee', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
          <LogOut size={16}/> Uitloggen
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Project naam..." style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }}/>
        <select value={type} onChange={e => setType(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #ddd' }}>
          <option value="latex">LaTeX</option>
          <option value="typst">Typst</option>
        </select>
        <button onClick={create} style={{ background: '#0071e3', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          <Plus size={18} style={{ verticalAlign: 'middle' }}/> Nieuw
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
        {projects.map((p: any) => (
          <div key={p._id} onClick={() => navigate(`/project/${p._id}`)} style={{ background: 'white', padding: '20px', borderRadius: '12px', cursor: 'pointer', position: 'relative', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: '1px solid #eee' }}>
            <div style={{ position: 'absolute', top: '10px', right: '10px', fontSize: '10px', background: '#f0f0f0', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>{p.type.toUpperCase()}</div>
            <h3 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '8px' }}><FileText size={18} color="#666"/> {p.name}</h3>
            <p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
              Owner: {p.owner.email === JSON.parse(localStorage.getItem('latex_user') || '{}').email ? 'Me' : p.owner.name}
            </p>
          </div>
        ))}
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
