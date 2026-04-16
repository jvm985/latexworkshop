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
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/docs';
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

    const docs = await Document.find({ project: projectId }).lean();
    let resolved: any[] = [];

    for (const doc of docs) {
        if (doc.isLink && doc.linkedDocument) {
            // Check access to linked project
            const linkedProj = await Project.findOne({ 
                _id: doc.linkedProject, 
                $or: [{ owner: user._id }, { 'sharedWith.email': user.email }] 
            });
            if (!linkedProj) continue; // No access

            const targetDoc: any = await Document.findById(doc.linkedDocument).lean();
            if (!targetDoc) continue;

            // Add the link itself (with target's info but project's path)
            resolved.push({ ...targetDoc, _id: doc._id, project: doc.project, path: doc.path, name: doc.name, isLink: true, originalId: targetDoc._id });

            if (targetDoc.isFolder) {
                // Pull in children recursively
                const children = await Document.find({ 
                    project: doc.linkedProject, 
                    path: new RegExp(`^${targetDoc.path}${targetDoc.name}/`) 
                }).lean();
                
                for (const child of children) {
                    const relativePath = child.path.substring(targetDoc.path.length + targetDoc.name.length + 1);
                    resolved.push({ 
                        ...child, 
                        _id: `${doc._id}_${child._id}`, // Virtual ID
                        project: doc.project, 
                        path: `${doc.path}${doc.name}/${relativePath}`,
                        isLink: true 
                    });
                }
            }
        } else {
            resolved.push(doc);
        }
    }
    return resolved;
}

// --- R SESSION MANAGEMENT ---
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
const userSessions = new Map<string, { process: ChildProcessWithoutNullStreams, output: string }>();

const getRSession = (userId: string) => {
  if (userSessions.has(userId)) return userSessions.get(userId)!;

  const rProcess = spawn('R', ['--vanilla', '--quiet', '--interactive']);
  const session = { process: rProcess, output: '' };
  
  rProcess.stdout.on('data', (data) => { 
    session.output += data.toString(); 
  });
  rProcess.stderr.on('data', (data) => { 
    session.output += data.toString(); 
  });
  
  rProcess.stdin.write(`options(device = function(...) { 
    png(file = "/tmp/lw_plot_${userId}_%03d.png", width = 800, height = 600)
  })\n`);

  userSessions.set(userId, session);
  return session;
};

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

