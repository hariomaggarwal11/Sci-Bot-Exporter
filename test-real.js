/*
 * Verification against REAL sci-bot output.
 *
 * sci-bot.ru is a client-rendered SPA, so the raw MathML DOM can't be fetched
 * with plain HTTP. What CAN be captured is the rendered text - and that is
 * exactly the "worst case" input (what a user gets by copy-pasting). These are
 * verbatim equation strings scraped from:
 *   https://sci-bot.ru/standard-ktv-is-an-index-1a83
 *
 * This test drives the tool's TEXT-FALLBACK path on that real data and checks:
 *   - no mathematical-italic Unicode (U+1D400..U+1D7FF) survives (req 2)
 *   - overlines are reconstructed as \overline / <m:bar> (req 5)
 *   - a full .md and .docx are produced and the .docx is well-formed (req 7)
 */
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
global.JSZip = JSZip;
const dom = new JSDOM('<!DOCTYPE html><body></body>');
global.window = dom.window; global.document = dom.window.document; global.Node = dom.window.Node;
const X = require('./sci-bot-export.user.js');

// --- Verbatim equation strings from the live Kt/V answer page ---
const REAL_EQUATIONS = [
  'stdKt/V=\uD835\uDC3A\uD835\uDC36\u203Epre\u00D710,080\uD835\uDC49',        // stdKt/V = G / C̄pre × 10080/V
  '\uD835\uDC36\u203Epre=\uD835\uDC3A\uD835\uDC3E\u00D7\u2026',                 // C̄pre = G/K × ...
  'eKt/V=0.924\u00D7spKt/V\u22120.395\u00D7spKt/V\uD835\uDC61+0.056',          // eKt/V = 0.924×spKt/V − 0.395×spKt/V/t + 0.056
  '\uD835\uDC53Kru=11+(spKt/V0.974)1.617',                                      // fKru = 1 / (1 + (spKt/V/0.974)^1.617)
  '\uD835\uDC51(\uD835\uDC36\uD835\uDC49)\uD835\uDC51\uD835\uDC61=\uD835\uDC3A\u2212\uD835\uDC3E\u22C5\uD835\uDC36' // d(CV)/dt = G − K·C
];

let pass = 0, fail = 0;
const ok = (n, c, e) => c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, e != null ? '\n     ' + e : ''));
const hasMathItalic = (s) => /[\u{1D400}-\u{1D7FF}]/u.test(s);
const hasOverlineMark = (s) => /[\u0305\u0304\u203E\u00AF]/u.test(s);

console.log('\n== Real sci-bot equations -> LaTeX (text fallback) ==');
REAL_EQUATIONS.forEach((eq, i) => {
  const tex = X.textMath2tex(eq);
  console.log(`  [${i}] RAW : ${eq}`);
  console.log(`      TEX : ${tex}`);
  ok(`eq${i}: no math-italic unicode left`, !hasMathItalic(tex), tex);
  ok(`eq${i}: no stray overline marks left`, !hasOverlineMark(tex), tex);
});

console.log('\n== Real sci-bot equations -> OMML (text fallback) ==');
REAL_EQUATIONS.forEach((eq, i) => {
  const om = X.textMath2omml(eq);
  ok(`eq${i}: omml has no math-italic unicode`, !hasMathItalic(om), om);
  if (eq.includes('\u203E')) ok(`eq${i}: overline became <m:bar>`, /<m:bar>/.test(om), om);
});

console.log('\n== Primary path spot-check (MathML as MathJax emits it) ==');
function mml(s){return new JSDOM('<body>'+s+'</body>').window.document.querySelector('math');}
// The real definition stdKt/V = G / C̄_pre, as structured MathML
const defMML = mml('<math><mfrac><mi>G</mi><msub><mover><mi>C</mi><mo>&#8254;</mo></mover><mi>pre</mi></msub></mfrac></math>');
const defTex = X.mml2tex(defMML), defOm = X.mml2omml(defMML);
console.log('  TEX:', defTex);
ok('MathML path rebuilds fraction+overline+subscript', /\\frac\{G\}\{\\overline\{C\}_\{pre\}\}/.test(defTex), defTex);
ok('MathML path OMML fraction+bar', /<m:f>/.test(defOm) && /<m:bar>/.test(defOm), defOm);

console.log('\n== Build real .md and .docx from reconstructed Kt/V answer ==');
const conv = {
  title: 'standard Kt/V is an index of dialysis dose. What is its mathematical basis?',
  url: 'https://sci-bot.ru/standard-ktv-is-an-index-1a83',
  blocks: [
    { type: 'heading', level: 1, inlines: [{ k: 'text', s: 'The Mathematical Basis of Standard Kt/V' }] },
    { type: 'heading', level: 2, inlines: [{ k: 'text', s: 'Definition: Continuous Equivalent Clearance' }] },
    { type: 'para', inlines: [{ k: 'text', s: 'Formally, stdKt/V is defined as:' }] },
    { type: 'mathblock', math: fb(REAL_EQUATIONS[0]) },
    { type: 'para', inlines: [
        { k: 'text', s: 'where G is the urea generation rate and ' },
        { k: 'math', math: fb('\uD835\uDC36\u203Epre') },
        { k: 'text', s: ' is the mean predialysis BUN.' } ] },
    { type: 'heading', level: 2, inlines: [{ k: 'text', s: 'Residual Kidney Function' }] },
    { type: 'mathblock', math: fb(REAL_EQUATIONS[3]) },
    { type: 'heading', level: 2, inlines: [{ k: 'text', s: 'References' }] },
    { type: 'para', inlines: [{ k: 'link', href: 'https://sci-hub.ru/10.1038/ki.2009.525',
        kids: [{ k: 'text', s: '[4] Daugirdas et al., Kidney International 77(7), 637-644 (2010)' }] }] }
  ]
};
function fb(raw){ return { tex: X.textMath2tex(raw), omml: X.textMath2omml(raw), ok: false }; }

const fs = require('fs');
const md = X.toMarkdown(conv);
fs.writeFileSync('real-ktv.md', md);
ok('real .md written, no math-italic unicode', !hasMathItalic(md), 'garbled unicode present');
ok('real .md has overline latex', /\\overline\{C\}/.test(md), md);
console.log('\n----- real-ktv.md (first 20 lines) -----');
console.log(md.split('\n').slice(0, 20).join('\n'));

(async () => {
  const blob = await X.buildDocxBlob(conv);
  const buf = Buffer.from(await blob.arrayBuffer());
  fs.writeFileSync('real-ktv.docx', buf);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml').async('string');
  ok('real .docx has native equations (m:bar)', /<m:bar>/.test(docXml));
  ok('real .docx has no math-italic unicode', !hasMathItalic(docXml));
  ok('real .docx has hyperlink', /r:id="rIdH/.test(docXml));
  const xdoc = new JSDOM(docXml, { contentType: 'application/xml' }).window.document;
  ok('real .docx document.xml well-formed', xdoc.getElementsByTagName('parsererror').length === 0,
     xdoc.getElementsByTagName('parsererror').length ? xdoc.documentElement.textContent.slice(0,200) : '');
  console.log('\n== REAL-DATA VERIFICATION:', pass, 'passed,', fail, 'failed ==');
  console.log('   artifacts: real-ktv.md, real-ktv.docx');
  process.exit(fail ? 1 : 0);
})();
