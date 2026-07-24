import { redirect } from 'next/navigation';

// O MVP começa no Radar (descoberta → curadoria → modelagem).
export default function Home() {
  redirect('/radar');
}
