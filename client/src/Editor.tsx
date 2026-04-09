import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { Play, ChevronLeft, Users, AlertCircle } from 'lucide-react';

const API_URL = '/api';

export default function EditorView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [activeDoc, setActiveDoc] = useState<any>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState('');
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
    
    const onUpdate = (content: string) => {
      setActiveDoc((prev: any) => ({ ...prev, content }));
    };
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

  const share = async () => {
    if (!shareEmail) return;
    await axios.post(`${API_URL}/projects/${id}/share`, { email: shareEmail, permission: 'write' }, { headers: { Authorization: `Bearer ${token}` } });
    setShareEmail('');
    alert('Project gedeeld!');
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
    } catch (err: any) {
      if (err.response?.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const result = JSON.parse(reader.result as string);
            setLogs(result.logs || 'Onbekende fout.');
          } catch(e) { setLogs('Fout bij verwerken van logs.'); }
        };
        reader.readAsText(err.response.data);
      } else {
        setLogs('Compilatie mislukt. Controleer de server.');
      }
    } finally {
      setCompiling(false);
    }
  };

  if (!project) return <div>Laden...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e1e', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 20px', background: '#333', borderBottom: '1px solid #444' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}><ChevronLeft /></button>
          <h2 style={{ margin: 0, fontSize: '18px' }}>{project.name}</h2>
          
          {project.type === 'latex' && (
            <select value={project.compiler} onChange={e => updateSettings({ compiler: e.target.value })} style={{ background: '#444', color: 'white', border: 'none', padding: '5px', borderRadius: '4px' }}>
              <option value="pdflatex">PDFLaTeX</option>
              <option value="xelatex">XeLaTeX</option>
              <option value="lualatex">LuaLaTeX</option>
            </select>
          )}

          <div style={{ display: 'flex', gap: '5px' }}>
            <input value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="Delen met email..." style={{ background: '#444', border: 'none', color: 'white', padding: '5px 10px', borderRadius: '4px', fontSize: '13px' }}/>
            <button onClick={share} style={{ background: '#555', border: 'none', color: 'white', padding: '5px', borderRadius: '4px', cursor: 'pointer' }}><Users size={16}/></button>
          </div>
        </div>

        <button onClick={compile} disabled={compiling} style={{ background: compiling ? '#666' : '#28a745', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Play size={16} /> {compiling ? 'Compiling...' : 'Recompile'}
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, borderRight: '1px solid #444' }}>
          <Editor
            height="100%"
            language={project.type === 'typst' ? 'rust' : 'latex'}
            theme="vs-dark"
            value={activeDoc?.content || ''}
            onChange={handleEditorChange}
            options={{ wordWrap: 'on', fontSize: 16, minimap: { enabled: false } }}
          />
        </div>

        <div style={{ flex: 1, background: '#525659', position: 'relative' }}>
          {pdfUrl && <iframe src={pdfUrl} width="100%" height="100%" style={{ border: 'none' }} title="PDF Preview" />}
          {logs && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '250px', background: '#2d0000', color: '#ffbaba', padding: '15px', overflowY: 'auto', fontSize: '12px', borderTop: '2px solid #ff0000', zIndex: 10 }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertCircle size={16}/> Compilation Error:</div>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{logs}</pre>
            </div>
          )}
          {!pdfUrl && !logs && !compiling && (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc' }}>
              Klik op Recompile om de PDF te genereren.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
