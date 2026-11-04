import type { ReactElement } from 'react';
import type { Coords } from '@/lib/geo';

export type CourierMapProps = {
  courier: Coords;
  /** Bilinmiyorsa yalnızca kurye işaretlenir. */
  destination: Coords | null;
  /** "Kurye 1,2 km uzakta · 20 sn önce" */
  line: string;
  /** Harita üstündeki düğmelerin kapladığı yükseklik. */
  topInset: number;
};

/** Metro CourierMap.native.tsx ya da CourierMap.web.tsx dosyasını seçer; bu dosya yalnızca tür içindir. */
export function CourierMap(props: CourierMapProps): ReactElement;
