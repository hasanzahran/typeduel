import { View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Button,
  Icon,
  MatchStatus,
  Screen,
  Scoreline,
  Text,
  styles,
} from '../../components/ui';
import { colors } from '../../theme';
import { setActiveMatchRuntime, useMatchRuntime } from './runtime';

export function ResultsScreen() {
  const router = useRouter();
  const [runtime, view] = useMatchRuntime();
  const snapshot = view.snapshot;
  if (
    !snapshot ||
    (snapshot.phase !== 'COMPLETED' && snapshot.phase !== 'ABORTED')
  )
    return (
      <Screen>
        <MatchStatus message="Waiting for the committed match outcome…" />
      </Screen>
    );
  const viewerId = snapshot.viewer.playerId;
  const completion =
    snapshot.phase === 'COMPLETED' ? snapshot.completion : null;
  const you = snapshot.participants.find(
    (player) => player.playerId === viewerId,
  )!;
  const opponent = snapshot.participants.find(
    (player) => player.playerId !== viewerId,
  )!;
  const title =
    snapshot.phase === 'ABORTED'
      ? 'Match interrupted'
      : completion!.draw
        ? 'Draw'
        : completion!.winnerId === viewerId
          ? 'You win!'
          : 'You lost';
  return (
    <Screen>
      <Text
        style={[styles.heading, { textAlign: 'center', paddingVertical: 12 }]}
      >
        Match Results
      </Text>
      <View style={[styles.center, { paddingVertical: 12 }]}>
        <Icon
          name={
            snapshot.phase === 'ABORTED'
              ? 'alert-circle-outline'
              : 'trophy-outline'
          }
          size={44}
          color={
            completion?.winnerId === viewerId
              ? colors.accent
              : colors.textSecondary
          }
        />
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.display, { textAlign: 'center' }]}
        >
          {title}
        </Text>
      </View>
      {snapshot.phase === 'ABORTED' ? (
        <Text style={{ textAlign: 'center' }}>
          The match could not finish. No win was awarded.
        </Text>
      ) : (
        <Scoreline you={you.score} opponent={opponent.score} name="Opponent" />
      )}
      <View style={styles.card}>
        <Text style={[styles.caption, { textAlign: 'center' }]}>
          {snapshot.setup.mode === 'classic' ? 'Classic' : 'Challenge'} ·
          General · {snapshot.roundNumber} rounds
        </Text>
        <Text style={[styles.caption, { textAlign: 'center' }]}>
          Performance statistics are unavailable.
        </Text>
      </View>
      <Button
        label="Back to playtest lobby"
        onPress={() => {
          runtime.dispose();
          setActiveMatchRuntime(null);
          router.replace('/playtest');
        }}
      />
    </Screen>
  );
}
