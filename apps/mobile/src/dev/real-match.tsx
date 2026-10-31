import { useEffect, useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, MatchStatus, Screen, Text, styles } from '../components/ui';
import { colors } from '../theme';
import { apiBaseUrl } from '../api/client';
import { SupabaseSessionProvider } from '../auth/supabase-session';
import { MatchRuntime, setActiveMatchRuntime } from '../features/match/runtime';

export function RealMatchLauncher() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(
    'Sign in with one approved test user per phone.',
  );
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<MatchRuntime | null>(null);
  const [, render] = useState(0);
  const provider = useMemo(() => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    return url && key ? new SupabaseSessionProvider(url, key) : null;
  }, []);
  useEffect(() => {
    if (!runtime) return;
    return runtime.subscribe(() => render((value) => value + 1));
  }, [runtime]);
  useEffect(() => {
    if (runtime?.view.snapshot)
      router.replace({ pathname: '/game', params: { live: '1' } });
  }, [router, runtime?.view.snapshot?.matchId]);
  useEffect(
    () => () => {
      if (!runtime?.view.snapshot) runtime?.dispose();
    },
    [runtime],
  );
  const admission = runtime?.view.session?.admission;
  return (
    <Screen>
      <Text style={[styles.heading, { textAlign: 'center' }]}>
        Physical pair playtest
      </Text>
      <Text style={[styles.caption, { textAlign: 'center' }]}>
        Development credentials stay in memory and are cleared on restart.
      </Text>
      {!provider ? (
        <MatchStatus message="Public Supabase configuration is missing." />
      ) : null}
      {!runtime ? (
        <View style={{ gap: 12 }}>
          <TextInput
            accessibilityLabel="Test user email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="Test user email"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            accessibilityLabel="Test user password"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            value={password}
            onChangeText={setPassword}
          />
          <Button
            label={busy ? 'Signing in…' : 'Sign in and find match'}
            disabled={!provider || busy || !email || !password}
            onPress={() => {
              if (!provider) return;
              setBusy(true);
              setMessage('Signing in…');
              void provider
                .signIn(email, password)
                .then(async () => {
                  setPassword('');
                  const next = new MatchRuntime(apiBaseUrl(), provider);
                  setActiveMatchRuntime(next);
                  setRuntime(next);
                  try {
                    await next.start();
                    await next.joinDevelopmentQueue();
                    setMessage('Waiting for another approved test user…');
                  } catch (error) {
                    next.dispose();
                    setActiveMatchRuntime(null);
                    setRuntime(null);
                    throw error;
                  }
                })
                .catch(() => setMessage('Sign-in or matchmaking failed.'))
                .finally(() => setBusy(false));
            }}
          />
        </View>
      ) : admission?.kind === 'lobby' ? (
        <Button
          label="Ready"
          onPress={() => {
            setBusy(true);
            void runtime.lobby
              .ready(admission.lobby.lobbyId, true)
              .catch(() => setMessage('Ready was not confirmed.'))
              .finally(() => setBusy(false));
          }}
          disabled={busy}
        />
      ) : null}
      <MatchStatus message={message} />
    </Screen>
  );
}
