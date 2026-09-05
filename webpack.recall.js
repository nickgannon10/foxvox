import path from 'node:path';
import fs from 'node:fs';

export default {
  entry: Object.fromEntries(
    ['background', 'content', 'options', 'popup', 'demo'].map(name => [
      name,
      `./src/recall/${name}.ts`,
    ])
  ),
  output: { path: path.resolve('dist-recall-chrome'), filename: '[name].bundle.js', clean: true },
  devtool: false,
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: { loader: 'ts-loader', options: { configFile: 'tsconfig.recall.json' } },
        exclude: /node_modules/,
      },
      { test: /\.css$/, type: 'asset/source' },
    ],
  },
  resolve: { extensions: ['.ts', '.js'] },
  performance: { hints: false },
  plugins: [
    {
      apply(compiler) {
        compiler.hooks.afterEmit.tap('RecallAssets', () => {
          const dest = path.resolve('dist-recall-chrome');
          fs.copyFileSync('manifest.recall.json', path.join(dest, 'manifest.json'));
          for (const file of [
            'options.html',
            'options.css',
            'popup.html',
            'popup.css',
            'demo.html',
            'demo.css',
          ]) {
            fs.copyFileSync(path.join('src/recall', file), path.join(dest, file));
          }
          fs.cpSync('icons', path.join(dest, 'icons'), { recursive: true });
          fs.cpSync('node_modules/katex/dist/fonts', path.join(dest, 'fonts'), { recursive: true });
          fs.copyFileSync('LICENSE', path.join(dest, 'LICENSE'));
        });
      },
    },
  ],
};
