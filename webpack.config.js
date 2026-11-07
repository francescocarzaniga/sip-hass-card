const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

// RNNoise runs in an AudioWorklet and loads its WASM at call time, so these
// are served as separate static files next to sip_core.js instead of being
// bundled into the module every Home Assistant page loads.
const rnnoiseDist = path.dirname(require.resolve('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js'));

module.exports = (env, argv) => ({
  entry: './src/index.ts',
  // Inline source maps are ~1.6 MB and would be embedded in the bundle that
  // every Home Assistant page loads, so keep them out of production builds.
  devtool: argv.mode === 'production' ? false : 'inline-source-map',
  mode: argv.mode || 'development',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: 'sip_core.js',
    path: path.resolve(__dirname, 'custom_components', 'sip_core', 'www'),
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: path.join(rnnoiseDist, 'workletProcessor.js'), to: 'rnnoise-worklet.js' },
        { from: path.join(rnnoiseDist, '..', 'rnnoise.wasm'), to: 'rnnoise.wasm' },
        { from: path.join(rnnoiseDist, '..', 'rnnoise_simd.wasm'), to: 'rnnoise_simd.wasm' },
      ],
    }),
  ],
});
