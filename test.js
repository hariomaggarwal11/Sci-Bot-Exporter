/* Test harness for sci-bot-export core logic (run under Node with jsdom). */
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
global.JSZip = JSZip;

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

const X = require('./sci-bot-export.user.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra != null ? '\n    -> ' + extra : ''); }
}
function mml(str) {
  const d = new JSDOM('<!DOCTYPE html><body>' + str + '</body>', { contentType: 'text/html' });
  return d.window.document.querySelector('math');
}

console.log('\n== MathML -> LaTeX ==');
// stdKt/V = G / (C_pre-bar) : a fraction with an overline in the denominator
let m = mml(`<math><mfrac><mi>G</mi><msub><mover><mi>C</mi><mo>&#8254;</mo></mover><mi>pre</mi></msub></mfrac></math>`);
let tex = X.mml2tex(m);
ok('fraction+overline+subscript tex', /\\frac\{G\}\{\\overline\{C\}_\{pre\}\}/.test(tex), tex);

// e^{-Kt/V}
m = mml(`<math><msup><mi>e</mi><mrow><mo>&#8722;</mo><mi>K</mi><mi>t</mi><mo>/</mo><mi>V</mi></mrow></msup></math>`);
tex = X.mml2tex(m);
ok('superscript tex', tex === 'e^{-Kt/V}', tex);

// sum with limits: sum_{k=1}^{n}
m = mml(`<math><munderover><mo>&#8721;</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover></math>`);
tex = X.mml2tex(m);
ok('n-ary sum tex', /\\sum_\{k=1\}\^\{n\}/.test(tex), tex);

// sqrt
m = mml(`<math><msqrt><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow></msqrt></math>`);
tex = X.mml2tex(m);
ok('sqrt tex', tex === '\\sqrt{a+b}', tex);

console.log('\n== MathML -> OMML ==');
m = mml(`<math><mfrac><mi>G</mi><msub><mover><mi>C</mi><mo>&#8254;</mo></mover><mi>pre</mi></msub></mfrac></math>`);
let om = X.mml2omml(m);
ok('omml has fraction', /<m:f>/.test(om) && /<m:num>/.test(om) && /<m:den>/.test(om), om);
ok('omml has bar (overline)', /<m:bar>/.test(om), om);
ok('omml has subscript', /<m:sSub>/.test(om), om);

m = mml(`<math><munderover><mo>&#8721;</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover></math>`);
om = X.mml2omml(m);
ok('omml n-ary sum', /<m:nary>/.test(om) && /m:chr m:val="\u2211"/.test(om), om);

m = mml(`<math><msqrt><mi>x</mi></msqrt></math>`);
om = X.mml2omml(m);
ok('omml radical', /<m:rad>/.test(om) && /<m:degHide/.test(om), om);

console.log('\n== TeX -> OMML fallback ==');
om = X.tex2omml('\\frac{G}{\\overline{C}_{pre}}\\times\\frac{10080}{V}');
ok('tex2omml fraction', (om.match(/<m:f>/g) || []).length === 2, om);
ok('tex2omml bar', /<m:bar>/.test(om), om);
om = X.tex2omml('e^{-Kt/V}');
ok('tex2omml superscript', /<m:sSup>/.test(om), om);
om = X.tex2omml('\\sum_{k=1}^{n} a_k');
ok('tex2omml nary', /<m:nary>/.test(om), om);

console.log('\n== Unicode text fallback ==');
// mathematical-italic G (U+1D43A) followed by C + combining overline
let raw = '\uD835\uDC3A\u0043\u0305pre';
let ftex = X.textMath2tex(raw);
ok('nfkc repairs math-italic G', ftex.indexOf('G') === 0, ftex);
ok('combining overline -> \\overline', /\\overline\{C\}/.test(ftex), ftex);

console.log('\n== Markdown assembly ==');
const conv = { title: 'Test', url: 'https://sci-bot.ru/x', blocks: [
  { type: 'heading', level: 2, inlines: [{ k: 'text', s: 'Section' }] },
  { type: 'para', inlines: [{ k: 'text', s: 'Value ' }, { k: 'math', math: { tex: 'x^2', omml: X.tex2omml('x^2'), ok: true } }, { k: 'text', s: ' done.' }] },
  { type: 'mathblock', math: { tex: '\\frac{a}{b}', omml: X.tex2omml('\\frac{a}{b}'), ok: true } },
  { type: 'list', ordered: false, items: [[{ k: 'text', s: 'one' }], [{ k: 'text', s: 'two' }]] }
]};
const md = X.toMarkdown(conv);
ok('md has heading', /## Section/.test(md), md);
ok('md inline math', /\$x\^2\$/.test(md), md);
ok('md block math', /\$\$\n\\frac\{a\}\{b\}\n\$\$/.test(md), md);
ok('md list', /- one\n- two/.test(md), md);

console.log('\n== DOCX package ==');
(async () => {
  const blob = await X.buildDocxBlob(conv);
  const buf = Buffer.from(await blob.arrayBuffer());
  require('fs').writeFileSync('sample-output.docx', buf);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml').async('string');
  ok('docx has document.xml', !!docXml);
  ok('docx has styles.xml', !!zip.file('word/styles.xml'));
  ok('docx content-types', !!zip.file('[Content_Types].xml'));
  ok('docx has oMath', /<m:oMath>/.test(docXml), docXml.slice(0, 200));
  ok('docx has oMathPara block', /<m:oMathPara>/.test(docXml));
  // Well-formedness: parse document.xml with jsdom XML parser
  const xdoc = new JSDOM(docXml, { contentType: 'application/xml' }).window.document;
  const errs = xdoc.getElementsByTagName('parsererror');
  ok('document.xml is well-formed XML', errs.length === 0, errs.length ? xdoc.documentElement.textContent.slice(0, 300) : '');

  console.log('\n== Result:', pass, 'passed,', fail, 'failed ==');
  process.exit(fail ? 1 : 0);
})();
