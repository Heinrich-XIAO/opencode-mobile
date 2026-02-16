const createExpoWebpackConfigAsync = require('@expo/webpack-config');
const path = require('path');

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv);
  
  // Add alias for react-native to react-native-web
  config.resolve.alias = {
    ...config.resolve.alias,
    'react-native$': 'react-native-web',
    // Fix Platform import path for expo-modules-core
    'react-native-web/dist/exports/Platform': 'react-native-web/dist/vendor/react-native/Utilities/Platform',
  };
  
  return config;
};
