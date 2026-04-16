import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor, { loader } from '@monaco-editor/react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import { 
  Play, ChevronLeft, FileText, 
  Eye, Folder, FilePlus, FolderPlus, 
  AlertCircle, X, UserPlus, User as UserIcon,
  ChevronDown, ChevronRight, Trash2, CheckCircle2, Check,
  Download, LogOut, Loader, Upload,
  Copy, FileCode, ImageIcon, ZoomIn as ZoomInIcon, ZoomOut as ZoomOutIcon,
  List, ScrollText, Edit3, MoreVertical,
  Zap, Layers, Eraser, Database, Link
} from 'lucide-react';

import { Viewer, Worker, SpecialZoomLevel } from '@react-pdf-viewer/core';
import { zoomPlugin } from '@react-pdf-viewer/zoom';
import type { RenderZoomInProps, RenderZoomOutProps } from '@react-pdf-viewer/zoom';
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
  
  const [compiling, setCompiling] = useState(false);
  const [compileMode, setCompileMode] = useState<'normal' | 'draft'>('normal');
  const [usePreamble, setUsePreamble] = useState(false);
  const [lastStatus, setLastStatus] = useState<'success' | 'error' | 'none'>('success');
  const [logs, setLogs] = useState<string | null>(null);
  const [parsedErrors, setParsedErrors] = useState<any[]>([]);
  const [logView, setLogView] = useState<'ordered' | 'raw'>('ordered');
  const [showErrorView, setShowErrorView] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const [showShare, setShowShare] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePerm, setSharePerm] = useState('read');
  const [showSettings, setShowSettings] = useState(false);
  const [showFullLogs, setShowFullLogs] = useState(false);
  const [showCompileOptions, setShowCompileOptions] = useState(false);
  
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<any[]>([]);
  const [browsingProject, setBrowsingProject] = useState<any>(null);
  const [browsingDocs, setBrowsingDocs] = useState<any[]>([]);
  const [linkTargetDoc, setLinkTargetDoc] = useState<any>(null);
  
  const [leftWidth, setLeftWidth] = useState(240);
  const [editorWidth, setEditorWidth] = useState(50);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ '/': true });
  
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, doc: any } | null>(null);
  const [activeItemMenu, setActiveItemMenu] = useState<string | null>(null);
  const [dragOverNode, setDragOverNode] = useState<string | null>(null);
  
  const [user] = useState<any>(JSON.parse(localStorage.getItem('latex_user') || '{}'));
  const [expandedVars, setExpandedVars] = useState<Set<string>>(new Set());
  
  const [activeTab, setActiveTab] = useState<'plots' | 'variables'>('plots');
  const [currentPlotIndex, setCurrentPlotPlotIndex] = useState(0);
  const [resultsHeight, setResultsHeight] = useState(300);
  const [outputHeight, setOutputHeight] = useState(150);
  
  const isResizingRef = useRef(false);
  const isResizingSidebarRef = useRef(false);
  const isResizingResultsRef = useRef(false);
  const isResizingOutputRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const editorRef = useRef<any>(null);
  const activeDocIdRef = useRef<string | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const viewerInstanceRef = useRef<any>(null);
  
  const token = localStorage.getItem('latex_token');

  const zoomPluginInstance = zoomPlugin();
  const { ZoomIn, ZoomOut } = zoomPluginInstance;

  const parseLogErrors = (rawLogs: string, type: 'latex' | 'typst' | 'markdown') => {
      const errors: any[] = [];
      if (!rawLogs) return errors;
      const lines = rawLogs.split('\n');
      
      if (type === 'typst') {
          for (let i = 0; i < lines.length; i++) {
              const match = lines[i].match(/┌─\s+(.*?):(\d+):(\d+)/);
              if (match) {
                  errors.push({
                      file: match[1].trim(),
                      line: parseInt(match[2]),
                      message: lines[i-1]?.trim() || 'Typst Error'
                  });
              }
          }
      } else {
          let currentFile = 'main.tex';
          for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const fileMatch = line.match(/\(([^()]*?\.(?:tex|sty|cls))/);
              if (fileMatch) {
                  const cleaned = fileMatch[1].replace(/^\.\//, '');
                  if (!cleaned.includes('/usr/')) currentFile = cleaned;
              }
              if (line.startsWith('! ')) {
                  let message = line.substring(2);
                  let lineNum = 0;
                  for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
                      const nextLine = lines[j];
                      const lineMatch = nextLine.match(/^l\.(\d+)/);
                      if (lineMatch) {
                          lineNum = parseInt(lineMatch[1]);
                          break;
                      }
                  }
                  if (lineNum > 0) errors.push({ file: currentFile, line: lineNum, message });
              }
          }
      }
      return errors;
  };

  const compile = async (isAutoMode = false, typeOverride?: string) => {
    if (compiling && isAutoMode) return;
    setCompiling(true);
    const pType = typeOverride || project?.type || 'latex';
    try {
      const currentDoc = activeDocIdRef.current ? documents.find(d => d._id === activeDocIdRef.current) : null;
      const isR = currentDoc?.name.endsWith('.R') || currentDoc?.name.endsWith('.r');
      
      let contentToRun = editorRef.current ? editorRef.current.getValue() : currentDoc?.content;

      if (isR && editorRef.current) {
          const selection = editorRef.current.getSelection();
          const model = editorRef.current.getModel();
          if (selection && !selection.isEmpty()) {
              contentToRun = model.getValueInRange(selection);
          } else {
              const position = editorRef.current.getPosition();
              contentToRun = model.getLineContent(position.lineNumber);
              // Move cursor to next line
              const lineCount = model.getLineCount();
              if (position.lineNumber < lineCount) {
                  editorRef.current.setPosition({ lineNumber: position.lineNumber + 1, column: 1 });
                  editorRef.current.revealLine(position.lineNumber + 1);
              }
              editorRef.current.focus();
          }
          if (!contentToRun.trim()) {
              setCompiling(false);
              return;
          }
          // Echo the command to console
          setRResult((prev: any) => ({
              ...prev,
              stdout: (prev?.stdout || '') + (prev?.stdout?.endsWith('\n') || !prev?.stdout ? '' : '\n') + '> ' + contentToRun + '\n'
          }));
      }

      const res = await axios.post(`${API_URL}/compile/${id}`, {
          preferredMain: currentDoc?.name,
          currentContent: contentToRun,
          currentFileId: currentDoc?._id,
          mode: compileMode,
          usePreamble: usePreamble
      }, { 
        headers: { Authorization: `Bearer ${token}` }, 
        responseType: isR ? 'json' : 'blob' 
      });
      
      if (isR) {
          setRResult((prev: any) => ({
              ...res.data,
              stdout: (prev?.stdout || '') + res.data.stdout + (res.data.stdout.endsWith('\n') ? '' : '\n'),
              plots: [...(prev?.plots || []), ...(res.data.plots || [])]
          }));
          setPdfUrl(null);
          if (res.data.plots && res.data.plots.length > 0) {
              setActiveTab('plots');
              setRResult((finalState: any) => {
                  setCurrentPlotPlotIndex(finalState.plots.length - 1);
                  return finalState;
              });
          }
      } else {
          const blob = new Blob([res.data], { type: 'application/pdf' });
          const url = window.URL.createObjectURL(blob);
          setPdfUrl(url);
          setRResult(null);
      }

      setLogs(null);
      setParsedErrors([]);
      setLastStatus('success');
      setShowErrorView(false);
    } catch (err: any) {
      setLastStatus('error');
      if (!isAutoMode) setShowErrorView(true);
      
      const processErrorData = (data: any) => {
        try {
          const result = typeof data === 'string' ? JSON.parse(data) : data;
          const rawLogs = result.logs || result.error || (typeof result === 'string' ? result : 'Compilation failed.');
          setLogs(rawLogs);
          setParsedErrors(parseLogErrors(rawLogs, pType as any));
        } catch(e) { 
          setLogs(typeof data === 'string' ? data : 'Compilation error.'); 
        }
      };

      if (err.response?.data instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => processErrorData(reader.result);
        reader.readAsText(err.response.data);
      } else if (err.response?.data) {
        processErrorData(err.response.data);
      } else {
        setLogs(err.message || 'Unknown error occurred.');
      }
    } finally { setCompiling(false); }
  };

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [rResult]);

  const fetchAll = async () => {
    try {
      const res = await axios.get(`${API_URL}/projects/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setProject(res.data.project);
      setDocuments(res.data.documents);
      if (res.data.documents.length > 0 && !activeDocIdRef.current) {
        const main = res.data.documents.find((d: any) => d.isMain) || res.data.documents.find((d: any) => d.name === 'main.tex' || d.name === 'main.typ' || d.name === 'main.md') || res.data.documents.find((d: any) => !d.isFolder && !d.isBinary) || res.data.documents[0];
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        compile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project, documents, compileMode, usePreamble]);

  useEffect(() => {
    const docId = activeDoc?._id;
    if (!docId || !socketRef.current || activeDoc.isBinary || activeDoc.isFolder) return;
    const socket = socketRef.current;
    socket.emit('join-document', docId);
    const onUpdate = (content: string) => {
      if (activeDocIdRef.current === docId) {
        setActiveDoc((prev: any) => (prev?._id === docId ? { ...prev, content } : prev));
        setDocuments(prev => prev.map(d => d._id === docId ? { ...d, content } : d));
      }
    };
    socket.on('document-updated', onUpdate);
    return () => {
      socket.emit('leave-document', docId);
      socket.off('document-updated', onUpdate);
    };
  }, [activeDoc?._id]);

  const lastSyncRef = useRef(0);
  const syncToPdf = async () => {
      if (!editorRef.current || !activeDoc || activeDoc.isFolder || activeDoc.isBinary || (project?.type !== 'latex' && project?.type !== 'typst')) return;
      const now = Date.now();
      if (now - lastSyncRef.current < 1500) return;
      lastSyncRef.current = now;
      const position = editorRef.current.getPosition();
      try {
          const res = await axios.get(`${API_URL}/projects/${id}/synctex`, {
              params: { line: position.lineNumber, file: activeDoc.name },
              headers: { Authorization: `Bearer ${token}` }
          });
          if (res.data.page && viewerInstanceRef.current) viewerInstanceRef.current.jumpToPage(res.data.page - 1);
      } catch (e) {}
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined || !activeDoc) return;
    setDocuments(prev => prev.map(d => d._id === activeDoc._id ? { ...d, content: value } : d));
    socketRef.current?.emit('edit-document', { documentId: activeDoc._id, content: value });
    syncToPdf();
  };

  const jumpToError = (error: any) => {
      const foundDoc = documents.find(d => {
          const fullPath = (d.path + d.name).replace(/^\//, '');
          return fullPath === error.file || d.name === error.file || error.file.endsWith(d.name);
      });
      if (foundDoc) {
          switchDoc(foundDoc);
          setTimeout(() => {
              if (editorRef.current) {
                  editorRef.current.revealLineInCenter(error.line);
                  editorRef.current.setPosition({ lineNumber: error.line, column: 1 });
                  editorRef.current.focus();
              }
          }, 300);
      }
  };

  const switchDoc = (item: any, folderPath?: string) => {
      if (!item) return;
      if (item._isFolder) {
          if (folderPath) setExpandedFolders(prev => ({ ...prev, [folderPath]: !prev[folderPath] }));
          setActiveDoc(item._doc || { isFolder: true, path: item._path || '', name: item._name || '' }); 
          return;
      }
      setActiveDoc(item);
      activeDocIdRef.current = item._id;
  };

  const setAsMain = async (fileId: string) => {
      await axios.post(`${API_URL}/projects/${id}/files/${fileId}/main`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const toggleVar = (name: string) => {
    const next = new Set(expandedVars);
    if (next.has(name)) next.delete(name); else next.add(name);
    setExpandedVars(next);
  };

  const renameFile = async (doc: any) => {
      const newName = prompt('Enter new name:', doc.name);
      if (!newName || newName === doc.name) return;
      await axios.patch(`${API_URL}/projects/${id}/files/${doc._id}`, { name: newName }, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const updateProject = async (updates: any) => {
      const res = await axios.patch(`${API_URL}/projects/${id}`, updates, { headers: { Authorization: `Bearer ${token}` } });
      setProject(res.data);
  };

  const createLink = async (targetProjectId: string, targetDoc: any) => {
      const parent = contextMenu?.doc?.isFolder ? contextMenu.doc : null;
      const targetPath = parent ? (parent.path + parent.name + '/') : '/';

      try {
          await axios.post(`${API_URL}/projects/${id}/links`, {
              targetProjectId,
              targetDocumentId: targetDoc._id,
              name: targetDoc.name,
              path: targetPath
          }, { headers: { Authorization: `Bearer ${token}` } });
          setShowLinkModal(false);
          setBrowsingProject(null);
          setBrowsingDocs([]);
          fetchAll();
      } catch (e: any) {
          alert(e.response?.data || 'Failed to create link.');
      }
  };

  const addFile = async (isFolder: boolean, parent?: any) => {
    const name = prompt(`Enter ${isFolder ? 'folder' : 'file'} name:`);
    if (!name) return;
    let path = "";
    const base = parent || activeDoc;
    if (base && base.isFolder) path = base.path + base.name + "/";
    else if (base && base.path) path = base.path;
    await axios.post(`${API_URL}/projects/${id}/files`, { name, isFolder, path }, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, isFolder = false, targetDoc?: any) => {
      const files = e.target.files;
      if (!files) return;
      let basePath = "";
      const base = targetDoc || activeDoc;
      if (base && base.isFolder) basePath = base.path + base.name + "/";
      else if (base && base.path) basePath = base.path;
      
      const textExtensions = ['.tex', '.typ', '.md', '.R', '.r', '.Rmd', '.txt', '.bib', '.cls', '.sty', '.json', '.css', '.js', '.ts', '.html'];

      for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const relativePath = (file as any).webkitRelativePath || "";
          let finalPath = basePath;
          let name = file.name;
          if (isFolder && relativePath) {
              const parts = relativePath.split('/');
              name = parts.pop()!;
              finalPath = basePath + parts.join('/') + (parts.length > 0 ? "/" : "");
          }
          
          const isBinary = !textExtensions.some(ext => name.toLowerCase().endsWith(ext));
          const reader = new FileReader();
          
          reader.onload = () => {
              if (isBinary) {
                  const base64 = (reader.result as string).split(',')[1];
                  axios.post(`${API_URL}/projects/${id}/files`, { name, isFolder: false, isBinary: true, path: finalPath, binaryData: base64 }, { headers: { Authorization: `Bearer ${token}` } }).then(() => {
                      if (i === files.length - 1) fetchAll();
                  });
              } else {
                  const content = reader.result as string;
                  axios.post(`${API_URL}/projects/${id}/files`, { name, isFolder: false, isBinary: false, path: finalPath, content }, { headers: { Authorization: `Bearer ${token}` } }).then(() => {
                      if (i === files.length - 1) fetchAll();
                  });
              }
          };

          if (isBinary) {
              reader.readAsDataURL(file);
          } else {
              reader.readAsText(file);
          }
      }
  };

  const deleteFile = async (docId: string) => {
    if (!confirm('Delete this item?')) return;
    await axios.delete(`${API_URL}/projects/${id}/files/${docId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (activeDoc?._id === docId) setActiveDoc(null);
    fetchAll();
  };

  const moveFile = async (docId: string, newPath: string) => {
      await axios.patch(`${API_URL}/projects/${id}/files/${docId}`, { path: newPath }, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const copyFile = async (doc: any) => {
      const newName = prompt('Enter new name:', doc.name + ' (copy)');
      if (!newName) return;
      await axios.post(`${API_URL}/projects/${id}/files`, { name: newName, isFolder: doc.isFolder, isBinary: doc.isBinary, path: doc.path, content: doc.content, binaryData: doc.binaryData }, { headers: { Authorization: `Bearer ${token}` } });
      fetchAll();
  };

  const logout = () => {
      localStorage.removeItem('latex_token');
      navigate('/login');
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingRef.current) {
        const offset = leftWidth + 4;
        const availableWidth = window.innerWidth - offset;
        const percentage = ((e.clientX - offset) / availableWidth) * 100;
        setEditorWidth(Math.max(10, Math.min(90, percentage)));
      }
      if (isResizingSidebarRef.current) setLeftWidth(Math.max(150, Math.min(500, e.clientX)));
      if (isResizingResultsRef.current) {
          const newHeight = window.innerHeight - e.clientY;
          setResultsHeight(Math.max(100, Math.min(window.innerHeight - 100, newHeight)));
      }
      if (isResizingOutputRef.current) {
          const rect = document.getElementById('results-container')?.getBoundingClientRect();
          if (rect) {
              const newOutputHeight = e.clientY - rect.top;
              setOutputHeight(Math.max(50, Math.min(rect.height - 50, newOutputHeight)));
          }
      }
    };
    const handleMouseUp = () => {
      isResizingRef.current = false;
      isResizingSidebarRef.current = false;
      isResizingResultsRef.current = false;
      isResizingOutputRef.current = false;
      setContextMenu(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftWidth, resultsHeight]);

  const buildTree = () => {
    const root: any = { _isFolder: true, _children: {}, _doc: null };
    documents.forEach(doc => {
      const parts = (doc.path + (doc.isFolder ? "" : doc.name)).split('/').filter(Boolean);
      if (doc.isFolder) parts.push(doc.name); 
      let current = root;
      parts.forEach((part: string, index: number) => {
        const isLast = index === parts.length - 1;
        if (isLast && !doc.isFolder) {
          current._children[part] = doc;
        } else {
          if (!current._children[part] || !current._children[part]._isFolder) {
            current._children[part] = { _isFolder: true, _children: {}, _doc: null, _path: doc.path, _name: part };
          }
          if (isLast && doc.isFolder) current._children[part]._doc = doc;
          current = current._children[part];
        }
      });
    });
    return root;
  };

  const onDragStart = (e: React.DragEvent, doc: any) => {
      if (!doc) return;
      e.dataTransfer.setData('docId', doc._id);
  };

  const onDrop = (e: React.DragEvent, targetNode: any) => {
      e.preventDefault();
      setDragOverNode(null);
      const docId = e.dataTransfer.getData('docId');
      let newPath = "";
      if (targetNode._isFolder) {
          newPath = (targetNode._path || "") + (targetNode._name ? targetNode._name + "/" : "");
      } else if (targetNode.isFolder) {
          newPath = targetNode.path + targetNode.name + "/";
      } else {
          newPath = targetNode.path;
      }
      if (docId) moveFile(docId, newPath);
  };

  const renderNode = (node: any, path: string, depth: number) => {
    if (!node || !node._children) return null;
    const keys = Object.keys(node._children).sort((a, b) => {
      const itemA = node._children[a];
      const itemB = node._children[b];
      const isFolderA = !!itemA._isFolder;
      const isFolderB = !!itemB._isFolder;
      if (isFolderA && !isFolderB) return -1;
      if (!isFolderA && isFolderB) return 1;
      return a.localeCompare(b);
    });
    return keys.map(key => {
      const item = node._children[key];
      const isFolderNode = !!item._isFolder;
      const folderPath = `${path}${key}/`;
      const isExpanded = expandedFolders[folderPath];
      const doc = isFolderNode ? item._doc : item;
      const itemId = doc?._id || folderPath;
      return (
        <div key={itemId} onDragOver={(e) => { e.preventDefault(); setDragOverNode(itemId); }} onDragLeave={() => setDragOverNode(null)} onDrop={(e) => onDrop(e, item)} style={{ background: dragOverNode === itemId ? 'rgba(0,113,227,0.1)' : 'transparent' }}>
          <div onClick={() => switchDoc(item, folderPath)} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, doc }); }} draggable={!!doc} onDragStart={(e) => onDragStart(e, doc)} style={{ display: 'flex', alignItems: 'center', padding: `4px 12px 4px ${depth * 12 + 12}px`, cursor: 'pointer', fontSize: '13px', background: activeDoc?._id === doc?._id ? '#37373d' : 'transparent', color: activeDoc?._id === doc?._id ? '#fff' : (doc?.isMain ? '#4ade80' : '#aaa'), gap: '8px', justifyContent: 'space-between', position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                {isFolderNode ? (isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>) : null}
                {isFolderNode ? <Folder size={14} style={{ color: '#dcb67a' }}/> : (doc?.isBinary ? <ImageIcon size={14} color="#dcb67a"/> : <FileText size={14} color="#519aba"/>)}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: doc?.isLink ? 'italic' : 'normal' }}>{key}</span>
                {doc?.isMain && <CheckCircle2 size={12} color="#4ade80"/>}
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <button onClick={(e) => { e.stopPropagation(); setActiveItemMenu(activeItemMenu === itemId ? null : itemId); }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '2px' }}><MoreVertical size={14}/></button>
                {activeItemMenu === itemId && (
                    <div style={{ position: 'absolute', top: '100%', right: 0, background: '#252526', border: '1px solid #444', borderRadius: '6px', zIndex: 200, width: '140px', padding: '4px', boxShadow: '0 5px 15px rgba(0,0,0,0.5)' }}>
                        <button onClick={(e) => { e.stopPropagation(); if (doc) renameFile(doc); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Edit3 size={12}/> Rename</button>
                        {doc && !doc.isFolder && <a href={`${API_URL}/projects/${id}/files/${doc._id}/raw`} download={doc.name} onClick={(e) => e.stopPropagation()} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}><Download size={12}/> Download</a>}
                        <button onClick={(e) => { e.stopPropagation(); if (doc) deleteFile(doc._id); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ff5f56', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Trash2 size={12}/> Delete</button>
                        <div style={{ borderTop: '1px solid #333', margin: '4px 0' }}></div>
                        <button onClick={(e) => { e.stopPropagation(); addFile(false, doc || item); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><FilePlus size={12}/> New File</button>
                        <button onClick={(e) => { e.stopPropagation(); addFile(true, doc || item); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><FolderPlus size={12}/> New Folder</button>
                        <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); setActiveItemMenu(null); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '6px 10px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}><Upload size={12}/> Upload</button>
                    </div>
                )}
            </div>
          </div>
          {isFolderNode && isExpanded && renderNode(item, folderPath, depth + 1)}
        </div>
      );
    });
  };

  if (!project) return <div style={{ background: '#1e1e1e', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>Laden...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#1e1e1e', color: 'white', overflow: 'hidden' }} onClick={() => { setActiveItemMenu(null); setShowCompileOptions(false); }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px', height: '48px', background: '#252526', borderBottom: '1px solid #333', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><ChevronLeft size={20}/></button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700 }}>{project?.name || 'Loading...'}</span>
            <span style={{ fontSize: '10px', background: '#333', padding: '2px 6px', borderRadius: '4px', color: '#888', fontWeight: 700 }}>DOCS</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '12px', background: '#333', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{user?.name?.[0]}</div>
              <span style={{ fontSize: '13px', color: '#ccc' }}>{user?.name}</span>
          </div>
          <button onClick={logout} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 4 }} title="Logout"><LogOut size={18}/></button>
        </div>
      </nav>

      <main style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <aside style={{ width: `${leftWidth}px`, background: '#181818', borderRight: '1px solid #282828', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>Explorer</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={async () => {
                  const res = await axios.get(`${API_URL}/projects`, { headers: { Authorization: `Bearer ${token}` } });
                  setAvailableProjects(res.data.filter((p: any) => p._id !== id));
                  setShowLinkModal(true);
              }} title="Link from other project"><Link size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => addFile(false)} title="New File"><FilePlus size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => addFile(true)} title="New Folder"><FolderPlus size={14}/></button>
              <button style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0 }} onClick={() => fileInputRef.current?.click()} title="Upload Files"><Upload size={14}/></button>
              <input type="file" ref={fileInputRef} onChange={(e) => handleUpload(e, false)} multiple style={{ display: 'none' }}/>
              <input type="file" ref={folderInputRef} onChange={(e) => handleUpload(e, true)} multiple {...{webkitdirectory: "", directory: ""} as any} style={{ display: 'none' }}/>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>{renderNode(buildTree(), '/', 0)}</div>
        </aside>
        <div onMouseDown={() => isResizingSidebarRef.current = true} style={{ width: '4px', cursor: 'col-resize', background: 'transparent', zIndex: 50 }}></div>
        
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div style={{ width: `${editorWidth}%`, height: '100%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
                <div style={{ background: '#2d2d2d', padding: '8px 16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '12px', color: '#aaa', fontWeight: 600 }}>{activeDoc?.name || 'No file selected'}</span>
                        <div style={{ width: '10px', height: '10px', borderRadius: '5px', background: lastStatus === 'success' ? '#4ade80' : lastStatus === 'error' ? '#ff5f56' : '#666', cursor: 'pointer', boxShadow: lastStatus === 'error' ? '0 0 8px #ff5f56' : 'none' }} onClick={() => { if (lastStatus === 'error') setShowErrorView(true); }} title={lastStatus === 'error' ? 'Click to show errors' : 'Status OK'}/>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ position: 'relative', display: 'flex', background: '#28a745', borderRadius: '4px', overflow: 'visible' }}>
                            <button onClick={() => compile()} disabled={compiling} style={{ background: 'none', color: 'white', border: 'none', padding: '4px 12px', cursor: 'pointer', fontWeight: 600, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}><Play size={12} fill="white"/> {compiling ? '...' : (project?.type === 'R' ? 'Run' : (compileMode === 'normal' ? 'Compile' : 'Draft'))}</button>
                            {project?.type === 'latex' && (
                                <button onClick={(e) => { e.stopPropagation(); setShowCompileOptions(!showCompileOptions); }} style={{ background: 'rgba(0,0,0,0.1)', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.1)', color: 'white', padding: '4px 6px', cursor: 'pointer' }}><ChevronDown size={12}/></button>
                            )}
                            {showCompileOptions && (
                                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', background: '#252526', border: '1px solid #444', borderRadius: '8px', zIndex: 100, width: '200px', padding: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} onClick={(e) => e.stopPropagation()}>
                                    <div style={{ fontSize: '10px', color: '#666', fontWeight: 800, padding: '4px 8px', textTransform: 'uppercase' }}>Mode</div>
                                    <button onClick={() => { setCompileMode('normal'); setShowCompileOptions(false); }} style={{ width: '100%', textAlign: 'left', background: compileMode === 'normal' ? '#333' : 'none', border: 'none', color: '#ccc', padding: '8px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '4px' }}>
                                        {compileMode === 'normal' ? <CheckCircle2 size={14} color="#4ade80"/> : <Layers size={14}/>} Normal Mode
                                    </button>
                                    <button onClick={() => { setCompileMode('draft'); setShowCompileOptions(false); }} style={{ width: '100%', textAlign: 'left', background: compileMode === 'draft' ? '#333' : 'none', border: 'none', color: '#ccc', padding: '8px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '4px' }}>
                                        {compileMode === 'draft' ? <CheckCircle2 size={14} color="#4ade80"/> : <Zap size={14}/>} Draft Mode
                                    </button>
                                    
                                    <div style={{ borderTop: '1px solid #333', margin: '8px 0' }}></div>
                                    <div style={{ fontSize: '10px', color: '#666', fontWeight: 800, padding: '4px 8px', textTransform: 'uppercase' }}>Compiler</div>
                                    {['pdflatex', 'xelatex', 'lualatex'].map(c => (
                                        <button key={c} onClick={() => { updateProject({ compiler: c }); setShowCompileOptions(false); }} style={{ width: '100%', textAlign: 'left', background: project?.compiler === c ? '#333' : 'none', border: 'none', color: '#ccc', padding: '8px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '4px' }}>
                                            {project?.compiler === c ? <CheckCircle2 size={14} color="#0071e3"/> : <div style={{ width: 14 }}/>} {c}
                                        </button>
                                    ))}

                                    <div style={{ borderTop: '1px solid #333', margin: '8px 0' }}></div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', cursor: 'pointer', fontSize: '12px', color: '#ccc' }}>
                                        <input type="checkbox" checked={usePreamble} onChange={(e) => setUsePreamble(e.target.checked)} />
                                        Use Precompiled Preamble
                                    </label>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                    {activeDoc && !activeDoc.isBinary && !activeDoc.isFolder ? (
                        <Editor height="100%" language={activeDoc.name?.endsWith('.tex') ? 'latex' : (activeDoc.name?.endsWith('.md') ? 'markdown' : (activeDoc.name?.endsWith('.R') || activeDoc.name?.endsWith('.r') ? 'r' : (project?.type === 'typst' ? 'typst' : 'latex')))} theme="vs-dark" value={activeDoc.content || ''} onChange={handleEditorChange} onMount={(editor) => { editorRef.current = editor; editor.onMouseDown(syncToPdf); }} options={{ fontSize: 16, minimap: { enabled: false }, wordWrap: 'on', lineNumbers: 'on', padding: { top: 16 }, renderWhitespace: 'none', cursorBlinking: 'smooth', smoothScrolling: true }} />
                    ) : activeDoc?.isBinary ? (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#1e1e1e', padding: '40px' }}>
                            {activeDoc.name.match(/\.(png|jpg|jpeg|gif|svg)$/i) ? <img src={`${API_URL}/projects/${id}/files/${activeDoc._id}/raw?t=${Date.now()}`} style={{ maxWidth: '100%', maxHeight: '100%', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', borderRadius: '8px' }} alt={activeDoc.name}/> : <div style={{ textAlign: 'center', color: '#444' }}><FileCode size={64} style={{ opacity: 0.1, marginBottom: '20px' }}/><div>Binary file: {activeDoc.name}</div></div>}
                        </div>
                    ) : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>Select a file.</div>}
                </div>
            </div>
            <div onMouseDown={() => isResizingRef.current = true} style={{ width: '6px', cursor: 'col-resize', background: '#111', zIndex: 50 }}></div>
            <div style={{ flex: 1, background: '#2d2d2d', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                <div style={{ background: '#2d2d2d', padding: '8px 16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {!rResult && (
                            <>
                            <ZoomOut>
                                {({ onClick }: RenderZoomOutProps) => (
                                    <button onClick={onClick} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px', borderRadius: '4px', cursor: 'pointer' }} title="Zoom Out"><ZoomOutIcon size={14}/></button>
                                )}
                            </ZoomOut>
                            <ZoomIn>
                                {({ onClick }: RenderZoomInProps) => (
                                    <button onClick={onClick} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px', borderRadius: '4px', cursor: 'pointer' }} title="Zoom In"><ZoomInIcon size={14}/></button>
                                )}
                            </ZoomIn>
                            </>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        {!rResult && (
                            <>
                            {logs && (
                                <button onClick={() => { navigator.clipboard.writeText(logs); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {copied ? <Check size={14} color="#4ade80"/> : <Copy size={14}/>} {copied ? 'Copied' : 'Copy Logs'}
                                </button>
                            )}
                            <button onClick={() => { setLogView(logView === 'ordered' ? 'raw' : 'ordered'); setShowErrorView(true); }} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>{logView === 'ordered' ? <ScrollText size={14}/> : <List size={14}/>} {logView === 'ordered' ? 'Raw Logs' : 'Clean Errors'}</button>
                            <button onClick={() => setShowErrorView(!showErrorView)} style={{ background: showErrorView ? '#0071e3' : '#333', border: 'none', color: 'white', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>{showErrorView ? 'Show PDF' : 'Show Logs'}</button>
                            {pdfUrl && <a href={pdfUrl} download={`${project?.name}.pdf`} style={{ background: '#333', color: '#ccc', padding: '4px', borderRadius: '4px' }}><Download size={14}/></a>}
                            </>
                        )}
                    </div>
                </div>
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {rResult ? (
                        <div id="results-container" style={{ flex: 1, background: '#1e1e1e', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {/* TOP: Output / Console */}
                            <div style={{ height: `${outputHeight}px`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <div style={{ background: '#252526', padding: '4px 12px', fontSize: '10px', color: '#666', fontWeight: 800, textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #333' }}>
                                    <span>Console Output</span>
                                    <button onClick={() => setRResult((prev: any) => prev ? ({ ...prev, stdout: '' }) : null)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}><Eraser size={10}/> Clear</button>
                                </div>
                                <div ref={consoleRef} style={{ flex: 1, overflow: 'auto', padding: '12px', background: '#000' }}>
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#4ade80', fontSize: '13px', fontFamily: 'monospace' }}>{rResult.stdout || 'No output.'}</pre>
                                </div>
                            </div>

                            {/* MIDDLE: Sub-resizer */}
                            <div onMouseDown={() => isResizingOutputRef.current = true} style={{ height: '6px', cursor: 'ns-resize', background: '#111', zIndex: 50 }}></div>

                            {/* BOTTOM: Tabs (Plots / Variables) */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                <div style={{ background: '#252526', display: 'flex', borderBottom: '1px solid #333' }}>
                                    {['plots', 'variables'].map(tab => (
                                        <button key={tab} onClick={() => setActiveTab(tab as any)} style={{ padding: '8px 16px', background: activeTab === tab ? '#1e1e1e' : 'transparent', color: activeTab === tab ? '#0071e3' : '#666', border: 'none', borderBottom: activeTab === tab ? '2px solid #0071e3' : 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>{tab}</button>
                                    ))}
                                </div>
                                <div style={{ flex: 1, overflow: 'auto', padding: '15px' }}>
                                    {activeTab === 'plots' && (
                                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                            {rResult.plots && rResult.plots.length > 0 ? (
                                                <>
                                                <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                    <button onClick={() => setCurrentPlotPlotIndex(Math.max(0, currentPlotIndex - 1))} disabled={currentPlotIndex === 0} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', opacity: currentPlotIndex === 0 ? 0.3 : 1 }}><ChevronLeft size={14}/></button>
                                                    <span style={{ fontSize: '12px', color: '#888' }}>{currentPlotIndex + 1} / {rResult.plots.length}</span>
                                                    <button onClick={() => setCurrentPlotPlotIndex(Math.min(rResult.plots.length - 1, currentPlotIndex + 1))} disabled={currentPlotIndex === rResult.plots.length - 1} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', opacity: currentPlotIndex === rResult.plots.length - 1 ? 0.3 : 1 }}><ChevronRight size={14}/></button>
                                                </div>
                                                <img src={`data:image/png;base64,${rResult.plots[currentPlotIndex]}`} style={{ maxWidth: '100%', maxHeight: 'calc(100% - 40px)', objectFit: 'contain' }} alt="Plot" />
                                                </>
                                            ) : <div style={{ color: '#444', height: '100%', display: 'flex', alignItems: 'center' }}>No plots.</div>}
                                        </div>
                                    )}
                                    {activeTab === 'variables' && (
                                        <div style={{ textAlign: 'left' }}>
                                            {Object.entries(rResult.variables || {}).map(([name, info]: [string, any]) => (
                                                <div key={name} style={{ marginBottom: '8px', borderBottom: '1px solid #222', paddingBottom: '8px' }}>
                                                    <div onClick={() => toggleVar(name)} style={{ fontWeight: 700, color: '#0071e3', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                        {expandedVars.has(name) ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                                                        <Database size={12}/>{name} <span style={{ fontWeight: 400, color: '#666', fontSize: '10px' }}>({info.type})</span>
                                                    </div>
                                                    {expandedVars.has(name) && info.summary && (
                                                        <pre style={{ margin: '4px 0 0 18px', fontSize: '11px', color: '#aaa', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: '#111', padding: '6px', borderRadius: '4px', borderLeft: '2px solid #0071e3' }}>
                                                            {info.summary}
                                                        </pre>
                                                    )}
                                                </div>
                                            ))}
                                            {Object.keys(rResult.variables || {}).length === 0 && <div style={{ color: '#444', fontSize: '12px' }}>No variables in environment.</div>}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            {showErrorView && logs ? (
                                <div style={{ padding: '24px', height: '100%', overflowY: 'auto', background: '#1e1e1e' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                        <h2 style={{ color: '#ff5f56', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '18px', margin: 0 }}><AlertCircle /> Compilation Output</h2>
                                        <button onClick={() => setShowErrorView(false)} style={{ background: '#333', border: 'none', color: '#ccc', padding: '4px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}>Back to PDF</button>
                                    </div>
                                    {logView === 'ordered' && parsedErrors.length > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {parsedErrors.map((err, i) => (
                                                <div key={i} onClick={() => jumpToError(err)} style={{ background: '#2d2d2d', padding: '12px 16px', borderRadius: '8px', cursor: 'pointer', borderLeft: '4px solid #ff5f56' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span style={{ color: '#ff5f56', fontWeight: 700, fontSize: '12px' }}>{err.file}</span><span style={{ color: '#888', fontSize: '11px' }}>Line {err.line}</span></div>
                                                    <div style={{ color: '#ddd', fontSize: '13px', fontFamily: 'monospace' }}>{err.message}</div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : <pre style={{ padding: '12px', background: '#000', color: '#aaa', fontSize: '11px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{logs}</pre>}
                                    {logView === 'ordered' && <button onClick={() => setShowFullLogs(!showFullLogs)} style={{ marginTop: '20px', background: 'none', border: 'none', color: '#666', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>Toon volledige logs</button>}
                                    {showFullLogs && logView === 'ordered' && <pre style={{ marginTop: '12px', padding: '12px', background: '#000', color: '#aaa', fontSize: '11px', whiteSpace: 'pre-wrap' }}>{logs}</pre>}
                                </div>
                            ) : (
                                <div style={{ height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
                                    {compiling && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader size={32} className="animate-spin" color="#0071e3"/></div>}
                                    {pdfUrl ? (
                                        <div style={{ height: '100%', width: '100%', background: '#323639', padding: '20px', overflow: 'auto' }}>
                                            <Worker workerUrl={`https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js`}>
                                                <div style={{ width: '100%', maxWidth: '1000px', margin: '0 auto' }}>
                                                    <Viewer 
                                                        fileUrl={pdfUrl} 
                                                        plugins={[zoomPluginInstance]}
                                                        onDocumentLoad={(e) => { viewerInstanceRef.current = e.doc; }}
                                                        defaultScale={SpecialZoomLevel.PageWidth}
                                                    />
                                                </div>
                                            </Worker>
                                        </div>
                                    ) : !compiling && !logs && (
                                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
                                            <Eye size={48} style={{ opacity: 0.1, marginBottom: '10px' }}/>
                                            <span>PDF Loading...</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
      </main>

      {contextMenu && <div style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, background: '#252526', border: '1px solid #444', borderRadius: '8px', zIndex: 1000, width: '160px', padding: '6px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}><button onClick={() => copyFile(contextMenu.doc)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ccc', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><Copy size={14}/> Copy</button><div style={{ borderTop: '1px solid #333', margin: '4px 0' }}></div>{!contextMenu.doc.isMain && !contextMenu.doc.isBinary && !contextMenu.doc.isFolder && <button onClick={() => setAsMain(contextMenu.doc._id)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#4ade80', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><CheckCircle2 size={14}/> Set Main</button>}<button onClick={() => deleteFile(contextMenu.doc._id)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ff5f56', padding: '8px', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><Trash2 size={14}/> Delete</button></div>}
      
      {showSettings && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}><div style={{ background: '#252526', width: '400px', borderRadius: '12px', border: '1px solid #333', padding: '24px' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}><h2 style={{ margin: 0, fontSize: '18px' }}>Project Settings</h2><X style={{ cursor: 'pointer', color: '#666' }} onClick={() => setShowSettings(false)}/></div><div style={{ marginBottom: '20px' }}><label style={{ display: 'block', fontSize: '12px', color: '#888', marginBottom: '8px' }}>Default Compiler (for LaTeX)</label><select value={project?.compiler} onChange={(e) => updateProject({ compiler: e.target.value })} style={{ width: '100%', background: '#333', color: 'white', border: '1px solid #444', padding: '8px', borderRadius: '4px' }}><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option><option value="typst">Typst</option><option value="pandoc">Pandoc (Markdown)</option></select><div style={{ marginTop: '12px', fontSize: '11px', color: '#666', lineHeight: '1.5' }}>Tip: specify main LaTeX file with:<br/><code>% !TEX root = main.tex</code></div></div><button onClick={() => setShowSettings(false)} style={{ width: '100%', background: '#0071e3', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 600 }}>Save</button></div></div>}
      
      {showShare && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}><div style={{ background: '#252526', width: '450px', borderRadius: '16px', border: '1px solid #333', padding: '32px' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}><h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}><UserPlus color="#0071e3"/> Share Project</h2><X style={{ cursor: 'pointer', color: '#666' }} onClick={() => setShowShare(false)}/></div><div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}><input value={shareEmail} onChange={e => setShareEmail(e.target.value)} placeholder="Email address..." style={{ flex: 1, background: '#1e1e1e', border: '1px solid #333', padding: '10px', borderRadius: '8px', outline: 'none' }}/><select value={sharePerm} onChange={e => setSharePerm(e.target.value)} style={{ background: '#333', border: 'none', padding: '10px', borderRadius: '8px' }}><option value="read">Read</option><option value="write">Write</option></select><button onClick={() => { axios.post(`${API_URL}/projects/${id}/share`, { email: shareEmail, permission: sharePerm }, { headers: { Authorization: `Bearer ${token}` } }).then(() => { setShareEmail(''); fetchAll(); }); }} style={{ background: '#0071e3', border: 'none', color: 'white', padding: '10px 20px', borderRadius: '8px', fontWeight: 600 }}>Invite</button></div><div style={{ borderTop: '1px solid #333', paddingTop: '20px' }}><span style={{ fontSize: '12px', fontWeight: 700, color: '#555', textTransform: 'uppercase' }}>Access</span><div style={{ marginTop: '12px' }}><div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}><div style={{ width: '32px', height: '32px', borderRadius: '16px', background: '#0071e3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UserIcon size={16} color="white"/></div><div style={{ flex: 1 }}><div style={{ fontSize: '14px', fontWeight: 600 }}>{project?.owner?.email}</div><div style={{ fontSize: '12px', color: '#666' }}>Owner</div></div></div>{project?.sharedWith?.map((s: any) => (<div key={s.email} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}><div style={{ width: '32px', height: '32px', borderRadius: '16px', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UserIcon size={16}/></div><div style={{ flex: 1 }}><div style={{ fontSize: '14px' }}>{s.email}</div><div style={{ fontSize: '12px', color: '#666' }}>Can {s.permission === 'read' ? 'read' : 'write'}</div></div></div>))}</div></div></div></div>}

      {showLinkModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: '#252526', width: '600px', height: '500px', borderRadius: '16px', border: '1px solid #333', padding: '32px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                      <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}><Link color="#0071e3"/> Link from other project</h2>
                      <X style={{ cursor: 'pointer', color: '#666' }} onClick={() => setShowLinkModal(false)}/>
                  </div>
                  
                  <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: 0 }}>
                      <div style={{ flex: 1, background: '#1e1e1e', borderRadius: '8px', padding: '12px', overflowY: 'auto' }}>
                          <div style={{ fontSize: '10px', color: '#666', fontWeight: 800, textTransform: 'uppercase', marginBottom: '12px' }}>Projects</div>
                          {availableProjects.map(p => (
                              <div key={p._id} onClick={async () => {
                                  const res = await axios.get(`${API_URL}/projects/${p._id}`, { headers: { Authorization: `Bearer ${token}` } });
                                  setBrowsingProject(p);
                                  setBrowsingDocs(res.data.documents);
                              }} style={{ padding: '8px', cursor: 'pointer', borderRadius: '4px', background: browsingProject?._id === p._id ? '#0071e3' : 'transparent', fontSize: '13px' }}>
                                  {p.name}
                              </div>
                          ))}
                      </div>
                      <div style={{ flex: 2, background: '#1e1e1e', borderRadius: '8px', padding: '12px', overflowY: 'auto' }}>
                          <div style={{ fontSize: '10px', color: '#666', fontWeight: 800, textTransform: 'uppercase', marginBottom: '12px' }}>Files & Folders</div>
                          {browsingDocs.map(d => (
                              <div key={d._id} onClick={() => setLinkTargetDoc(d)} style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: '4px', background: linkTargetDoc?._id === d._id ? '#333' : 'transparent', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', color: d.isFolder ? '#dcb67a' : '#aaa' }}>
                                  {d.isFolder ? <Folder size={14}/> : <FileText size={14}/>}
                                  <span>{d.path}{d.name}</span>
                              </div>
                          ))}
                          {!browsingProject && <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: '12px' }}>Select a project first</div>}
                      </div>
                  </div>

                  <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                      <button onClick={() => setShowLinkModal(false)} style={{ background: '#333', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '8px', fontWeight: 600 }}>Cancel</button>
                      <button 
                        disabled={!linkTargetDoc} 
                        onClick={() => createLink(browsingProject._id, linkTargetDoc)}
                        style={{ background: linkTargetDoc ? '#0071e3' : '#333', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '8px', fontWeight: 600, cursor: linkTargetDoc ? 'pointer' : 'default' }}
                      >
                        Link Item
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
