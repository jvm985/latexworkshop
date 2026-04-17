import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  FileText, ExternalLink, RefreshCw
} from 'lucide-react';

const API_URL = '/api';

export default function Dashboard() {
  console.log('!!! DASHBOARD MOUNTED !!!');
  
  const [projects, setProjects] = useState([]);
  const [search] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const token = localStorage.getItem('latex_token');
  const userStr = localStorage.getItem('latex_user');
  const user = userStr ? JSON.parse(userStr) : null;

  console.log('Token exists:', !!token);
  console.log('User:', user?.email);

  const fetchProjects = async () => {
    console.log('Calling /api/projects...');
    try {
      const res = await axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } });
      console.log('Projects received:', res.data.length);
      setProjects(res.data);
    } catch (e: any) {
      console.error('Fetch Error:', e.response?.data || e.message);
      if (e.response?.status === 401) {
          console.log('Unauthorized, clearing storage and redirecting');
          localStorage.clear();
          navigate('/login');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    console.log('Dashboard useEffect triggering');
    if (!token) {
      console.log('Redirecting to login due to missing token');
      navigate('/login');
      return;
    }
    fetchProjects();
  }, [token]);

  const create = async () => {
    if (!name) return;
    try {
        await axios.post(`${API_URL}/projects`, { name, type: 'latex' }, { headers: { Authorization: `Bearer ${token}` } });
        fetchProjects();
    } catch (e) { alert('Creation failed'); }
  };
  
  const filteredProjects = projects.filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()));

  if (loading) return (
    <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
        <RefreshCw className="animate-spin" />
        <span style={{ marginLeft: '12px' }}>Laden van projecten...</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100vw', background: '#0f0f0f', color: 'white', fontFamily: 'sans-serif' }}>
        <nav style={{ padding: '12px 40px', background: '#181818', borderBottom: '1px solid #282828', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ background: '#0071e3', padding: '6px', borderRadius: '8px' }}><FileText size={18}/></div>
                <span style={{ fontWeight: 800, fontSize: '18px' }}>LaTeX Workshop</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <div style={{ fontSize: '13px', color: '#888' }}>{user?.email}</div>
                <button onClick={() => { localStorage.clear(); navigate('/login'); }} style={{ background: '#222', border: '1px solid #333', color: '#aaa', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>Logout</button>
            </div>
        </nav>
        
        <main style={{ flex: 1, padding: '40px 80px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: 700 }}>Projecten ({filteredProjects.length})</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Nieuw project..." style={{ background: '#181818', border: '1px solid #333', color: 'white', padding: '8px 12px', borderRadius: '8px', width: '200px' }}/>
                    <button onClick={create} style={{ background: '#0071e3', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Nieuw Project</button>
                </div>
            </div>

            <div style={{ background: '#181818', borderRadius: '12px', border: '1px solid #282828', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ background: '#1e1e1e', color: '#666', fontSize: '11px', textTransform: 'uppercase', borderBottom: '1px solid #282828' }}>
                            <th style={{ padding: '12px 20px' }}>Naam</th>
                            <th style={{ padding: '12px 20px' }}>Type</th>
                            <th style={{ padding: '12px 20px' }}>Datum</th>
                            <th style={{ width: '50px' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredProjects.map((p: any) => (
                            <tr key={p._id} onClick={() => navigate(`/project/${p._id}`)} style={{ borderBottom: '1px solid #1e1e1e', cursor: 'pointer' }}>
                                <td style={{ padding: '16px 20px', fontWeight: 500 }}>{p.name}</td>
                                <td style={{ padding: '16px 20px' }}><span style={{ fontSize: '10px', background: '#222', color: '#888', padding: '2px 8px', borderRadius: '4px' }}>{p.type}</span></td>
                                <td style={{ padding: '16px 20px', color: '#666', fontSize: '13px' }}>{new Date(p.lastModified).toLocaleDateString()}</td>
                                <td style={{ padding: '16px 20px' }}><ExternalLink size={14} color="#333"/></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredProjects.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: '#444' }}>Geen projecten gevonden.</div>}
            </div>
        </main>
    </div>
  );
}
