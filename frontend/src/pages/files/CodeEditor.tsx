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
import { StreamLanguage } from '@codemirror/language';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import type { Extension } from '@codemirror/state';

/**
 * key=value files (.properties, and the INI-style .cfg, .conf, .ini, .env).
 * The stock properties mode only marks comments and sections; this one also
 * tells keys from values, so the editor themes colour them as in TOML.
 * Forge's "B:enableFeature=true" keeps its type prefix in the key: a line
 * with "=" splits there, otherwise at the first ":".
 */
const keyValue = StreamLanguage.define<{ inValue: boolean }>({
  name: 'properties',
  startState: () => ({ inValue: false }),
  token(stream, state) {
    if (stream.sol()) state.inValue = false;
    if (stream.eatSpace()) return null;

    if (state.inValue) {
      stream.skipToEnd();
      const value = stream.current().trim();
      if (/^(true|false|yes|no|on|off)$/i.test(value)) return 'bool';
      if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
      return 'string';
    }

    const rest = stream.string.slice(stream.pos);
    if (/^[#!;]/.test(rest) && stream.string.slice(0, stream.pos).trim() === '') {
      stream.skipToEnd();
      return 'comment';
    }
    if (rest.startsWith('[')) {
      stream.skipToEnd();
      return 'heading';
    }
    if (rest[0] === '=' || rest[0] === ':') {
      stream.next();
      state.inValue = true;
      return 'operator';
    }
    const separator = rest.includes('=') ? /[^=]/ : /[^:=\s]/;
    if (stream.eatWhile(separator)) {
      // Trailing spaces before "=" are not part of the key.
      stream.backUp(stream.current().length - stream.current().trimEnd().length);
      return 'propertyName';
    }
    stream.next();
    return null;
  },
});

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
  if (/\.(properties|cfg|conf|ini|env)$/.test(ext)) return [keyValue];
  if (/\.ya?ml$/.test(ext)) return [StreamLanguage.define(yaml)];
  if (ext === '.toml') return [StreamLanguage.define(toml)];
  if (/\.(sh|bash|zsh)$/.test(ext)) return [StreamLanguage.define(shell)];
  // JSON5 is JSON with comments, trailing commas and unquoted keys: JavaScript highlighting reads it best.
  if (ext === '.json5') return [javascript()];
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
