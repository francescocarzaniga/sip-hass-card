const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

// RNNoise runs in an AudioWorklet and loads its WASM at call time, so these
// are served as separate static files next to sip_core.js instead of being
// bundled into the module every Home Assistant page loads.
const rnnoiseDist = path.dirname(require.resolve('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js'));
// Same for WebRTC's AEC3 echo canceller (software_echo_cancellation)
const apmDir = path.dirname(require.resolve('@ai-ecoverse/wasm-webrtc-audio-processing/package.json'));

module.exports = (env, argv) => ({
  entry: {
    sip_core: './src/index.ts',
    // Runs in an AudioWorkletGlobalScope, loaded with audioWorklet.addModule()
    'aec-worklet': './src/aec-worklet.ts',
  },
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
    filename: '[name].js',
    path: path.resolve(__dirname, 'custom_components', 'sip_core', 'www'),
    // The worklet scope has neither `window` nor `self`, nor a document to derive a public path from
    globalObject: 'globalThis',
    publicPath: '',
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: path.join(rnnoiseDist, 'workletProcessor.js'), to: 'rnnoise-worklet.js' },
        { from: path.join(rnnoiseDist, '..', 'rnnoise.wasm'), to: 'rnnoise.wasm' },
        { from: path.join(rnnoiseDist, '..', 'rnnoise_simd.wasm'), to: 'rnnoise_simd.wasm' },
        { from: path.join(apmDir, 'dist', 'webrtc-audio-processing.wasm'), to: 'webrtc-apm.wasm' },
        { from: path.join(apmDir, 'LICENSE'), to: 'webrtc-apm.LICENSE.txt' },
        { from: path.join(apmDir, 'THIRD-PARTY-NOTICES.md'), to: 'webrtc-apm.THIRD-PARTY-NOTICES.md' },
      ],
    }),
  ],
});
