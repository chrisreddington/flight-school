/**
 * Dashboard Helper Functions
 *
 * Utilities for generating dynamic dashboard content based on user profile.
 */

import type { ProfileResponse } from '@/app/api/profile/route';
import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';

/**
 * Get time-appropriate greeting.
 */
export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Generate personalized challenge based on user's top language and experience level.
 * 
 * @param profile - User's GitHub profile data (null if not loaded)
 * @returns Tailored daily challenge
 */
export function getDynamicChallenge(profile: ProfileResponse | null): DailyChallenge {
  const topLanguage = profile?.stats.topLanguages[0]?.name || 'TypeScript';
  const level = profile?.stats.experienceLevel || 'intermediate';

  const challenges: Record<string, Record<string, DailyChallenge>> = {
    TypeScript: {
      beginner: {
        id: 'ts-1',
        title: 'Build a Type-Safe Config Loader',
        description: 'Create a function that loads and validates configuration from environment variables with full type safety.',
        difficulty: 'beginner',
        language: 'TypeScript',
        estimatedTime: '20 min',
        whyThisChallenge: ['Practice TypeScript type inference', 'Learn runtime validation patterns'],
      },
      intermediate: {
        id: 'ts-2',
        title: 'Implement a Generic Event Emitter',
        description: 'Build a type-safe event system using generics and mapped types that provides autocomplete for event names and payloads.',
        difficulty: 'intermediate',
        language: 'TypeScript',
        estimatedTime: '30 min',
        whyThisChallenge: ['Master TypeScript generics', 'Understand mapped types'],
      },
      advanced: {
        id: 'ts-3',
        title: 'Create a Type-Level State Machine',
        description: 'Design a state machine where invalid transitions are caught at compile time using conditional types and template literals.',
        difficulty: 'advanced',
        language: 'TypeScript',
        estimatedTime: '45 min',
        whyThisChallenge: ['Explore conditional types', 'Build compile-time safety'],
      },
    },
    JavaScript: {
      beginner: {
        id: 'js-1',
        title: 'Build a Promise Queue',
        description: 'Create a queue that processes async tasks with configurable concurrency limits.',
        difficulty: 'beginner',
        language: 'JavaScript',
        estimatedTime: '25 min',
        whyThisChallenge: ['Practice async/await patterns', 'Learn concurrency control'],
      },
      intermediate: {
        id: 'js-2',
        title: 'Implement Debounce with Cancel',
        description: 'Build a debounce utility with cancel and flush capabilities, plus proper this binding.',
        difficulty: 'intermediate',
        language: 'JavaScript',
        estimatedTime: '20 min',
        whyThisChallenge: ['Master closure patterns', 'Understand function context'],
      },
      advanced: {
        id: 'js-3',
        title: 'Create a Reactive Store',
        description: 'Build a minimal reactive state management library using Proxies with computed values and subscriptions.',
        difficulty: 'advanced',
        language: 'JavaScript',
        estimatedTime: '40 min',
        whyThisChallenge: ['Learn Proxy API', 'Build reactive systems'],
      },
    },
    Python: {
      beginner: {
        id: 'py-1',
        title: 'Build a CLI Task Manager',
        description: 'Create a command-line todo app with categories, priorities, and persistent storage.',
        difficulty: 'beginner',
        language: 'Python',
        estimatedTime: '25 min',
        whyThisChallenge: ['Practice Python file I/O', 'Learn CLI argument parsing'],
      },
      intermediate: {
        id: 'py-2',
        title: 'Implement a Rate Limiter Decorator',
        description: 'Build a decorator that rate-limits function calls with sliding window algorithm.',
        difficulty: 'intermediate',
        language: 'Python',
        estimatedTime: '30 min',
        whyThisChallenge: ['Master Python decorators', 'Understand rate limiting'],
      },
      advanced: {
        id: 'py-3',
        title: 'Create an Async Context Manager Pool',
        description: 'Build a connection pool using async context managers with health checks and reconnection.',
        difficulty: 'advanced',
        language: 'Python',
        estimatedTime: '45 min',
        whyThisChallenge: ['Learn asyncio patterns', 'Build robust connection pools'],
      },
    },
  };

  const langChallenges = challenges[topLanguage] || challenges.TypeScript;
  return langChallenges[level] || langChallenges.intermediate;
}

/**
 * Generate personalized goal based on user's recent activity.
 * 
 * @param profile - User's GitHub profile data (null if not loaded)
 * @returns Tailored daily goal with progress tracking
 */
