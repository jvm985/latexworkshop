import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { exec, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/latexworkshop';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '339058057860-i6ne31mqs27mqm2ulac7al9vi26pmgo1.apps.googleusercontent.com';
const JWT_SECRET = process.env.JWT_SECRET || 'docs-secret-key';

mongoose.connect(MONGO_URI).then(() => console.log('✅ Connected to MongoDB (latexworkshop)'));

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
  type: { type: String, default: 'project' },
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
  isMain: { type: Boolean, default: false },
  isLink: { type: Boolean, default: false },
  linkedProject: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  linkedDocument: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' }
});
const Document = mongoose.model('Document', documentSchema);

async function resolveDocuments(projectId: string, user: any, visited = new Set()) {
    if (visited.has(projectId.toString())) return [];
    visited.add(projectId.toString());
    const docs = await Document.find({ project: projectId }).select('-content -binaryData').lean();
    let resolved: any[] = [];
    for (const doc of docs) {
        if (doc.isLink && doc.linkedDocument) {
            const linkedProj = await Project.findOne({ _id: doc.linkedProject, $or: [{ owner: user._id }, { 'sharedWith.email': user.email }] });
            if (!linkedProj) continue;
            const targetDoc: any = await Document.findById(doc.linkedDocument).select('-content -binaryData').lean();
            if (!targetDoc) continue;
            resolved.push({ ...targetDoc, _id: doc._id, project: doc.project, path: doc.path, name: doc.name, isLink: true, originalId: targetDoc._id });
            if (targetDoc.isFolder) {
                const children = await Document.find({ project: doc.linkedProject, path: new RegExp(`^${targetDoc.path}${targetDoc.name}/`) }).select('-content -binaryData').lean();
                for (const child of children) {
                    const relativePath = child.path.substring(targetDoc.path.length + targetDoc.name.length + 1);
                    resolved.push({ ...child, _id: `${doc._id}_${child._id}`, project: doc.project, path: `${doc.path}${doc.name}/${relativePath}`, isLink: true });
                }
            }
        } else resolved.push(doc);
    }
    return resolved;
}

// --- R SESSION MANAGEMENT ---
const userSessions = new Map<string, { process: ChildProcessWithoutNullStreams, output: string }>();
const getRSession = (userId: string) => {
  if (userSessions.has(userId)) return userSessions.get(userId)!;
  const rProcess = spawn('R', ['--vanilla', '--quiet', '--interactive']);
  const session = { process: rProcess, output: '' };
  rProcess.stdout.on('data', (data) => { session.output += data.toString(); });
  rProcess.stderr.on('data', (data) => { session.output += data.toString(); });
  rProcess.stdin.write(`.libPaths(c("/usr/local/lib/R/site-library", .libPaths()))\n`);
  rProcess.stdin.write(`options(device = function(...) { png(file = "/tmp/lw_plot_${userId}_%03d.png", width = 800, height = 600) })\n`);
  userSessions.set(userId, session);
  return session;
};

// --- AUTH MIDDLEWARE ---
const authenticate = async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send('Unauthorized');
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.userId);
    if (!req.user) return res.status(401).send('User not found');
    next();
  } catch (err) { res.status(401).send('Invalid token'); }
};

// --- ROUTES ---
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) throw new Error('No payload');
    let user = await User.findOne({ email: payload.email });
    if (!user) user = await User.create({ email: payload.email, name: payload.name, picture: payload.picture });
    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET);
    res.json({ token, user });
  } catch (e) { res.status(401).send('Auth failed'); }
});

app.get('/api/projects', authenticate, async (req: any, res) => {
  const projects = await Project.find({ $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email');
  res.json(projects);
});

app.get('/api/projects/all', authenticate, async (req: any, res) => {
  const projects = await Project.find({}).populate('owner', 'name email');
  res.json(projects);
});

app.post('/api/projects', authenticate, async (req: any, res) => {
  const { name } = req.body;
  const project = await Project.create({ owner: req.user._id, name, type: 'project' });
  await Document.create({ project: project._id, name: 'main.tex', content: '\\documentclass{article}\n\\begin{document}\nHello!\n\\end{document}', isMain: true });
  res.json(project);
});

app.get('/api/projects/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email');
  if (!project) return res.status(404).send('Not found');
  const documents = await resolveDocuments(project._id as any, req.user);
  res.json({ project, documents });
});

app.get('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    const doc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (!doc) return res.status(404).send('Not found');
    res.json(doc);
});

app.post('/api/projects/:id/files', authenticate, async (req: any, res) => {
  const { name, path, isFolder, isBinary, content, binaryData } = req.body;
  const doc = await Document.create({ project: req.params.id, name, path, isFolder, isBinary, content: content || '', binaryData: binaryData ? Buffer.from(binaryData, 'base64') : null });
  res.json(doc);
});

app.patch('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    const doc = await Document.findOneAndUpdate({ _id: req.params.fileId, project: req.params.id }, req.body, { new: true });
    res.json(doc);
});

app.delete('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    await Document.deleteOne({ _id: req.params.fileId, project: req.params.id });
    res.json({ success: true });
});