// --- COMPILATION ENGINE ---
export const compileProject = async (project: any, documents: any[], options: any) => {
    const { preferredMain, mode, usePreamble, currentContent, currentFileId } = options;
    
    // Use /dev/shm (RAM) for ultra-fast access and to ensure no disk lag
    const baseDir = fs.existsSync('/dev/shm') ? '/dev/shm' : '/tmp';
    const workDir = path.join(baseDir, `lw_proj_${project._id}`);
    const cacheDir = path.join(baseDir, `lw_cache_${project._id}`);
    
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    let mainFile = '';
    let latestModTime = 0;

    // 1. Sync all files to RAM
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

        const data = (doc.isBinary || (doc.isLink && binaryData)) ? binaryData : Buffer.from(content || '');
        
        // Write and force flush to OS buffer
        fs.writeFileSync(fullPath, data);
        try {
            const fd = fs.openSync(fullPath, 'r+');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
        } catch (e) {}
        
        const stats = fs.statSync(fullPath);
        if (stats.mtimeMs > latestModTime) latestModTime = stats.mtimeMs;
        
        const relPath = path.join(doc.path, doc.name);
        if (preferredMain && doc.name === preferredMain) mainFile = relPath;
        if (doc.isMain && !mainFile) mainFile = relPath;
    }

    if (!mainFile) {
        // Look for LaTeX root comment % !TEX root = ...
        for (const doc of documents) {
            if (doc.content?.includes('!TEX root')) {
                const match = doc.content.match(/%\s*!TEX\s+root\s*=\s*([^\s]+)/);
                if (match) {
                    mainFile = path.join(doc.path, match[1]);
                    break;
                }
            }
        }
    }

    if (!mainFile) {
        const fallback = documents.find(d => d.name.endsWith('.tex') || d.name.endsWith('.typ') || d.name.endsWith('.md') || d.name.endsWith('.Rmd'));
        if (fallback) mainFile = path.join(fallback.path, fallback.name);
    }

    if (!mainFile) return { error: 'Geen hoofdbestand gevonden.', logs: 'Stel een hoofdbestand in.' };

    const jobName = path.parse(mainFile).name;
    const targetPath = path.join(workDir, mainFile);
    const absLogPath = path.join(workDir, path.dirname(mainFile), `${jobName}.log`);
    const absActualPdfPath = path.join(workDir, path.dirname(mainFile), `${jobName}.pdf`);
    const finalPdf = path.join(workDir, 'output.pdf');

    // 2. Clear old artifacts
    [finalPdf, absActualPdfPath, absLogPath].forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });

    let command = '';
    const runId = Math.random().toString(36).substring(7);
    const runCacheDir = path.join(workDir, `rc_${runId}`);
    fs.mkdirSync(runCacheDir, { recursive: true });
    
    const env = { ...process.env, TYPST_CACHE_DIR: runCacheDir };

    if (mainFile.endsWith('.typ')) {
        command = `typst compile --font-path /usr/share/fonts/dm-sans/ "${mainFile}" "output.pdf"`;
    } else if (mainFile.endsWith('.Rmd')) {
        command = `Rscript -e "rmarkdown::render('${mainFile}', output_file='output.pdf', output_dir='.')"`;
    } else if (mainFile.endsWith('.md')) {
        command = `pandoc "${mainFile}" -o "output.pdf"`;
    } else {
        const compiler = project.compiler || 'pdflatex';
        const engine = compiler === 'xelatex' ? '-pdfxe' : (compiler === 'lualatex' ? '-pdflua' : '-pdf');
        command = `latexmk ${engine} -interaction=nonstopmode -f -synctex=1 "${mainFile}"`;
    }

    // 4. Execute
    return new Promise((resolve, reject) => {
        exec(command, { cwd: workDir, timeout: 120000, env }, (error, stdout, stderr) => {
            let logs = `--- COMMAND ---\n${command}\n\n--- STDOUT ---\n${stdout}\n\n--- STDERR ---\n${stderr}`;
            if (fs.existsSync(absLogPath)) logs += `\n\n--- LATEX LOG ---\n${fs.readFileSync(absLogPath, 'utf8')}`;

            // Success detection
            const producedPdf = (mainFile.endsWith('.tex')) ? absActualPdfPath : finalPdf;

            if (fs.existsSync(producedPdf)) {
                if (producedPdf !== finalPdf) fs.renameSync(producedPdf, finalPdf);
                resolve({ pdfPath: finalPdf, logs });
            } else {
                reject({ error: 'Compilatie mislukt', logs });
            }
        });
    });
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
  const { name } = req.body;
  const project = await Project.create({ owner: req.user._id, name, type: 'project', compiler: 'pdflatex' });
  await Document.create({ project: project._id, name: 'main.tex', content: '\\documentclass{article}\n\\begin{document}\nHello Docs!\n\\end{document}', isMain: true });
  res.json(project);
});

app.get('/api/projects/:id', authenticate, async (req: any, res) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] }).populate('owner', 'name email');
  if (!project) return res.status(404).send('Not found');
  const documents = await resolveDocuments(project._id as any, req.user);
  res.json({ project, documents });
});

app.post('/api/projects/:id/links', authenticate, async (req: any, res) => {
    const { targetProjectId, targetDocumentId, name, path } = req.body;

    // Check target access
    const targetProj = await Project.findOne({ 
        _id: targetProjectId, 
        $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] 
    });
    if (!targetProj) return res.status(403).send('No access to target project');

    // Circularity check: does target project already link to THIS project?
    const targetDocs = await resolveDocuments(targetProjectId, req.user);
    if (targetDocs.some(d => d.project.toString() === req.params.id)) {
        return res.status(400).send('Circular reference detected');
    }

    const link = await Document.create({
        project: req.params.id,
        name,
        path,
        isLink: true,
        linkedProject: targetProjectId,
        linkedDocument: targetDocumentId
    });
    res.json(link);
});


app.post('/api/projects/:id/files', authenticate, async (req: any, res) => {
  const { name, path, isFolder, isBinary, content, binaryData } = req.body;
  const doc = await Document.create({ project: req.params.id, name, path, isFolder, isBinary, content: content || '', binaryData: binaryData ? Buffer.from(binaryData, 'base64') : null });
  res.json(doc);
});

app.get('/api/projects/:id/files/:fileId/raw', authenticate, async (req: any, res) => {
    const doc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (!doc) return res.status(404).send('File not found');
    res.setHeader('Content-Type', mime.lookup(doc.name) || 'application/octet-stream');
    res.send(doc.isBinary && doc.binaryData ? doc.binaryData : doc.content);
});

