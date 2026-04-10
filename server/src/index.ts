import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mime from 'mime-types';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { 
  cors: { origin: '*', methods: ['GET', 'POST'] },
  allowEIO3: true
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/latexworkshop';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '339058057860-i6ne31mqs27mqm2ulac7al9vi26pmgo1.apps.googleusercontent.com';

mongoose.connect(MONGO_URI).then(() => console.log('✅ Connected to MongoDB'));

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// --- MODELS ---
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  name: String,
  picture: String,
});
const User = mongoose.model('User', userSchema);

const projectSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['latex', 'typst', 'markdown'], default: 'latex' },
  compiler: { type: String, enum: ['pdflatex', 'xelatex', 'lualatex', 'typst', 'pandoc'], default: 'pdflatex' },
  sharedWith: [{
    email: String,
    permission: { type: String, enum: ['read', 'write'], default: 'read' }
  }],
  lastModified: { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', projectSchema);

const documentSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  name: { type: String, required: true },
  path: { type: String, default: '' },
  content: { type: String, default: '' },
  binaryData: { type: Buffer },
  isBinary: { type: Boolean, default: false },
  isFolder: { type: Boolean, default: false },
  isMain: { type: Boolean, default: false }
});
const Document = mongoose.model('Document', documentSchema);

// --- AUTH MIDDLEWARE ---
const authenticate = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('Unauthorized');
  
  if (process.env.NODE_ENV === 'test' && token === 'mock-token') {
      req.user = await User.findOne({ email: 'test@gemini.com' });
      if (!req.user) req.user = await User.create({ email: 'test@gemini.com', name: 'Gemini Tester' });
      return next();
  }

  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error('Invalid token');
    req.user = await User.findOne({ email: payload.email });
    if (!req.user) req.user = await User.create({ email: payload.email, name: payload.name, picture: payload.picture });
    next();
  } catch (err) { res.status(401).send('Invalid token'); }
};

// --- ROUTES ---
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload) throw new Error('No payload');
    let user = await User.findOne({ email: payload.email });
    if (!user) user = await User.create({ email: payload.email, name: payload.name, picture: payload.picture });
    res.json({ token: credential, user });
  } catch (err) { res.status(400).send('Login failed'); }
});

app.get('/api/projects', authenticate, async (req: any, res) => {
  const projects = await Project.find({ $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email').sort({ lastModified: -1 });
  res.json(projects);
});

app.post('/api/projects', authenticate, async (req: any, res) => {
  const { name, type } = req.body;
  let compiler = 'pdflatex';
  if (type === 'typst') compiler = 'typst';
  if (type === 'markdown') compiler = 'pandoc';
  
  const project = await Project.create({ owner: req.user._id, name, type, compiler });
  
  let mainFile = 'main.tex';
  let content = '\\documentclass{article}\n\\begin{document}\nHello LaTeX!\n\\end{document}';
  if (type === 'typst') {
      mainFile = 'main.typ';
      content = '#set page(paper: "a4")\n= Hello Typst';
  } else if (type === 'markdown') {
      mainFile = 'main.md';
      content = '# Hello Markdown\n\nThis is a professional document.';
  }
  
  await Document.create({ project: project._id, name: mainFile, content, isMain: true });
  res.json(project);
});

app.get('/api/projects/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email');
  if (!project) return res.status(404).send('Not found');
  const documents = await Document.find({ project: project._id }, { binaryData: 0 });
  res.json({ project, documents });
});

app.post('/api/projects/:id/files', authenticate, async (req: any, res) => {
  const { name, path, isFolder, isBinary, content, binaryData } = req.body;
  const doc = await Document.create({ 
    project: req.params.id, name, path, isFolder, isBinary, 
    content: content || '', 
    binaryData: binaryData ? Buffer.from(binaryData, 'base64') : null 
  });
  res.json(doc);
});

app.get('/api/projects/:id/files/:fileId/raw', authenticate, async (req: any, res) => {
    const doc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (!doc) return res.status(404).send('File not found');
    
    const contentType = mime.lookup(doc.name) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);

    if (doc.isBinary && doc.binaryData) {
        res.send(doc.binaryData);
    } else {
        res.send(doc.content);
    }
});

