/* Regression: MathML->LaTeX must emit valid commands (trailing space),
   reproducing the convolution/eigenvalue equations from the exported doc. */
const { JSDOM } = require('jsdom');
global.window = new JSDOM('').window; global.document = window.document; global.Node = window.Node;
global.JSZip = require('jszip');
const X = require('./sci-bot-export.user.js');
const mml = (s) => new JSDOM('<body>' + s + '</body>').window.document.querySelector('math');

let pass = 0, fail = 0;
const ok = (n, c, e) => c ? (pass++, console.log('  PASS', n)) : (fail++, console.log('  FAIL', n, '\n     ' + e));
// undefined-control-sequence detector: backslash-word immediately followed by a letter/digit
const glued = (tex) => /\\[a-zA-Z]+[a-zA-Z0-9]/.test(tex.replace(/\\(left|right|frac|sqrt|begin|end|overline|hat|vec|bar|tilde|dot|ast|cdot|times|sum|prod|int|approx|pm|to|infty|nabla|partial|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|chi|psi|omega|Omega|Delta|Gamma|Sigma|Phi|Psi|ldots|cdots|leq|geq|neq|in|cup|cap)\b/g, ''));

console.log('\n== MathML -> LaTeX operator spacing ==');
// convolution: y(t)=x(t) * h(t)
let m = mml('<math><mi>x</mi><mo>(</mo><mi>t</mi><mo>)</mo><mo>&#8727;</mo><mi>h</mi><mo>(</mo><mi>t</mi><mo>)</mo></math>');
let tex = X.mml2tex(m);
console.log('   ', tex);
ok('conv \\ast has trailing space', /\\ast h/.test(tex), tex);
ok('conv not glued', !/\\asth/.test(tex), tex);

m = mml('<math><mi>H</mi><mo>(</mo><mi>s</mi><mo>)</mo><mo>&#8901;</mo><msup><mi>e</mi><mrow><mi>s</mi><mi>t</mi></mrow></msup></math>');
tex = X.mml2tex(m);
ok('cdot spaced', /\\cdot e/.test(tex), tex);

m = mml('<math><mn>2</mn><mi>&#960;</mi><mo>&#215;</mo><mn>500</mn></math>');
tex = X.mml2tex(m);
ok('times before digit spaced', /\\times 500/.test(tex), tex);

m = mml('<math><mo>&#8721;</mo><msub><mi>b</mi><mi>k</mi></msub></math>');
tex = X.mml2tex(m);
ok('sum not glued to b', !/\\sumb/.test(tex), tex);

// set braces T{delta(t)}
m = mml('<math><mi>T</mi><mo>{</mo><mi>&#948;</mi><mo>(</mo><mi>t</mi><mo>)</mo><mo>}</mo></math>');
tex = X.mml2tex(m);
ok('braces escaped visible', /T\\\{/.test(tex), tex);

console.log('\n== Result:', pass, 'passed,', fail, 'failed ==');
process.exit(fail ? 1 : 0);
