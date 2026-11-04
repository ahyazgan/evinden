import { Stack } from 'expo-router';

import { centeredScene, useResponsive } from '@/lib/responsive';
import { useTheme } from '@/lib/theme-context';

export default function AuthGroupLayout() {
  const { colors: t } = useTheme();
  const { isDesktop } = useResponsive();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: [{ backgroundColor: t.background }, isDesktop && centeredScene(480)] as any,
        animation: 'slide_from_right',
      }}
    />
  );
}
