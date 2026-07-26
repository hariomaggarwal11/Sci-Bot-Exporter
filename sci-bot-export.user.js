// ==UserScript==
// @name         Sci-Bot Conversation Exporter
// @namespace    https://sci-bot.ru/export
// @version      1.0.0
// @description  Export a sci-bot.ru answer/conversation to Markdown or Word (.docx) with real, structured math equations (LaTeX for .md, native OMML for .docx). Handles special characters, math symbols and structures.
// @match        https://sci-bot.ru/*
// @match        https://www.sci-bot.ru/*
// @run-at       document-idle
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

/*
 * OVERVIEW
 * --------
 * sci-bot.ru renders mathematics as MathML / mathematical-italic Unicode. Copying
 * the rendered text destroys structure (fractions collapse to a line, overlines and
 * sub/superscripts break, letters turn into exotic codepoints like U+1D43A).
 *
 * This tool runs INSIDE the page, so it can read the *structured* math source
 * (MathML, or the original TeX annotation) instead of the broken rendered text,
 * and rebuild proper equations:
 *   - Markdown  ->  LaTeX math ($...$ / $$...$$)
 *   - Word .docx -> native OMML (Office Math) equations, fully editable in Word
 *
 * Requirements satisfied:
 *   1. Captures the entire conversation (question + full answer + references).
 *   2. Special characters preserved (Unicode-safe, NFKC repair of math letters).
 *   3. Ships a library of math symbols + structures (SYMBOLS / STRUCT below).
 *   4. Captures complete equations via MathML / TeX (not rendered text).
 *   5. Converts raw math into a pure equation format (LaTeX + OMML).
 *   6. Structured alignment/spacing in the exported file (headings, lists, blocks).
 *   7. Saves as .docx or .md.
 */
