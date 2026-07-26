/* End-to-end: simulate a sci-bot answer page and run the full pipeline. */
const { JSDOM } = require('jsdom');
const JSZip = require('jszip');
global.JSZip = JSZip;

// A MathJax-style container embeds assistive MathML (what the tool reads).
function mjx(mathml, display) {
  return `<mjx-container class="MathJax${display ? ' MathJax_Display' : ''}" jax="CHTML"${display ? ' display="block"' : ''}><mjx-math></mjx-math>` +
    `<mjx-assistive-mml unselectable="on">${mathml}</mjx-assistive-mml></mjx-container>`;
}
const page = `<!DOCTYPE html><html><head><title>standard Kt/V is an index | sci-bot</title></head>
<body>
<nav><a href="/login">Log in</a><a href="/register">Register</a></nav>
<article>
  <h1>The Mathematical Basis of Standard Kt/V</h1>
  <h2>Definition</h2>
  <p>The dose is defined as follows, where G is the generation rate.</p>
  ${mjx('<math display="block"><mfrac><mi>G</mi><msub><mover><mi>C</mi><mo>&#8254;</mo></mover><mi>pre</mi></msub></mfrac></math>', true)}
  <p>Decay follows ${mjx('<math><msup><mi>e</mi><mrow><mo>&#8722;</mo><mi>K</mi><mi>t</mi><mo>/</mo><mi>V</mi></mrow></msup></math>')} over time.</p>
  <ul><li>G = generation rate</li><li>V = volume</li></ul>
  <h2>References</h2>
  <p><a href="https://sci-hub.ru/10.1038/ki.2009.525">[4] Daugirdas et al. (2010)</a></p>
</article>
<footer>Powered by Sci-Hub</footer>
</body></html>`;

const dom = new JSDOM(page, { contentType: 'text/html' });
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.location = dom.window.location;

const X = require('./sci-bot-export.user.js');
let pass = 0, fail = 0;
const ok = (n, c, e) => c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, e || ''));

const conv = X.collectConversation();
console.log('Captured blocks:', conv.blocks.map(b => b.type).join(', '));
ok('title parsed', /Kt\/V/.test(conv.title), conv.title);
ok('has headings', conv.blocks.some(b => b.type === 'heading'));
ok('has display mathblock', conv.blocks.some(b => b.type === 'mathblock'), '');
ok('has list', conv.blocks.some(b => b.type === 'list'));

const md = X.toMarkdown(conv);
ok('md: display fraction latex', /\\frac\{G\}\{\\overline\{C\}_\{pre\}\}/.test(md), md);
ok('md: inline exponent', /\$e\^\{-Kt\/V\}\$/.test(md), md);
ok('md: reference link', /\]\(https:\/\/sci-hub\.ru\/10\.1038/.test(md), md);
ok('md: no raw math-italic unicode', !/[\u{1D400}-\u{1D7FF}]/u.test(md), 'found garbled unicode');

(async () => {
  const blob = await X.buildDocxBlob(conv);
  const buf = Buffer.from(await blob.arrayBuffer());
  require('fs').writeFileSync('sample-ktv.docx', buf);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml').async('string');
  ok('docx: native fraction', /<m:f>/.test(docXml));
  ok('docx: overline bar', /<m:bar>/.test(docXml));
  ok('docx: hyperlink rel', /<m:oMath>/.test(docXml) && /r:id="rIdH/.test(docXml));
  const relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
  ok('docx: hyperlink target in rels', /sci-hub\.ru\/10\.1038/.test(relsXml));
  const xdoc = new JSDOM(docXml, { contentType: 'application/xml' }).window.document;
  ok('docx: well-formed', xdoc.getElementsByTagName('parsererror').length === 0);
  console.log('\n== E2E:', pass, 'passed,', fail, 'failed ==\n');
  process.exit(fail ? 1 : 0);
})();
