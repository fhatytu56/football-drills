import type { Metadata } from 'next';
import GameApp from '@/components/game/GameApp';

export const metadata: Metadata = {
  title: 'Wayside Celtic — U10 Manager',
  robots: { index: false, follow: false },
};

export default function GamePage({ params }: { params: { token: string } }) {
  return <GameApp token={params.token} />;
}
