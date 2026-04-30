const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const LOGO_FILENAME = 'junta.png'; // Using available logo
const FRONTEND_IMAGES_PATH = path.join(__dirname, '../../frontend/images');

/**
 * Normalizes markdown list indentation.
 * Converts arbitrary indentation jumps (e.g., 0 -> 4 spaces) into standard 2-space increments.
 */
function normalizeIndentation(text) {
    if (!text) return '';
    const lines = text.split('\n');
    const output = [];
    let indentStack = [-1];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const match = line.match(/^(\s*)([-*+])\s+(.*)/);
        if (match) {
            const currentIndent = match[1].length;
            const marker = match[2];
            const content = match[3];

            let lastIndent = indentStack[indentStack.length - 1];

            if (currentIndent > lastIndent) {
                indentStack.push(currentIndent);
            } else if (currentIndent < lastIndent) {
                while (indentStack.length > 1 && currentIndent < indentStack[indentStack.length - 1]) {
                    indentStack.pop();
                }
                lastIndent = indentStack[indentStack.length - 1];
                if (currentIndent > lastIndent) {
                    indentStack.push(currentIndent);
                }
            }

            const level = Math.max(1, indentStack.length - 1);
            const newIndent = "  ".repeat(level - 1);
            output.push(`${newIndent}${marker} ${content}`);
        } else {
            if (line.trim() !== '' && !line.match(/^\s/)) {
                indentStack = [-1];
            }
            output.push(line);
        }
    }
    return output.join('\n');
}

/* 
 * Helper function to escape special LaTeX characters in text
 */
function escapeLatex(text) {
    if (!text) return '';

    // Normalize list indentation first
    text = normalizeIndentation(text);

    // 1. Escape special characters
    let escaped = text
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/{/g, '\\{')
        .replace(/}/g, '\\}')
        .replace(/\$/g, '\\$')
        .replace(/&/g, '\\&')
        .replace(/#/g, '\\#')
        .replace(/_/g, '\\_')
        .replace(/%/g, '\\%')
        .replace(/\^/g, '\\textasciicircum{}')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(/</g, '\\textless{}')
        .replace(/>/g, '\\textgreater{}');

    // 2. Format Bold/Italic
    escaped = escaped
        .replace(/\*\*(.*?)\*\*/g, '\\textbf{$1}')
        .replace(/__(.*?)__/g, '\\textbf{$1}')
        .replace(/\*(.*?)\*/g, '\\textit{$1}')
        .replace(/_(.*?)_/g, '\\textit{$1}');

    // 3. Line-by-line List Parser
    const lines = escaped.split('\n');
    let output = [];
    let listLevel = 0;

    for (const line of lines) {
        // Detect list item: optional whitespace, dash/asterisk/plus, whitespace, content
        const match = line.match(/^(\s*)[-*+]\s+(.*)/);

        if (match) {
            const indent = match[1].length;
            const content = match[2];

            // Determine level (assume 2 spaces = 1 additional level)
            let nextLevel = Math.floor(indent / 2) + 1;

            // Sanity check
            if (nextLevel > listLevel + 1) nextLevel = listLevel + 1;

            if (nextLevel > listLevel) {
                while (listLevel < nextLevel) {
                    output.push('\\begin{itemize}');
                    listLevel++;
                }
            } else if (nextLevel < listLevel) {
                while (listLevel > nextLevel) {
                    output.push('\\end{itemize}');
                    listLevel--;
                }
            }

            output.push(`\\item ${content}`);
        } else {
            const trimmed = line.trim();
            if (!trimmed) {
                // Ignore empty lines to prevent breaking lists into multiple itemize blocks
                continue;
            }

            // Not a list item and not empty: close all open lists
            while (listLevel > 0) {
                output.push('\\end{itemize}');
                listLevel--;
            }

            // Regular text line. Use \par for safe paragraph break.
            output.push(`${trimmed} \\par`);
        }
    }

    // Close any remaining open lists at the end
    while (listLevel > 0) {
        output.push('\\end{itemize}');
        listLevel--;
    }

    return output.join('\n');
}

/*
 * Parses markdown to extract content for SIMPLIFICATION report (5 sections).
 */
