// rollup.config.cjs
const typescript = require('@rollup/plugin-typescript');
const resolve = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const path = require('path');

module.exports = {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/index.cjs.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'auto'
    },
    {
      file: 'dist/index.esm.js',
      format: 'es',
      sourcemap: true
    }
  ],
  plugins: [
    resolve({
      extensions: ['.ts', '.js'],
      browser: true
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      tslib: path.resolve(__dirname, 'node_modules/tslib'),
      sourceMap: true,
      declaration: true,
      declarationDir: 'dist'
    })
  ],
  external: []
};