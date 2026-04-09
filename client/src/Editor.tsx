import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { Play, ChevronLeft, Save } from 'lucide-react';

const API_URL = '/api';

export default function EditorView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [activeDoc, setActiveDoc] = useState<any>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compiling, setCompiling] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('latex_token');
    if (!token) return navigate('/login');

    const loadData = async () => {
      try {
        const res = await axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        setProject(res.data.project);
        setDocuments(res.data.documents);
        if (res.data.documents.length > 0) setActiveDoc(res.data.documents[0]);
      } catch (e) {
        navigate('/');
      }
    };
    loadData();

    // Setup Socket.IO for collaboration (connecting to the same host)
    socketRef.current = io({ path: '/socket.io' });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [id]);

  useEffect(() => {
    if (!activeDoc || !socketRef.current) return;
    
    socketRef.current.emit('join-document', activeDoc._id);

    const handleUpdate = (newContent: string) => {
      // In a full implementation, use operational transformation. 
      // For this prototype, we just overwrite if changes arrive.
      setDocuments(docs => docs.map(d => d._id === activeDoc._id ? { ...d, content: newContent } : d));
      setActiveDoc((d: any) => ({ ...d, content: newContent }));
    };

    socketRef.current.on('document-updated', handleUpdate);

    return () => {
      socketRef.current?.emit('leave-document', activeDoc._id);
      socketRef.current?.off('document-updated', handleUpdate);
    };
  }, [activeDoc?._id]);

  const handleEditorChange = (value: string | undefined) => {
    if (!value || !activeDoc || !socketRef.current) return;
    setActiveDoc({ ...activeDoc, content: value });
    setDocuments(docs => docs.map(d => d._id === activeDoc._id ? { ...d, content: value } : d));
    socketRef.current.emit('edit-document', { documentId: activeDoc._id, content: value });
  };

  const compilePdf = async () => {
    setCompiling(true);
    const token = localStorage.getItem('latex_token');
    try {
      const res = await axios.post(`${API_URL}/compile/${id}`, {}, { 
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPdfUrl(url);
    } catch (err) {
      alert('Compilatiefout! Bekijk de server logs.');
    } finally {
      setCompiling(false);
    }
  };

  if (!project) return <div>Loading...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e1e', color: 'white' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', background: '#333' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', marginRight: '15px' }}><ChevronLeft /></button>
          <h2 style={{ margin: 0, fontSize: '18px' }}>{project.name}</h2>
        </div>
        <button onClick={compilePdf} disabled={compiling} style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', background: compiling ? '#666' : '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: compiling ? 'wait' : 'pointer' }}>
          <Play size={16} style={{ marginRight: '8px' }}/> {compiling ? 'Compiling...' : 'Recompile'}
        </button>
      </div>

      {/* Main Area */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Editor */}
        <div style={{ flex: 1, borderRight: '1px solid #444' }}>
          <Editor
            height="100%"
            language="latex"
            theme="vs-dark"
            value={activeDoc?.content || ''}
            onChange={handleEditorChange}
            options={{ wordWrap: 'on', minimap: { enabled: false }, fontSize: 16 }}
          />
        </div>

        {/* PDF Viewer */}
        <div style={{ flex: 1, background: '#525659', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {pdfUrl ? (
            <iframe src={pdfUrl} width="100%" height="100%" style={{ border: 'none' }} title="PDF Preview" />
          ) : (
            <div style={{ color: '#aaa' }}>Klik op Recompile om de PDF te genereren.</div>
          )}
        </div>
      </div>
    </div>
  );
}
