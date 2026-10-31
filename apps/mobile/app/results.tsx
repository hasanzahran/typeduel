import { useLocalSearchParams } from 'expo-router';
import { ReleaseScreen } from '../src/components/ui';
import { ResultsScreen } from '../src/features/match/ResultsScreen';

const Preview = __DEV__ ? require('../src/dev/preview').Results : ReleaseScreen;
export default function ResultsRoute() {
  const params = useLocalSearchParams();
  return params.live === '1' ? <ResultsScreen /> : <Preview />;
}
