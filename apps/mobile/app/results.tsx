import { ReleaseScreen } from '../src/components/ui';
// Metro removes this branch and the entire preview module from release bundles.
const Screen = __DEV__ ? require('../src/dev/preview').Results : ReleaseScreen;
export default Screen;
