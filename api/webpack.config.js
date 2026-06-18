const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  // Dependencies such as `stripe` ship source maps that point at `src/**/*.ts`
  // files they don't publish to npm, so source-map-loader can't resolve them.
  // The warnings are harmless — silence them for node_modules only.
  ignoreWarnings: [
    (warning) =>
      /Failed to parse source map/.test(warning.message) &&
      /node_modules/.test(warning.message),
  ],
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
