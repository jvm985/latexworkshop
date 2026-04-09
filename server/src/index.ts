import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/latexworkshop';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '339058057860-i6ne31mqs27mqm2ulac7al9vi26pmgo1.apps.googleusercontent.com';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

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
  lastModified: { type: Date, default: Date.now }
});
const Project = mongoose.model('Project', projectSchema);

const documentSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  name: { type: String, required: true },
  content: { type: String, default: '' }
});
const Document = mongoose.model('Document', documentSchema);

// --- AUTH MIDDLEWARE ---
const authenticate = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('Unauthorized');
  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error('Invalid token');
    req.user = await User.findOne({ email: payload.email });
    if (!req.user) return res.status(401).send('User not found');
    next();
  } catch (err) {
    res.status(401).send('Invalid token');
  }
};

// --- ROUTES ---
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error('No payload');
    
    let user = await User.findOne({ email: payload.email });
    if (!user) {
      user = await User.create({ email: payload.email, name: payload.name, picture: payload.picture });
    }
    res.json({ token: credential, user });
  } catch (err) {
    console.error(err);
    res.status(400).send('Login failed');
  }
});

// Get Projects
app.get('/api/projects', authenticate, async (req: any, res) => {
  const projects = await Project.find({ owner: req.user._id }).sort({ lastModified: -1 });
  res.json(projects);
});

// Create Project
app.post('/api/projects', authenticate, async (req: any, res) => {
  const { name } = req.body;
  const project = await Project.create({ owner: req.user._id, name });
  // Create main.tex by default
  await Document.create({
    project: project._id,
    name: 'main.tex',
    content: '\\documentclass{article}\n\\begin{document}\nHello World!\n\\end{document}'
  });
  res.json(project);
});

// Get Project Details & Documents
app.get('/api/projects/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
  if (!project) return res.status(404).send('Not found');
  const documents = await Document.find({ project: project._id });
  res.json({ project, documents });
});

// Compile LaTeX
app.post('/api/compile/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
  if (!project) return res.status(404).send('Not found');
  
  const documents = await Document.find({ project: project._id });
  const workDir = path.join('/tmp', `latex_${project._id}_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  // Write all files
  for (const doc of documents) {
    fs.writeFileSync(path.join(workDir, doc.name), doc.content);
  }

  const mainFile = 'main.tex';
  if (!fs.existsSync(path.join(workDir, mainFile))) {
    return res.status(400).send('main.tex not found');
  }

  // Compile using pdflatex
  exec(`pdflatex -interaction=nonstopmode -halt-on-error ${mainFile}`, { cwd: workDir }, (error, stdout, stderr) => {
    const pdfPath = path.join(workDir, 'main.pdf');
    if (fs.existsSync(pdfPath)) {
      res.sendFile(pdfPath, () => {
        fs.rmSync(workDir, { recursive: true, force: true });
      });
    } else {
      fs.rmSync(workDir, { recursive: true, force: true });
      res.status(500).json({ error: 'Compilation failed', logs: stdout });
    }
  });
});

// --- SOCKET.IO FOR COLLABORATION ---
io.on('connection', (socket) => {
  socket.on('join-document', (documentId) => {
    socket.join(documentId);
  });

  socket.on('leave-document', (documentId) => {
    socket.leave(documentId);
  });

  socket.on('edit-document', async ({ documentId, content }) => {
    // Broadcast to others in the same document
    socket.to(documentId).emit('document-updated', content);
    // Debounced save to DB can be added here
    await Document.findByIdAndUpdate(documentId, { content });
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 LaTeX Workshop Backend running on port ${PORT}`);
});
