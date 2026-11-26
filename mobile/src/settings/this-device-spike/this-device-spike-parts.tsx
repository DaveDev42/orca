import { Pressable, Switch, Text, View } from 'react-native'
import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import type { SpikeStatus } from './spike-tests'

export function badgeStyle(status: SpikeStatus) {
  switch (status) {
    case 'pass':
      return styles.badgePass
    case 'fail':
      return styles.badgeFail
    case 'running':
      return styles.badgeRunning
    case 'idle':
    case 'skip':
      return styles.badgeIdle
  }
}

export function ToggleRow({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  )
}

export function Button({
  label,
  onPress,
  disabled = false
}: {
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed
      ]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  )
}

export const styles = themedStyleSheet(() => ({
  note: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm
  },
  warn: {
    color: colors.statusAmber,
    fontSize: typography.metaSize,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs
  },
  toggleLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    marginRight: spacing.md
  },
  webFrame: {
    height: 300,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    borderRadius: radii.control,
    overflow: 'hidden',
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  web: { flex: 1 },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg
  },
  urlInput: {
    flex: 1,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radii.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.bodySize
  },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, margin: spacing.lg },
  button: {
    backgroundColor: colors.bgRaised,
    borderRadius: radii.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start'
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  testCard: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.control,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm
  },
  testHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  testTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  badge: { fontSize: typography.metaSize, fontWeight: '700' },
  badgePass: { color: colors.statusGreen },
  badgeFail: { color: colors.statusRed },
  badgeRunning: { color: colors.statusAmber },
  badgeIdle: { color: colors.textMuted },
  detail: { color: colors.textSecondary, fontSize: typography.metaSize },
  heading: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700',
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg
  },
  mono: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: 10,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm
  }
}))
