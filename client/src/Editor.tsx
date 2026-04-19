import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor, { loader } from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { 
  Play, ChevronLeft, FileText, 
  X, 
  ChevronDown, ChevronRight,
  LogOut, Loader, 
  Eraser, Database, Link, FilePlus, FolderPlus, Trash2, 
  MoreVertical, Edit3, Folder, ImageIcon, CheckCircle2, Download, Copy, AlertCircle, Check
} from 'lucide-react';

import { Viewer, Worker, SpecialZoomLevel } from '@react-pdf-viewer/core';
import { zoomPlugin } from '@react-pdf-viewer/zoom';
import '@react-pdf-viewer/core/lib/styles/index.css';
import '@react-pdf-viewer/zoom/lib/styles/index.css';

const API_URL = '/api';

// --- ADVANCED MONACO SETUP ---
loader.init().then(monaco => {
  monaco.languages.register({ id: 'latex' });
  monaco.languages.setMonarchTokensProvider('latex', {
    defaultToken: '',
    tokenPostfix: '.latex',
    tokenizer: {
      root: [
        [/\\(?:[a-zA-Z]+|.)/, 'keyword'],
        [/\{/, { token: 'delimiter.curly', bracket: '@open' }],
        [/\}/, { token: 'delimiter.curly', bracket: '@close' }],
        [/\[/, { token: 'delimiter.square', bracket: '@open' }],
        [/\]/, { token: 'delimiter.square', bracket: '@close' }],
        [/%/, { token: 'comment', next: '@comment' }],
        [/\$.*?\$/, 'variable'],
        [/&/, 'operator'],
        [/\\\\/, 'operator'],
      ],
      comment: [
        [/[^%]+/, 'comment'],
        [/$/, 'comment', '@pop'],
      ],
    }
  });

  monaco.languages.register({ id: 'typst' });
  monaco.languages.setMonarchTokensProvider('typst', {
    tokenizer: {
      root: [
        [/^#.*/, 'comment'],
        [/^= .*/, 'keyword'],
        [/\[/, { token: 'string', bracket: '@open', next: '@string' } as any],
        [/\$.*\$/, 'variable'],
        [/[{}()\[\]]/, '@brackets'],
        [/[a-zA-Z_]\w*/, 'identifier'],
      ],
      string: [
        [/[^\]]+/, 'string'],
        [/\]/, { token: 'string', bracket: '@close', next: '@pop' } as any],
      ],
    }
  });
});

