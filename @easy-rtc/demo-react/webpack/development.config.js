const { merge } = require('webpack-merge');
const baseConfig = require('./base.config');

module.exports = merge(baseConfig, {
  mode: 'development',
  devServer: {
    historyApiFallback: {
      index: '/easy-rtc/react',
    },
    open: '/easy-rtc/react',
  },
});
