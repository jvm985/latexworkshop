import { exec, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const testDir = '/tmp/lw_system_tests';
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

async function runTest(name, command, files, expectedSuccess = true) {
    console.log(`\n--- TEST: ${name} ---`);
    const workDir = path.join(testDir, name.replace(/\s+/g, '_'));
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    // Write files
    for (const [filename, content] of Object.entries(files)) {
        const fullPath = path.join(workDir, filename);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
    }

    console.log(`Running: ${command}`);
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.error('FAIL: Timeout');
            resolve(false);
        }, 60000);

        exec(command, { cwd: workDir }, (error, stdout, stderr) => {
            clearTimeout(timeout);
            const success = !error;
            if (success === expectedSuccess) {
                console.log(`PASS: ${name} (${success ? 'Success' : 'Failure'} as expected)`);
                resolve(true);
            } else {
                console.error(`FAIL: ${name} (Expected success: ${expectedSuccess}, got: ${success})`);
                console.error('STDOUT:', stdout);
                console.error('STDERR:', stderr);
                resolve(false);
            }
        });
    });
}

async function runRTest(name, code, expectedSuccess = true) {
    console.log(`\n--- R TEST: ${name} ---`);
    const userScriptPath = path.join(testDir, `test_${Date.now()}.R`);
    fs.writeFileSync(userScriptPath, code);

    const sentinel = "SENTINEL_DONE";
    const wrappedCode = `
      options(warn=-1)
      tryCatch({
        source("${userScriptPath}", echo=TRUE, print.eval=TRUE)
      }, error = function(e) { cat("ERROR:", e$message, "\\n") })
      cat("${sentinel}\\n")
    `;

    return new Promise((resolve) => {
        const rProcess = spawn('R', ['--vanilla', '--quiet', '--interactive']);
        let output = '';
        const timeout = setTimeout(() => {
            rProcess.kill();
            console.error('FAIL: R Timeout');
            resolve(false);
        }, 10000);

        rProcess.stdout.on('data', (data) => {
            output += data.toString();
            if (output.includes(sentinel)) {
                rProcess.stdin.write('q()\n');
                rProcess.stdin.write('n\n');
            }
        });

        rProcess.on('close', () => {
            clearTimeout(timeout);
            const hasError = output.includes("ERROR:") || output.includes("Error in");
            const success = !hasError;
            if (success === expectedSuccess) {
                console.log(`PASS: ${name}`);
                resolve(true);
            } else {
                console.error(`FAIL: ${name} (Expected success: ${expectedSuccess}, got: ${success})`);
                console.log('OUTPUT:', output);
                resolve(false);
            }
        });

        rProcess.stdin.write(wrappedCode + '\n');
    });
}

async function main() {
    let allPassed = true;

    // LaTeX Tests
    const texPass = await runTest('LaTeX OK', 'latexmk -pdf -interaction=nonstopmode -f main.tex', {
        'main.tex': '\\documentclass{article}\\begin{document}Hello\\end{document}'
    });
    const texFail = await runTest('LaTeX Fail', 'latexmk -pdf -interaction=nonstopmode -f main.tex', {
        'main.tex': '\\documentclass{article}\\begin{document}Hello\\undefinedcommand\\end{document}'
    }, false);

    // RMarkdown Tests
    const rmdPass = await runTest('RMarkdown OK', 'Rscript -e "rmarkdown::render(\'main.Rmd\', output_file=\'output.pdf\', output_dir=\'.\')"', {
        'main.Rmd': '---\noutput: pdf_document\n---\n# Hello\n```{r}\nprint(1+1)\n```'
    });

    // Typst Tests
    const typstPass = await runTest('Typst OK', 'typst compile main.typ output.pdf', {
        'main.typ': '= Hello\nThis is Typst'
    });

    // R Interactive Tests
    const rPass = await runRTest('R Snippet OK', 'x <- 10\nprint(x)');
    const rFail = await runRTest('R Snippet Fail', 'stop("Mislukt")' , false);

    console.log('\n==============================');
    if (texPass && texFail && rmdPass && typstPass && rPass && rFail) {
        console.log('ALL SYSTEM TESTS PASSED');
    } else {
        console.error('SOME TESTS FAILED');
        process.exit(1);
    }
}

main();