export default function EditorView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [activeDoc, setActiveDoc] = useState<any>(null);
  
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [rResult, setRResult] = useState<{ stdout: string, plots: string[], variables: any } | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  
  const [compiling, setCompiling] = useState(false);
  const [lastStatus, setLastStatus] = useState<'success' | 'error' | 'none'>('none');
  const [showCompilerMenu, setShowCompilerMenu] = useState(false);
  
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<any[]>([]);
  const [browsingProject, setBrowsingProject] = useState<any>(null);
  const [browsingDocs, setBrowsingDocs] = useState<any[]>([]);
  const [linkTargetDoc, setLinkTargetDoc] = useState<any>(null);
  
  const [leftWidth, setLeftWidth] = useState(240);
  const [editorWidth, setEditorWidth] = useState(50);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ '/': true });
  
  const [activeItemMenu, setActiveItemMenu] = useState<string | null>(null);
  const [dragOverNode, setDragOverNode] = useState<string | null>(null);
  
  const [user] = useState<any>(JSON.parse(localStorage.getItem('latex_user') || '{}'));
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  
  const [activeTab, setActiveTab] = useState<'plots' | 'variables'>('plots');
  const [currentPlotIndex, setCurrentPlotPlotIndex] = useState(0);
  const [outputHeight, setOutputHeight] = useState(150);
  
  const isResizingSidebarRef = useRef(false);
  const isResizingRef = useRef(false);
  const isResizingOutputRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const editorRef = useRef<any>(null);
  const activeDocIdRef = useRef<string | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  
  const token = localStorage.getItem('latex_token');
  const zoomPluginInstance = zoomPlugin();

  useEffect(() => {
    if (project) {
        document.title = `${project.name} - ${activeDoc?.name || 'Editor'} | Docs`;
    }
  }, [project, activeDoc]);

  const fetchAll = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setProject(res.data.project);
      setDocuments(res.data.documents);
      if (res.data.documents.length > 0 && !activeDocIdRef.current) {
        const main = res.data.documents.find((d: any) => d.isMain) || res.data.documents.find((d: any) => d.name.toLowerCase() === 'main.tex' || d.name.toLowerCase() === 'main.typ' || d.name.toLowerCase() === 'main.md') || res.data.documents.find((d: any) => !d.isFolder && !d.isBinary) || res.data.documents[0];
        switchDoc(main);
      }
    } catch (e) { navigate('/'); }
  };

  useEffect(() => {
    if (!token) { navigate('/login'); return; }
    fetchAll();
    socketRef.current = io({ path: '/socket.io', transports: ['websocket'] });
    return () => { socketRef.current?.disconnect(); };
  }, [id, token]);

  const compile = async () => {
    if (compiling) return;
    setCompiling(true);
    setShowLogs(false);
    try {
      const currentDoc = activeDocIdRef.current ? documents.find(d => d._id === activeDocIdRef.current) : null;
      const isR = currentDoc?.name.match(/\.[Rr]$/);
      let contentToRun = editorRef.current ? editorRef.current.getValue() : currentDoc?.content;

      if (isR && editorRef.current) {
          const selection = editorRef.current.getSelection();
          if (selection && !selection.isEmpty()) {
              contentToRun = editorRef.current.getModel().getValueInRange(selection);
          } else {
              const pos = editorRef.current.getPosition();
              contentToRun = editorRef.current.getModel().getLineContent(pos.lineNumber);
              editorRef.current.setPosition({ lineNumber: pos.lineNumber + 1, column: 1 });
              editorRef.current.revealLine(pos.lineNumber + 1);
          }
          editorRef.current.focus();
      }

      const res = await axios.post(`${API_URL}/compile/${id}`, { currentContent: contentToRun, currentFileId: currentDoc?._id }, { headers: { Authorization: `Bearer ${token}` }, responseType: isR ? 'json' : 'blob' });
      
      if (isR) {
          setRResult((prev: any) => ({ ...res.data, stdout: (prev?.stdout || '') + res.data.stdout + '\n', plots: [...(prev?.plots || []), ...(res.data.plots || [])] }));
          if (res.data.plots?.length > 0) { setActiveTab('plots'); setCurrentPlotPlotIndex((prev:any) => (prev || 0) + res.data.plots.length - 1); }
      } else {
          // Check for logs in header
          const b64Logs = res.headers['x-compilation-logs'];
          if (b64Logs) {
              try { setLogs(atob(b64Logs)); } catch(e) { console.error('Failed to decode logs'); }
          }

          const blob = new Blob([res.data], { type: 'application/pdf' });
          setPdfUrl(window.URL.createObjectURL(blob));
          setRResult(null);
          setLastStatus('success');
      }
    } catch (err: any) {
        setLastStatus('error');
        
        // Check voor logs in headers van de error respons
        const b64Logs = err.response?.headers?.['x-compilation-logs'];
        if (b64Logs) {
            try { setLogs(atob(b64Logs)); } catch(e) { console.error('Failed to decode error logs'); }
        }

        if (err.response?.data instanceof Blob) {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const errorData = JSON.parse(reader.result as string);
                    if (!logs) setLogs(errorData.logs || errorData.error || 'Onbekende fout');
                    setShowLogs(true);
                } catch(e) { if (!logs) setLogs('Fout bij compileren'); }
            };
            reader.readAsText(err.response.data);
        } else if (err.response?.data) {
            if (!logs) setLogs(err.response.data.logs || err.response.data.error || 'Compilatie mislukt');
            setShowLogs(true);
        }
    } finally { setCompiling(false); }
  };

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [rResult]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); compile(); } };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeDoc, compiling, documents]);

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined || !activeDoc || activeDoc.isLink) return;
    setDocuments(prev => prev.map(d => d._id === activeDoc._id ? { ...d, content: value } : d));
    socketRef.current?.emit('edit-document', { documentId: activeDoc._id, content: value });
  };

  const switchDoc = async (item: any, folderPath?: string) => {
      console.log('Switching to document:', item?.name, 'ID:', item?._id, 'isLink:', item?.isLink);
      if (!item) return;
      if (item._isFolder) {
          if (folderPath) setExpandedFolders(prev => ({ ...prev, [folderPath]: !prev[folderPath] }));
          return;
      }
      let fullDoc = item;
      const needsLazyLoad = (item.isFolder === false) && (
          (item.isBinary === false && (item.content === undefined || item.content === "")) ||
          (item.isBinary === true && (item.binaryData === undefined || item.binaryData === null))
      );

      if (needsLazyLoad) {
          console.log('Lazy loading content for:', item.name);
          try {
              const res = await axios.get(`${API_URL}/projects/${id}/files/${item._id}`, { headers: { Authorization: `Bearer ${token}` } });
              fullDoc = res.data;
              console.log('Received content for:', fullDoc.name, 'Length:', fullDoc.content?.length);
              setDocuments(prev => prev.map(d => d._id === item._id ? fullDoc : d));
          } catch (e) { console.error('Lazy load failed for', item.name, e); }
      }
      setActiveDoc(fullDoc);
      activeDocIdRef.current = fullDoc._id;
  };

  const toggleVar = (name: string) => {
    const next = new Set(expandedVars);
    if (next.has(name)) next.delete(name); else next.add(name);
    setExpandedVars(next);
  };

  const createLink = async (targetProjectId: string, targetDoc: any) => {
      const parent = activeDoc?.isFolder ? activeDoc : null;
      const targetPath = parent ? (parent.path + parent.name + '/') : '/';
      try {
          await axios.post(`${API_URL}/projects/${id}/links`, { targetProjectId, targetDocumentId: targetDoc._id, name: targetDoc.name, path: targetPath }, { headers: { Authorization: `Bearer ${token}` } });
          setShowLinkModal(false); fetchAll();
      } catch (e: any) { alert(e.response?.data || 'Link failed'); }
  };

  const addFile = async (isFolder: boolean, parent?: any) => {
    const name = prompt(`Enter ${isFolder ? 'folder' : 'file'} name:`);
    if (!name) return;
    let path = ""; const base = parent || activeDoc;
    if (base && base.isFolder) path = base.path + base.name + "/"; else if (base && base.path) path = base.path;
    await axios.post(`${API_URL}/projects/${id}/files`, { name, isFolder, path }, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll();
  };

  const deleteFile = async (docId: string) => {
    if (!confirm('Delete item?')) return;
    await axios.delete(`${API_URL}/projects/${id}/files/${docId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (activeDoc?._id === docId) setActiveDoc(null);
    fetchAll();
  };

  const renameFile = async (doc: any) => {
      const newName = prompt('Enter new name:', doc.name);
      if (!newName || newName === doc.name) return;
      await axios.patch(`${API_URL}/projects/${id}/files/${doc._id}`, { name: newName }, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const copyFile = async (doc: any) => {
      const newName = prompt('New name:', doc.name + ' (copy)'); if (!newName) return;
      await axios.post(`${API_URL}/projects/${id}/files`, { name: newName, isFolder: doc.isFolder, isBinary: doc.isBinary, path: doc.path, content: doc.content, binaryData: doc.binaryData }, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const moveFile = async (docId: string, newPath: string) => {
      await axios.patch(`${API_URL}/projects/${id}/files/${docId}`, { path: newPath }, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const setAsMain = async (fileId: string) => {
      await axios.post(`${API_URL}/projects/${id}/files/${fileId}/main`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const updateProject = async (updates: any) => {
      try {
          const res = await axios.patch(`${API_URL}/projects/${id}`, updates, { headers: { Authorization: `Bearer ${token}` } });
          setProject(res.data);
      } catch(e) {}
  };

  const buildTree = () => {
    const root: any = { _isFolder: true, _children: {} };
    // Sorteer documenten zodat links aan het einde komen (lokale bestanden eerst)
    const sortedDocs = [...documents].sort((a, b) => (a.isLink ? 1 : 0) - (b.isLink ? 0 : 1));
    
    sortedDocs.forEach(doc => {
      const parts = (doc.path + (doc.isFolder ? "" : doc.name)).split('/').filter(Boolean);
      if (doc.isFolder) parts.push(doc.name); 
      let current = root;
      parts.forEach((part: string, index: number) => {
        const isLast = index === parts.length - 1;
        if (isLast && !doc.isFolder) {
            // Overschrijf alleen als het geen link is, of als er nog niets staat
            if (!current._children[part] || !doc.isLink) {
                current._children[part] = doc;
            }
        }
        else {
          if (!current._children[part]) current._children[part] = { _isFolder: true, _children: {}, _doc: null, _path: doc.path, _name: part };
          if (isLast && doc.isFolder) {
              if (!current._children[part]._doc || !doc.isLink) {
                  current._children[part]._doc = doc;
              }
          }
          current = current._children[part];
        }
      });
    });
    return root;
  };

  const onDragStart = (e: React.DragEvent, doc: any) => { if (doc) e.dataTransfer.setData('docId', doc._id); };
  const onDrop = (e: React.DragEvent, targetPath: string, isFolder: boolean) => {
      e.preventDefault(); setDragOverNode(null);
      const docId = e.dataTransfer.getData('docId');
      // Als we op een folder droppen, is targetPath het nieuwe pad (bijv. "map/")
      // Als we op een bestand droppen, willen we naar de map van dat bestand (de parent)
      let finalPath = targetPath;
      if (!isFolder) {
          const parts = targetPath.split('/').filter(Boolean);
          parts.pop(); // Verwijder de bestandsnaam
          finalPath = parts.length > 0 ? parts.join('/') + '/' : '';
      }
      if (docId) moveFile(docId, finalPath);
  };

  const renderNode = (node: any, path: string, depth: number) => {
    const keys = Object.keys(node._children || {}).sort((a, b) => {
        const itemA = node._children[a]; const itemB = node._children[b];
        if (!!itemA._isFolder && !itemB._isFolder) return -1;
        if (!itemA._isFolder && !!itemB._isFolder) return 1;
        return a.localeCompare(b);
    });
    return keys.map(key => {
      const item = node._children[key]; const isFolderNode = !!item._isFolder;
      const folderPath = `${path}${key}/`; const isExpanded = expandedFolders[folderPath];
      const doc = isFolderNode ? item._doc : item;
      const itemId = doc?._id || folderPath;
      return (
        <div key={itemId} onDragOver={(e) => { e.preventDefault(); setDragOverNode(itemId); }} onDragLeave={() => setDragOverNode(null)} onDrop={(e) => onDrop(e, folderPath, isFolderNode)} style={{ background: dragOverNode === itemId ? 'rgba(0,113,227,0.1)' : 'transparent' }}>
          <div onClick={() => switchDoc(item, folderPath)} draggable={!!doc} onDragStart={(e) => onDragStart(e, doc)} style={{ display: 'flex', alignItems: 'center', padding: `4px 12px 4px ${depth * 12 + 12}px`, cursor: 'pointer', fontSize: '13px', background: activeDoc?._id === doc?._id ? '#37373d' : 'transparent', color: activeDoc?._id === doc?._id ? '#fff' : (doc?.isMain ? '#4ade80' : '#aaa'), gap: '8px', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                {isFolderNode ? (isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>) : null}
                {isFolderNode ? <Folder size={14} style={{ color: '#dcb67a' }}/> : (doc?.isBinary ? <ImageIcon size={14} color="#dcb67a"/> : <FileText size={14} color="#519aba"/>)}
                <span style={{ fontStyle: doc?.isLink ? 'italic' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{key}</span>
                {doc?.isMain && <CheckCircle2 size={12} color="#4ade80"/>}
            </div>
            <div style={{ position: 'relative' }}>
                <button onClick={(e) => { e.stopPropagation(); setActiveItemMenu(activeItemMenu === itemId ? null : itemId); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><MoreVertical size={14}/></button>
                {activeItemMenu === itemId && (
                    <div style={{ position: 'absolute', top: '100%', right: 0, background: '#252526', border: '1px solid #444', borderRadius: '6px', zIndex: 200, width: '160px', padding: '4px', boxShadow: '0 5px 15px rgba(0,0,0,0.5)' }}>
                        <button onClick={(e) => { e.stopPropagation(); if (doc) renameFile(doc); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Edit3 size={12}/> Rename</button>
                        <button onClick={(e) => { e.stopPropagation(); if (doc) copyFile(doc); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Copy size={12}/> Copy</button>
                        {doc && !doc.isFolder && <a href={`${API_URL}/projects/${id}/files/${doc._id}/raw`} download={doc.name} onClick={(e) => e.stopPropagation()} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}><Download size={12}/> Download</a>}
                        {doc && !doc.isMain && !doc.isBinary && !doc.isFolder && (
                            <button onClick={(e) => { e.stopPropagation(); setAsMain(doc._id); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#4ade80', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle2 size={12}/> Set Main</button>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); if (doc) deleteFile(doc._id); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ff5f56', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Trash2 size={12}/> Delete</button>
                        <div style={{ borderTop: '1px solid #333', margin: '4px 0' }}></div>
                        <button onClick={(e) => { e.stopPropagation(); addFile(false, doc || item); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><FilePlus size={12}/> New File</button>
                        <button onClick={(e) => { e.stopPropagation(); addFile(true, doc || item); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><FolderPlus size={12}/> New Folder</button>
                    </div>
                )}
            </div>
          </div>
          {isFolderNode && isExpanded && renderNode(item, folderPath, depth + 1)}
        </div>
      );
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebarRef.current) setLeftWidth(Math.max(150, Math.min(500, e.clientX)));
      if (isResizingRef.current) {
        const offset = leftWidth + 4; const percentage = ((e.clientX - offset) / (window.innerWidth - offset)) * 100;
        setEditorWidth(Math.max(10, Math.min(90, percentage)));
      }
      if (isResizingOutputRef.current) {
          const rect = document.getElementById('results-container')?.getBoundingClientRect();
          if (rect) setOutputHeight(Math.max(50, Math.min(rect.height - 50, e.clientY - rect.top)));
      }
    };
    const handleMouseUp = () => { isResizingSidebarRef.current = false; isResizingRef.current = false; isResizingOutputRef.current = false; };
    window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [leftWidth]);

  if (!project) return null;

  const renderBinaryContent = () => {
      if (!activeDoc || !activeDoc.isBinary) return null;
      const ext = activeDoc.name.toLowerCase().split('.').pop();
      const b64 = activeDoc.binaryData?.data ? btoa(String.fromCharCode(...new Uint8Array(activeDoc.binaryData.data))) : null;
      if (!b64) return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading binary...</div>;

      if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext!)) {
          return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflow: 'auto' }}><img src={`data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }} alt={activeDoc.name} /></div>;
      }
      if (ext === 'pdf') {
          return <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js"><div style={{ height: '100%' }}><Viewer fileUrl={`data:application/pdf;base64,${b64}`} plugins={[zoomPluginInstance]} defaultScale={SpecialZoomLevel.PageWidth} /></div></Worker>;
      }
      return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Binary File: {activeDoc.name} ({ext})</div>;
  };

  const getLanguage = (filename: string) => {
      const ext = filename.toLowerCase().split('.').pop();
      if (['tex', 'cls', 'sty'].includes(ext!)) return 'latex';
      if (ext === 'rmd' || ext === 'md') return 'markdown';
      if (ext === 'typ') return 'typst';
      if (ext === 'r') return 'r';
      if (ext === 'json') return 'json';
      if (['js', 'ts', 'tsx', 'jsx'].includes(ext!)) return 'typescript';
      if (['py', 'python'].includes(ext!)) return 'python';
      if (['css', 'scss', 'sass'].includes(ext!)) return 'css';
      if (ext === 'html') return 'html';
      return 'plaintext';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#1e1e1e', color: 'white', overflow: 'hidden' }} onClick={() => { setActiveItemMenu(null); setShowCompilerMenu(false); }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', height: '48px', background: '#252526', borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><ChevronLeft size={20}/></button>
          <span style={{ fontWeight: 700 }}>{project.name}</span>
          <span style={{ fontSize: '10px', background: '#333', padding: '2px 6px', borderRadius: '4px', color: '#888' }}>DOCS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '24px', height: '24px', borderRadius: '12px', background: '#333', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{user.name?.[0]}</div>
            <button onClick={() => { localStorage.clear(); navigate('/login'); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><LogOut size={18}/></button>
        </div>
      </nav>

      <main style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <aside style={{ width: `${leftWidth}px`, background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#555' }}>EXPLORER</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={async (e) => { e.stopPropagation(); const res = await axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } }); setAvailableProjects(res.data.filter((p:any)=>p._id!==id)); setShowLinkModal(true); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><Link size={14}/></button>
              <button onClick={() => addFile(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><FilePlus size={14}/></button>
              <button onClick={() => addFile(true)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><FolderPlus size={14}/></button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>{renderNode(buildTree(), '/', 0)}</div>
        </aside>
        <div onMouseDown={() => isResizingSidebarRef.current = true} style={{ width: '4px', cursor: 'col-resize', background: 'transparent', zIndex: 50 }}></div>

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: `${editorWidth}%`, height: '100%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
                <div style={{ background: '#2d2d2d', padding: '8px 16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '12px', color: '#aaa' }}>{activeDoc?.name}</span>
                        <button onClick={() => switchDoc({...activeDoc, content: undefined})} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '10px', textDecoration: 'underline' }}>Update</button>
                        <div style={{ width: '8px', height: '8px', borderRadius: '4px', background: lastStatus === 'success' ? '#4ade80' : lastStatus === 'error' ? '#ff5f56' : 'transparent' }}></div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={(e) => { e.stopPropagation(); setShowLogs(!showLogs); }} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Logs</button>
                        
                        <div style={{ position: 'relative', display: 'flex', background: '#28a745', borderRadius: '4px', overflow: 'visible' }}>
                            <button onClick={(e) => { e.stopPropagation(); compile(); }} disabled={compiling} style={{ background: 'none', color: 'white', border: 'none', padding: '4px 12px', borderRadius: '4px 0 0 4px', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', borderRight: activeDoc?.name.toLowerCase().endsWith('.tex') ? '1px solid rgba(0,0,0,0.1)' : 'none' }}><Play size={12}/> {compiling ? '...' : (activeDoc?.name.match(/\.[Rr]$/) ? 'Run' : (project?.compiler === 'pdflatex' ? 'Compile' : project?.compiler))}</button>
                            {activeDoc?.name.toLowerCase().endsWith('.tex') && (
                                <button onClick={(e) => { e.stopPropagation(); setShowCompilerMenu(!showCompilerMenu); }} style={{ background: 'none', border: 'none', color: 'white', padding: '4px 6px', cursor: 'pointer' }}><ChevronDown size={12}/></button>
                            )}
                            {showCompilerMenu && activeDoc?.name.toLowerCase().endsWith('.tex') && (
                                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: '#252526', border: '1px solid #444', borderRadius: '8px', zIndex: 100, width: '160px', padding: '4px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} onClick={(e) => e.stopPropagation()}>
                                    {['pdflatex', 'xelatex', 'lualatex'].map(c => (
                                        <button key={c} onClick={async (e) => { 
                                            e.stopPropagation(); 
                                            setShowCompilerMenu(false);
                                            await updateProject({ compiler: c });
                                            setTimeout(() => compile(), 100);
                                        }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: project?.compiler === c ? '#4ade80' : '#ccc', padding: '8px 12px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            {project?.compiler === c ? <Check size={14}/> : <div style={{ width: 14 }}/>} {c}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div style={{ flex: 1 }}>
                    {activeDoc && !activeDoc.isBinary && !activeDoc.isFolder ? (
                        <Editor key={activeDoc._id} height="100%" language={getLanguage(activeDoc.name)} theme="vs-dark" value={activeDoc.content || ''} onChange={handleEditorChange} onMount={(editor) => { editorRef.current = editor; }} options={{ fontSize: 16, minimap: { enabled: false }, readOnly: !!activeDoc.isLink }} />
                    ) : renderBinaryContent()}
                </div>
            </div>
            <div onMouseDown={() => isResizingRef.current = true} style={{ width: '6px', cursor: 'col-resize', background: '#111', zIndex: 50 }}></div>

            <div style={{ flex: 1, background: '#2d2d2d', display: 'flex', flexDirection: 'column' }}>
                <div id="results-container" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {showLogs && logs ? (
                         <div style={{ flex: 1, background: '#1e1e1e', padding: '24px', overflowY: 'auto' }}>
                             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                                 <h2 style={{ color: '#ff5f56', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '18px' }}><AlertCircle size={20}/> Compilatie Fout</h2>
                                 <button onClick={() => setShowLogs(false)} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer' }}>Sluiten</button>
                             </div>
                             <pre style={{ color: '#aaa', fontSize: '12px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: '#000', padding: '15px', borderRadius: '8px' }}>{logs}</pre>
                         </div>
                    ) : rResult ? (
                        <>
                        <div style={{ height: `${outputHeight}px`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ background: '#252526', padding: '4px 12px', fontSize: '10px', color: '#666', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between' }}>
                                <span>CONSOLE</span>
                                <button onClick={() => setRResult((p:any)=>({...p, stdout:''}))} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><Eraser size={10}/></button>
                            </div>
                            <div ref={consoleRef} style={{ flex: 1, overflow: 'auto', padding: '12px', background: '#000' }}>
                                <pre style={{ fontSize: '13px', fontFamily: 'monospace', margin: 0 }}>
                                    {(rResult.stdout || '').split('\n').map((line, i) => (
                                        <div key={i} style={{ color: (line.startsWith('> ') || line.startsWith('+ ')) ? '#888' : '#4ade80', whiteSpace: 'pre-wrap' }}>{line}</div>
                                    ))}
                                </pre>
                            </div>
                        </div>
                        <div onMouseDown={() => isResizingOutputRef.current = true} style={{ height: '6px', cursor: 'ns-resize', background: '#111', zIndex: 50 }}></div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ background: '#252526', display: 'flex', borderBottom: '1px solid #333' }}>
                                {['plots', 'variables'].map(tab => (<button key={tab} onClick={() => setActiveTab(tab as any)} style={{ padding: '8px 16px', background: activeTab === tab ? '#1e1e1e' : 'transparent', color: activeTab === tab ? '#0071e3' : '#666', border: 'none', borderBottom: activeTab === tab ? '2px solid #0071e3' : 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700 }}>{tab.toUpperCase()}</button>))}
                            </div>
                            <div style={{ flex: 1, overflow: 'auto', padding: '15px' }}>
                                {activeTab === 'plots' && (
                                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        {rResult.plots?.length > 0 ? (
                                            <>
                                            <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                <button onClick={() => setCurrentPlotPlotIndex(Math.max(0, currentPlotIndex - 1))} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 8px', borderRadius: '4px' }}><ChevronLeft size={14}/></button>
                                                <span style={{ fontSize: '12px' }}>{currentPlotIndex + 1} / {rResult.plots.length}</span>
                                                <button onClick={() => setCurrentPlotPlotIndex(Math.min(rResult.plots.length - 1, currentPlotIndex + 1))} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 8px', borderRadius: '4px' }}><ChevronRight size={14}/></button>
                                            </div>
                                            <img src={`data:image/png;base64,${rResult.plots[currentPlotIndex]}`} style={{ maxWidth: '100%', maxHeight: 'calc(100% - 40px)', objectFit: 'contain' }} alt="Plot" />
                                            </>
                                        ) : 'No plots.'}
                                    </div>
                                )}
                                {activeTab === 'variables' && (
                                    <div>
                                        {Object.entries(rResult.variables || {}).map(([name, info]: [string, any]) => (
                                            <div key={name} style={{ marginBottom: '8px', borderBottom: '1px solid #222' }}>
                                                <div onClick={() => toggleVar(name)} style={{ fontWeight: 700, color: '#0071e3', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    {expandedVars.has(name) ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                                                    <Database size={12}/>{name} <span style={{ fontWeight: 400, color: '#666' }}>({info.type})</span>
                                                </div>
                                                {expandedVars.has(name) && <pre style={{ fontSize: '11px', color: '#aaa', background: '#111', padding: '6px' }}>{info.summary}</pre>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        </>
                    ) : (
                        <div style={{ flex: 1, position: 'relative' }}>
                            {compiling && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader className="animate-spin" /></div>}
                            {pdfUrl ? <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js"><div style={{ height: '100%' }}><Viewer fileUrl={pdfUrl} plugins={[zoomPluginInstance]} defaultScale={SpecialZoomLevel.PageWidth} /></div></Worker> : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>PDF Preview</div>}
                        </div>
                    )}
                </div>
            </div>
        </div>
      </main>

      {showLinkModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: '#252526', width: '600px', height: '500px', borderRadius: '16px', border: '1px solid #333', padding: '32px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}><h2>Link from other project</h2><X style={{ cursor: 'pointer' }} onClick={() => setShowLinkModal(false)}/></div>
                  <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: 0 }}>
                      <div style={{ flex: 1, background: '#1e1e1e', padding: '12px', overflowY: 'auto' }}>
                          {availableProjects.map(p => (<div key={p._id} onClick={async () => { const res = await axios.get(`${API_URL}/projects/${p._id}`, { headers: { Authorization: `Bearer ${token}` } }); setBrowsingProject(p); setBrowsingDocs(res.data.documents); }} style={{ padding: '8px', cursor: 'pointer', background: browsingProject?._id === p._id ? '#0071e3' : 'transparent' }}>{p.name}</div>))}
                      </div>
                      <div style={{ flex: 2, background: '#1e1e1e', padding: '12px', overflowY: 'auto' }}>
                          {browsingDocs.map(d => (<div key={d._id} onClick={() => setLinkTargetDoc(d)} style={{ padding: '6px', cursor: 'pointer', background: linkTargetDoc?._id === d._id ? '#333' : 'transparent' }}>{d.path}{d.name}</div>))}
                      </div>
                  </div>
                  <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                      <button onClick={() => setShowLinkModal(false)} style={{ background: '#333', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '8px' }}>Cancel</button>
                      <button disabled={!linkTargetDoc} onClick={() => createLink(browsingProject._id, linkTargetDoc)} style={{ background: '#0071e3', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '8px' }}>Link Item</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
