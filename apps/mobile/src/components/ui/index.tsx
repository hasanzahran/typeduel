import type { PropsWithChildren, ComponentProps } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, tokens } from '../../theme';

export function Text({ style, ...props }: ComponentProps<typeof NativeText>) {
  return <NativeText {...props} style={[styles.text, style]} />;
}
export function Icon({
  name,
  color = colors.textSecondary,
  size = 22,
}: {
  name: ComponentProps<typeof Ionicons>['name'];
  color?: string;
  size?: number;
}) {
  return <Ionicons name={name} size={size} color={color} accessible={false} />;
}
export function Screen({
  children,
  keyboard = false,
}: PropsWithChildren<{ keyboard?: boolean }>) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {keyboard ? (
          <View style={[styles.content, { flex: 1, gap: 12 }]}>{children}</View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scroll}
          >
            <View style={styles.content}>{children}</View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        compact && { paddingHorizontal: 16 },
        (disabled || pressed) && { opacity: 0.55 },
      ]}
    >
      <Text
        style={[styles.buttonText, secondary && { color: colors.textPrimary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function SelectableChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      style={[
        styles.chip,
        selected && {
          backgroundColor: colors.accent,
          borderColor: colors.accent,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? colors.accentText : colors.textPrimary,
          fontWeight: selected ? '700' : '400',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function SegmentedModeControl({
  value,
  onChange,
}: {
  value: 'classic' | 'challenge';
  onChange: (value: 'classic' | 'challenge') => void;
}) {
  return (
    <View
      style={styles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel="Game mode"
    >
      {(['classic', 'challenge'] as const).map((mode) => (
        <Pressable
          key={mode}
          accessibilityRole="radio"
          accessibilityLabel={mode === 'classic' ? 'Classic' : 'Challenge'}
          accessibilityState={{ checked: mode === value }}
          aria-checked={mode === value}
          onPress={() => onChange(mode)}
          style={[
            styles.mode,
            mode === value && { borderColor: colors.accent },
          ]}
        >
          <Icon
            name={mode === 'classic' ? 'flash-outline' : 'trending-up-outline'}
            size={28}
            color={mode === value ? colors.accent : colors.textSecondary}
          />
          <Text style={{ fontWeight: '700' }}>
            {mode === 'classic' ? 'Classic' : 'Challenge'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function Scoreline({
  you,
  opponent,
  name,
}: {
  you: number;
  opponent: number;
  name: string;
}) {
  return (
    <View
      style={[styles.row, { justifyContent: 'center', gap: 28 }]}
      accessibilityLabel={`You ${you}, ${name} ${opponent}`}
      accessible
    >
      <View style={styles.center}>
        <Text style={styles.muted}>You</Text>
        <Text style={[styles.score, { color: colors.accent }]}>{you}</Text>
      </View>
      <Text style={[styles.heading, styles.muted]}>—</Text>
      <View style={styles.center}>
        <Text style={styles.muted}>{name}</Text>
        <Text style={styles.score}>{opponent}</Text>
      </View>
    </View>
  );
}
export function Timer({
  seconds,
  label,
  compact = false,
}: {
  seconds: number;
  label: string;
  compact?: boolean;
}) {
  const display = `00:${Math.max(0, Math.floor(seconds)).toString().padStart(2, '0')}`;
  return (
    <View
      style={
        compact ? [styles.row, { justifyContent: 'center' }] : styles.center
      }
    >
      <Text style={[styles.timer, compact && { fontSize: 32 }]}>{display}</Text>
      <Text style={[styles.muted, compact && { flexShrink: 1, fontSize: 14 }]}>
        {label}
      </Text>
    </View>
  );
}
export function AudioReplayButton({
  remaining,
  enabled,
  onPress,
}: {
  remaining: number;
  enabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.center}>
      <Button
        secondary
        compact
        label="Replay"
        disabled={!enabled || remaining === 0}
        onPress={onPress}
      />
      <Text style={styles.caption}>{remaining} replays left</Text>
    </View>
  );
}
export function TypingComposer({
  value,
  onChange,
  onSubmit,
  enabled,
  attempts,
  pending = false,
}: {
  value: string;
  onChange: (text: string) => void;
  onSubmit: () => void;
  enabled: boolean;
  attempts: number;
  pending?: boolean;
}) {
  const canSubmit =
    enabled && attempts > 0 && !pending && value.trim().length > 0;
  return (
    <View style={{ gap: 8 }}>
      <TextInput
        accessibilityLabel="Your spelling"
        placeholder="Type the word…"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        editable={enabled && attempts > 0 && !pending}
        autoCorrect={false}
        spellCheck={false}
        autoCapitalize="none"
        contextMenuHidden
        keyboardAppearance="dark"
        maxLength={120}
        returnKeyType="send"
        onSubmitEditing={() => {
          if (canSubmit) onSubmit();
        }}
        blurOnSubmit={false}
      />
      <Button
        label={pending ? 'Checking…' : 'Submit'}
        onPress={onSubmit}
        disabled={!canSubmit}
      />
      <Text style={[styles.caption, { textAlign: 'center' }]}>
        {attempts === 0 ? 'No attempts left' : `${attempts} attempts left`}
      </Text>
    </View>
  );
}
export function MatchStatus({ message }: { message: string }) {
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.caption, { textAlign: 'center' }]}
    >
      {message}
    </Text>
  );
}
export function ReleaseScreen() {
  return (
    <Screen>
      <View style={[styles.center, { paddingVertical: 64 }]}>
        <Text style={styles.display}>TypeDuel</Text>
        <Text style={styles.muted}>Fast word battles</Text>
        <Text style={{ textAlign: 'center' }}>
          The game is not available yet.
        </Text>
      </View>
    </Screen>
  );
}
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1 },
  content: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 24,
  },
  text: { color: colors.textPrimary, fontSize: tokens.typography.body },
  muted: { color: colors.textSecondary },
  caption: {
    fontSize: tokens.typography.label,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  display: {
    fontSize: tokens.typography.display,
    fontWeight: '800',
    letterSpacing: -1,
  },
  heading: { fontSize: tokens.typography.heading, fontWeight: '700' },
  label: { fontSize: 14, color: colors.textSecondary, letterSpacing: 1.5 },
  center: { alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: tokens.radii.card,
    padding: 20,
    gap: 12,
  },
  button: {
    minHeight: 56,
    backgroundColor: colors.accent,
    borderRadius: tokens.radii.button,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: {
    color: colors.accentText,
    fontWeight: '700',
    fontSize: 18,
    textAlign: 'center',
  },
  chip: {
    minHeight: 48,
    borderRadius: tokens.radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 20,
    paddingVertical: 12,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  mode: {
    flex: 1,
    minHeight: 100,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  score: { fontSize: 40, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timer: {
    fontSize: tokens.typography.timer,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: tokens.radii.input,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