app.patch('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    const oldDoc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (!oldDoc) return res.status(404).send('File not found');

    const { path: newPath, name: newName } = req.body;

    if (oldDoc.isFolder && (newPath !== undefined || newName !== undefined)) {
        const oldFolderPath = oldDoc.path + oldDoc.name + "/";
        const folderName = newName !== undefined ? newName : oldDoc.name;
        const folderParentPath = newPath !== undefined ? newPath : oldDoc.path;
        const newFolderPath = folderParentPath + folderName + "/";

        const children = await Document.find({ project: req.params.id, path: new RegExp('^' + oldFolderPath) });
        for (const child of children) {
            const updatedPath = child.path.replace(oldFolderPath, newFolderPath);
            await Document.updateOne({ _id: child._id }, { path: updatedPath });
        }
    }

    const doc = await Document.findOneAndUpdate(
        { _id: req.params.fileId, project: req.params.id }, 
        req.body, 
        { new: true }
    );
    res.json(doc);
});

app.delete('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    const doc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (doc?.isFolder) {
        const folderPath = doc.path + doc.name + "/";
        await Document.deleteMany({ project: req.params.id, path: new RegExp('^' + folderPath) });
    }
    await Document.deleteOne({ _id: req.params.fileId, project: req.params.id });
    res.json({ success: true });
});

app.post('/api/projects/:id/files/:fileId/main', authenticate, async (req: any, res) => {
    await Document.updateMany({ project: req.params.id }, { isMain: false });
    await Document.updateOne({ _id: req.params.fileId, project: req.params.id }, { isMain: true });
    res.json({ success: true });
});

app.patch('/api/projects/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOneAndUpdate({ _id: req.params.id, owner: req.user._id }, req.body, { new: true });
  res.json(project);
});

app.post('/api/projects/:id/share', authenticate, async (req: any, res) => {
  const { email, permission } = req.body;
  const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
  if (!project) return res.status(404).send('Not found');
  project.sharedWith.push({ email, permission });
  await project.save();
  res.json(project);
});

app.delete('/api/projects/:id', authenticate, async (req: any, res) => {
    await Project.deleteOne({ _id: req.params.id, owner: req.user._id });
    await Document.deleteMany({ project: req.params.id });
    res.json({ success: true });
});

