import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import type { Extension } from '@codemirror/state';

function languageFor(name: string): Extension[] {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();

  if (/\.(jsx?|mjs|cjs)$/.test(ext)) return [javascript()];
  if (/\.tsx?$/.test(ext)) return [javascript({ typescript: true, jsx: ext === '.tsx' })];
  if (ext === '.json') return [json()];
  if (/\.html?$/.test(ext)) return [html()];
  if (/\.(css|scss|less)$/.test(ext)) return [css()];
  if (ext === '.py') return [python()];
  if (/\.(md|markdown)$/.test(ext)) return [markdown()];
  if (ext === '.sql') return [sql()];
  if (/\.(xml|svg)$/.test(ext)) return [xml()];
  return [];
}

interface Props {
  name: string;
  value: string;
  readOnly: boolean;
  isDark: boolean;
  onChange: (value: string) => void;
}

const CodeEditor = ({ name, value, readOnly, isDark, onChange }: Props) => (
  <CodeMirror
    value={value}
    height="100%"
    theme={isDark ? oneDark : 'light'}
    extensions={languageFor(name)}
    editable={!readOnly}
    onChange={onChange}
    basicSetup={{ lineNumbers: true, highlightActiveLine: !readOnly, foldGutter: true }}
    className="h-full text-sm"
  />
);

export default CodeEditor;
