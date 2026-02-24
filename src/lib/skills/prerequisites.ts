import type { SkillLevel, SkillProfile } from '@/lib/skills/types';

/**
 * Skill Prerequisite Map
 *
 * Defines prerequisite relationships between skills based on Knowledge Space Theory
 * (Doignon & Falmagne, 1999). A skill is "next achievable" when all its prerequisites
 * are present in the learner's profile.
 */
export interface SkillNode {
  skillId: string;
  displayName: string;
  /** Skills that should be at intermediate+ before tackling this one */
  prerequisites: string[];
  /** Short description of what this skill unlocks */
  unlocks?: string;
}

const SKILL_LEVEL_ORDER: Record<SkillLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

const MINIMUM_PREREQUISITE_LEVEL: SkillLevel = 'intermediate';

export const SKILL_PREREQUISITES: SkillNode[] = [
  // Foundations
  { skillId: 'javascript', displayName: 'JavaScript', prerequisites: [], unlocks: 'TypeScript, React, Node.js' },
  { skillId: 'html', displayName: 'HTML', prerequisites: [], unlocks: 'CSS, React' },
  { skillId: 'css', displayName: 'CSS', prerequisites: ['html'], unlocks: 'React, Vue' },
  { skillId: 'python', displayName: 'Python', prerequisites: [], unlocks: 'FastAPI, Machine Learning' },

  // Intermediate
  { skillId: 'typescript', displayName: 'TypeScript', prerequisites: ['javascript'], unlocks: 'React, Next.js, Node.js' },
  { skillId: 'react', displayName: 'React', prerequisites: ['javascript', 'html', 'css'], unlocks: 'Next.js' },
  { skillId: 'nodejs', displayName: 'Node.js', prerequisites: ['javascript'], unlocks: 'Express, REST APIs' },
  { skillId: 'sql', displayName: 'SQL', prerequisites: [], unlocks: 'PostgreSQL, SQLite, ORM' },
  { skillId: 'git', displayName: 'Git', prerequisites: [], unlocks: 'GitHub Actions, CI/CD' },
  { skillId: 'testing', displayName: 'Testing', prerequisites: ['javascript'], unlocks: 'TDD, CI/CD' },

  // Advanced
  { skillId: 'nextjs', displayName: 'Next.js', prerequisites: ['react', 'typescript'], unlocks: 'Full-stack React' },
  { skillId: 'docker', displayName: 'Docker', prerequisites: ['nodejs'], unlocks: 'Kubernetes, CI/CD' },
  { skillId: 'graphql', displayName: 'GraphQL', prerequisites: ['nodejs', 'javascript'], unlocks: 'Apollo, Relay' },
  { skillId: 'rust', displayName: 'Rust', prerequisites: ['javascript'], unlocks: 'Systems Programming, WASM' },
  { skillId: 'go', displayName: 'Go', prerequisites: ['javascript'], unlocks: 'Backend Services, CLI Tools' },
  { skillId: 'kubernetes', displayName: 'Kubernetes', prerequisites: ['docker'], unlocks: 'Cloud-native Architecture' },
  { skillId: 'ci-cd', displayName: 'CI/CD', prerequisites: ['git', 'testing'], unlocks: 'DevOps, Deployment' },
  { skillId: 'machine-learning', displayName: 'Machine Learning', prerequisites: ['python'], unlocks: 'Deep Learning, MLOps' },
  { skillId: 'rest-api', displayName: 'REST APIs', prerequisites: ['nodejs', 'javascript'], unlocks: 'Microservices' },
  { skillId: 'postgresql', displayName: 'PostgreSQL', prerequisites: ['sql'], unlocks: 'Database Design' },
];

function isIntermediateOrAdvanced(level: SkillLevel | undefined): boolean {
  if (!level) {
    return false;
  }

  return SKILL_LEVEL_ORDER[level] >= SKILL_LEVEL_ORDER[MINIMUM_PREREQUISITE_LEVEL];
}

/**
 * Returns skills from SKILL_PREREQUISITES that are "next achievable" given the user's profile.
 * A skill is next-achievable when:
 * 1. It is NOT already in the user's skill profile at intermediate+ level
 * 2. All its prerequisites are present in the user's profile at any level
 */
export function getNextAchievableSkills(profile: SkillProfile): SkillNode[] {
  const skillLevels = new Map<string, SkillLevel>();

  for (const userSkill of profile.skills) {
    const currentLevel = skillLevels.get(userSkill.skillId);
    if (!currentLevel || SKILL_LEVEL_ORDER[userSkill.level] > SKILL_LEVEL_ORDER[currentLevel]) {
      skillLevels.set(userSkill.skillId, userSkill.level);
    }
  }

  return SKILL_PREREQUISITES.filter((skillNode) => {
    if (isIntermediateOrAdvanced(skillLevels.get(skillNode.skillId))) {
      return false;
    }

    return skillNode.prerequisites.every((prerequisite) =>
      skillLevels.has(prerequisite)
    );
  });
}
