import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { skillsGetMock, skillsSaveMock, calibrationNeededMock, loggerErrorMock } = vi.hoisted(() => ({
  skillsGetMock: vi.fn(),
  skillsSaveMock: vi.fn(),
  calibrationNeededMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/contexts/breadcrumb-context', () => ({
  useBreadcrumb: vi.fn(),
}));

vi.mock('@/lib/skills/storage', () => ({
  skillsStore: { get: skillsGetMock, save: skillsSaveMock },
}));

vi.mock('@/lib/focus/storage', () => ({
  focusStore: { getCalibrationNeeded: calibrationNeededMock },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
    withTag: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

vi.mock('@/components/AppHeader', () => ({
  AppHeader: () => <header>Header</header>,
}));

vi.mock('@/components/Dashboard/inline-calibration', () => ({
  InlineCalibration: () => <div>InlineCalibration</div>,
}));

vi.mock('@/components/LearningPathPanel', () => ({
  LearningPathPanel: () => <div>LearningPathPanel</div>,
}));

vi.mock('@/components/SkillSlider', () => ({
  SkillSlider: () => <div>SkillSlider</div>,
}));

import type { SkillProfile } from '@/lib/skills/types';
import { SkillsClient } from './SkillsClient';

const INITIAL_REACT_PROFILE: SkillProfile = {
  skills: [
    { skillId: 'react', displayName: 'React', level: 'intermediate', source: 'manual' },
  ],
  lastUpdated: '2025-01-01T00:00:00.000Z',
};

describe('SkillsClient save errors', () => {
  it('shows "Failed to save" banner when save throws', async () => {
    calibrationNeededMock.mockResolvedValueOnce([]);
    skillsSaveMock.mockRejectedValueOnce(new Error('Save failed'));

    render(<SkillsClient initialProfile={INITIAL_REACT_PROFILE} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add Skill' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New skill name' }), {
      target: { value: 'TypeScript' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Failed to save')).toBeInTheDocument();
    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });

  it('reverts optimistic profile state after add-skill save failure', async () => {
    calibrationNeededMock.mockResolvedValueOnce([]);
    skillsSaveMock.mockRejectedValueOnce(new Error('Save failed'));

    render(<SkillsClient initialProfile={INITIAL_REACT_PROFILE} />);

    expect(await screen.findByText('React')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Skill' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New skill name' }), {
      target: { value: 'TypeScript' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Failed to save')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('TypeScript')).not.toBeInTheDocument();
    });
    expect(screen.getByText('React')).toBeInTheDocument();
  });
});
