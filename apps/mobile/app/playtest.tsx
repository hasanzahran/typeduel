import { ReleaseScreen } from '../src/components/ui';

const Screen = __DEV__
  ? require('../src/dev/real-match').RealMatchLauncher
  : ReleaseScreen;
export default Screen;