app.post('/api/projects/:id/files/:fileId/main', authenticate, async (req: any, res) => {
    await Document.updateMany({ project: req.params.id }, { isMain: false });
    await Document.updateOne({ _id: req.params.fileId, project: req.params.id }, { isMain: true });
    res.json({ success: true });
});

app.delete('/api/projects/:id', authenticate, async (req: any, res) => {
  await Project.deleteOne({ _id: req.params.id, owner: req.user._id });
  await Document.deleteMany({ project: req.params.id });
  res.send('Deleted');
});

const compileProject = async (project: any, user: any, body: any) => {
    const { currentContent, currentFileId, preferredMain } = body;
    const workDir = `/tmp/lw_proj_${project._id}`;
    
    if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
    fs.mkdirSync(workDir, { recursive: true });

    const documents = await Document.find({ project: project._id }).lean();

    let mainFile = '';
    for (const doc of documents) {
        if (doc.isFolder) continue;
        const fullPath = path.join(workDir, doc.path, doc.name);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        
        let content = (currentFileId && doc._id.toString() === currentFileId) ? currentContent : doc.content;
        let binaryData = doc.binaryData;

        if (doc.isLink && doc.linkedDocument) {
            const target: any = await Document.findById(doc.linkedDocument).lean();
            if (target) {
                content = target.content;
                binaryData = target.binaryData;
            }
        }
        
        let finalData: string | Buffer = content || '';
        if (doc.isBinary && binaryData) {
            finalData = Buffer.isBuffer(binaryData) ? binaryData : Buffer.from((binaryData as any).buffer || binaryData);
        }
        
        fs.writeFileSync(fullPath, finalData);
        const relPath = path.join(doc.path, doc.name);
        if (preferredMain && doc.name === preferredMain) mainFile = relPath;
        if (doc.isMain && !mainFile) mainFile = relPath;
    }
    if (!mainFile) {
        const fallback = documents.find(d => d.name.endsWith('.tex') || d.name.endsWith('.typ') || d.name.endsWith('.md') || d.name.endsWith('.Rmd'));
        if (fallback) mainFile = path.join(fallback.path, fallback.name);
    }
    if (!mainFile) throw { error: 'Geen hoofdbestand gevonden.' };
    
    const finalPdf = path.join(workDir, 'output.pdf');
    let command = '';
    if (mainFile.endsWith('.Rmd')) command = `Rscript -e ".libPaths(c('/usr/local/lib/R/site-library', .libPaths())); rmarkdown::render('${mainFile}', output_file='output.pdf', output_dir='.')"`;
    else if (mainFile.endsWith('.typ')) command = `typst compile "${mainFile}" "output.pdf"`;
    else command = `latexmk -pdf -interaction=nonstopmode -f "${mainFile}"`;

    return new Promise((resolve, reject) => {
        exec(command, { cwd: workDir, timeout: 120000 }, (error, stdout, stderr) => {
            const logs = stdout + stderr;
            if (fs.existsSync(finalPdf)) resolve({ pdfPath: finalPdf, logs });
            else reject({ error: 'Failed', logs });
        });
    });
};

