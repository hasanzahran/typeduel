import type { ExpoConfig } from 'expo/config';
const config: ExpoConfig = {
  name: 'TypeDuel',
  slug: 'typeduel',
  scheme: 'typeduel',
  version: '0.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  backgroundColor: '#0B1220',
  plugins: [
    'expo-router',
    [
      'expo-audio',
      {
        microphonePermission: false,
        recordAudioAndroid: false,
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ],
  ],
  ios: { supportsTablet: false },
  android: { softwareKeyboardLayoutMode: 'resize' },
  web: { bundler: 'metro', output: 'single', name: 'TypeDuel M0' },
};
export default config;