// --- COMPILATION ENGINE ---
const compileProject = async (project: any, documents: any[], options: any) => {
    const { preferredMain, mode, usePreamble } = options;
    
    // Stable incremental path per project
    const workDir = path.join('/tmp', `workshop_project_${project._id}`);
    const cacheDir = path.join('/tmp', `workshop_cache_${project._id}`);
    
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    let mainFile = '';
    let fallbackFile = '';

    for (const doc of documents) {
        const fullPath = path.join(workDir, doc.path, doc.name);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        
        const newContent = doc.isBinary && doc.binaryData ? doc.binaryData : Buffer.from(doc.content);
        if (!fs.existsSync(fullPath) || !fs.readFileSync(fullPath).equals(newContent)) {
            fs.writeFileSync(fullPath, newContent);
        }
        
        if (preferredMain && doc.name === preferredMain) {
            if (project.type === 'typst' && preferredMain.endsWith('.typ')) mainFile = preferredMain;
            else if (project.type === 'markdown' && preferredMain.endsWith('.md')) mainFile = preferredMain;
            else if (project.type === 'latex' && doc.content.includes('\\documentclass')) mainFile = preferredMain;
        }
        if (doc.isMain && !mainFile) mainFile = doc.name;
        if (project.type === 'typst' && !fallbackFile && doc.name.endsWith('.typ')) fallbackFile = doc.name;
        if (project.type === 'markdown' && !fallbackFile && doc.name.endsWith('.md')) fallbackFile = doc.name;
        if (project.type === 'latex' && !fallbackFile && doc.name.endsWith('.tex') && doc.content.includes('\\documentclass')) fallbackFile = doc.name;
    }

    if (!mainFile) mainFile = fallbackFile || (documents.find(d => d.name.endsWith('.tex') || d.name.endsWith('.typ') || d.name.endsWith('.md'))?.name || '');
    if (!mainFile) throw new Error('Geen compileerbaar bestand gevonden.');

    let command = '';
    const env = { ...process.env, TYPST_CACHE_DIR: cacheDir };

    if (project.type === 'typst') {
        command = `typst compile "${mainFile}" main.pdf`;
    } else if (project.type === 'markdown') {
        command = `pandoc "${mainFile}" -o main.pdf`;
    } else {
        const compiler = project.compiler === 'pdflatex' ? 'pdflatex' : project.compiler;
        
        if (usePreamble) {
            const mainDoc = documents.find(d => d.name === mainFile);
            if (mainDoc) {
                const preambleEnd = mainDoc.content.indexOf('\\begin{document}');
                if (preambleEnd !== -1) {
                    const preamble = mainDoc.content.substring(0, preambleEnd);
                    fs.writeFileSync(path.join(workDir, 'preamble.tex'), preamble + '\n\\begin{document}\n\\end{document}');
                    // Precompile format if missing or not draft
                    if (!fs.existsSync(path.join(workDir, 'preamble.fmt')) || mode !== 'draft') {
                        await new Promise((resolve) => {
                            exec(`${compiler} -ini -jobname="preamble" "&${compiler} preamble.tex\\dump"`, { cwd: workDir }, () => resolve(true));
                        });
                    }
                }
            }
        }

        if (mode === 'draft') {
            // Fast single pass
            const fmtFlag = usePreamble ? '-fmt preamble' : '';
            command = `${compiler} -interaction=nonstopmode -synctex=1 ${fmtFlag} -jobname=main "${mainFile}"`;
        } else {
            // Full convergence
            const latexOption = usePreamble ? '-latexoption="-fmt preamble"' : '';
            command = `latexmk -${project.compiler === 'pdflatex' ? 'pdf' : project.compiler} -interaction=nonstopmode -jobname=main -f -synctex=1 ${latexOption} "${mainFile}"`;
        }
    }

    return new Promise((resolve, reject) => {
        exec(command, { cwd: workDir, timeout: 60000, env }, (error, stdout, stderr) => {
            const pdfPath = path.join(workDir, 'main.pdf');
            const synctexPath = path.join(workDir, 'main.synctex.gz');
            
            if (fs.existsSync(pdfPath)) {
                if (fs.existsSync(synctexPath)) {
                    fs.copyFileSync(synctexPath, path.join('/tmp', `synctex_${project._id}.gz`));
                }
                resolve({ pdfPath, logs: stdout + "\n" + stderr });
            } else {
                reject({ error: 'Compilatie mislukt.', logs: stdout + "\n" + stderr });
            }
        });
    });
};

app.post('/api/compile/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] });
  if (!project) return res.status(404).send('Not found');
  
  const documents = await Document.find({ project: project._id, isFolder: false });
  try {
      const result: any = await compileProject(project, documents, req.body);
      res.sendFile(result.pdfPath);
  } catch (err: any) {
      res.status(500).json(err);
  }
});

// SyncTeX API
app.get('/api/projects/:id/synctex', authenticate, async (req: any, res) => {
    const { line, file } = req.query;
    const synctexFile = path.join('/tmp', `synctex_${req.params.id}.gz`);
    if (!fs.existsSync(synctexFile)) return res.status(404).send('SyncTeX file not found');

    const command = `synctex view -i ${line}:0:${file} -o dummy.pdf`;
    exec(command, { cwd: '/tmp' }, (error, stdout) => {
        if (error) return res.status(500).send('SyncTeX error');
        const pageMatch = stdout.match(/Page:(\d+)/);
        const yMatch = stdout.match(/y:([\d.]+)/);
        if (pageMatch) {
            res.json({
                page: parseInt(pageMatch[1]),
                y: yMatch ? parseFloat(yMatch[1]) : 0
            });
        } else {
            res.status(404).send('Position not found');
        }
    });
});

io.on('connection', (socket) => {
  socket.on('join-document', (documentId) => socket.join(documentId));
  socket.on('edit-document', async ({ documentId, content }) => {
    socket.to(documentId).emit('document-updated', content);
    await Document.findByIdAndUpdate(documentId, { content });
  });
});

httpServer.listen(PORT, () => console.log(`🚀 Workshop Backend running on port ${PORT}`));
