// One-off helper (Phase 2 of staff languages): wraps the English text in .tsx pages in t("…").
//   node scripts/i18n-wrap.mjs <file.tsx> [...more]
// JSX text runs (with the values between them) become one t("… {name} …", { name: value }) each;
// text-like string attributes (placeholder, aria-label, title, label, confirm, empty) become t("…").
// It never adds `t` to scope: the type checker then points at every function that needs it.
// Review the diff afterwards: it's a starting point, not the final word.
import fs from "node:fs";
import ts from "typescript";

const ATTRS = new Set(["placeholder", "aria-label", "title", "alt", "label", "confirm", "empty", "data-pending-label"]);
const wordy = (s) => /[A-Za-z]{2,}/.test(s) && !/@|https?:|^\/|^[a-z_]+$/.test(s.trim());
const decode = (s) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function containsJsx(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

// Values that can sit inside a sentence: names, properties, calls (not conditions or template strings).
function simpleValue(e) {
  return ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isCallExpression(e) || ts.isElementAccessExpression(e) ||
    ts.isNonNullExpression(e) || ts.isNumericLiteral(e);
}

function placeholderName(expr, used, src) {
  let base = "v";
  if (ts.isIdentifier(expr)) base = expr.text;
  else if (ts.isPropertyAccessExpression(expr)) base = expr.name.text;
  else if (ts.isCallExpression(expr)) {
    const c = expr.expression;
    base = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "v";
  }
  base = base.replace(/[^A-Za-z0-9_]/g, "") || "v";
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}${i}`;
  used.add(name);
  return name;
}

function wrapFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

  const handleChildren = (children) => {
    let run = [];
    const flush = () => {
      if (!run.some((c) => ts.isJsxText(c) && wordy(c.getText(sf)))) {
        run = [];
        return;
      }
      const used = new Set();
      const vars = [];
      let tpl = "";
      const raw = (c) => text.slice(c.pos, c.end); // JsxText with its leading spaces
      for (const c of run) {
        if (ts.isJsxText(c)) tpl += decode(raw(c));
        else if (ts.isStringLiteral(c.expression)) tpl += c.expression.text;
        else {
          const name = placeholderName(c.expression, used, sf);
          vars.push(`${name}: ${c.expression.getText(sf)}`);
          tpl += `{${name}}`;
        }
      }
      const key = tpl.replace(/\s+/g, " ").trim();
      if (!key) {
        run = [];
        return;
      }
      const call = `{t(${JSON.stringify(key)}${vars.length ? `, { ${vars.join(", ")} }` : ""})}`;
      const first = run[0];
      const lastNode = run[run.length - 1];
      // Keep the whitespace around the run as it was: line breaks stay line breaks (with their
      // indentation); a plain space next to an element becomes {" "}.
      const headWs = ts.isJsxText(first) ? raw(first).match(/^\s*/)[0] : "";
      const tailWs = ts.isJsxText(lastNode) ? raw(lastNode).match(/\s*$/)[0] : "";
      const head = headWs.includes("\n") ? headWs : headWs ? '{" "}' : "";
      const tail = tailWs.includes("\n") ? tailWs : tailWs ? '{" "}' : "";
      edits.push({ start: first.pos, end: lastNode.end, text: head + call + tail });
      run = [];
    };
    for (const c of children) {
      const textual =
        (ts.isJsxText(c) && !c.containsOnlyTriviaWhiteSpaces) ||
        (ts.isJsxExpression(c) && c.expression && !containsJsx(c.expression) && simpleValue(c.expression));
      const spaceLiteral = ts.isJsxExpression(c) && c.expression && ts.isStringLiteral(c.expression) && c.expression.text.trim() === "";
      if (textual || (spaceLiteral && run.length)) run.push(c);
      else flush();
    }
    flush();
  };

  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(sf) : "";
      if (!["code", "pre", "style", "script"].includes(tag)) handleChildren(node.children);
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf);
      if (ATTRS.has(name) && wordy(node.initializer.text)) {
        edits.push({ start: node.initializer.getStart(sf), end: node.initializer.getEnd(), text: `{t(${JSON.stringify(node.initializer.text)})}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  edits.sort((a, b) => b.start - a.start);
  let out = text;
  let last = Infinity;
  for (const e of edits) {
    if (e.end > last) continue; // overlapping (nested) edit: keep the inner one already applied
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    last = e.start;
  }
  fs.writeFileSync(file, out);
  return edits.length;
}

for (const f of process.argv.slice(2)) console.log(f, wrapFile(f));
