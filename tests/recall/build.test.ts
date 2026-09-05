/** @jest-environment node */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import { Script } from 'node:vm';

// Chrome's content-script validator rejects Unicode noncharacters in addition
// to malformed UTF-8. KaTeX's lexer includes U+FFFF as a character-range bound.
function firstNoncharacter(source: string): number | undefined {
  for (const character of source) {
    const codepoint = character.codePointAt(0) ?? 0;
    if ((codepoint >= 0xfdd0 && codepoint <= 0xfdef) || (codepoint & 0xffff) >= 0xfffe)
      return codepoint;
  }
  return undefined;
}

// Production goes last so running tests leaves a loadable production build.
it.each(['development', 'production'])(
  '%s bundles pass Chrome script encoding validation',
  mode => {
    execFileSync(
      process.execPath,
      [require.resolve('webpack-cli/bin/cli.js'), '--config', 'webpack.recall.js', '--mode', mode],
      { stdio: 'pipe' }
    );
    const directory = join(process.cwd(), 'dist-recall-chrome');
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    const files = readdirSync(directory).filter(file => file.endsWith('.js'));
    expect(files).toContain(manifest.content_scripts[0].js[0]);
    expect(files).toContain(manifest.background.service_worker);
    for (const file of files) {
      const bytes = readFileSync(join(directory, file));
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      expect({ file, noncharacter: firstNoncharacter(source) }).toEqual({
        file,
        noncharacter: undefined,
      });
      expect(() => new Script(source, { filename: file })).not.toThrow();
    }
  },
  30000
);
