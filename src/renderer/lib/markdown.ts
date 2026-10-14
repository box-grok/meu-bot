import { marked, type Tokens } from "../vendor/marked.esm.js";
import DOMPurify from "../vendor/purify.es.mjs";
import hljs from "../vendor/hljs-core.js";
import bash from "../vendor/hljs/bash.js";
import shell from "../vendor/hljs/shell.js";
import javascript from "../vendor/hljs/javascript.js";
import typescript from "../vendor/hljs/typescript.js";
import json from "../vendor/hljs/json.js";
import python from "../vendor/hljs/python.js";
import markdown from "../vendor/hljs/markdown.js";
import yaml from "../vendor/hljs/yaml.js";
import sql from "../vendor/hljs/sql.js";
import diff from "../vendor/hljs/diff.js";

const LANGUAGES = { bash, shell, javascript, typescript, json, python, markdown, yaml, sql, diff } as const;
const ALIASES: Record<string, keyof typeof LANGUAGES> = {
  sh: "bash", zsh: "bash", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript",
  py: "python", md: "markdown", yml: "yaml", console: "shell", shellsession: "shell", jsonc: "json",
};

let ready = false;
function ensureLanguages(): void {
  if (ready) return;
  for (const [name, grammar] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, grammar);
  ready = true;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function highlight(code: string, lang: string): { html: string; language: string } {
  ensureLanguages();
  const key = lang.toLowerCase();
  const name = key in LANGUAGES ? (key as keyof typeof LANGUAGES) : ALIASES[key];
  if (name !== undefined) return { html: hljs.highlight(code, { language: name }).value, language: name };
  if (key === "") {
    const auto = hljs.highlightAuto(code, Object.keys(LANGUAGES));
    if (auto.language !== undefined && (auto.relevance ?? 0) >= 5) return { html: auto.value, language: auto.language };
  }
  return { html: escapeHtml(code), language: key || "texto" };
}

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: Tokens.Code): string => {
  const { html, language } = highlight(text, lang ?? "");
  return `<div class="code-block" data-lang="${escapeHtml(language)}"><div class="code-head"><span>${escapeHtml(language)}</span><button type="button" class="btn-copy">Copiar</button></div><pre><code class="hljs language-${escapeHtml(language)}">${html}</code></pre></div>\n`;
};
marked.setOptions({ gfm: true, breaks: true, renderer });

const SAFE_HREF = /^https?:\/\//i;

/** Markdown do modelo → fragmento DOM sanitizado. Nunca usar innerHTML com texto cru. */
export function renderMarkdown(text: string): DocumentFragment {
  const html = marked.parse(text, { async: false }) as string;
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ["img", "style", "svg", "math", "form", "input"],
    FORBID_ATTR: ["style", "onerror", "onload"],
    ADD_ATTR: ["target"],
  });
  for (const a of fragment.querySelectorAll("a")) {
    const href = a.getAttribute("href") ?? "";
    if (!SAFE_HREF.test(href)) {
      const span = document.createElement("span");
      span.textContent = a.textContent;
      a.replaceWith(span);
      continue;
    }
    a.setAttribute("rel", "noreferrer noopener");
    a.setAttribute("target", "_blank");
  }
  return fragment;
}
