import { compileProject } from './dist/index.js';
import fs from 'fs';
import path from 'path';

process.env.NODE_ENV = 'test_compile';

const testId = 'test_project_' + Date.now();
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

const typstContent = `#set page(paper: "a4")\n= Hello Typst`;
const mdContent = `# Hello Markdown\n\nThis is a test.`;

async function runTests() {
    let failed = 0;
    let passed = 0;

    console.log("=== RUNNING LATEXWORKSHOP COMPILER TESTS ===\\n");

    const runTestCase = async (name, project, documents, options) => {
        process.stdout.write(`Testing: ${name}... `);
        try {
            const result = await compileProject(project, documents, options);
            if (result.pdfPath && fs.existsSync(result.pdfPath)) {
                console.log("✅ SUCCESS");
                passed++;
                // Clean up pdf for next run
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

    // 1. Test LaTeX compilers with different modes
    for (const compiler of compilers) {
        for (const usePreamble of preambleOptions) {
            for (const mode of modes) {
                const project = { _id: testId, type: 'latex', compiler };
                const documents = [{
                    _id: 'doc_1',
                    name: '5_geschiedenis.tex', // test with an "odd" name
                    path: '',
                    content: docContent,
                    isMain: true,
                    isFolder: false,
                    isBinary: false
                }];
                const options = {
                    preferredMain: '5_geschiedenis.tex',
                    mode,
                    usePreamble,
                    currentContent: docContent,
                    currentFileId: 'doc_1'
                };
                await runTestCase(`${compiler} | preamble: ${usePreamble} | mode: ${mode}`, project, documents, options);
            }
        }
    }

    // 2. Test Typst
    await runTestCase('typst | normal', { _id: testId, type: 'typst' }, [{
        _id: 'doc_2', name: 'main.typ', path: '', content: typstContent, isMain: true
    }], { preferredMain: 'main.typ', mode: 'normal', usePreamble: false });

    // 3. Test Markdown (Pandoc)
    await runTestCase('markdown | normal', { _id: testId, type: 'markdown' }, [{
        _id: 'doc_3', name: 'main.md', path: '', content: mdContent, isMain: true
    }], { preferredMain: 'main.md', mode: 'normal', usePreamble: false });

    // 4. Test complex structure with subdirectories (XeLaTeX + Preamble)
    const complexProject = { _id: 'complex_' + testId, type: 'latex', compiler: 'xelatex' };
    const complexDocs = [
        {
            _id: 'c1', name: 'main.tex', path: '', isMain: true,
            content: `\\documentclass{book}\n\\input{sub/config}\n\\begin{document}\n\\include{sub/chapter1}\n\\end{document}`
        },
        {
            _id: 'c2', name: 'config.tex', path: 'sub/',
            content: `\\usepackage{xcolor}`
        },
        {
            _id: 'c3', name: 'chapter1.tex', path: 'sub/',
            content: `\\chapter{Test}\nHello from subfolder with \\textcolor{blue}{color}!`
        }
    ];
    await runTestCase('Complex Subdirs | xelatex | preamble: true', complexProject, complexDocs, {
        preferredMain: 'main.tex', mode: 'normal', usePreamble: true
    });

    console.log(`\\n=== TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
    
    // Clean up
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
