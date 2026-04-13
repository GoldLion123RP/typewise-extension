const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const LodashPlugin = require('lodash-webpack-plugin');

const target = process.env.TARGET || 'chrome';
const manifestSource = target === 'firefox' ? 'manifest.firefox.json' : 'manifest.json';

module.exports = {
  entry: {
    popup: './src/popup/popup.ts',
    options: './src/options/options.ts',
    background: './src/background/background.ts',
    content: './src/content/content.ts'
  },
  output: {
    path: path.resolve(__dirname, `dist/${target}`),
    filename: '[name].js',
    clean: true
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg)$/,
        type: 'asset/resource',
        generator: {
          filename: 'assets/icons/[name][ext]'
        }
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@types': path.resolve(__dirname, 'src/types')
    }
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.GITHUB_CLIENT_ID': JSON.stringify(process.env.GITHUB_CLIENT_ID || ''),
    }),
    new MiniCssExtractPlugin({
      filename: '[name].css'
    }),
    new CopyPlugin({
      patterns: [
        { 
          from: manifestSource,
          to: 'manifest.json'
        },
        { 
          from: 'assets',
          to: 'assets',
          noErrorOnMissing: true
        },
        {
          from: 'src/styles/common.css',
          to: 'styles/common.css',
          noErrorOnMissing: true
        },
        {
          from: 'src/popup/popup.css',
          to: 'popup/popup.css',
          noErrorOnMissing: true
        },
        {
          from: 'src/options/options.css',
          to: 'options/options.css',
          noErrorOnMissing: true
        }
      ]
    }),
    new HtmlPlugin({
      template: './src/popup/popup.html',
      filename: 'popup/popup.html',
      chunks: ['popup'],
      inject: 'body'
    }),
    new HtmlPlugin({
      template: './src/options/options.html',
      filename: 'options/options.html',
      chunks: ['options'],
      inject: 'body'
    }),
new LodashPlugin({
      lodashTemplate: false
    })
  ],
  
  // Disable performance warnings for browser extensions
  performance: {
    hints: false
  },
  
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  devtool: process.env.NODE_ENV === 'production' ? false : 'inline-source-map'
};