export function getDynamicGoal(profile: ProfileResponse | null): DailyGoal {
  const pastSevenDays = profile?.pastSevenDays;

  if (!pastSevenDays) {
    return {
      id: 'default',
      title: 'Make your first commit today',
      description: 'Start building something new or contribute to an existing project.',
      progress: 0,
      target: '1 commit',
      reasoning: 'Building a daily coding habit starts with small, consistent actions.',
    };
  }

  if (pastSevenDays.pullRequests < 2) {
    return {
      id: 'pr-goal',
      title: 'Open a pull request',
      description: 'Share your work with the team. Code reviews improve quality and spread knowledge.',
      progress: pastSevenDays.pullRequests,
      target: '2 PRs this week',
      reasoning: 'Regular pull requests improve collaboration and code quality through peer review.',
    };
  }

  if (pastSevenDays.commits < 10) {
    return {
      id: 'commit-goal',
      title: 'Keep the momentum going',
      description: 'You\'re making progress! A few more commits will solidify your streak.',
      progress: pastSevenDays.commits,
      target: '10 commits this week',
      reasoning: 'Consistent commit activity shows steady progress and builds strong coding habits.',
    };
  }

  if (pastSevenDays.reposUpdated < 2) {
    return {
      id: 'repo-goal',
      title: 'Explore another project',
      description: 'Working across multiple repos builds breadth. Try contributing to something different.',
      progress: pastSevenDays.reposUpdated,
      target: '2 repos this week',
      reasoning: 'Working in multiple projects broadens your skills and prevents tunnel vision.',
    };
  }

  return {
    id: 'streak-goal',
    title: 'Maintain your excellent pace',
    description: 'You\'re on fire this week! Keep up the great work and help a teammate.',
    progress: Math.min(pastSevenDays.commits, 15),
    target: '15 commits',
    reasoning: 'Your momentum is impressive! Helping others now multiplies your impact.',
  };
}

/**
 * Generate learning topics based on user's top programming languages.
 * 
 * @param profile - User's GitHub profile data (null if not loaded)
 * @returns List of 2 relevant learning topics
 */
export function getDynamicLearningTopics(profile: ProfileResponse | null): LearningTopic[] {
  const languages = profile?.stats.topLanguages || [];
  const level = profile?.stats.experienceLevel || 'intermediate';

  const topicsByLanguage: Record<string, LearningTopic[]> = {
    TypeScript: [
      {
        id: 'ts-generics',
        title: 'Advanced TypeScript Generics',
        description: 'Master conditional types, mapped types, and template literal types for powerful abstractions.',
        type: 'concept',
        relatedTo: 'Your TypeScript projects',
      },
      {
        id: 'ts-patterns',
        title: 'TypeScript Design Patterns',
        description: 'Learn builder, factory, and decorator patterns with full type safety.',
        type: 'pattern',
        relatedTo: 'Your TypeScript repositories',
      },
    ],
    JavaScript: [
      {
        id: 'js-async',
        title: 'Async Patterns & Error Handling',
        description: 'Master Promise combinators, async iterators, and graceful error recovery.',
        type: 'concept',
        relatedTo: 'Your JavaScript projects',
      },
      {
        id: 'js-perf',
        title: 'JavaScript Performance Optimization',
        description: 'Learn about V8 optimizations, memory management, and avoiding deoptimizations.',
        type: 'best-practice',
        relatedTo: 'Your JavaScript repositories',
      },
    ],
    Python: [
      {
        id: 'py-async',
        title: 'Async Python with asyncio',
        description: 'Build concurrent applications with coroutines, tasks, and async context managers.',
        type: 'concept',
        relatedTo: 'Your Python projects',
      },
      {
        id: 'py-typing',
        title: 'Python Type Hints & Protocols',
        description: 'Use type hints, generics, and protocols for self-documenting, safer code.',
        type: 'best-practice',
        relatedTo: 'Your Python repositories',
      },
    ],
    Go: [
      {
        id: 'go-concurrency',
        title: 'Go Concurrency Patterns',
        description: 'Master goroutines, channels, and common patterns like worker pools and fan-out/fan-in.',
        type: 'concept',
        relatedTo: 'Your Go projects',
      },
      {
        id: 'go-interfaces',
        title: 'Effective Go Interfaces',
        description: 'Design small, composable interfaces that make your code flexible and testable.',
        type: 'pattern',
        relatedTo: 'Your Go repositories',
      },
    ],
    Rust: [
      {
        id: 'rust-ownership',
        title: 'Mastering Rust Ownership',
        description: 'Deep dive into borrowing, lifetimes, and the patterns that make Rust code clean.',
        type: 'concept',
        relatedTo: 'Your Rust projects',
      },
      {
        id: 'rust-traits',
        title: 'Rust Traits & Generics',
        description: 'Build flexible APIs with trait bounds, associated types, and impl Trait.',
        type: 'pattern',
        relatedTo: 'Your Rust repositories',
      },
    ],
  };

  const defaultTopics: LearningTopic[] = [
    {
      id: 'git-advanced',
      title: 'Advanced Git Workflows',
      description: 'Master interactive rebase, bisect, and strategies for clean commit history.',
      type: 'best-practice',
      relatedTo: 'All your repositories',
    },
    {
      id: 'code-review',
      title: 'Effective Code Review',
      description: 'Learn techniques for giving constructive feedback and catching subtle bugs.',
      type: 'best-practice',
      relatedTo: 'Your team collaboration',
    },
  ];

  const result: LearningTopic[] = [];
  for (const lang of languages.slice(0, 2)) {
    const langTopics = topicsByLanguage[lang.name];
    if (langTopics) {
      result.push(level === 'beginner' || level === 'intermediate' ? langTopics[0] : langTopics[1]);
    }
  }

  while (result.length < 2) {
    result.push(defaultTopics[result.length]);
  }

  return result;
}
