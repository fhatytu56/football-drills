import type { Metadata } from 'next';
import RsvpForm from '@/components/RsvpForm';

export const metadata: Metadata = {
  title: 'Wayside Celtic — Can your child play?',
  robots: { index: false, follow: false },
};

export default function RsvpPage({ params }: { params: { token: string } }) {
  return <RsvpForm token={params.token} />;
}
