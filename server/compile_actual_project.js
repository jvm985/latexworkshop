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
    const Project = mongoose.model('Project', projectSchema);

    const documentSchema = new mongoose.Schema({
        project: mongoose.Schema.Types.ObjectId,
        name: String,
        path: String,
        content: String,
        isBinary: Boolean,
        binaryData: Buffer,
        isMain: Boolean
    });
    const Document = mongoose.model('Document', documentSchema);

    const project = await Project.findById(projectID);
    if (!project) {
        console.error("Project not found!");
        process.exit(1);
    }
    console.log(`Compiling project: ${project.name} (${project.compiler})`);

    const documents = await Document.find({ project: projectID });
    console.log(`Found ${documents.length} documents.`);

    const options = {
        preferredMain: '5_geschiedenis.tex', // based on previous logs
        mode: 'normal',
        usePreamble: true
    };

    try {
        const result = await compileProject(project, documents, options);
        console.log("✅ COMPILATION SUCCESSFUL!");
        console.log("PDF Path:", result.pdfPath);
        process.exit(0);
    } catch (err) {
        console.log("❌ COMPILATION FAILED!");
        console.log("Error:", err.error);
        console.log("Logs:");
        console.log(err.logs);
        process.exit(1);
    }
}

run();
