import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { 
  FileText, LogOut, Layout, Clock, FolderPlus, 
  Search, Grid, List, Settings, User as UserIcon, Plus
} from 'lucide-react';
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
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f' }}>
      <div style={{ background: '#1e1e1e', padding: '60px', borderRadius: '24px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', textAlign: 'center', border: '1px solid #333', width: '400px' }}>
        <div style={{ background: 'linear-gradient(135deg, #0071e3 0%, #003f8c 100%)', width: '80px', height: '80px', borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 32px', boxShadow: '0 8px 20px rgba(0,113,227,0.3)' }}>
          <Layout color="white" size={40} />
        </div>
        <h1 style={{ color: 'white', marginBottom: '8px', fontSize: '32px', fontWeight: 800, letterSpacing: '-0.5px' }}>LaTeX Workshop</h1>
        <p style={{ color: '#888', marginBottom: '48px', fontSize: '16px' }}>Professional typesetting reinvented.</p>
        <GoogleLogin onSuccess={handleLogin} theme="filled_blue" shape="pill" size="large" width="280px" />
      </div>
    </div>
  );
}

function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [search, setSearch] = useState('');
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

  const filteredProjects = projects.filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#121212', color: 'white', fontFamily: '"Inter", sans-serif' }}>
      {/* Sidebar */}
      <aside style={{ width: '260px', background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #282828' }}>
          <div style={{ background: '#0071e3', padding: '6px', borderRadius: '8px' }}><Layout size={20}/></div>
          <span style={{ fontWeight: 800, fontSize: '18px', letterSpacing: '-0.5px' }}>Workshop</span>
        </div>
        
        <nav style={{ flex: 1, padding: '24px 12px' }}>
          <div style={{ background: '#282828', padding: '10px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', cursor: 'pointer' }}>
            <Grid size={18} color="#0071e3"/> <span style={{ fontSize: '14px', fontWeight: 600 }}>Projects</span>
          </div>
          <div style={{ padding: '10px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', color: '#888', cursor: 'not-allowed' }}>
            <Clock size={18}/> <span style={{ fontSize: '14px' }}>Recent</span>
          </div>
          <div style={{ padding: '10px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', color: '#888', cursor: 'not-allowed' }}>
            <Settings size={18}/> <span style={{ fontSize: '14px' }}>Settings</span>
          </div>
        </nav>

        <div style={{ padding: '24px', borderTop: '1px solid #282828', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '16px', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UserIcon size={16}/></div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
            <div style={{ fontSize: '11px', color: '#666' }}>Pro Account</div>
          </div>
          <button onClick={() => { localStorage.clear(); navigate('/login'); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><LogOut size={16}/></button>
        </div>
      </aside>

      {/* Main Content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '24px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666' }}/>
            <input 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects..." 
              style={{ background: '#181818', border: '1px solid #282828', color: 'white', padding: '10px 16px 10px 40px', borderRadius: '10px', width: '320px', outline: 'none', fontSize: '14px' }}
            />
          </div>
          
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ display: 'flex', background: '#181818', borderRadius: '10px', border: '1px solid #282828', padding: '4px' }}>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Project title..." style={{ background: 'none', border: 'none', color: 'white', padding: '0 12px', width: '180px', outline: 'none', fontSize: '14px' }}/>
              <select value={type} onChange={e => setType(e.target.value)} style={{ background: '#282828', border: 'none', color: 'white', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                <option value="latex">LaTeX</option>
                <option value="typst">Typst</option>
              </select>
              <button onClick={create} style={{ background: '#0071e3', border: 'none', color: 'white', padding: '6px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, marginLeft: '4px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Plus size={16}/> Create
              </button>
            </div>
          </div>
        </header>

        <div style={{ padding: '0 40px 40px', flex: 1, overflowY: 'auto' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '24px' }}>All Projects</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
            {filteredProjects.map((p: any) => (
              <div 
                key={p._id} 
                onClick={() => navigate(`/project/${p._id}`)} 
                style={{ background: '#181818', padding: '24px', borderRadius: '16px', border: '1px solid #282828', cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', position: 'relative' }}
                onMouseOver={e => { e.currentTarget.style.borderColor = '#0071e3'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = '#282828'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <div style={{ background: '#222', width: '48px', height: '48px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px', border: '1px solid #333' }}>
                  <FileText size={24} color={p.type === 'typst' ? '#4ade80' : '#0071e3'}/>
                </div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '17px', fontWeight: 600 }}>{p.name}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#666', fontSize: '12px' }}>
                  <Clock size={14}/>
                  <span>{new Date(p.lastModified).toLocaleDateString()}</span>
                  <span>•</span>
                  <span style={{ textTransform: 'uppercase', fontWeight: 700, color: '#444' }}>{p.type}</span>
                </div>
              </div>
            ))}
          </div>
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
