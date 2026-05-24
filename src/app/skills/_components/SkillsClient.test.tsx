import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { addSkillActionMock, skillsGetMock, skillsSaveMock, calibrationNeededMock, routerRefreshMock } =
  vi.hoisted(() => ({
    addSkillActionMock: vi.fn(),
    skillsGetMock: vi.fn(),
    skillsSaveMock: vi.fn(),
    calibrationNeededMock: vi.fn(),
    routerRefreshMock: vi.fn(),
  }));

vi.mock('@/contexts/breadcrumb-context', () => ({ useBreadcrumb: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefreshMock, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/skills',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../actions', () => ({ addSkillAction: addSkillActionMock }));
vi.mock('@/lib/skills/storage', () => ({
  skillsStore: { get: skillsGetMock, save: skillsSaveMock },
}));
vi.mock('@/lib/focus/storage', () => ({
  focusStore: { getCalibrationNeeded: calibrationNeededMock },
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    withTag: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));
vi.mock('@/components/AppHeader', () => ({ AppHeader: () => <header>Header</header> }));
vi.mock('@/components/Dashboard/inline-calibration', () => ({
  InlineCalibration: () => <div>InlineCalibration</div>,
}));
vi.mock('@/components/LearningPathPanel', () => ({
  LearningPathPanel: () => <div>LearningPathPanel</div>,
}));
vi.mock('@/components/SkillSlider', () => ({ SkillSlider: () => <div>SkillSlider</div> }));

import type { SkillProfile } from '@/lib/skills/types';
import { SkillsClient } from './SkillsClient';

const INITIAL: SkillProfile = {
  skills: [{ skillId: 'react', displayName: 'React', level: 'intermediate', source: 'manual' }],
  lastUpdated: '2025-01-01T00:00:00.000Z',
};

describe('SkillsClient add-skill action', () => {
  it('clears the form input after successful submission', async () => {
    calibrationNeededMock.mockResolvedValueOnce([]);
    addSkillActionMock.mockResolvedValueOnce({ ok: true });

    render(<SkillsClient initialProfile={INITIAL} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add Skill' }));
    const input = screen.getByRole('textbox', { name: 'New skill name' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'TypeScript' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'New skill name' })).not.toBeInTheDocument();
    });
  });

  it('surfaces validation error returned by the action', async () => {
    calibrationNeededMock.mockResolvedValueOnce([]);
    addSkillActionMock.mockResolvedValueOnce({ ok: false, error: 'Skill already exists.' });

    render(<SkillsClient initialProfile={INITIAL} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add Skill' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New skill name' }), {
      target: { value: 'React' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Skill already exists.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'New skill name' })).toBeInTheDocument();
  });
});