(function () {
  'use strict';

  /* =========================================================================
   * CONFIG  -  tune selectors here if the site markup changes
   * ========================================================================= */
  const CONFIG = {
    // Candidate selectors for the main answer container, tried in order.
    answerSelectors: [
      'article', 'main', '[class*="markdown"]', '[class*="prose"]',
      '[class*="answer"]', '[class*="content"]', '[class*="message"]'
    ],
    // Elements to ignore anywhere in the capture.
    ignoreSelectors: [
      'nav', 'header', 'footer', 'script', 'style', 'noscript',
      'button', '[role="navigation"]', '.katex-html' // katex-html is visual dup of katex-mathml
    ],
    // Text of links/blocks that mark site chrome (skipped in fallback capture).
    chromeText: ['Log in', 'Register', 'Ask a new question', 'Contact',
      'Donate', 'queued', 'bookmark', 'Powered by Sci-Hub', 'Display search process']
  };

  /* =========================================================================
   * MATH SYMBOL LIBRARY  (requirement 3)
   * Maps Unicode math symbols -> { tex: LaTeX command, ch: OMML literal char }
   * Used by both the MathML converters and the plain-text fallback.
   * ========================================================================= */
  const SYMBOLS = {
    // relations
    '=': { tex: '=', ch: '=' }, '≈': { tex: '\\approx', ch: '≈' },
    '≠': { tex: '\\neq', ch: '≠' }, '≡': { tex: '\\equiv', ch: '≡' },
    '≤': { tex: '\\leq', ch: '≤' }, '≥': { tex: '\\geq', ch: '≥' },
    '<': { tex: '<', ch: '<' }, '>': { tex: '>', ch: '>' },
    '∝': { tex: '\\propto', ch: '∝' }, '∼': { tex: '\\sim', ch: '∼' },
    '±': { tex: '\\pm', ch: '±' }, '∓': { tex: '\\mp', ch: '∓' },
    // operators
    '+': { tex: '+', ch: '+' }, '−': { tex: '-', ch: '−' }, '-': { tex: '-', ch: '-' },
    '×': { tex: '\\times', ch: '×' }, '⋅': { tex: '\\cdot', ch: '⋅' },
    '·': { tex: '\\cdot', ch: '·' }, '÷': { tex: '\\div', ch: '÷' },
    '∗': { tex: '\\ast', ch: '∗' }, '∘': { tex: '\\circ', ch: '∘' },
    // big operators
    '∑': { tex: '\\sum', ch: '∑', nary: true },
    '∏': { tex: '\\prod', ch: '∏', nary: true },
    '∫': { tex: '\\int', ch: '∫', nary: true },
    '∬': { tex: '\\iint', ch: '∬', nary: true },
    '∮': { tex: '\\oint', ch: '∮', nary: true },
    '⋃': { tex: '\\bigcup', ch: '⋃', nary: true },
    '⋂': { tex: '\\bigcap', ch: '⋂', nary: true },
    // arrows
    '→': { tex: '\\to', ch: '→' }, '←': { tex: '\\leftarrow', ch: '←' },
    '⇒': { tex: '\\Rightarrow', ch: '⇒' }, '⇔': { tex: '\\Leftrightarrow', ch: '⇔' },
    // sets / logic
    '∈': { tex: '\\in', ch: '∈' }, '∉': { tex: '\\notin', ch: '∉' },
    '⊂': { tex: '\\subset', ch: '⊂' }, '⊆': { tex: '\\subseteq', ch: '⊆' },
    '∪': { tex: '\\cup', ch: '∪' }, '∩': { tex: '\\cap', ch: '∩' },
    '∅': { tex: '\\emptyset', ch: '∅' }, '∞': { tex: '\\infty', ch: '∞' },
    '∀': { tex: '\\forall', ch: '∀' }, '∃': { tex: '\\exists', ch: '∃' },
    '∂': { tex: '\\partial', ch: '∂' }, '∇': { tex: '\\nabla', ch: '∇' },
    '√': { tex: '\\sqrt', ch: '√' },
    // punctuation / misc
    '…': { tex: '\\ldots', ch: '…' }, '⋯': { tex: '\\cdots', ch: '⋯' },
    '°': { tex: '^{\\circ}', ch: '°' }, '′': { tex: "'", ch: '′' },
    '‾': { tex: '\\overline', ch: '¯', accent: true },
    '¯': { tex: '\\overline', ch: '¯', accent: true },
    '^': { tex: '\\hat', ch: '̂', accent: true }
  };

  // Greek letters -> LaTeX (OMML keeps the literal Unicode glyph).
  const GREEK = {
    'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon',
    'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota', 'κ': '\\kappa',
    'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi',
    'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi',
    'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
    'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi',
    'Π': '\\Pi', 'Σ': '\\Sigma', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega'
  };

  // Combining accent codepoints -> structure kind (for text fallback).
  const COMBINING = {
    '\u0305': 'overline', '\u0304': 'overline', // combining overline / macron
    '\u0302': 'hat', '\u0303': 'tilde', '\u20D7': 'vec', '\u0307': 'dot'
  };

  /** Map a Unicode symbol to its LaTeX form (symbol lib + greek + passthrough). */
  function symToTex(s) {
    if (SYMBOLS[s]) return SYMBOLS[s].tex;
    if (GREEK[s]) return GREEK[s];
    return s;
  }
  /** Map a Unicode symbol to the literal char OMML should carry. */
  function symToChar(s) {
    if (SYMBOLS[s]) return SYMBOLS[s].ch;
    return s;
  }

  /* =========================================================================
   * SMALL UTILITIES
   * ========================================================================= */
  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function mdEsc(s) {
    // Escape markdown-significant chars in prose (not inside math/code).
    return String(s).replace(/([\\`*_{}\[\]()#+\-.!|])/g, '\\$1');
  }
  function nfkc(s) {
    // Repairs mathematical-italic/bold Unicode letters & digits -> ASCII base.
    try { return s.normalize('NFKC'); } catch (e) { return s; }
  }
  const isBigOp = (ch) => SYMBOLS[ch] && SYMBOLS[ch].nary;

  /* =========================================================================
   * STRUCTURE LIBRARY  (requirement 3 & 5)  - builders for pure equation output
   * LaTeX builders (for Markdown) and OMML builders (for Word .docx).
   * ========================================================================= */
  const STRUCT = {
    // ---- LaTeX ----
    tex: {
      frac: (n, d) => `\\frac{${n}}{${d}}`,
      sup: (b, s) => `${b}^{${s}}`,
      sub: (b, s) => `${b}_{${s}}`,
      subsup: (b, sb, sp) => `${b}_{${sb}}^{${sp}}`,
      sqrt: (e) => `\\sqrt{${e}}`,
      root: (e, k) => `\\sqrt[${k}]{${e}}`,
      overline: (e) => `\\overline{${e}}`,
      accent: (e, kind) => ({ hat: `\\hat{${e}}`, tilde: `\\tilde{${e}}`,
        vec: `\\vec{${e}}`, dot: `\\dot{${e}}`, overline: `\\overline{${e}}` }[kind] || `\\overline{${e}}`),
      nary: (op, sb, sp, body) => {
        let out = symToTex(op);
        if (sb) out += `_{${sb}}`;
        if (sp) out += `^{${sp}}`;
        return `${out} ${body}`;
      },
      fenced: (open, close, body) => `\\left${open || '.'}${body}\\right${close || '.'}`
    },
    // ---- OMML (Office Math) ----
    omml: {
      run: (t) => `<m:r><m:t xml:space="preserve">${xmlEsc(t)}</m:t></m:r>`,
      frac: (n, d) => `<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>${n}</m:num><m:den>${d}</m:den></m:f>`,
      sup: (b, s) => `<m:sSup><m:e>${b}</m:e><m:sup>${s}</m:sup></m:sSup>`,
      sub: (b, s) => `<m:sSub><m:e>${b}</m:e><m:sub>${s}</m:sub></m:sSub>`,
      subsup: (b, sb, sp) => `<m:sSubSup><m:e>${b}</m:e><m:sub>${sb}</m:sub><m:sup>${sp}</m:sup></m:sSubSup>`,
      sqrt: (e) => `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${e}</m:e></m:rad>`,
      root: (e, k) => `<m:rad><m:deg>${k}</m:deg><m:e>${e}</m:e></m:rad>`,
      bar: (e) => `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${e}</m:e></m:bar>`,
      accent: (e, chr) => `<m:acc><m:accPr><m:chr m:val="${xmlEsc(chr)}"/></m:accPr><m:e>${e}</m:e></m:acc>`,
      nary: (op, sb, sp, body) => {
        const hideSub = sb ? '' : '<m:subHide m:val="1"/>';
        const hideSup = sp ? '' : '<m:supHide m:val="1"/>';
        return `<m:nary><m:naryPr><m:chr m:val="${xmlEsc(symToChar(op))}"/>` +
          `<m:limLoc m:val="undOvr"/>${hideSub}${hideSup}</m:naryPr>` +
          `<m:sub>${sb || ''}</m:sub><m:sup>${sp || ''}</m:sup><m:e>${body || ''}</m:e></m:nary>`;
      },
      fenced: (open, close, body) =>
        `<m:d><m:dPr><m:begChr m:val="${xmlEsc(open || '(')}"/>` +
        `<m:endChr m:val="${xmlEsc(close || ')')}"/></m:dPr><m:e>${body}</m:e></m:d>`,
      matrix: (rows) => {
        const cols = Math.max(...rows.map(r => r.length), 1);
        const mcJc = `<m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>`;
        const body = rows.map(r =>
          `<m:mr>${r.map(c => `<m:e>${c}</m:e>`).join('')}</m:mr>`).join('');
        return `<m:m><m:mPr>${mcJc}</m:mPr>${body}</m:m>`;
      }
    }
  };

  /* =========================================================================
   * MATH SOURCE ACQUISITION  (requirement 4)
   * Pull the *structured* math from the DOM, preferring MathML, then TeX.
   * ========================================================================= */
  function getMathML(el) {
    if (el.tagName && el.tagName.toLowerCase() === 'math') return el;
    // MathJax v3 assistive MathML, KaTeX MathML, or any embedded <math>.
    return el.querySelector('mjx-assistive-mml math, .katex-mathml math, math');
  }
  function getTeX(el) {
    // KaTeX / MathJax store the original TeX in an annotation or script tag.
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    if (ann) return ann.textContent.trim();
    const sx = el.querySelector('script[type^="math/tex"]');
    if (sx) return sx.textContent.trim();
    for (const a of ['data-latex', 'data-tex', 'data-original']) {
      if (el.getAttribute && el.getAttribute(a)) return el.getAttribute(a).trim();
    }
    return null;
  }

  const localName = (n) => (n.localName || n.nodeName || '').toLowerCase();
  const elemChildren = (n) => Array.from(n.childNodes).filter(
    c => c.nodeType === 1 || (c.nodeType === 3 && c.textContent.trim() !== ''));

  /* =========================================================================
   * MathML  ->  LaTeX   (for Markdown export)
   * ========================================================================= */
  function mml2tex(node) {
    if (node.nodeType === 3) return mapText(node.textContent, 'tex');
    const name = localName(node);
    const kids = elemChildren(node);
    const seq = () => kids.map(mml2tex).join('');
    switch (name) {
      case 'math': case 'mrow': case 'mstyle': case 'mpadded':
      case 'semantics': return seq();
      case 'annotation': case 'annotation-xml': return '';
      case 'mi': case 'mn': case 'mtext':
        return mapText(node.textContent, 'tex');
      case 'mo': return wrapOp(mapText(node.textContent, 'tex'));
      case 'mfrac': return STRUCT.tex.frac(mml2tex(kids[0]), mml2tex(kids[1]));
      case 'msup': return STRUCT.tex.sup(mml2tex(kids[0]), mml2tex(kids[1]));
      case 'msub': return STRUCT.tex.sub(mml2tex(kids[0]), mml2tex(kids[1]));
      case 'msubsup': return STRUCT.tex.subsup(mml2tex(kids[0]), mml2tex(kids[1]), mml2tex(kids[2]));
      case 'msqrt': return STRUCT.tex.sqrt(seq());
      case 'mroot': return STRUCT.tex.root(mml2tex(kids[0]), mml2tex(kids[1]));
      case 'mover': return overUnderTex(kids, 'over');
      case 'munder': return overUnderTex(kids, 'under');
      case 'munderover': return overUnderTex(kids, 'both');
      case 'mfenced': return STRUCT.tex.fenced(
        node.getAttribute('open') || '(', node.getAttribute('close') || ')', seq());
      case 'mtable':
        return '\\begin{matrix}' + kids.map(r =>
          elemChildren(r).map(c => mml2tex(c)).join(' & ')).join(' \\\\ ') + '\\end{matrix}';
      case 'mtr': return elemChildren(node).map(mml2tex).join(' & ');
      case 'mtd': return seq();
      default: return seq();
    }
  }
  function overUnderTex(kids, kind) {
    const base = mml2tex(kids[0]);
    const baseCh = (kids[0].textContent || '').trim();
    const over = kids[kind === 'both' ? 2 : 1] ? mml2tex(kids[kind === 'both' ? 2 : 1]) : '';
    const under = kind === 'under' ? mml2tex(kids[1]) :
      (kind === 'both' ? mml2tex(kids[1]) : '');
    if (isBigOp(baseCh)) { // sum/prod/int with limits
      let out = symToTex(baseCh);
      if (kind === 'under') out += `_{${over}}`;
      else if (kind === 'over') out += `^{${over}}`;
      else out += `_{${under}}^{${over}}`;
      return out;
    }
    // accent (overline/hat/bar/vec)
    const acc = (kids[1] ? (kids[1].textContent || '').trim() : '');
    if (kind === 'over') {
      const kindName = COMBINING[acc] || (acc === '‾' || acc === '¯' || acc === '_' ? 'overline' : null);
      if (kindName) return STRUCT.tex.accent(base, kindName);
      return `\\overset{${over}}{${base}}`;
    }
    if (kind === 'under') return `\\underset{${under}}{${base}}`;
    return STRUCT.tex.subsup(base, under, over);
  }
  function wrapOp(t) {
    // Spacing around binary relations/operators for readable LaTeX.
    return t;
  }

  /* =========================================================================
   * MathML  ->  OMML   (for Word .docx export, native editable equations)
   * ========================================================================= */
  function mml2omml(node) {
    if (node.nodeType === 3) return runsFromText(node.textContent);
    const name = localName(node);
    const kids = elemChildren(node);
    const seq = () => kids.map(mml2omml).join('');
    switch (name) {
      case 'math': case 'mrow': case 'mstyle': case 'mpadded':
      case 'semantics': return seq();
      case 'annotation': case 'annotation-xml': return '';
      case 'mi': case 'mn': case 'mtext': case 'mo':
        return runsFromText(node.textContent);
      case 'mfrac': return STRUCT.omml.frac(mml2omml(kids[0]), mml2omml(kids[1]));
      case 'msup': return STRUCT.omml.sup(mml2omml(kids[0]), mml2omml(kids[1]));
      case 'msub': return STRUCT.omml.sub(mml2omml(kids[0]), mml2omml(kids[1]));
      case 'msubsup': return STRUCT.omml.subsup(mml2omml(kids[0]), mml2omml(kids[1]), mml2omml(kids[2]));
      case 'msqrt': return STRUCT.omml.sqrt(seq());
      case 'mroot': return STRUCT.omml.root(mml2omml(kids[0]), mml2omml(kids[1]));
      case 'mover': return overUnderOmml(kids, 'over');
      case 'munder': return overUnderOmml(kids, 'under');
      case 'munderover': return overUnderOmml(kids, 'both');
      case 'mfenced': return STRUCT.omml.fenced(
        node.getAttribute('open') || '(', node.getAttribute('close') || ')', seq());
      case 'mtable':
        return STRUCT.omml.matrix(kids.map(r =>
          elemChildren(r).map(c => mml2omml(c))));
      case 'mtr': return elemChildren(node).map(mml2omml).join('');
      case 'mtd': return seq();
      default: return seq();
    }
  }
  function overUnderOmml(kids, kind) {
    const baseCh = (kids[0].textContent || '').trim();
    const base = mml2omml(kids[0]);
    if (isBigOp(baseCh)) {
      const a = kids[1] ? mml2omml(kids[1]) : '';
      const b = kids[2] ? mml2omml(kids[2]) : '';
      if (kind === 'under') return STRUCT.omml.nary(baseCh, a, '', '');
      if (kind === 'over') return STRUCT.omml.nary(baseCh, '', a, '');
      return STRUCT.omml.nary(baseCh, a, b, '');
    }
    const accCh = kids[1] ? (kids[1].textContent || '').trim() : '';
    if (kind === 'over') {
      if (accCh === '‾' || accCh === '¯' || accCh === '\u0305' || accCh === '\u0304')
        return STRUCT.omml.bar(base);
      if (COMBINING[accCh]) return STRUCT.omml.accent(base, accCh === '\u0302' ? '̂' : accCh);
      return STRUCT.omml.accent(base, '¯');
    }
    if (kind === 'under') return STRUCT.omml.sub(base, mml2omml(kids[1]));
    return STRUCT.omml.subsup(base, mml2omml(kids[1]), mml2omml(kids[2]));
  }

  /* Split raw MathML leaf text into OMML runs, keeping symbols literal. */
  function runsFromText(txt) {
    const clean = nfkc(txt).replace(/\s+/g, ' ');
    if (clean === '') return '';
    return STRUCT.omml.run(clean);
  }

  /* mapText: normalize a leaf token for LaTeX or plain output. */
  function mapText(txt, mode) {
    let s = nfkc(txt);
    if (mode === 'tex') {
      // Convert known symbols/greek char-by-char, keeping LaTeX commands valid:
      // an alphabetic command (\ast, \cdot, \times, \sum ...) needs a trailing
      // space so it doesn't fuse with the next token (e.g. \ast + h -> "\asth").
      const cmd = (t) => (/^\\[a-zA-Z]+$/.test(t) ? t + ' ' : t);
      let out = '';
      for (const ch of s) {
        if (SYMBOLS[ch]) out += cmd(SYMBOLS[ch].tex);
        else if (GREEK[ch]) out += GREEK[ch] + ' ';
        else if (ch === '{' || ch === '}') out += '\\' + ch; // visible set braces
        else if ('#%&$'.includes(ch)) out += '\\' + ch;      // escape LaTeX specials
        else out += ch;
      }
      return out;
    }
    return s;
  }

  /* =========================================================================
   * FALLBACK 1:  LaTeX  ->  OMML   (used when the DOM only exposes TeX)
   * A compact parser covering the constructs sci-bot answers actually use.
   * ========================================================================= */
  const TEX2CHAR = (() => {
    const m = {};
    for (const [u, v] of Object.entries(SYMBOLS)) if (v.tex.startsWith('\\')) m[v.tex] = v.ch;
    for (const [u, v] of Object.entries(GREEK)) m[v] = u;
    Object.assign(m, { '\\to': '→', '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇' });
    return m;
  })();
  const NARY_CMD = { '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\oint': '∮',
    '\\iint': '∬', '\\bigcup': '⋃', '\\bigcap': '⋂' };
  const ACCENT_CMD = { '\\overline': 'bar', '\\bar': 'bar', '\\hat': '̂',
    '\\vec': '⃗', '\\tilde': '̃', '\\dot': '̇' };

  function texTokens(s) {
    const t = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        let j = i + 1, cmd = '\\';
        if (/[a-zA-Z]/.test(s[j])) { while (j < s.length && /[a-zA-Z]/.test(s[j])) cmd += s[j++]; }
        else { cmd += s[j++]; }
        t.push({ t: 'cmd', v: cmd }); i = j;
      } else if ('{}^_'.includes(c)) { t.push({ t: c }); i++; }
      else if (/\s/.test(c)) { i++; }
      else { t.push({ t: 'ch', v: c }); i++; }
    }
    return t;
  }
  function tex2omml(src) {
    const tk = texTokens(src); let p = 0;
    function group() { // parse a {...} or single token, return OMML string
      if (tk[p] && tk[p].t === '{') { p++; const s = seq('}'); if (tk[p] && tk[p].t === '}') p++; return s; }
      return atom();
    }
    function atom() {
      const x = tk[p];
      if (!x) return '';
      if (x.t === 'cmd') {
        p++;
        if (x.v === '\\frac') { const n = group(), d = group(); return STRUCT.omml.frac(n, d); }
        if (x.v === '\\sqrt') {
          if (tk[p] && tk[p].t === '[') { p++; let k = ''; while (tk[p] && tk[p].t !== ']') k += (tk[p++].v || ''); if (tk[p]) p++; return STRUCT.omml.root(group(), STRUCT.omml.run(k)); }
          return STRUCT.omml.sqrt(group());
        }
        if (ACCENT_CMD[x.v]) { const e = group(); return ACCENT_CMD[x.v] === 'bar' ? STRUCT.omml.bar(e) : STRUCT.omml.accent(e, ACCENT_CMD[x.v]); }
        if (x.v === '\\left') { const open = tk[p] ? (tk[p++].v || '(') : '('; const body = seqUntil('\\right'); let close = ')'; if (tk[p] && tk[p].t === 'cmd' && tk[p].v === '\\right') { p++; if (tk[p]) close = tk[p++].v || ')'; } return STRUCT.omml.fenced(open, close, body); }
        if (NARY_CMD[x.v]) return naryTex(NARY_CMD[x.v]);
        if (TEX2CHAR[x.v]) return STRUCT.omml.run(TEX2CHAR[x.v]);
        return STRUCT.omml.run(x.v.replace(/^\\/, ''));
      }
      if (x.t === 'ch') { p++; return STRUCT.omml.run(SYMBOLS[x.v] ? SYMBOLS[x.v].ch : x.v); }
      if (x.t === '{') return group();
      p++; return '';
    }
    function withScripts(base) {
      let sub = null, sup = null;
      while (tk[p] && (tk[p].t === '^' || tk[p].t === '_')) {
        const k = tk[p].t; p++;
        if (k === '^') sup = group(); else sub = group();
      }
      if (sub != null && sup != null) return STRUCT.omml.subsup(base, sub, sup);
      if (sub != null) return STRUCT.omml.sub(base, sub);
      if (sup != null) return STRUCT.omml.sup(base, sup);
      return base;
    }
    function naryTex(chr) {
      let sub = null, sup = null;
      while (tk[p] && (tk[p].t === '^' || tk[p].t === '_')) {
        const k = tk[p].t; p++;
        if (k === '^') sup = group(); else sub = group();
      }
      return STRUCT.omml.nary(chr, sub, sup, '');
    }
    function seq(stop) {
      let out = '';
      while (p < tk.length) {
        if (stop && tk[p].t === stop) break;
        out += withScripts(atom());
      }
      return out;
    }
    function seqUntil(cmd) {
      let out = '';
      while (p < tk.length && !(tk[p].t === 'cmd' && tk[p].v === cmd)) out += withScripts(atom());
      return out;
    }
    return seq(null);
  }

  /* =========================================================================
   * FALLBACK 2:  raw math text  ->  OMML / LaTeX  (last resort)
   * Repairs mathematical-italic letters (NFKC) and overline/accent marks.
   * NOTE: text-only input has no fraction/script structure to recover; this
   * path repairs symbols, letters and accents, and keeps output linear.
   * ========================================================================= */
  // Spacing overline (U+203E) and macron (U+00AF) -> combining overline, so the
  // accent binds to the preceding glyph (NFKC otherwise leaves a stray space).
  const OVERLINE_MARKS = /[\u203E\u00AF]/g;
  function normMath(txt) { return nfkc(String(txt).replace(OVERLINE_MARKS, '\u0305')); }
  const ACCENT_TEX = { overline: '\\overline', hat: '\\hat', tilde: '\\tilde', vec: '\\vec', dot: '\\dot' };
  const ACCENT_OMML_CH = { hat: '\u0302', tilde: '\u0303', vec: '\u20D7', dot: '\u0307' };

  function textMath2omml(txt) {
    let out = '', buf = '';
    const flush = () => { if (buf) { out += STRUCT.omml.run(buf); buf = ''; } };
    for (const ch of normMath(txt)) {
      const kind = COMBINING[ch];
      if (kind) {
        buf = buf.replace(/\s+$/, '');
        const last = buf.slice(-1); buf = buf.slice(0, -1); flush();
        if (!last) continue;
        out += (kind === 'overline')
          ? STRUCT.omml.bar(STRUCT.omml.run(last))
          : STRUCT.omml.accent(STRUCT.omml.run(last), ACCENT_OMML_CH[kind] || '\u0305');
      } else buf += (SYMBOLS[ch] ? SYMBOLS[ch].ch : ch);
    }
    flush();
    return out;
  }
  function textMath2tex(txt) {
    let out = '';
    for (const ch of normMath(txt)) {
      const kind = COMBINING[ch];
      if (kind) { out = out.replace(/(\S)(\s*)$/, (ACCENT_TEX[kind] || '\\overline') + '{$1}'); continue; }
      const t = symToTex(ch);
      out += /^\\[a-zA-Z]+$/.test(t) ? t + ' ' : t; // keep LaTeX commands valid
    }
    return out.replace(/\s+$/, '');
  }

  /* Unified: given a math DOM element, produce {tex, omml}. */
  function convertMath(el) {
    const mml = getMathML(el);
    if (mml) {
      try { return { tex: mml2tex(mml).trim(), omml: mml2omml(mml).trim(), ok: true }; }
      catch (e) { console.warn('[sci-bot-export] MathML convert failed', e); }
    }
    const tex = getTeX(el);
    if (tex) {
      try { return { tex, omml: tex2omml(tex).trim(), ok: true }; }
      catch (e) { console.warn('[sci-bot-export] TeX convert failed', e); }
    }
    const raw = el.textContent || '';
    return { tex: textMath2tex(raw), omml: textMath2omml(raw), ok: false };
  }

  /* =========================================================================
   * DOM WALK  ->  intermediate representation (blocks + inline runs)
   * (requirement 1: capture the whole conversation, structured)
   * ========================================================================= */
  const MATH_SELECTOR = 'math, mjx-container, .MathJax, .MathJax_Display, .katex, .katex-display, [class*="math"]';
  function isMathEl(el) {
    if (el.nodeType !== 1) return false;
    const n = localName(el);
    if (n === 'math' || n === 'mjx-container') return true;
    const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '');
    return /\b(MathJax|katex)\b|math/i.test(String(cls));
  }
  function isDisplayMath(el) {
    const cls = String((el.className && el.className.baseVal) || el.className || '');
    if (/display/i.test(cls)) return true;
    const d = el.getAttribute && el.getAttribute('display');
    return d === 'block';
  }
  function isIgnored(el) {
    return CONFIG.ignoreSelectors.some(sel => { try { return el.matches && el.matches(sel); } catch (e) { return false; } });
  }

  function extractInlines(node) {
    const out = [];
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { if (c.textContent) out.push({ k: 'text', s: c.textContent }); continue; }
      if (c.nodeType !== 1 || isIgnored(c)) continue;
      if (isMathEl(c)) { out.push({ k: 'math', math: convertMath(c) }); continue; }
      const n = localName(c);
      if (n === 'br') out.push({ k: 'br' });
      else if (n === 'a') out.push({ k: 'link', href: c.getAttribute('href') || '', kids: extractInlines(c) });
      else if (n === 'strong' || n === 'b') out.push({ k: 'strong', kids: extractInlines(c) });
      else if (n === 'em' || n === 'i') out.push({ k: 'em', kids: extractInlines(c) });
      else if (n === 'code') out.push({ k: 'code', s: c.textContent });
      else if (n === 'sup') out.push({ k: 'sup', kids: extractInlines(c) });
      else if (n === 'sub') out.push({ k: 'sub', kids: extractInlines(c) });
      else out.push(...extractInlines(c)); // span / unknown inline -> flatten
    }
    return out;
  }

  function extractBlocks(root) {
    const blocks = [];
    for (const c of root.childNodes) {
      if (c.nodeType === 3) { if (c.textContent.trim()) blocks.push({ type: 'para', inlines: [{ k: 'text', s: c.textContent }] }); continue; }
      if (c.nodeType !== 1 || isIgnored(c)) continue;
      if (isMathEl(c)) {
        if (isDisplayMath(c)) blocks.push({ type: 'mathblock', math: convertMath(c) });
        else blocks.push({ type: 'para', inlines: [{ k: 'math', math: convertMath(c) }] });
        continue;
      }
      const n = localName(c);
      if (/^h[1-6]$/.test(n)) blocks.push({ type: 'heading', level: +n[1], inlines: extractInlines(c) });
      else if (n === 'p') blocks.push({ type: 'para', inlines: extractInlines(c) });
      else if (n === 'ul' || n === 'ol') blocks.push({ type: 'list', ordered: n === 'ol',
        items: Array.from(c.children).filter(li => localName(li) === 'li').map(li => extractInlines(li)) });
      else if (n === 'pre') blocks.push({ type: 'code', text: c.textContent });
      else if (n === 'hr') blocks.push({ type: 'hr' });
      else if (n === 'table') blocks.push({ type: 'table',
        rows: Array.from(c.querySelectorAll('tr')).map(tr =>
          Array.from(tr.children).map(td => extractInlines(td))) });
      else if (n === 'blockquote' || n === 'div' || n === 'section' || n === 'article' || n === 'main' || n === 'li') {
        const inner = extractBlocks(c);
        if (inner.length) blocks.push(...inner);
        else { const inl = extractInlines(c); if (inl.length) blocks.push({ type: 'para', inlines: inl }); }
      } else {
        const inl = extractInlines(c);
        if (inl.length) blocks.push({ type: 'para', inlines: inl });
      }
    }
    return blocks;
  }

  function pickRoot() {
    let best = null, bestLen = 0;
    const cands = [];
    for (const sel of CONFIG.answerSelectors) document.querySelectorAll(sel).forEach(e => cands.push(e));
    document.querySelectorAll('article, main, section, div').forEach(e => cands.push(e));
    for (const e of cands) {
      if (isIgnored(e)) continue;
      const len = (e.textContent || '').length;
      const hasStructure = e.querySelector('h1,h2,h3,p,li');
      if (hasStructure && len > bestLen) { best = e; bestLen = len; }
    }
    return best || document.body;
  }

  function collectConversation() {
    const root = pickRoot();
    const blocks = extractBlocks(root);
    const title = (document.title || 'sci-bot conversation')
      .replace(/\s*[|\u2013\-]\s*sci.?bot.*$/i, '').trim() || 'sci-bot conversation';
    return { title, url: location.href, blocks };
  }

  /* =========================================================================
   * RENDER  ->  MARKDOWN   (requirements 5,6,7)
   * ========================================================================= */
  function inlinesMd(inls) {
    let s = '';
    for (const it of inls) {
      switch (it.k) {
        case 'text': s += it.s; break;
        case 'br': s += '  \n'; break;
        case 'strong': s += '**' + inlinesMd(it.kids).trim() + '**'; break;
        case 'em': s += '*' + inlinesMd(it.kids).trim() + '*'; break;
        case 'code': s += '`' + it.s + '`'; break;
        case 'sup': s += '<sup>' + inlinesMd(it.kids) + '</sup>'; break;
        case 'sub': s += '<sub>' + inlinesMd(it.kids) + '</sub>'; break;
        case 'link': s += '[' + inlinesMd(it.kids).trim() + '](' + it.href + ')'; break;
        case 'math': s += it.math.tex ? '$' + it.math.tex + '$' : ''; break;
      }
    }
    return s;
  }
  function toMarkdown(conv) {
    const L = [];
    L.push('# ' + conv.title, '');
    L.push('> Source: ' + conv.url, '> Exported: ' + new Date().toISOString(), '');
    for (const b of conv.blocks) {
      switch (b.type) {
        case 'heading': L.push('#'.repeat(Math.min(b.level, 6)) + ' ' + inlinesMd(b.inlines).trim(), ''); break;
        case 'para': { const t = inlinesMd(b.inlines).replace(/[ \t]+\n/g, '\n').trim(); if (t) L.push(t, ''); break; }
        case 'mathblock': L.push('$$', b.math.tex, '$$', ''); break;
        case 'list':
          b.items.forEach((it, i) => L.push((b.ordered ? (i + 1) + '. ' : '- ') + inlinesMd(it).trim()));
          L.push(''); break;
        case 'code': L.push('```', b.text.replace(/\s+$/, ''), '```', ''); break;
        case 'hr': L.push('---', ''); break;
        case 'table':
          if (b.rows.length) {
            L.push('| ' + b.rows[0].map(c => inlinesMd(c).trim()).join(' | ') + ' |');
            L.push('| ' + b.rows[0].map(() => '---').join(' | ') + ' |');
            b.rows.slice(1).forEach(r => L.push('| ' + r.map(c => inlinesMd(c).trim()).join(' | ') + ' |'));
            L.push('');
          }
          break;
      }
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* =========================================================================
   * RENDER  ->  WORD (.docx)  with native OMML equations (requirements 5,6,7)
   * ========================================================================= */
  function runXml(text, fmt) {
    const rPr = [];
    if (fmt && fmt.b) rPr.push('<w:b/>');
    if (fmt && fmt.i) rPr.push('<w:i/>');
    if (fmt && fmt.code) rPr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
    const pr = rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : '';
    return `<w:r>${pr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
  }
  // Build inline docx content. `rels` collects hyperlink relationships.
  function inlinesDocx(inls, fmt, rels) {
    let s = '';
    for (const it of inls) {
      switch (it.k) {
        case 'text': s += runXml(it.s, fmt); break;
        case 'br': s += '<w:r><w:br/></w:r>'; break;
        case 'strong': s += inlinesDocx(it.kids, Object.assign({}, fmt, { b: true }), rels); break;
        case 'em': s += inlinesDocx(it.kids, Object.assign({}, fmt, { i: true }), rels); break;
        case 'code': s += runXml(it.s, Object.assign({}, fmt, { code: true })); break;
        case 'sup': s += `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">${xmlEsc(inlineText(it.kids))}</w:t></w:r>`; break;
        case 'sub': s += `<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">${xmlEsc(inlineText(it.kids))}</w:t></w:r>`; break;
        case 'link': {
          const rid = rels.add(it.href);
          s += `<w:hyperlink r:id="${rid}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr>` +
               `<w:t xml:space="preserve">${xmlEsc(inlineText(it.kids))}</w:t></w:r></w:hyperlink>`;
          break;
        }
        case 'math': if (it.math.omml) s += `<m:oMath>${it.math.omml}</m:oMath>`; else s += runXml(it.math.tex || '', fmt); break;
      }
    }
    return s;
  }
  function inlineText(inls) {
    return inls.map(it => it.k === 'text' ? it.s : (it.kids ? inlineText(it.kids) : (it.s || (it.math && it.math.tex) || ''))).join('');
  }
  function para(content, style) {
    const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
    return `<w:p>${pPr}${content}</w:p>`;
  }
  function toDocxDocument(conv) {
    const rels = (() => {
      const list = []; let n = 0;
      return { add: (url) => { const id = 'rIdH' + (++n); list.push({ id, url }); return id; }, list };
    })();
    const body = [];
    body.push(para(runXml(conv.title), 'Title'));
    body.push(para(runXml('Source: ' + conv.url, { i: true })));
    for (const b of conv.blocks) {
      switch (b.type) {
        case 'heading': body.push(para(inlinesDocx(b.inlines, {}, rels), 'Heading' + Math.min(b.level, 4))); break;
        case 'para': { const c = inlinesDocx(b.inlines, {}, rels); if (c.trim()) body.push(para(c)); break; }
        case 'mathblock': body.push(`<w:p><m:oMathPara><m:oMath>${b.math.omml}</m:oMath></m:oMathPara></w:p>`); break;
        case 'list':
          b.items.forEach((it, i) => body.push(para(
            runXml((b.ordered ? (i + 1) + '.\t' : '\u2022\t')) + inlinesDocx(it, {}, rels), 'ListParagraph')));
          break;
        case 'code': body.push(para(runXml(b.text, { code: true }))); break;
        case 'hr': body.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>'); break;
        case 'table': body.push(tableXml(b.rows, rels)); break;
      }
    }
    const doc =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
<w:body>
${body.join('\n')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body>
</w:document>`;
    return { doc, rels: rels.list };
  }
  function tableXml(rows, rels) {
    const grid = rows.length ? rows[0].length : 1;
    const cols = '<w:tblGrid>' + Array(grid).fill('<w:gridCol w:w="2500"/>').join('') + '</w:tblGrid>';
    const body = rows.map(r => '<w:tr>' + r.map(c =>
      `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>${para(inlinesDocx(c, {}, rels))}</w:tc>`).join('') + '</w:tr>').join('');
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
      `<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>` +
      `</w:tblBorders></w:tblPr>${cols}${body}</w:tbl>`;
  }

  const STYLES_XML =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="120"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

  async function buildDocxBlob(conv) {
    const { doc, rels } = toDocxDocument(conv);
    const zip = new JSZip();
    zip.file('[Content_Types].xml',
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
    zip.folder('_rels').file('.rels',
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    const wordRels = rels.map(r =>
      `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(r.url)}" TargetMode="External"/>`).join('');
    const word = zip.folder('word');
    word.file('document.xml', doc);
    word.file('styles.xml', STYLES_XML);
    word.folder('_rels').file('document.xml.rels',
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${wordRels}
</Relationships>`);
    return zip.generateAsync({ type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* =========================================================================
   * DOWNLOAD + UI
   * ========================================================================= */
  function slugify(s) {
    return (s || 'sci-bot-conversation').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sci-bot-conversation';
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  function toast(msg, err) {
    let t = document.getElementById('sbx-toast');
    if (!t) { t = document.createElement('div'); t.id = 'sbx-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:2147483647;padding:10px 14px;' +
      'border-radius:8px;font:13px/1.4 system-ui,sans-serif;color:#fff;max-width:320px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.25);background:' + (err ? '#c0392b' : '#2c7a3f');
    t.style.opacity = '1';
    clearTimeout(t._h); t._h = setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; }, 3500);
  }

  async function exportAs(kind) {
    try {
      const conv = collectConversation();
      if (!conv.blocks.length) { toast('Nothing to export on this page.', true); return; }
      const missing = countMissingMath(conv);
      if (kind === 'md') {
        download(new Blob([toMarkdown(conv)], { type: 'text/markdown;charset=utf-8' }), slugify(conv.title) + '.md');
      } else {
        if (typeof JSZip === 'undefined') { toast('JSZip not loaded (needed for .docx).', true); return; }
        const blob = await buildDocxBlob(conv);
        download(blob, slugify(conv.title) + '.docx');
      }
      toast('Exported ' + kind.toUpperCase() + (missing ? ' (' + missing + ' math region(s) used text fallback)' : ' \u2713'));
    } catch (e) {
      console.error('[sci-bot-export]', e);
      toast('Export failed: ' + e.message, true);
    }
  }
  function countMissingMath(conv) {
    let n = 0;
    const scan = (inls) => inls && inls.forEach(it => {
      if (it.k === 'math' && it.math && it.math.ok === false) n++;
      if (it.kids) scan(it.kids);
    });
    conv.blocks.forEach(b => { if (b.type === 'mathblock' && b.math.ok === false) n++; scan(b.inlines); if (b.items) b.items.forEach(scan); });
    return n;
  }

  function buildUI() {
    if (document.getElementById('sbx-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'sbx-wrap';
    wrap.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;font:13px system-ui,sans-serif;';
    wrap.innerHTML =
      '<div id="sbx-menu" style="display:none;margin-bottom:8px;background:#fff;border:1px solid #ddd;' +
      'border-radius:10px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.18);min-width:150px">' +
        '<button data-k="md" style="all:unset;display:block;width:100%;box-sizing:border-box;padding:10px 14px;cursor:pointer;color:#222">\u2b07 Markdown (.md)</button>' +
        '<button data-k="docx" style="all:unset;display:block;width:100%;box-sizing:border-box;padding:10px 14px;cursor:pointer;color:#222;border-top:1px solid #eee">\u2b07 Word (.docx)</button>' +
      '</div>' +
      '<button id="sbx-btn" style="all:unset;cursor:pointer;background:#1f6feb;color:#fff;padding:11px 16px;' +
      'border-radius:24px;box-shadow:0 4px 14px rgba(31,111,235,.4);font-weight:600">\u2b73 Export</button>';
    document.body.appendChild(wrap);
    const menu = wrap.querySelector('#sbx-menu');
    wrap.querySelector('#sbx-btn').addEventListener('click', () => {
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    });
    menu.querySelectorAll('button').forEach(b => {
      b.addEventListener('mouseenter', () => b.style.background = '#f2f6ff');
      b.addEventListener('mouseleave', () => b.style.background = '#fff');
      b.addEventListener('click', () => { menu.style.display = 'none'; exportAs(b.dataset.k); });
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) menu.style.display = 'none'; });
  }

  // ----- Node test hook: export internals when not in a browser -----
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      mml2tex, mml2omml, tex2omml, textMath2omml, textMath2tex,
      toMarkdown, toDocxDocument, buildDocxBlob, extractBlocks, collectConversation,
      SYMBOLS, GREEK, STRUCT
    };
  }

  // ----- Browser UI bootstrap (skipped under Node) -----
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    window.SciBotExport = { exportMarkdown: () => exportAs('md'), exportDocx: () => exportAs('docx'), collect: collectConversation };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
    else buildUI();
  }
})();
