import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { fonts } from '@/lib/fonts';
import { useTheme } from '@/lib/theme-context';
import { Badge, type BadgeVariant } from './Badge';
import { Button } from './Button';

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  const { colors: t } = useTheme();
  return (
    <View style={s.sectionHeader}>
      <View style={s.sectionCopy}>
        <Text accessibilityRole="header" style={[s.sectionTitle, { color: t.heading }]}>{title}</Text>
        {subtitle ? <Text style={[s.sectionSubtitle, { color: t.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function MetricCard({ label, value, hint, icon, variant = 'default', onPress }: {
  label: string;
  value: string;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: 'default' | 'accent' | 'warning' | 'danger';
  onPress?: () => void;
}) {
  const { colors: t } = useTheme();
  const color = variant === 'danger' ? t.danger : variant === 'warning' ? t.amber : variant === 'accent' ? t.success : t.text;
  const content = (
    <>
      <View style={s.metricTop}>
        <Text style={[s.metricLabel, { color: t.textSecondary }]}>{label}</Text>
        {icon ? <Ionicons name={icon} size={18} color={color} /> : null}
      </View>
      <Text style={[s.metricValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Text style={[s.metricHint, { color: t.textMuted }]} numberOfLines={2}>{hint}</Text> : null}
    </>
  );
  const style: StyleProp<ViewStyle> = [s.metric, { backgroundColor: t.surface, borderColor: t.surfaceBorder }];
  if (!onPress) return <View style={style}>{content}</View>;
  return <Pressable style={style} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>{content}</Pressable>;
}

export function SegmentedControl<T extends string | number>({ options, value, onChange }: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const { colors: t } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.segmentWrap}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            style={[s.segment, { backgroundColor: active ? t.brand : t.surface, borderColor: active ? t.brand : t.surfaceBorder }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[s.segmentText, { color: active ? t.onBrand : t.textSecondary }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function EmptyState({ title, description, icon = 'file-tray-outline', actionLabel, onAction }: {
  title: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors: t } = useTheme();
  return (
    <View style={s.empty}>
      <View style={[s.emptyIcon, { backgroundColor: t.background }]}>
        <Ionicons name={icon} size={28} color={t.textSecondary} />
      </View>
      <Text style={[s.emptyTitle, { color: t.heading }]}>{title}</Text>
      {description ? <Text style={[s.emptyText, { color: t.textSecondary }]}>{description}</Text> : null}
      {actionLabel && onAction ? <Button label={actionLabel} variant="outline" onPress={onAction} /> : null}
    </View>
  );
}

export function DetailRow({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' | 'success' }) {
  const { colors: t } = useTheme();
  const color = tone === 'danger' ? t.danger : tone === 'success' ? t.success : t.text;
  return (
    <View style={s.detailRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[s.detailLabel, { color: t.textSecondary }]}>{label}</Text>
      <Text style={[s.detailValue, { color }]}>{value}</Text>
    </View>
  );
}

export function ToolbarSearch({ value, onChangeText, placeholder = 'Ara' }: { value: string; onChangeText: (value: string) => void; placeholder?: string }) {
  const { colors: t } = useTheme();
  return (
    <View style={[s.toolbar, { backgroundColor: t.surface, borderColor: t.surfaceBorder }]}>
      <Ionicons name="search" size={18} color={t.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.textMuted}
        style={[s.toolbarInput, { color: t.text }]}
        accessibilityLabel={placeholder}
      />
      {value ? <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Aramayı temizle"><Ionicons name="close-circle" size={19} color={t.textMuted} /></Pressable> : null}
    </View>
  );
}

export function StatusPill({ label, variant }: { label: string; variant: BadgeVariant }) {
  return <Badge label={label} variant={variant} />;
}

const s = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontFamily: fonts.display },
  sectionSubtitle: { fontSize: 12, lineHeight: 17, fontFamily: fonts.regular, marginTop: 2 },
  metric: { flexBasis: '47%', flexGrow: 1, minWidth: 150, borderWidth: 1, borderRadius: 16, padding: 14, gap: 4 },
  metricTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metricLabel: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold },
  metricValue: { fontSize: 23, lineHeight: 29, fontFamily: fonts.display },
  metricHint: { fontSize: 11, lineHeight: 15, fontFamily: fonts.regular },
  segmentWrap: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  segment: { minHeight: 40, paddingHorizontal: 14, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 13, fontFamily: fonts.bold },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 42, paddingHorizontal: 24 },
  emptyIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 17, lineHeight: 23, fontFamily: fonts.display, textAlign: 'center' },
  emptyText: { fontSize: 13, lineHeight: 19, fontFamily: fonts.regular, textAlign: 'center', maxWidth: 360 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, minHeight: 42, paddingVertical: 9 },
  detailLabel: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: fonts.regular },
  detailValue: { flex: 1.4, fontSize: 13, lineHeight: 19, fontFamily: fonts.semibold, textAlign: 'right' },
  toolbar: { minHeight: 46, borderRadius: 13, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13 },
  toolbarInput: { flex: 1, minWidth: 0, fontSize: 14, fontFamily: fonts.regular, padding: 0 },
});

