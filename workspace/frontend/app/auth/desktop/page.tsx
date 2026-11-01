'use client';

import { useEffect, useState } from 'react';

import {
  DESKTOP_AUTH_PATH,
  forwardToDesktop,
  parseDesktopHandoff,
  type DesktopHandoff,
} from '@/lib/desktop-handoff';
import { useT, type MessageKey } from '@/lib/i18n';
import { API_URL, fetchAuthConfig, loadWorkspaceSession } from '@/lib/workspace-session';

/**
 * The desktop launcher's sign-in landing.
 *
 * The launcher opens this page with the loopback port it is listening on. From
 * here there are exactly two outcomes:
 *
 *  - a workspace session already exists on this origin → hand it to the port
 *  - none does → send the user through the central login, with this page as
 *    the returnTo, and take the first branch when they come back
 *
 * Deliberately an ordinary page rather than a branch of /auth/callback: the
 * central login mints its one-time token and bounces through the callback ON
 * THE WAY to returnTo, so a returnTo pointing at the callback is treated as the
 * final destination and no token is ever minted. Being a normal destination
 * keeps this on the same path every browser sign-in already takes.
 */

const CENTRAL = 'https://openagents.org';

/** Set once we have been through the login; a second empty return is a failure,
 *  not a reason to bounce again. */
const RETRY_FLAG = 'retried';

type Phase = 'working' | 'done' | 'failed';

/** A catalogue key, translated at render time, or a raw message from an Error. */
type ErrorMessage = { key: MessageKey } | { text: string };

function DesktopAuth() {
  const t = useT();
  const [phase, setPhase] = useState<Phase>('working');
  const [error, setError] = useState<ErrorMessage | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const handoff = parseDesktopHandoff(window.location.search);
    if (!handoff) {
      setPhase('failed');
      setError({ key: 'auth.desktopLinkInvalid' });
      return;
    }

    void (async () => {
      try {
        const config = await fetchAuthConfig();
        if (config.mode === 'oidc') {
          if (!config.oidc.enabled) throw new Error('Workspace sign-in is unavailable');
          const challenge = params.get('code_challenge');
          if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || params.get('code_challenge_method') !== 'S256') {
            throw new Error('Invalid desktop sign-in challenge');
          }
          const response = await fetch(`${API_URL}/v1/auth/desktop/handoff`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code_challenge: challenge, code_challenge_method: 'S256' }),
          });
          if (response.status === 401) {
            if (params.get(RETRY_FLAG)) throw new Error('Please restart desktop sign-in');
            const target = new URL(window.location.href);
            target.searchParams.set(RETRY_FLAG, '1');
            window.location.replace(`${API_URL}/v1/auth/oidc/login?return_to=${encodeURIComponent(target.href)}`);
            return;
          }
          const json = await response.json();
          if (!response.ok || !json.data?.code) throw new Error('Desktop sign-in was rejected');
          await forwardToDesktop(handoff, { code: json.data.code });
          setPhase('done');
          return;
        }
        legacySignIn(handoff);
      } catch (e) {
        setPhase('failed');
        setError(e instanceof Error ? { text: e.message } : { key: 'auth.desktopUnreachable' });
      }
    })();

    function legacySignIn(handoff: DesktopHandoff) {
    const session = loadWorkspaceSession();
    if (!session) {
      if (params.get(RETRY_FLAG)) {
        setPhase('failed');
        setError({ key: 'auth.desktopNoSession' });
        return;
      }
      window.location.replace(`${CENTRAL}/login?returnTo=${encodeURIComponent(returnUrl(handoff))}`);
      return;
    }

    void (async () => {
      try {
        await forwardToDesktop(handoff, {
          session: {
            token: session.token,
            email: session.email,
            displayName: session.displayName,
            expiresAt: session.expiresAt,
          },
        });
        setPhase('done');
      } catch (e) {
        setPhase('failed');
        setError(e instanceof Error ? { text: e.message } : { key: 'auth.desktopUnreachable' });
      }
    })();
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <img
          src="/logo-icon.png"
          alt="OpenAgents"
          className={`size-16 dark:hidden ${phase === 'working' ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''}`}
        />
        <img
          src="/logo-white.png"
          alt="OpenAgents"
          className={`size-16 hidden dark:block ${phase === 'working' ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''}`}
        />
        {phase === 'done' ? (
          // One line the user can read from across the room: they are done here.
          <h1 className="max-w-3xl px-8 text-center text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t('auth.desktopReturn')}
          </h1>
        ) : (
          <div className="text-center max-w-md px-8">
            <h1
              className={`text-xl font-semibold tracking-tight ${phase === 'failed' ? 'text-destructive' : ''}`}
            >
              {phase === 'failed' ? t('auth.signInFailed') : t('auth.signingIn')}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {error ? ('key' in error ? t(error.key) : error.text) : t('metadata.title')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** This page's own URL, marked so a fruitless round trip cannot loop. */
function returnUrl(handoff: DesktopHandoff): string {
  const url = new URL(DESKTOP_AUTH_PATH, window.location.origin);
  url.searchParams.set('port', String(handoff.port));
  url.searchParams.set('state', handoff.state);
  url.searchParams.set(RETRY_FLAG, '1');
  return url.href;
}

export default function DesktopAuthPage() {
  return <DesktopAuth />;
}
