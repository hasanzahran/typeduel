import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AudioReplayButton,
  MatchStatus,
  Screen,
  Scoreline,
  Text,
  Timer,
  TypingComposer,
  styles,
} from '../../components/ui';
import { useMatchRuntime } from './runtime';

export function GameScreen() {
  const router = useRouter();
  const [runtime, view] = useMatchRuntime();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [nowTick, setNowTick] = useState(0);
  const [heldResult, setHeldResult] = useState(view.results.at(-1) ?? null);
  const snapshot = view.snapshot;

  useEffect(() => {
    const timer = setInterval(() => setNowTick((value) => value + 1), 250);
    return () => clearInterval(timer);
  }, []);
  const latestResult = view.results.at(-1) ?? null;
  useEffect(() => {
    if (!latestResult) return;
    setHeldResult(latestResult);
    const timer = setTimeout(() => setHeldResult(null), 1500);
    return () => clearTimeout(timer);
  }, [latestResult?.roundId]);
  useEffect(() => {
    if (snapshot?.phase === 'COMPLETED' || snapshot?.phase === 'ABORTED')
      router.replace({ pathname: '/results', params: { live: '1' } });
  }, [router, snapshot?.phase]);
  useEffect(() => {
    setText('');
    setPending(false);
  }, [snapshot?.roundNumber]);

  const scores = useMemo(() => {
    if (!snapshot) return { you: 0, opponent: 0 };
    const you = snapshot.participants.find(
      (participant) => participant.playerId === snapshot.viewer.playerId,
    );
    const opponent = snapshot.participants.find(
      (participant) => participant.playerId !== snapshot.viewer.playerId,
    );
    return { you: you?.score ?? 0, opponent: opponent?.score ?? 0 };
  }, [snapshot]);
  void nowTick;
  const remainingMs =
    snapshot && snapshot.phase === 'ACTIVE_TYPING'
      ? runtime.connection.clock.remaining(snapshot.round.schedule.deadlineAt)
      : null;
  const status =
    view.status !== 'ready'
      ? 'Connection lost. Reconnecting…'
      : view.audio.failure
        ? 'The word could not be played. This round will be interrupted.'
        : heldResult
          ? `Round ${heldResult.roundNumber}: ${heldResult.correctWord}`
          : snapshot?.phase === 'ACTIVE_TYPING'
            ? view.inputEnabled
              ? notice || 'Type the word you heard.'
              : 'Waiting for verified playback completion…'
            : snapshot?.phase === 'PLAYING_WORD'
              ? 'Listen carefully'
              : snapshot?.phase === 'COUNTDOWN'
                ? 'Get ready…'
                : 'Preparing reviewed audio…';

  if (!snapshot) {
    return (
      <Screen>
        <Text style={[styles.heading, { textAlign: 'center' }]}>
          Live Match
        </Text>
        <MatchStatus message="Waiting for a committed match…" />
      </Screen>
    );
  }
  return (
    <Screen keyboard>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 16, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.caption, { textAlign: 'center' }]}>
          Live match
        </Text>
        <Text style={[styles.caption, { textAlign: 'center' }]}>
          Round {snapshot.roundNumber} · Level {snapshot.currentLevel}
        </Text>
        <Scoreline
          you={scores.you}
          opponent={scores.opponent}
          name="Opponent"
        />
        <Timer
          seconds={remainingMs === null ? 0 : remainingMs / 1000}
          label={
            snapshot.phase === 'ACTIVE_TYPING'
              ? 'Time remaining'
              : 'Listen carefully'
          }
        />
        <AudioReplayButton
          remaining={view.audio.replaysRemaining}
          enabled={view.inputEnabled && !view.audio.replaying}
          onPress={() => {
            setNotice('');
            void runtime.audio
              .replay()
              .catch(() => setNotice('Replay could not be completed.'));
          }}
        />
        <MatchStatus message={status} />
        {snapshot.participants.some((participant) => !participant.connected) ? (
          <View style={styles.card}>
            <Text style={{ textAlign: 'center' }}>
              A player disconnected. The authoritative match clock is still
              running.
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <TypingComposer
        value={text}
        onChange={setText}
        enabled={view.inputEnabled}
        attempts={snapshot.viewer.attemptsRemaining}
        pending={pending}
        onSubmit={() => {
          if (!view.inputEnabled || pending) return;
          setPending(true);
          setNotice('Checking…');
          void runtime
            .submit(text)
            .then((ack) => {
              setText('');
              setNotice(
                ack.status === 'CORRECT'
                  ? 'Correct!'
                  : ack.status === 'INCORRECT'
                    ? `Not quite · ${ack.attemptsRemaining} attempts left`
                    : 'The round is no longer accepting answers.',
              );
            })
            .catch(() => setNotice('Submission was not confirmed. Try again.'))
            .finally(() => setPending(false));
        }}
      />
    </Screen>
  );
}
