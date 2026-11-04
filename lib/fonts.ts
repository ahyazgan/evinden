import { useFonts } from 'expo-font';
import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
  Figtree_900Black,
} from '@expo-google-fonts/figtree';

export function useAppFonts() {
  return useFonts({
    'Figtree-Regular': Figtree_400Regular,
    'Figtree-Medium': Figtree_500Medium,
    'Figtree-SemiBold': Figtree_600SemiBold,
    'Figtree-Bold': Figtree_700Bold,
    'Figtree-ExtraBold': Figtree_800ExtraBold,
    'Figtree-Black': Figtree_900Black,
    'Bricolage-ExtraBold': BricolageGrotesque_800ExtraBold,
  });
}

/** Marka yazı tipleri: metin Figtree, başlık Bricolage Grotesque */
export const fonts = {
  regular: 'Figtree-Regular',
  medium: 'Figtree-Medium',
  semibold: 'Figtree-SemiBold',
  bold: 'Figtree-Bold',
  extrabold: 'Figtree-ExtraBold',
  black: 'Figtree-Black',
  display: 'Bricolage-ExtraBold',
} as const;
