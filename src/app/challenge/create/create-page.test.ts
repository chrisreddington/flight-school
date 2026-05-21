import type { DailyChallenge } from '@/lib/focus/types';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const { addChallengeMock, queueState, routerPushMock } = vi.hoisted(() => ({
  addChallengeMock: vi.fn(),
  queueState: {
    isQueueFull: false,
    maxQueueSize: 20,
  },
  routerPushMock: vi.fn(),
}));

const mockChallenge: DailyChallenge = {
  id: 'test-challenge',
  title: 'Test Challenge',
  description: 'Test description',
  difficulty: 'beginner',
  language: 'typescript',
  estimatedTime: '30 minutes',
  whyThisChallenge: ['Practice problem solving'],
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock('@/hooks/use-custom-challenge-queue', () => ({
  useCustomChallengeQueue: () => ({
    addChallenge: addChallengeMock,
    isQueueFull: queueState.isQueueFull,
    maxQueueSize: queueState.maxQueueSize,
  }),
}));

vi.mock('@/hooks/use-user-profile', () => ({
  useUserProfile: () => ({
    data: null,
  }),
}));

vi.mock('@/contexts/breadcrumb-context', () => ({
  useBreadcrumb: vi.fn(),
}));

vi.mock('@/components/AppHeader', () => ({
  AppHeader: () => createElement('header', null, 'Header'),
}));

vi.mock('@/components/ChallengeAuthoring', () => ({
  ChallengeAuthoring: ({ onSaveChallenge }: { onSaveChallenge: (challenge: DailyChallenge) => void }) =>
    createElement(
      'button',
      {
        'data-testid': 'save-challenge',
        onClick: () => {
          void onSaveChallenge(mockChallenge);
        },
        type: 'button',
      },
      'Save challenge'
    ),
}));

import CreateChallengePage from './page';

describe('CreateChallengePage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    queueState.isQueueFull = false;
    queueState.maxQueueSize = 20;
    addChallengeMock.mockReset();
    routerPushMock.mockReset();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();
  });

  async function renderPage() {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(CreateChallengePage));
    });
  }

  async function clickSave() {
    await act(async () => {
      const saveButton = container.querySelector('[data-testid="save-challenge"]') as HTMLButtonElement;
      saveButton.click();
      await Promise.resolve();
    });
  }

  it('should start with no error message', async () => {
    await renderPage();

    expect(container.textContent).not.toContain('Queue is full');
    expect(container.textContent).not.toContain('Failed to add challenge to queue. Please try again.');
  });

  it('should set queue-full error when queue is full', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    queueState.isQueueFull = true;
    queueState.maxQueueSize = 3;

    await renderPage();
    await clickSave();

    expect(addChallengeMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      'Queue is full (3 challenges max). Complete or remove some challenges first.'
    );
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('should set failure error when addChallenge fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    addChallengeMock.mockResolvedValue(false);

    await renderPage();
    await clickSave();

    expect(addChallengeMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Failed to add challenge to queue. Please try again.');
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
