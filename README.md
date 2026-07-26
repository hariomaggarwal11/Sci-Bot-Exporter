# Sci-Bot Conversation Exporter

A client-side tool that exports a [sci-bot.ru](https://sci-bot.ru/) answer/conversation
to **Markdown (`.md`)** or **Word (`.docx`)** with **real, structured math equations**.

It runs inside the page (as a userscript or bookmarklet), so it reads the *structured*
math source (MathML / original TeX) instead of the rendered text. That matters because
sci-bot renders equations with mathematical-italic Unicode + combining marks — a plain
"copy text" turns `stdKt/V = G / C̄_pre` into garbage like `stdKt=𝐺𝐶‾pre`.

## What it does (requirements covered)

| # | Requirement | How |
|---|-------------|-----|
| 1 | Capture the entire conversation | Walks the answer container into a structured block model (headings, paragraphs, lists, tables, references). |
| 2 | Special characters preserved | Unicode-safe throughout; `NFKC` repairs mathematical-italic/bold letters back to normal ASCII. |
| 3 | Library of math symbols & structures | `SYMBOLS`, `GREEK`, `COMBINING`, and `STRUCT` (LaTeX + OMML builders) inside the script. |
| 4 | Capture complete equations | Reads MathML (MathJax assistive MML / KaTeX / native `<math>`) or the original TeX annotation. |
| 5 | Convert raw math to pure format | MathML→LaTeX for `.md`; MathML→**OMML** (native Word equations) for `.docx`; TeX and text fallbacks. |
| 6 | Structured alignment & spacing | Headings, paragraph spacing, lists, tables, and display vs inline math preserved. |
| 7 | Save as `.docx` or `.md` | One-click download of either format. |

## Install (recommended: userscript)

1. Install a userscript manager: **Tampermonkey** or **Violentmonkey** (Chrome/Edge/Firefox).
2. Create a new script and paste the contents of [`sci-bot-export.user.js`](./sci-bot-export.user.js).
   - It auto-loads JSZip via `@require` (needed for `.docx`).
3. Open any answer page, e.g. `https://sci-bot.ru/standard-ktv-is-an-index-1a83`.
4. Click the blue **⤳ Export** button (bottom-right) → choose **Markdown** or **Word**.

## Install (alternative: bookmarklet)

If you can't use a userscript manager:

1. Host `sci-bot-export.user.js` on an HTTPS URL (e.g. a GitHub "raw" link).
2. Put that URL into `SCRIPT_URL` in [`bookmarklet.js`](./bookmarklet.js).
3. Minify `bookmarklet.js` to one line, prefix with `javascript:`, and save it as a bookmark URL.
4. On a sci-bot answer page, click the bookmark → the Export button appears.

## Output examples

**Markdown** — math as LaTeX, editable and renders on GitHub/Obsidian/Pandoc:

```markdown
## Definition
The dose is defined as

$$
\frac{G}{\overline{C}_{pre}} \times \frac{10080}{V}
$$

Decay follows $e^{-Kt/V}$ over time.
```

**Word (`.docx`)** — equations are **native OMML**, so Word shows them as real,
editable equations (not images), with proper fractions, overlines, subscripts,
n-ary sums/products, and radicals. Headings use Word heading styles; reference
links are real hyperlinks.

## Math handling details

For each equation the tool tries, in order:

1. **MathML** from the DOM (MathJax `mjx-assistive-mml`, KaTeX `.katex-mathml`, or native `<math>`)
   → converted to LaTeX and OMML. *(primary path on sci-bot)*
2. **Original TeX** annotation (`annotation[encoding="application/x-tex"]`, `script[type=math/tex]`, `data-latex`)
   → LaTeX used directly for `.md`; a compact LaTeX→OMML parser for `.docx`.
3. **Text fallback** — `NFKC` normalization + combining-mark repair (e.g. `C̄` → `\overline{C}`).

Supported structures: fractions, super/subscripts, sub+sup, square roots and nth roots,
overline/bar and accents (hat/vec/tilde/dot), n-ary operators with limits (∑ ∏ ∫ …),
fenced/delimiters, and matrices. If a region falls back to text, the toast shows a count
so you know to spot-check it.

## Tuning

If sci-bot changes its markup, adjust the selectors at the top of the script in `CONFIG`
(`answerSelectors`, `ignoreSelectors`). Everything else keys off standard MathML/TeX.

## Development / tests

```powershell
npm install          # installs jszip + jsdom (dev/test only)
node test.js         # 25 unit tests (converters, markdown, docx package)
node test-e2e.js     # end-to-end against a simulated sci-bot answer DOM
```

Both suites also emit `sample-output.docx` / `sample-ktv.docx` you can open in Word to inspect.

## Notes & limitations

- The tool cannot modify sci-bot itself; it adds export **client-side** in your browser.
- It reads only what's already rendered on the page you have open.
- sci-bot associates with Sci-Hub; downloading paywalled papers via those DOI links may
  carry legal/copyright implications in your jurisdiction. This tool only exports the
  on-page answer text and math — it does not fetch papers.
- Extremely exotic MathML constructs not listed above fall back to a best-effort text run.
