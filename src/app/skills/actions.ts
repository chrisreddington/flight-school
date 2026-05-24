'use server';

/**
 * Server Actions for the `/skills` route. Mutations land here from
 * `<form action={…}>` consumers so the page can write through to disk
 * without a JSON API round-trip. Every action is guarded by
 * {@link requireGuardedUserContext} and re-validates the route so the
 * Server Component re-reads the canonical profile.
 */

import { revalidatePath } from 'next/cache';

import { requireGuardedUserContext } from '@/lib/security/guard';
import { readUserSkillsProfile, writeUserSkillsProfile } from '@/lib/skills/server';
import type { SkillProfile, UserSkill } from '@/lib/skills/types';
import { now } from '@/lib/utils/date-utils';

/** Result returned to `useActionState` after a skill mutation. */
export interface AddSkillState {
  ok: boolean;
  error?: string;
}

const SKILLS_ACTION_GUARD = {
  eventType: 'storage.write' as const,
  auditMetadata: { route: '/skills' },
};

function normaliseSkillId(displayName: string): string {
  return displayName.toLowerCase().replace(/\s+/g, '-');
}

function appendSkill(profile: SkillProfile, displayName: string): SkillProfile | null {
  const skillId = normaliseSkillId(displayName);
  if (profile.skills.some((existing) => existing.skillId === skillId)) return null;
  const skill: UserSkill = { skillId, displayName, level: 'beginner', source: 'manual' };
  return { skills: [...profile.skills, skill], lastUpdated: now() };
}

/**
 * Adds a manual skill to the user's profile. Returns a banner-friendly
 * error string when validation fails so the form can surface it via
 * `useActionState`.
 */
export async function addSkillAction(
  _previous: AddSkillState,
  formData: FormData,
): Promise<AddSkillState> {
  const { release } = await requireGuardedUserContext({
    ...SKILLS_ACTION_GUARD,
    auditMetadata: { ...SKILLS_ACTION_GUARD.auditMetadata, action: 'addSkill' },
  });
  try {
    const raw = formData.get('name');
    const displayName = typeof raw === 'string' ? raw.trim() : '';
    if (!displayName) return { ok: false, error: 'Skill name is required.' };

    const current = await readUserSkillsProfile();
    const next = appendSkill(current, displayName);
    if (!next) return { ok: false, error: 'Skill already exists.' };

    await writeUserSkillsProfile(next);
    revalidatePath('/skills');
    return { ok: true };
  } finally {
    release();
  }
}
