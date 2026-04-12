import mongoose from 'mongoose';
import { compileProject } from './dist/index.js';
import fs from 'fs';

const projectID = '69d8080ed0dd6fef006ae994';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/latexworkshop';

async function run() {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected.");

    const projectSchema = new mongoose.Schema({
        name: String,
        type: String,
        compiler: String,
    });
    const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);

    const documentSchema = new mongoose.Schema({
        project: mongoose.Schema.Types.ObjectId,
        name: String,
        path: String,
        content: String,
        isBinary: Boolean,
        binaryData: Buffer,
        isMain: Boolean
    });
    const Document = mongoose.models.Document || mongoose.model('Document', documentSchema);

    const project = await Project.findById(projectID);
    if (!project) {
        console.error("Project not found!");
        process.exit(1);
    }
    console.log(`Compiling project: ${project.name} (${project.compiler})`);

    const documents = await Document.find({ project: projectID, isFolder: false });
    console.log(`Found ${documents.length} non-folder documents.`);

    // Fix the includeonly issue for testing
    const mainDoc = documents.find(d => d.name === '5_geschiedenis.tex');
    if (mainDoc) {
        mainDoc.content = mainDoc.content.replace(/\\includeonly\{[\s\S]*?\}/, '% includeonly removed for testing');
    }

    const optionsWithPreamble = {
        preferredMain: '5_geschiedenis.tex',
        mode: 'normal',
        usePreamble: true
    };

    const optionsWithoutPreamble = {
        preferredMain: '5_geschiedenis.tex',
        mode: 'normal',
        usePreamble: false
    };

    console.log("\n--- TESTING WITHOUT PREAMBLE ---");
    try {
        const result = await compileProject(project, documents, optionsWithoutPreamble);
        console.log("✅ SUCCESS WITHOUT PREAMBLE");
    } catch (err) {
        console.log("❌ FAILED WITHOUT PREAMBLE");
        console.log("Error:", err.error);
        // console.log("Logs:", err.logs);
    }

    console.log("\n--- TESTING WITH PREAMBLE ---");
    try {
        const result = await compileProject(project, documents, optionsWithPreamble);
        console.log("✅ SUCCESS WITH PREAMBLE");
        process.exit(0);
    } catch (err) {
        console.log("❌ FAILED WITH PREAMBLE");
        console.log("Error:", err.error);
        console.log("Logs (last 20 lines):");
        const lines = (err.logs || "").split('\n');
        console.log(lines.slice(-20).join('\n'));
        process.exit(1);
    }
}

run();
