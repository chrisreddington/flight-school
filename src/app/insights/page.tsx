import { redirect } from 'next/navigation';

/**
 * `/insights` was rolled into `/history?tab=stats`. Server-side redirect
 * avoids a flash-of-empty-page and shaves the route off the client bundle.
 */
export default function InsightsRedirect(): never {
  redirect('/history?tab=stats');
}
