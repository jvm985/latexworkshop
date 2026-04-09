import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { FileText, LogOut, Plus, Layout, Users } from 'lucide-react';
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
        <h1><Layout /> Workshop</h1>
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
    if (!token) return navigate('/login');
    axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } }).then(res => setProjects(res.data));
  }, [token]);

  const create = async () => {
    if (!name) return;
    const res = await axios.post(`${API_URL}/projects`, { name, type }, { headers: { Authorization: `Bearer ${token}` } });
    navigate(`/project/${res.data._id}`);
  };

  return (
    <div style={{ padding: '40px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
        <h1>Mijn Projecten</h1>
        <button onClick={() => { localStorage.clear(); navigate('/login'); }}><LogOut /> Uitloggen</button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '30px', background: 'white', padding: '20px', borderRadius: '12px' }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Project naam..." style={{ flex: 1, padding: '10px' }}/>
        <select value={type} onChange={e => setType(e.target.value)} style={{ padding: '10px' }}>
          <option value="latex">LaTeX</option>
          <option value="typst">Typst</option>
        </select>
        <button onClick={create} style={{ background: '#0071e3', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px' }}><Plus /> Nieuw</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
        {projects.map((p: any) => (
          <div key={p._id} onClick={() => navigate(`/project/${p._id}`)} style={{ background: 'white', padding: '20px', borderRadius: '12px', cursor: 'pointer', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '10px', right: '10px', fontSize: '10px', background: '#eee', padding: '2px 6px', borderRadius: '4px' }}>{p.type.toUpperCase()}</div>
            <h3><FileText size={18} /> {p.name}</h3>
            <p style={{ fontSize: '12px', color: '#888' }}>
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
