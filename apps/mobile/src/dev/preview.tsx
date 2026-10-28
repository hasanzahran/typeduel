import { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  MatchSetupSchema,
  QuickMatchSetupSchema,
  type Category,
  type Mode,
} from '@typeduel/contracts';
import {
  AudioReplayButton,
  Button,
  Icon,
  MatchStatus,
  Screen,
  Scoreline,
  SegmentedModeControl,
  SelectableChip,
  Text,
  Timer,
  TypingComposer,
  styles,
} from '../components/ui';
import { colors } from '../theme';
import { fetchHealth } from '../api/client';
import {
  categories,
  fixtureMarker,
  levels,
  sample,
  scenarios,
} from './fixtures';

function PreviewLabel() {
  return (
    <Text
      testID={fixtureMarker}
      style={{ fontSize: 12, color: colors.accent, textAlign: 'center' }}
    >
      Development preview · Mock data
    </Text>
  );
}
function Header({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        style={{ minWidth: 48, minHeight: 48, justifyContent: 'center' }}
      >
        <Icon name="chevron-back" />
      </Pressable>
      <Text style={[styles.heading, { flex: 1 }]}>{title}</Text>
    </View>
  );
}
function Metadata() {
  const params = useLocalSearchParams();
  const mode = params.mode === 'classic' ? 'Classic' : 'Challenge';
  const category =
    categories.find((c) => c.slug === params.categorySlug)?.label ?? 'Animals';
  return (
    <Text style={[styles.caption, { textAlign: 'center' }]}>
      {mode} · {category}
    </Text>
  );
}
export function Home() {
  const router = useRouter();
  const [empty, setEmpty] = useState(false);
  const [info, setInfo] = useState('');
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    enabled: false,
    retry: false,
  });
  return (
    <Screen>
      <PreviewLabel />
      <View style={[styles.center, { paddingVertical: 20 }]}>
        <Text style={[styles.display, { fontSize: 44 }]}>TypeDuel</Text>
        <Text style={[styles.muted, { fontSize: 20 }]}>Fast word battles</Text>
      </View>
      <View
        style={[styles.card, styles.row, { justifyContent: 'space-around' }]}
      >
        {[
          ['Wins', empty ? '0' : String(sample.wins)],
          ['Matches', empty ? '0' : String(sample.matches)],
          ['Win rate', empty ? '—' : sample.winRate],
        ].map(([label, value], i) => (
          <View key={label} style={styles.center}>
            <Text style={styles.caption}>{label}</Text>
            <Text
              style={{
                fontSize: 30,
                fontWeight: '700',
                color: i === 0 ? colors.accent : colors.textPrimary,
              }}
            >
              {value}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ gap: 12 }}>
        <Button
          label="Quick Match"
          onPress={() =>
            router.push({ pathname: '/setup', params: { kind: 'quick' } })
          }
        />
        <Button
          secondary
          label="Play with Friend"
          onPress={() =>
            router.push({ pathname: '/setup', params: { kind: 'friend' } })
          }
        />
      </View>
      <View style={{ gap: 12 }}>
        {(['Profile', 'How to Play', 'Settings'] as const).map((label, i) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() =>
              setInfo(
                label === 'How to Play'
                  ? 'Hear the word → Type it → Submit. Three attempts, two replays. Classic keeps your level; Challenge advances after a correct round.'
                  : `${label} is not available in M0.`,
              )
            }
            style={[styles.card, styles.row, { minHeight: 64 }]}
          >
            <Icon
              name={
                i === 0
                  ? 'person-outline'
                  : i === 1
                    ? 'help-circle-outline'
                    : 'settings-outline'
              }
            />
            <Text style={{ flex: 1 }}>{label}</Text>
            <Icon name="chevron-forward" size={18} />
          </Pressable>
        ))}
      </View>
      {info ? <MatchStatus message={info} /> : null}
      <Text style={[styles.caption, { textAlign: 'center' }]}>
        Classic and Challenge modes
      </Text>
      <View style={{ gap: 8 }}>
        <Button
          secondary
          label={empty ? 'Preview sample stats' : 'Preview empty stats'}
          onPress={() => setEmpty(!empty)}
        />
        <Button
          secondary
          label="Check local API"
          onPress={() => {
            void health.refetch();
          }}
        />
        <MatchStatus
          message={
            health.isFetching
              ? 'Checking API…'
              : health.isError
                ? 'API unavailable. Check the server and public API URL.'
                : health.data
                  ? 'Local API connected'
                  : 'Development tools · no account or matchmaking connection'
          }
        />
      </View>
    </Screen>
  );
}
export function Setup() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const friend = params.kind === 'friend';
  const [mode, setMode] = useState<Mode>('classic');
  const [category, setCategory] = useState<Category>('general');
  const [difficulty, setDifficulty] = useState(1);
  const [notice, setNotice] = useState('');
  const selection =
    mode === 'classic'
      ? { mode, categorySlug: friend ? category : 'general', difficulty }
      : { mode, categorySlug: friend ? category : 'general' };
  const parsed = (friend ? MatchSetupSchema : QuickMatchSetupSchema).safeParse(
    selection,
  );
  return (
    <Screen>
      <PreviewLabel />
      <Header title="Match Setup" />
      <View style={{ gap: 12 }}>
        <Text style={styles.label}>GAME MODE</Text>
        <SegmentedModeControl value={mode} onChange={setMode} />
      </View>
      <View style={{ gap: 12 }}>
        <Text style={styles.label}>CATEGORY</Text>
        {friend ? (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Category"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}
          >
            {categories.map((c) => (
              <SelectableChip
                key={c.slug}
                label={c.label}
                selected={c.slug === category}
                onPress={() => setCategory(c.slug)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.card}>
            <Text>General · All Words</Text>
            <Text style={styles.caption}>Quick Match always uses General.</Text>
          </View>
        )}
        {friend ? (
          <Text style={styles.caption}>
            Preview categories only. Word-pool availability is not connected.
          </Text>
        ) : null}
      </View>
      {mode === 'classic' ? (
        <View style={{ gap: 12 }}>
          <Text style={styles.label}>DIFFICULTY</Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Difficulty"
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
          >
            {levels.map((label, i) => (
              <SelectableChip
                key={label}
                label={`${i + 1} ${label}`}
                selected={difficulty === i + 1}
                onPress={() => setDifficulty(i + 1)}
              />
            ))}
          </View>
          <Text style={styles.caption}>
            Your selected level stays fixed throughout the match.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Icon name="trending-up-outline" color={colors.accent} />
          <Text>
            Starts at Level 1. Difficulty increases after a correct round.
          </Text>
        </View>
      )}
      <Button
        label={friend ? 'Create Invite' : 'Find Match'}
        disabled={!parsed.success}
        onPress={() =>
          setNotice(
            friend
              ? 'Invites are not connected in M0. Use Preview game to review the layout.'
              : 'Matchmaking is not connected in M0. Use Preview game to review the layout.',
          )
        }
      />
      {notice ? <MatchStatus message={notice} /> : null}
      <Button
        secondary
        label="Preview game"
        onPress={() => {
          if (parsed.success)
            router.push({ pathname: '/game', params: { ...parsed.data } });
        }}
      />
    </Screen>
  );
}
export function Game() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () =>
      setKeyboardVisible(true),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboardVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const state = scenarios[index] ?? 'typing';
  const enabled = state === 'typing' || state === 'incorrect';
  const attempts =
    state === 'exhausted'
      ? 0
      : state === 'incorrect' || state === 'pending'
        ? 2
        : 3;
  const level =
    params.mode === 'classic' ? String(params.difficulty ?? 1) : '2';
  const status =
    state === 'listening'
      ? 'Listen carefully · audio not connected'
      : state === 'pending'
        ? 'Checking… · preview only'
        : state === 'incorrect'
          ? 'Not quite · 2 attempts left'
          : state === 'reconnecting'
            ? 'Connection lost. Reconnecting… · preview only'
            : state === 'audio-error'
              ? 'Couldn’t play the word · preview only'
              : state === 'exhausted'
                ? 'No attempts left'
                : 'Static timer · no active match';
  return (
    <Screen keyboard>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 16, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <PreviewLabel />
        <Metadata />
        <Text style={[styles.caption, { textAlign: 'center' }]}>
          Round 2 of 5 · Level {level}
        </Text>
        <Scoreline
          you={sample.score.you}
          opponent={sample.score.opponent}
          name={sample.opponent}
        />
        {!keyboardVisible && (
          <Timer
            seconds={state === 'listening' ? 0 : 8}
            label={
              state === 'listening' ? 'Listen carefully' : 'Time remaining'
            }
          />
        )}
        <AudioReplayButton
          remaining={2}
          enabled={enabled}
          onPress={() => setNotice('Audio replay is not connected in M0.')}
        />
        <MatchStatus message={notice || status} />
        <View style={{ gap: 8 }}>
          <Button
            secondary
            compact
            label={`Preview state: ${state}`}
            onPress={() => {
              setIndex((index + 1) % scenarios.length);
              setNotice('');
              setText('');
            }}
          />
          <Button
            secondary
            compact
            label="Preview results"
            onPress={() => router.push({ pathname: '/results', params })}
          />
        </View>
      </ScrollView>
      {keyboardVisible && (
        <Timer
          compact
          seconds={state === 'listening' ? 0 : 8}
          label={
            state === 'listening' ? 'Listen carefully' : 'Time remaining · mock'
          }
        />
      )}
      <TypingComposer
        value={text}
        onChange={setText}
        enabled={enabled}
        attempts={attempts}
        pending={state === 'pending'}
        onSubmit={() =>
          setNotice('Submission preview only. No answer was checked or scored.')
        }
      />
    </Screen>
  );
}
export function Results() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const outcomes = [
    'You win!',
    'You lost',
    'Draw',
    'Match interrupted',
  ] as const;
  const outcome = outcomes[index] ?? outcomes[0];
  return (
    <Screen>
      <PreviewLabel />
      <Text
        style={[styles.heading, { textAlign: 'center', paddingVertical: 12 }]}
      >
        Match Results
      </Text>
      <View style={[styles.center, { paddingVertical: 12 }]}>
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon
            name={
              index === 0
                ? 'trophy-outline'
                : index === 3
                  ? 'alert-circle-outline'
                  : 'flag-outline'
            }
            size={44}
            color={index === 0 ? colors.accent : colors.textSecondary}
          />
        </View>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.display, { textAlign: 'center' }]}
        >
          {outcome}
        </Text>
      </View>
      {index === 3 ? (
        <Text style={{ textAlign: 'center' }}>
          The match could not finish. No win was awarded.
        </Text>
      ) : (
        <>
          <Scoreline
            you={index === 1 ? 1 : index === 2 ? 2 : sample.result.you}
            opponent={
              index === 1 ? 3 : index === 2 ? 2 : sample.result.opponent
            }
            name={sample.opponent}
          />
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {index === 0
              ? 'You beat Sam'
              : index === 1
                ? 'Sam won this match'
                : 'Tied after 3 tiebreakers'}
          </Text>
        </>
      )}
      <View style={styles.card}>
        <Metadata />
        <Text style={[styles.caption, { textAlign: 'center' }]}>
          Sample outcome only. Performance statistics are unavailable.
        </Text>
      </View>
      {index !== 3 ? (
        <Button
          label="Rematch"
          onPress={() =>
            setNotice(
              'Rematches are not connected in M0. No invitation was sent.',
            )
          }
        />
      ) : null}
      <Button
        secondary={index !== 3}
        label="Back Home"
        onPress={() => router.replace('/')}
      />
      {notice ? <MatchStatus message={notice} /> : null}
      <Button
        secondary
        label="Preview next outcome"
        onPress={() => {
          setIndex((index + 1) % outcomes.length);
          setNotice('');
        }}
      />
    </Screen>
  );
}