app.post('/api/compile/:id', authenticate, async (req: any, res: any) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] });
  if (!project) return res.status(404).send('Not found');

  const { currentContent, currentFileId } = req.body;
  const activeDoc = await Document.findById(currentFileId);
  const isR = activeDoc?.name.match(/\.[Rr]$/);

  if (isR) {
      const userId = req.user._id.toString();
      const session = getRSession(userId);
      const workDir = `/tmp/lw_r_work_${userId}`;
      
      if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });

      const documents = await Document.find({ project: project._id, isFolder: false });
      for (const doc of documents) {
          const fullPath = path.join(workDir, doc.path, doc.name);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          let content = (currentFileId && doc._id.toString() === currentFileId) ? currentContent : doc.content;
          if (doc.isLink && doc.linkedDocument) {
              const target: any = await Document.findById(doc.linkedDocument).lean();
              if (target) content = target.content;
          }
          fs.writeFileSync(fullPath, content || '');
      }

      fs.readdirSync('/tmp').filter(f => f.startsWith(`lw_plot_${userId}_`)).forEach(f => { try { fs.unlinkSync(path.join('/tmp', f)); } catch(e) {} });
      session.output = '';
      const sentinel = `SENTINEL_DONE_${Date.now()}`;
      const userScriptPath = `/tmp/lw_user_${userId}.R`;
      const wrapperScriptPath = `/tmp/lw_wrap_${userId}.R`;
      fs.writeFileSync(userScriptPath, currentContent || '');

      const wrappedCode = `
        setwd("${workDir}")
        options(warn=-1, prompt="> ", continue="+ ")
        tryCatch({ source("${userScriptPath}", echo=TRUE, spaced=FALSE, print.eval=TRUE) }, error = function(e) { cat("ERROR:", e$message, "\\n") })
        while(dev.cur() > 1) dev.off()
        cat("${sentinel}\\n")
        suppressMessages(library(jsonlite, quietly=TRUE))
        var_list <- list(); all_objs <- ls(all.names=FALSE, envir = .GlobalEnv)
        for (v in all_objs) {
          if (v %in% c("var_list", "all_objs", "v", "val") || grepl("^\\\\.lw_", v)) next
          val <- get(v, envir = .GlobalEnv)
          if (!is.function(val) && !is.environment(val)) var_list[[v]] <- list(type = class(val)[1], summary = paste(capture.output(str(val)), collapse="\\n"))
        }
        write_json(var_list, "/tmp/lw_vars_${userId}.json")
      `;
      
      fs.writeFileSync(wrapperScriptPath, wrappedCode);
      session.process.stdin.write(`source("${wrapperScriptPath}", echo=FALSE)\n`);

      let checkCount = 0;
      const waitForDone = setInterval(() => {
          if (session.output.includes(sentinel) || ++checkCount > 250) {
              clearInterval(waitForDone);
              let out = session.output.split(sentinel)[0];
              const lines = out.split('\n').filter(l => {
                  const t = l.trim();
                  if (t.startsWith('> source(') || t.startsWith('> options(warn=') || t.startsWith('> suppressMessages(')) return false;
                  if (t.includes('SENTINEL_DONE_') || t.includes('lw_vars_')) return false;
                  return true;
              });
              const varFile = `/tmp/lw_vars_${userId}.json`;
              let variables = {};
              if (fs.existsSync(varFile)) { try { variables = JSON.parse(fs.readFileSync(varFile, 'utf8')); fs.unlinkSync(varFile); } catch(e) {} }
              const plotFiles = fs.readdirSync('/tmp').filter(f => f.startsWith(`lw_plot_${userId}_`)).sort();
              const plots = plotFiles.map(f => fs.readFileSync(path.join('/tmp', f)).toString('base64'));
              plotFiles.forEach(f => { try { fs.unlinkSync(path.join('/tmp', f)); } catch(e) {} });
              res.json({ stdout: lines.join('\n').trim(), plots, variables });
          }
      }, 100);
      return;
  }

  try {
      const result: any = await compileProject(project, req.user, req.body);
      res.sendFile(result.pdfPath);
  } catch (err: any) {
      console.error("Compilation Error:", err);
      res.status(500).json(err);
  }
});

app.get('/api/test-system', async (req, res) => {
    const results: any[] = [];
    try {
        const testUser = await User.findOneAndUpdate({ email: 'test-system@internal.cloud' }, { name: 'System Tester' }, { upsert: true, new: true });
        const token = jwt.sign({ userId: testUser._id, email: testUser.email }, JWT_SECRET);
        results.push({ name: 'Auth/JWT OK', success: !!token });
        const projName = `Test Proj ${Date.now()}`;
        const proj = await Project.create({ owner: testUser._id, name: projName });
        results.push({ name: 'Project Creation OK', success: !!proj && proj.name === projName });
        if (proj) {
            await Project.deleteOne({ _id: proj._id });
            const found = await Project.findById(proj._id);
            results.push({ name: 'Project Deletion OK', success: !found });
        }
    } catch (e: any) { results.push({ name: 'Auth/Project DB Tests', success: false, error: e.message }); }

    const testDir = '/tmp/lw_system_tests';
    if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
    const runCmd = (name: string, cmd: string, files: any) => {
        const work = path.join(testDir, name.replace(/ /g,'_'));
        if (!fs.existsSync(work)) fs.mkdirSync(work, { recursive: true });
        for (const [f,c] of Object.entries(files)) fs.writeFileSync(path.join(work, f), c as string);
        return new Promise((resolve) => {
            exec(cmd, { cwd: work, timeout: 60000 }, (err, stdout, stderr) => {
                results.push({ name, success: !err, stdout, stderr });
                resolve(null);
            });
        });
    };
    await runCmd('LaTeX Compilation OK', 'latexmk -pdf -interaction=nonstopmode main.tex', { 'main.tex': '\\documentclass{article}\\begin{document}OK\\end{document}' });
    await runCmd('RMarkdown Compilation OK', 'Rscript -e "rmarkdown::render(\'main.Rmd\', output_file=\'out.pdf\')" ', { 'main.Rmd': '---\noutput: pdf_document\n---\n# OK' });
    const rTest = () => {
        return new Promise((resolve) => {
            const session = getRSession("test_user_system");
            const sentinel = `TEST_DONE_${Date.now()}`;
            let output = '';
            const handler = (data: Buffer) => {
                output += data.toString();
                if (output.includes(sentinel)) { session.process.stdout.off('data', handler); resolve({ name: 'R Interactive OK', success: output.includes('42'), stdout: output }); }
            };
            session.process.stdout.on('data', handler);
            session.process.stdin.write(`print(21*2)\ncat("${sentinel}\\n")\n`);
        });
    };
    results.push(await rTest());
    res.json(results);
});

io.on('connection', (socket) => {
  socket.on('join-document', (documentId) => socket.join(documentId));
  socket.on('edit-document', async ({ documentId, content }) => {
    socket.to(documentId).emit('document-updated', content);
    await Document.findByIdAndUpdate(documentId, { content });
  });
});

httpServer.listen(PORT, () => console.log(`🚀 Docs Backend running on port ${PORT}`));
