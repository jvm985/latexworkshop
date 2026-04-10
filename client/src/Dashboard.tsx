import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { 
  FileText, Plus, LogOut, Search, Clock, 
  Trash2, Shield, Layers, Loader2
} from 'lucide-react';

const API_URL = '/api';

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('latex');
  const token = localStorage.getItem('latex_token');
  const user = JSON.parse(localStorage.getItem('latex_user') || '{}');

  const fetchProjects = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects`, { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      setProjects(res.data);
    } catch (e) {
      navigate('/login');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    fetchProjects();
  }, [token]);

  const createProject = async () => {
    if (!newName) return;
    try {
      const res = await axios.post(`${API_URL}/projects`, 
        { name: newName, type: newType }, 
        { headers: { Authorization: `Bearer ${token}` } }
      );
      navigate(`/project/${res.data._id}`);
    } catch (e) {
      alert('Failed to create project.');
    }
  };

  const deleteProject = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;
    try {
      await axios.delete(`${API_URL}/projects/${id}`, { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      fetchProjects();
    } catch (e) {
      alert('Failed to delete project.');
    }
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
      <Loader2 className="animate-spin" />
    </div>
  );

  return (
    <div style={{ background: '#1e1e1e', minHeight: '100vh', color: 'white', fontFamily: 'system-ui, sans-serif' }}>
      <nav style={{ height: '64px', background: '#252526', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 40px', borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#0071e3', padding: '8px', borderRadius: '8px' }}>
            <Layers color="white" size={24} />
          </div>
          <span style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.5px' }}>LaTeX Workshop</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#666' }} size={16} />
            <input 
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects..." 
              style={{ background: '#1e1e1e', border: '1px solid #333', padding: '10px 12px 10px 40px', borderRadius: '10px', color: 'white', width: '300px', outline: 'none', transition: 'border-color 0.2s' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '16px', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>{user.name?.[0]}</div>
              <button 
                onClick={() => { localStorage.clear(); navigate('/login'); }}
                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <LogOut size={20} />
              </button>
          </div>
        </div>
      </nav>

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '48px 40px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '40px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '32px', fontWeight: 800 }}>Welcome back</h1>
            <p style={{ color: '#888', marginTop: '8px' }}>You have {projects.length} projects in your workspace.</p>
          </div>
          <button 
            onClick={() => setShowNew(true)}
            style={{ background: '#0071e3', color: 'white', border: 'none', padding: '12px 24px', borderRadius: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', transition: 'transform 0.1s' }}
          >
            <Plus size={20} /> New Project
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
          {filteredProjects.map(project => (
            <div 
              key={project._id}
              onClick={() => navigate(`/project/${project._id}`)}
              style={{ background: '#252526', borderRadius: '20px', border: '1px solid #333', padding: '24px', cursor: 'pointer', transition: 'all 0.2s', position: 'relative' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#444'; e.currentTarget.style.transform = 'translateY(-4px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div style={{ background: project.type === 'latex' ? '#0071e322' : project.type === 'typst' ? '#28a74522' : '#ffc10722', padding: '12px', borderRadius: '14px' }}>
                  <FileText color={project.type === 'latex' ? '#0071e3' : project.type === 'typst' ? '#28a745' : '#ffc107'} size={24} />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <span style={{ fontSize: '10px', background: '#1e1e1e', padding: '4px 8px', borderRadius: '6px', color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>{project.type}</span>
                    <button 
                        onClick={(e) => { e.stopPropagation(); deleteProject(project._id); }}
                        style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', padding: '4px' }}
                    >
                        <Trash2 size={18} />
                    </button>
                </div>
              </div>
              
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>{project.name}</h3>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#666', fontSize: '13px', marginTop: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={14} />
                  {new Date(project.lastModified).toLocaleDateString()}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Shield size={14} />
                  {project.owner.email.split('@')[0]}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }}>
          <div style={{ background: '#252526', width: '450px', borderRadius: '24px', border: '1px solid #333', padding: '40px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
            <h2 style={{ margin: '0 0 24px 0', fontSize: '24px', fontWeight: 800 }}>Create New Project</h2>
            
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', color: '#888', fontSize: '13px', marginBottom: '8px', fontWeight: 600 }}>Project Name</label>
              <input 
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="My awesome paper..."
                autoFocus
                style={{ width: '100%', background: '#1e1e1e', border: '1px solid #333', padding: '14px', borderRadius: '12px', color: 'white', outline: 'none', fontSize: '16px' }}
              />
            </div>

            <div style={{ marginBottom: '32px' }}>
              <label style={{ display: 'block', color: '#888', fontSize: '13px', marginBottom: '8px', fontWeight: 600 }}>Document Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                {['latex', 'typst', 'markdown'].map(t => (
                  <button 
                    key={t}
                    onClick={() => setNewType(t)}
                    style={{ background: newType === t ? '#0071e3' : '#1e1e1e', color: newType === t ? 'white' : '#888', border: '1px solid', borderColor: newType === t ? '#0071e3' : '#333', padding: '12px', borderRadius: '12px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', textTransform: 'capitalize' }}
                  >
                    {t === 'latex' ? 'LaTeX' : t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setShowNew(false)}
                style={{ flex: 1, background: '#333', color: 'white', border: 'none', padding: '14px', borderRadius: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button 
                onClick={createProject}
                style={{ flex: 1, background: '#0071e3', color: 'white', border: 'none', padding: '14px', borderRadius: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
