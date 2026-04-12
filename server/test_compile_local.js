import { compileProject } from './dist/index.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

process.env.NO_LISTEN = '1';

const testId = 'test_project_local';
const cacheDir = `/tmp/workshop_cache_${testId}`;
const workDir = `/tmp/workshop_project_${testId}`;

const compilers = ['pdflatex', 'xelatex', 'lualatex'];
const modes = ['normal', 'draft'];
const preambleOptions = [false, true];

const docContent = `\\documentclass{article}
\\usepackage{xcolor}
\\begin{document}
Hello World with \\textcolor{red}{color}.
\\end{document}`;

function hasTool(cmd) {
    try {
        execSync(`${cmd} --version`, { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}

async function runTests() {
    let failed = 0;
    let passed = 0;

    console.log("=== RUNNING LOCAL LATEXWORKSHOP COMPILER TESTS ===\n");

    const runTestCase = async (name, project, documents, options) => {
        process.stdout.write(`Testing: ${name}... `);
        try {
            const result = await compileProject(project, documents, options);
            if (result.pdfPath && fs.existsSync(result.pdfPath)) {
                console.log("✅ SUCCESS");
                passed++;
                fs.unlinkSync(result.pdfPath);
            } else {
                console.log("❌ FAILED (No PDF)");
                console.error(result.logs || result.error);
                failed++;
            }
        } catch (err) {
            console.log("❌ FAILED (Exception)");
            console.error(err.logs || err.message || err);
            failed++;
        }
    };

    // 1. Test LaTeX compilers
    for (const compiler of compilers) {
        if (!hasTool(compiler === 'pdflatex' ? 'pdflatex' : compiler)) {
            console.log(`Skipping ${compiler} (not found)`);
            continue;
        }
        for (const usePreamble of preambleOptions) {
            for (const mode of modes) {
                const project = { _id: testId, type: 'latex', compiler };
                const documents = [{
                    _id: 'doc_1',
                    name: 'main.tex',
                    path: '',
                    content: docContent,
                    isMain: true,
                    isFolder: false,
                    isBinary: false
                }];
                const options = {
                    preferredMain: 'main.tex',
                    mode,
                    usePreamble,
                    currentContent: docContent,
                    currentFileId: 'doc_1'
                };
                await runTestCase(`${compiler} | preamble: ${usePreamble} | mode: ${mode}`, project, documents, options);
            }
        }
    }

    // 2. Test Complex subdirs (LaTeX)
    if (hasTool('xelatex')) {
        const complexProject = { _id: 'complex_local', type: 'latex', compiler: 'xelatex' };
        const complexDocs = [
            { _id: 'c1', name: 'main.tex', path: '', isMain: true, content: `\\documentclass{book}\n\\input{sub/config}\n\\begin{document}\n\\include{sub/chapter1}\n\\end{document}` },
            { _id: 'c2', name: 'config.tex', path: 'sub/', content: `\\usepackage{xcolor}` },
            { _id: 'c3', name: 'chapter1.tex', path: 'sub/', content: `\\chapter{Test}\nHello from subfolder with \\textcolor{blue}{color}!` }
        ];
        await runTestCase('Complex Subdirs | xelatex | preamble: true', complexProject, complexDocs, { preferredMain: 'main.tex', mode: 'normal', usePreamble: true });
    }

    console.log(`\n=== TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
    
    // Clean up
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
