import { Stack } from 'expo-router';

import { colors } from '@/constants/theme';
import { centeredScene, useResponsive } from '@/lib/responsive';

export default function AuthGroupLayout() {
  const { isDesktop } = useResponsive();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: [{ backgroundColor: colors.background }, isDesktop && centeredScene(480)] as any,
        animation: 'slide_from_right',
      }}
    />
  );
}
