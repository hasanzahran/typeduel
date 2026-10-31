import { useLocalSearchParams } from 'expo-router';
import { ReleaseScreen } from '../src/components/ui';
import { GameScreen } from '../src/features/match/GameScreen';

const Preview = __DEV__ ? require('../src/dev/preview').Game : ReleaseScreen;
export default function GameRoute() {
  const params = useLocalSearchParams();
  return params.live === '1' ? <GameScreen /> : <Preview />;
}