function parseSimplificationSections(markdown) {
    const sections = {
        motivo: 'No información disponible.',
        antecedentes: 'No información disponible.',
        pruebas: 'No información disponible.',
        diagnostico: 'No información disponible.',
        tratamiento: 'No información disponible.'
    };

    const patterns = {
        motivo: /Motivo del ingreso/i,
        antecedentes: /Problemas de salud anteriores/i,
        pruebas: /Pruebas y procedimientos/i,
        diagnostico: /Diagnóstico del ingreso/i,
        tratamiento: /Tratamiento y recomendaciones/i
    };

    const lines = markdown.split('\n');
    let currentSection = null;
    let buffer = [];

    for (const line of lines) {
        let foundHeader = false;
        if (line.trim().match(/^(#+)/)) {
            for (const [key, pattern] of Object.entries(patterns)) {
                if (line.match(pattern)) {
                    if (currentSection) {
                        sections[currentSection] = buffer.join('\n').trim();
                    }
                    currentSection = key;
                    buffer = [];
                    foundHeader = true;
                    break;
                }
            }
            if (!foundHeader && currentSection) {
                buffer.push(line);
            }
        } else {
            if (currentSection) {
                buffer.push(line);
            }
        }
    }
    if (currentSection) {
        sections[currentSection] = buffer.join('\n').trim();
    }

    for (const key in sections) {
        sections[key] = escapeLatex(sections[key]);
    }

    return sections;
}

/*
 * Parses markdown to extract content for GENERATION report (10 sections).
 * Based on TARGET_SECTIONS_CONFIG from seccionado.py
 */
function parseGenerationSections(markdown) {
    const sections = {
        motivo_ingreso: 'No información disponible.',
        antecedentes: 'No información disponible.',
        historia_actual: 'No información disponible.',
        evolucion: 'No información disponible.',
        pruebas_complementarias: 'No información disponible.',
        procedimientos: 'No información disponible.',
        juicio_clinico: 'No información disponible.',
        plan_terapeutico: 'No información disponible.',
        tratamiento_alta: 'No información disponible.',
        revisiones: 'No información disponible.'
    };

    const patterns = {
        motivo_ingreso: /Motivo de [Ii]ngreso/i,
        antecedentes: /Antecedentes/i,
        historia_actual: /Historia Actual/i,
        evolucion: /Evoluci[óo]n/i,
        pruebas_complementarias: /Pruebas Complementarias/i,
        procedimientos: /Procedimientos.*Intervenci[óo]n/i,
        juicio_clinico: /Juicio Cl[íi]nico.*Diagn[óo]sticos/i,
        plan_terapeutico: /Plan Terap[ée]utico/i,
        tratamiento_alta: /Tratamiento al Alta/i,
        revisiones: /Revisiones/i
    };

    const lines = markdown.split('\n');
    let currentSection = null;
    let buffer = [];

    for (const line of lines) {
        let foundHeader = false;
        if (line.trim().match(/^(#+)/)) {
            for (const [key, pattern] of Object.entries(patterns)) {
                if (line.match(pattern)) {
                    if (currentSection) {
                        sections[currentSection] = buffer.join('\n').trim();
                    }
                    currentSection = key;
                    buffer = [];
                    foundHeader = true;
                    break;
                }
            }
            if (!foundHeader && currentSection) {
                buffer.push(line);
            }
        } else {
            if (currentSection) {
                buffer.push(line);
            }
        }
    }
    if (currentSection) {
        sections[currentSection] = buffer.join('\n').trim();
    }

    for (const key in sections) {
        sections[key] = escapeLatex(sections[key]);
    }

    return sections;
}

const TEMPLATE_SIMPLIFICATION = (sections, logoPath) => `
\\documentclass[a4paper,11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[spanish, es-tabla]{babel}
\\usepackage{geometry}
\\usepackage{graphicx}
\\usepackage{xcolor}
\\usepackage{fancyhdr}
\\usepackage{lastpage}
\\usepackage{helvet}

\\renewcommand{\\familydefault}{\\sfdefault}
\\geometry{
    top=0.2cm, bottom=2.5cm, left=2.5cm, right=2.5cm, headheight=1.5cm, includehead
}

\\definecolor{tealblue}{RGB}{37, 150, 190} 

\\newcommand{\\tituloPrincipal}[1]{%
    \\vspace{1.5em}\\noindent\\textbf{\\large #1}\\\\[-0.7em]\\rule{\\textwidth}{0.5pt}\\par\\vspace{1em}
}

\\newcommand{\\tituloSeccion}[1]{%
    \\vspace{1em}\\noindent\\textbf{\\color{tealblue} #1}\\par\\vspace{0.3em}
}

\\newcommand{\\subTituloSeccion}[1]{%
    \\vspace{0.5em}
    \\noindent\\hspace{1em}\\textbf{\\color{tealblue} #1}\\par
}

\\pagestyle{fancy}
\\fancyhf{}
\\lhead{\\small Informe de Alta}
\\rhead{\\small Page \\thepage\\ of \\pageref{LastPage}}
\\renewcommand{\\headrulewidth}{0pt} 

\\begin{document}

\\noindent
\\begin{minipage}[t]{0.45\\textwidth}
    \\includegraphics[height=2.5cm, keepaspectratio]{${logoPath}} 
\\end{minipage}%
\\hfill
\\begin{minipage}[t]{0.5\\textwidth}
    \\begin{flushright}
        \\footnotesize
        Avenida del Ejército Español 10, Jaén (23007) Jaén España\\\\[0.2em]
        \\textbf{\\large A.Complejo Hospitalario de Jaén}\\\\[0.2em]
        \\textbf{Servicio: Cardiología General}
    \\end{flushright}
\\end{minipage}

\\vspace{1.5cm}

\\begin{center}
    FECHA DE FIRMA: \\today \\\\ [0.5em]
    \\textbf{\\Large INFORME CLÍNICO DE ALTA SIMPLIFICADO GENERADO POR IA}
\\end{center}

\\tituloPrincipal{Identificación del paciente}

{\\small
\\noindent
\\begin{tabular}{@{}p{0.33\\textwidth} p{0.33\\textwidth} p{0.33\\textwidth}@{}}
    \\textbf{Paciente:} C*** H***, P*** & \\textbf{NHC:} 627XXX & \\textbf{Episodio:} 402XXXX \\\\
    \\textbf{DNI:} 258XXXXX-B & \\textbf{NASS:} 2300XXXXXXXX & \\textbf{NUHSA:} AN02XXXXXXXX \\\\
    \\textbf{F. Nacim.:} 29/01/1935 & \\textbf{Edad:} 167 años & \\textbf{Sexo:} X \\\\
    \\textbf{Domicilio:} C/ San pepito, Nº XX & \\textbf{Municipio:} Estocolmo & \\textbf{CP:} 123456 \\\\
\\end{tabular}

\\vspace{0.5em}
\\noindent\\rule{\\textwidth}{0.1pt}
\\vspace{0.5em}

\\noindent
\\begin{tabular}{@{}p{0.33\\textwidth} p{0.33\\textwidth} p{0.33\\textwidth}@{}}
    \\textbf{F. Ingreso:} 23/03/2021 & \\textbf{F. Alta:} 07/04/2021 & \\textbf{Tipo:} Hospitalización \\\\
    \\textbf{Procedencia:} Cardiol. Gral & \\textbf{C. Salud:} Estcolmo &  \\\\
    \\multicolumn{3}{@{}l}{\\textbf{Cuidador:} Hijo (Luis) - Tlf: 678XXXXXX}
\\end{tabular}
}
\\vspace{1cm} 

\\tituloSeccion{Motivo del ingreso}
${sections.motivo}

\\tituloSeccion{Problemas de salud anteriores}
${sections.antecedentes}

\\tituloSeccion{Pruebas y procedimientos}
${sections.pruebas}

\\tituloSeccion{Diagnóstico del ingreso}
${sections.diagnostico}

\\tituloSeccion{Tratamiento y recomendaciones}
${sections.tratamiento}

\\end{document}
`;

const TEMPLATE_GENERATION = (sections, logoPath) => `
\\documentclass[a4paper,11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[spanish, es-tabla]{babel}
\\usepackage{geometry}
\\usepackage{graphicx}
\\usepackage{xcolor}
\\usepackage{fancyhdr}
\\usepackage{lastpage}
\\usepackage{helvet}

\\renewcommand{\\familydefault}{\\sfdefault}
\\geometry{
    top=0.2cm, bottom=2.5cm, left=2.5cm, right=2.5cm, headheight=1.5cm, includehead
}

\\definecolor{tealblue}{RGB}{37, 150, 190} 

\\newcommand{\\tituloPrincipal}[1]{%
    \\vspace{1.5em}\\noindent\\textbf{\\large #1}\\\\[-0.7em]\\rule{\\textwidth}{0.5pt}\\par\\vspace{1em}
}

\\newcommand{\\tituloSeccion}[1]{%
    \\vspace{1em}\\noindent\\textbf{\\color{tealblue} #1}\\par\\vspace{0.3em}
}

\\newcommand{\\subTituloSeccion}[1]{%
    \\vspace{0.5em}
    \\noindent\\hspace{1em}\\textbf{\\color{tealblue} #1}\\par
}

% Nuevo comando para contenido con sangría
\\newenvironment{contenidoSangria}{%
    \\begin{list}{}{%
        \\setlength{\\leftmargin}{1.5em}%
        \\setlength{\\rightmargin}{0em}%
        \\setlength{\\itemindent}{0em}%
        \\setlength{\\parsep}{0pt}%
        \\setlength{\\topsep}{0pt}%
    }%
    \\item\\relax
}{%
    \\end{list}%
}

\\pagestyle{fancy}
\\fancyhf{}
\\lhead{\\small Informe de Alta}
\\rhead{\\small Page \\thepage\\ of \\pageref{LastPage}}
\\renewcommand{\\headrulewidth}{0pt} 

\\begin{document}

\\noindent
\\begin{minipage}[t]{0.45\\textwidth}
    \\includegraphics[height=2.5cm, keepaspectratio]{${logoPath}} 
\\end{minipage}%
\\hfill
\\begin{minipage}[t]{0.5\\textwidth}
    \\begin{flushright}
        \\footnotesize
        Avenida del Ejército Español 10, Jaén (23007) Jaén España\\\\[0.2em]
        \\textbf{\\large A.Complejo Hospitalario de Jaén}\\\\[0.2em]
        \\textbf{Servicio: Cardiología General}
    \\end{flushright}
\\end{minipage}

\\vspace{1.5cm}

\\begin{center}
    FECHA DE FIRMA: \\today \\\\ [0.5em]
    \\textbf{\\Large INFORME CLÍNICO DE ALTA GENERADO POR IA}
\\end{center}

\\tituloPrincipal{Identificación del paciente}

{\\small
\\noindent
\\begin{tabular}{@{}p{0.33\\textwidth} p{0.33\\textwidth} p{0.33\\textwidth}@{}}
    \\textbf{Paciente:} C*** H***, P*** & \\textbf{NHC:} 627XXX & \\textbf{Episodio:} 402XXXX \\\\
    \\textbf{DNI:} 258XXXXX-B & \\textbf{NASS:} 2300XXXXXXXX & \\textbf{NUHSA:} AN02XXXXXXXX \\\\
    \\textbf{F. Nacim.:} 29/01/1935 & \\textbf{Edad:} 167 años & \\textbf{Sexo:} X \\\\
    \\textbf{Domicilio:} C/ San pepito, Nº XX & \\textbf{Municipio:} Estocolmo & \\textbf{CP:} 123456 \\\\
\\end{tabular}

\\vspace{0.5em}
\\noindent\\rule{\\textwidth}{0.1pt}
\\vspace{0.5em}

\\noindent
\\begin{tabular}{@{}p{0.33\\textwidth} p{0.33\\textwidth} p{0.33\\textwidth}@{}}
    \\textbf{F. Ingreso:} 23/03/2021 & \\textbf{F. Alta:} 07/04/2021 & \\textbf{Tipo:} Hospitalización \\\\
    \\textbf{Procedencia:} Cardiol. Gral & \\textbf{C. Salud:} Estcolmo &  \\\\
    \\multicolumn{3}{@{}l}{\\textbf{Cuidador:} Hijo (Luis) - Tlf: 678XXXXXX}
\\end{tabular}
}
\\vspace{1cm} 

\\tituloSeccion{Motivo de ingreso}
\\begin{contenidoSangria}
${sections.motivo_ingreso}
\\end{contenidoSangria}

\\tituloSeccion{Antecedentes}
\\begin{contenidoSangria}
${sections.antecedentes}
\\end{contenidoSangria}

\\tituloSeccion{Historia Actual}
\\begin{contenidoSangria}
${sections.historia_actual}
\\end{contenidoSangria}

\\tituloSeccion{Evolución}
\\begin{contenidoSangria}
${sections.evolucion}
\\end{contenidoSangria}

\\tituloSeccion{Pruebas Complementarias}
\\begin{contenidoSangria}
${sections.pruebas_complementarias}
\\end{contenidoSangria}

\\tituloSeccion{Procedimientos / Intervención Quirúrgica}
\\begin{contenidoSangria}
${sections.procedimientos}
\\end{contenidoSangria}

\\tituloSeccion{Juicio Clínico / Diagnósticos}
\\begin{contenidoSangria}
${sections.juicio_clinico}
\\end{contenidoSangria}

\\tituloSeccion{Plan Terapéutico}
\\begin{contenidoSangria}
${sections.plan_terapeutico}
\\end{contenidoSangria}

\\tituloSeccion{Tratamiento al Alta}
\\begin{contenidoSangria}
${sections.tratamiento_alta}
\\end{contenidoSangria}

\\tituloSeccion{Revisiones}
\\begin{contenidoSangria}
${sections.revisiones}
\\end{contenidoSangria}

\\end{document}
`;

function detectReportType(markdown) {
    // Buscar secciones características de informe de alta (generación)
    const generationMarkers = [
        /Historia Actual/i,
        /Evoluci[óo]n/i,
        /Pruebas Complementarias/i,
        /Procedimientos.*Intervenci[óo]n/i,
        /Juicio Cl[íi]nico/i,
        /Plan Terap[ée]utico/i
    ];

    let matches = 0;
    for (const marker of generationMarkers) {
        if (markdown.match(marker)) matches++;
    }

    // Si encuentra 3+ secciones de generación, es informe de alta
    return matches >= 3 ? 'generation' : 'simplification';
}

function generateLatexPdf(markdown, outputFilename) {
    return new Promise((resolve, reject) => {
        const tempDir = path.join(__dirname, '../../data', 'temp_latex_' + uuidv4());
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        // Detectar tipo de informe
        const reportType = detectReportType(markdown);
        console.log(`[LATEX] Tipo de informe detectado: ${reportType}`);

        // Parsear secciones según el tipo
        let sections;
        let template;

        if (reportType === 'generation') {
            sections = parseGenerationSections(markdown);
            template = TEMPLATE_GENERATION;
            console.log('[LATEX] Usando plantilla de INFORME DE ALTA (10 secciones)');
        } else {
            sections = parseSimplificationSections(markdown);
            template = TEMPLATE_SIMPLIFICATION;
            console.log('[LATEX] Usando plantilla de INFORME SIMPLIFICADO (5 secciones)');
        }

        // Prepare logo
        const logoSource = path.join(FRONTEND_IMAGES_PATH, LOGO_FILENAME);
        const logoDest = path.join(tempDir, LOGO_FILENAME);
        if (fs.existsSync(logoSource)) {
            fs.copyFileSync(logoSource, logoDest);
        } else {
            console.warn('[LATEX] Warning: Logo not found in frontend/images');
        }

        const texContent = template(sections, LOGO_FILENAME);
        const texPath = path.join(tempDir, 'report.tex');

        fs.writeFileSync(texPath, texContent, 'utf8');

        // Helper to run pdflatex once
        const runPdfLatex = (iteration) => {
            return new Promise((res, rej) => {
                console.log(`[LATEX] Compiling PDF (Pass ${iteration}) in ${tempDir}...`);
                const pdflatex = spawn('pdflatex', ['-interaction=nonstopmode', 'report.tex'], {
                    cwd: tempDir
                });

                let output = '';
                pdflatex.stdout.on('data', d => output += d.toString());
                pdflatex.stderr.on('data', d => console.error(`[LATEX ERR] ${d}`));

                pdflatex.on('close', (code) => {
                    // Check if PDF exists regardless of exit code
                    const pdfSourceCheck = path.join(tempDir, 'report.pdf');

                    if (fs.existsSync(pdfSourceCheck)) {
                        if (code !== 0) {
                            console.warn(`[LATEX] Warning: pdflatex (Pass ${iteration}) exited with code ${code}, but PDF was generated.`);
                        }
                        res();
                    } else if (code === 0) {
                        // This shouldn't theoretically happen if code is 0 but file missing check is good
                        res();
                    } else {
                        console.error(`[LATEX] Compilation failed (Pass ${iteration}). Log:\n${output}`);
                        rej(new Error(`pdflatex exited with code ${code}`));
                    }
                });
            });
        };

        // Run twice to resolve references (LastPage)
        runPdfLatex(1)
            .then(() => runPdfLatex(2))
            .then(() => {
                const pdfSource = path.join(tempDir, 'report.pdf');
                if (fs.existsSync(pdfSource)) {
                    resolve(pdfSource);
                } else {
                    reject(new Error('PDF file not generated despite explicit success.'));
                }
            })
            .catch(err => {
                reject(err);
            });
    });
}

module.exports = { generateLatexPdf };
