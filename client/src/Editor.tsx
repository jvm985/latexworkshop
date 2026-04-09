import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { Play, ChevronLeft, Users, Settings, AlertCircle } from 'lucide-react';

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
    if (!token) return navigate('/login');
    axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then(res => {
      setProject(res.data.project);
      if (res.data.documents.length > 0) setActiveDoc(res.data.documents[0]);
    }).catch(() => navigate('/'));

    socketRef.current = io({ path: '/socket.io' });
    return () => { socketRef.current?.disconnect(); };
  }, [id]);

  useEffect(() => {
    if (!activeDoc || !socketRef.current) return;
    socketRef.current.emit('join-document', activeDoc._id);
    socketRef.current.on('document-updated', (content: string) => {
      setActiveDoc((prev: any) => ({ ...prev, content }));
    });
    return () => { socketRef.current?.emit('leave-document', activeDoc._id); };
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
      // Try to get logs from the error blob
      const reader = new FileReader();
      reader.onload = () => {
        const result = JSON.parse(reader.result as string);
        setLogs(result.logs);
      };
      if (err.response?.data) reader.readAsText(err.response.data);
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
          <h2 style={{ margin: 0 }}>{project.name}</h2>
          
          {project.type === 'latex' && (
            <select value={project.compiler} onChange={e => updateSettings({ compiler: e.target.value })} style={{ background: '#444', color: 'white', border: 'none', padding: '5px' }}>
              <option value="pdflatex">PDFLaTeX</option>
              <option value="xelatex">XeLaTeX</option>
              <option value="lualatex">LuaLaTeX</option>
            </select>
          )}

          <div style={{ display: 'flex', gap: '5px' }}>
            <input value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="Email delen..." style={{ background: '#444', border: 'none', color: 'white', padding: '5px 10px', borderRadius: '4px' }}/>
            <button onClick={share} style={{ background: '#555', border: 'none', color: 'white', padding: '5px', borderRadius: '4px' }}><Users size={16}/></button>
          </div>
        </div>

        <button onClick={compile} disabled={compiling} style={{ background: compiling ? '#666' : '#28a745', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer' }}>
          <Play size={16} /> {compiling ? 'Compiling...' : 'Recompile'}
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, borderRight: '1px solid #444' }}>
          <Editor
            height="100%"
            language={project.type === 'typst' ? 'rust' : 'latex'} // Typst has no direct Monaco support, rust is closest
            theme="vs-dark"
            value={activeDoc?.content || ''}
            onChange={handleEditorChange}
            options={{ wordWrap: 'on', fontSize: 16 }}
          />
        </div>

        <div style={{ flex: 1, background: '#525659', position: 'relative' }}>
          {pdfUrl && <iframe src={pdfUrl} width="100%" height="100%" style={{ border: 'none' }} />}
          {logs && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '200px', background: '#2d0000', color: '#ffbaba', padding: '15px', overflowY: 'auto', fontSize: '12px', borderTop: '2px solid #ff0000' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '5px', display: 'flex', alignItems: 'center' }}><AlertCircle size={14}/> Compilation Logs:</div>
              <pre>{logs}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