app.patch('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    const oldDoc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (!oldDoc) return res.status(404).send('File not found');
    const { path: newPath, name: newName } = req.body;
    if (oldDoc.isFolder && (newPath !== undefined || newName !== undefined)) {
        const oldFolderPath = oldDoc.path + oldDoc.name + "/";
        const newFolderPath = (newPath !== undefined ? newPath : oldDoc.path) + (newName !== undefined ? newName : oldDoc.name) + "/";
        const children = await Document.find({ project: req.params.id, path: new RegExp('^' + oldFolderPath) });
        for (const child of children) await Document.updateOne({ _id: child._id }, { path: child.path.replace(oldFolderPath, newFolderPath) });
    }
    const doc = await Document.findOneAndUpdate({ _id: req.params.fileId, project: req.params.id }, req.body, { new: true });
    res.json(doc);
});

app.delete('/api/projects/:id/files/:fileId', authenticate, async (req: any, res) => {
    const doc = await Document.findOne({ _id: req.params.fileId, project: req.params.id });
    if (doc?.isFolder) await Document.deleteMany({ project: req.params.id, path: new RegExp('^' + (doc.path + doc.name + "/").replace(/\//g, '\\/')) });
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

app.post('/api/compile/:id', authenticate, async (req: any, res: any) => {
  const project = await Project.findOne({ _id: req.params.id, $or: [{ owner: req.user._id }, { 'sharedWith.email': req.user.email }] });
  if (!project) return res.status(404).send('Not found');
  const documents = await Document.find({ project: project._id, isFolder: false });

  const { currentContent, currentFileId } = req.body;
  const activeDoc = documents.find(d => d._id.toString() === currentFileId);
  const isR = activeDoc?.name.endsWith('.R') || activeDoc?.name.endsWith('.r');

  if (isR) {
      const userId = req.user._id.toString();
      const session = getRSession(userId);
      const workDir = `/tmp/lw_r_work_${userId}`;

      if (!fs.existsSync(workDir)) fs.mkdirSync(workDir);
      for (const doc of documents) {
          if (doc.isFolder) continue;
          let content = (currentFileId && doc._id.toString() === currentFileId) ? currentContent : doc.content;
          
          if (doc.isLink && doc.linkedDocument) {
              const target: any = await Document.findById(doc.linkedDocument).lean();
              if (target) content = target.content;
          }

          fs.writeFileSync(path.join(workDir, doc.path, doc.name), content || '');
      }

      // Clear previous plots for this user
      fs.readdirSync('/tmp').filter(f => f.startsWith(`lw_plot_${userId}_`)).forEach(f => {
          try { fs.unlinkSync(path.join('/tmp', f)); } catch(e) {}
      });

      session.output = '';
      const sentinel = `SENTINEL_DONE_${Date.now()}`;
      const scriptPath = `/tmp/lw_script_${userId}.R`;
      
      const codeToRun = (currentFileId ? currentContent : documents.find(d => d.isMain)?.content) || '';

      const wrappedCode = `
        setwd("${workDir}")
        options(warn=-1)
        suppressMessages(library(jsonlite, quietly=TRUE))
        
        # Run user code expression by expression to mimic console behavior
        .lw_code <- ${JSON.stringify(codeToRun)}
        .lw_exprs <- tryCatch(parse(text = .lw_code), error = function(e) { cat("PARSE ERROR:", e$message, "\\n"); NULL })
        
        if (!is.null(.lw_exprs)) {
            for (.lw_i in seq_along(.lw_exprs)) {
                tryCatch({
                    .lw_res <- withVisible(eval(.lw_exprs[[.lw_i]], envir = .GlobalEnv))
                    if (.lw_res$visible) {
                        if (is.null(.lw_res$value)) {
                            # NULL often doesn't print in print()
                            cat("NULL\\n")
                        } else {
                            print(.lw_res$value)
                        }
                    }
                }, error = function(e) { cat("ERROR:", e$message, "\\n") })
            }
        }
        
        # Finalize plots
        while(dev.cur() > 1) dev.off()
        cat("${sentinel}\\n")
        
        # Silently capture variables
        var_list <- list()
        all_objs <- ls(all.names=FALSE, envir = .GlobalEnv)
        for (v in all_objs) {
          if (v %in% c("var_list", "all_objs", "v", "val") || grepl("^\\\\.lw_", v)) next
          val <- get(v, envir = .GlobalEnv)
          if (!is.function(val) && !is.environment(val)) {
            var_list[[v]] <- list(type = class(val)[1], summary = paste(capture.output(str(val)), collapse="\\n"))
          }
        }
        write_json(var_list, "/tmp/lw_vars_${userId}.json")
      `;

      fs.writeFileSync(scriptPath, wrappedCode);
      session.process.stdin.write(`source("${scriptPath}", echo=FALSE, verbose=FALSE, print.eval=TRUE)\n`);

      let checkCount = 0;
      const waitForDone = setInterval(() => {
          checkCount++;
          if (session.output.includes(sentinel) || checkCount > 250) {
              clearInterval(waitForDone);
              
              let finalOutput = session.output.split(sentinel)[0];
              
              const scriptFileName = path.basename(scriptPath);
              const lines = finalOutput.split('\n').filter(l => {
                  const trimmed = l.trim();
                  if (trimmed.includes(scriptFileName)) return false;
                  if (trimmed.startsWith('> source(')) return false;
                  if (trimmed.startsWith('> setwd(')) return false;
                  if (trimmed.startsWith('> options(')) return false;
                  if (trimmed.startsWith('> tryCatch({')) return false;
                  if (trimmed.startsWith('> while(dev.cur()')) return false;
                  if (trimmed === '+') return false;
                  if (trimmed.startsWith('+')) {
                      if (trimmed.includes('png(file =')) return false;
                      if (trimmed.includes('dev.off()')) return false;
                      if (trimmed.includes('cat("SENTINEL_DONE')) return false;
                      if (trimmed.includes('}, error = function(e)')) return false;
                      if (trimmed.includes('})')) return false;
                  }
                  return true;
              });
              finalOutput = lines.join('\n').replace(/^> /gm, '').trim();

              const varFile = `/tmp/lw_vars_${userId}.json`;
              let variables = {};
              
              setTimeout(() => {
                  if (fs.existsSync(varFile)) {
                      try { variables = JSON.parse(fs.readFileSync(varFile, 'utf8')); } catch (e) {}
                      fs.unlinkSync(varFile);
                  }

                  const plotFiles = fs.readdirSync('/tmp').filter(f => f.startsWith(`lw_plot_${userId}_`)).sort();
                  const plots = plotFiles.map(f => fs.readFileSync(path.join('/tmp', f)).toString('base64'));
                  plotFiles.forEach(f => { try { fs.unlinkSync(path.join('/tmp', f)); } catch(e) {} });

                  res.json({ stdout: finalOutput, plots, variables });
                  if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
              }, 500);
          }
      }, 100);
      return;
  }

  try {
      const result: any = await compileProject(project, documents, req.body);
      res.sendFile(result.pdfPath);
  } catch (err: any) {
      res.status(500).json(err);
  }
});

app.get('/api/projects/:id/synctex', authenticate, async (req: any, res) => {
    const { line, file } = req.query;
    const synctexFile = path.join('/tmp', `synctex_${req.params.id}.gz`);
    if (!fs.existsSync(synctexFile)) return res.status(404).send('SyncTeX file not found');
    exec(`synctex view -i ${line}:0:${file} -o dummy.pdf`, { cwd: '/tmp' }, (error, stdout) => {
        if (error) return res.status(500).send('SyncTeX error');
        const pageMatch = stdout.match(/Page:(\d+)/), yMatch = stdout.match(/y:([\d.]+)/);
        if (pageMatch) res.json({ page: parseInt(pageMatch[1]), y: yMatch ? parseFloat(yMatch[1]) : 0 });
        else res.status(404).send('Position not found');
    });
});

io.on('connection', (socket) => {
  socket.on('join-document', (documentId) => socket.join(documentId));
  socket.on('edit-document', async ({ documentId, content }) => {
    socket.to(documentId).emit('document-updated', content);
    await Document.findByIdAndUpdate(documentId, { content });
  });
});

const cleanup = () => {
    const baseDir = fs.existsSync('/dev/shm') ? '/dev/shm' : '/tmp';
    const dirs = fs.readdirSync(baseDir);
    const now = Date.now(), maxAge = 3600000; // 1 hour
    for (const dir of dirs) {
        if (dir.startsWith('lw_proj_') || dir.startsWith('lw_cache_')) {
            const p = path.join(baseDir, dir);
            try {
                if (now - fs.statSync(p).mtimeMs > maxAge) fs.rmSync(p, { recursive: true, force: true });
            } catch (e) {}
        }
    }
};
setInterval(cleanup, 3600000);

if (!process.env.NO_LISTEN) httpServer.listen(PORT, () => console.log(`🚀 Workshop Backend running on port ${PORT}`));
