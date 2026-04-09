import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { 
  Play, ChevronLeft, AlertCircle, FileText, 
  Settings, Terminal, Eye
} from 'lucide-react';

const API_URL = '/api';

export default function EditorView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [activeDoc, setActiveDoc] = useState<any>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [view, setView] = useState<'split' | 'logs'>('split');
  const socketRef = useRef<Socket | null>(null);

  const token = localStorage.getItem('latex_token');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    const loadData = async () => {
      try {
        const res = await axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        setProject(res.data.project);
        if (res.data.documents.length > 0) setActiveDoc(res.data.documents[0]);
      } catch (e) {
        navigate('/');
      }
    };
    loadData();

    socketRef.current = io({ path: '/socket.io' });
    return () => { socketRef.current?.disconnect(); };
  }, [id, navigate, token]);

  useEffect(() => {
    if (!activeDoc || !socketRef.current) return;
    const socket = socketRef.current;
    socket.emit('join-document', activeDoc._id);
    const onUpdate = (content: string) => setActiveDoc((prev: any) => ({ ...prev, content }));
    socket.on('document-updated', onUpdate);
    return () => {
      socket.emit('leave-document', activeDoc._id);
      socket.off('document-updated', onUpdate);
    };
  }, [activeDoc?._id]);

  const handleEditorChange = (value: string | undefined) => {
    if (!value || !activeDoc) return;
    setActiveDoc({ ...activeDoc, content: value });
    socketRef.current?.emit('edit-document', { documentId: activeDoc._id, content: value });
  };

  const updateSettings = async (updates: any) => {
    const res = await axios.patch(`${API_URL}/projects/${id}`, updates, { headers: { Authorization: `Bearer ${token}` } });
    setProject(res.data);
  };

  const compile = async () => {
    setCompiling(true);
    setLogs(null);
    try {
      const res = await axios.post(`${API_URL}/compile/${id}`, {}, { 
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });
      setPdfUrl(window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })));
      setView('split');
    } catch (err: any) {
      if (err.response?.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const result = JSON.parse(reader.result as string);
            setLogs(result.logs || 'Fout zonder logs.');
            setView('logs');
          } catch(e) { setLogs('Fout bij verwerken van logs.'); setView('logs'); }
        };
        reader.readAsText(err.response.data);
      }
    } finally {
      setCompiling(false);
    }
  };

  if (!project) return <div style={{ background: '#1e1e1e', height: '100vh', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Laden...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e1e', color: 'white', fontFamily: 'Inter, sans-serif' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', height: '50px', background: '#252526', borderBottom: '1px solid #3c3c3c', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', padding: '5px', display: 'flex' }} title="Back to Projects"><ChevronLeft size={20}/></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileText size={18} color="#0071e3"/>
            <span style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '0.3px' }}>{project.name}</span>
            <span style={{ fontSize: '10px', background: '#3e3e3e', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', color: '#aaa' }}>{project.type}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          {project.type === 'latex' && (
            <div style={{ display: 'flex', alignItems: 'center', background: '#3c3c3c', padding: '2px 8px', borderRadius: '4px' }}>
              <Settings size={14} style={{ marginRight: '8px', color: '#888' }}/>
              <select value={project.compiler} onChange={e => updateSettings({ compiler: e.target.value })} style={{ background: 'none', color: '#eee', border: 'none', fontSize: '13px', outline: 'none', cursor: 'pointer' }}>
                <option value="pdflatex">PDFLaTeX</option>
                <option value="xelatex">XeLaTeX</option>
                <option value="lualatex">LuaLaTeX</option>
              </select>
            </div>
          )}

          <div style={{ height: '20px', width: '1px', background: '#444' }}></div>

          <button onClick={() => setView(view === 'logs' ? 'split' : 'logs')} style={{ background: view === 'logs' ? '#4d4d4d' : 'none', border: 'none', color: logs ? '#ff5f56' : '#ccc', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '5px 10px', borderRadius: '4px' }}>
            <Terminal size={16}/> {logs ? 'Errors' : 'Logs'}
          </button>

          <button onClick={compile} disabled={compiling} style={{ background: compiling ? '#444' : '#28a745', color: 'white', border: 'none', padding: '6px 16px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Play size={14} fill="currentColor"/> {compiling ? 'Compiling...' : 'Recompile'}
          </button>
        </div>
      </nav>

      <main style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {view === 'split' ? (
          <>
            <div style={{ flex: 1, borderRight: '1px solid #333' }}>
              <Editor
                height="100%"
                language={project.type === 'typst' ? 'rust' : 'latex'}
                theme="vs-dark"
                value={activeDoc?.content || ''}
                onChange={handleEditorChange}
                options={{ wordWrap: 'on', fontSize: 15, minimap: { enabled: false }, lineNumbers: 'on', padding: { top: 20 } }}
              />
            </div>

            <div style={{ flex: 1, background: '#323639', display: 'flex', flexDirection: 'column' }}>
              {pdfUrl ? (
                <iframe src={pdfUrl} width="100%" height="100%" style={{ border: 'none' }} title="PDF Preview" />
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                  <Eye size={48} style={{ marginBottom: '15px', opacity: 0.2 }}/>
                  <p>Click Recompile to generate PDF</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ flex: 1, background: '#1e1e1e', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '20px 40px', background: '#2d2d2d', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '10px', color: logs ? '#ff5f56' : '#4ade80' }}>
                {logs ? <AlertCircle /> : <Terminal />} {logs ? 'Compilation Errors Found' : 'Compilation Output'}
              </h2>
              <button onClick={() => setView('split')} style={{ background: '#0071e3', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '6px', cursor: 'pointer' }}>Close Logs</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '40px', background: '#000' }}>
              <pre style={{ fontFamily: 'monospace', fontSize: '14px', lineHeight: '1.6', color: '#d4d4d4', margin: 0, whiteSpace: 'pre-wrap' }}>
                {logs || 'No logs available. Last compilation was successful.'}
              </pre>
            </div>
          </div>
        )}
      </main>

      <footer style={{ height: '22px', background: '#007acc', display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '11px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '15px' }}><span>Ready</span><span>UTF-8</span></div>
        <div style={{ display: 'flex', gap: '15px' }}><span>{project.compiler}</span><span>Lines: {activeDoc?.content.split('\n').length || 0}</span></div>
      </footer>
    </div>
  );
}
