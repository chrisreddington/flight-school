
# Project Specification Request: AI-Powered Learning Platform Persistence & State Management

## Project Context

**Project Name:** learn-copilot-sdk / Flight School  
**Type:** Next.js application with AI-powered developer learning platform  
**Current State:** Functional prototype with significant state management issues  
**Tech Stack:** Next.js, TypeScript, Copilot SDK, GitHub API integration  

## Problem Statement

### Core Issue
We have attempted multiple approaches to implement **persistent, background AI operations with cross-page state synchronization**, but have not achieved a robust, production-ready implementation. The current system exhibits state loss, streaming interruptions, and inconsistent UI updates when users navigate between pages during ongoing AI operations.

### Symptoms of Current Implementation
1. **AI operations terminate** when navigating away from the originating page
2. **Streaming content disappears** or doesn't resume when returning to a page
3. **No skeleton/loading indicators** persist across page navigation
4. **State inconsistency** between dashboard → history page transitions
5. **Lost context** in multi-turn chat conversations when navigating away

## What We've Been Trying to Achieve

### 1. Dashboard Focus Generation (Challenges, Goals, Learning Topics)

**Current Behavior:**
- User clicks "New" or "Skip" on Dashboard for Challenge/Goal/Learning Topic
- AI generation starts via streaming API (`/api/focus`)
- If user navigates to History page **during generation**, the operation is lost
- Returning to Dashboard shows incomplete or missing content

**Desired Behavior:**
```
USER JOURNEY:
1. Dashboard: Click "New" on Challenge card
2. Dashboard: Challenge card shows skeleton/loading state
3. User navigates to History page (mid-generation)
4. History page: Most recent item (at top) shows skeleton/loading state
5. AI generation completes (background operation)
6. History page: Skeleton resolves to full Challenge content
7. User returns to Dashboard
8. Dashboard: Shows the newly generated Challenge (no skeleton)
```

### 2. Learning Chat Conversations

**Current Behavior:**
- User starts chat in a learning topic (clicks "Explore" button)
- AI streams response via `/api/copilot/stream`
- If user navigates away **during streaming**, response is lost
- Returning to chat shows incomplete conversation with no ability to resume

**Desired Behavior:**
```
USER JOURNEY:
1. Learning topic page: Click "Explore"
2. Chat interface appears, user sends message
3. AI begins streaming response
4. User navigates to different page (e.g., Dashboard)
5. Background: AI continues streaming, storing partial content
6. User returns to Learning topic
7. Chat shows CURRENT STATE of conversation:
   - All previous messages
   - Currently streaming message with accumulated content
   - Streaming continues seamlessly where it left off
```

### 3. History Page State Sync

**Desired Behavior:**
- History page shows reverse-chronological list of all generated items
- Items currently being generated appear at **top** with skeleton UI
- When generation completes, skeleton resolves to full content
- Items marked as "skipped" show appropriate badge/status
- **No page refresh required** to see updated state

## Technical Context

### Current Architecture

**Key Files & Patterns Observed:**
```
src/
├── app/api/
│   ├── focus/route.ts          # Generates challenges/goals/topics
│   └── copilot/stream/route.ts # Streaming chat responses
├── lib/
│   ├── focus/
│   │   ├── types.ts            # Focus content types
│   │   └── storage.ts          # localStorage persistence
│   ├── copilot/
│   │   ├── streaming.ts        # SSE streaming utilities
│   │   └── sessions.ts         # Session management
│   ├── stream-store/           # State management for streams (?)
│   └── operations/             # Background operation tracking (?)
├── hooks/
│   ├── use-ai-focus.ts         # Focus generation hook
│   ├── use-learning-chat.ts    # Chat streaming hook
│   └── use-regeneration-state.ts # State persistence hook
└── components/
    ├── Dashboard/
    ├── FocusHistory/
    └── LearningChat/
```

**Current Patterns:**
- **Streaming**: Server-Sent Events (SSE) via Next.js API routes
- **State**: React hooks + localStorage for persistence
- **AI SDK**: Custom Copilot SDK wrapper with session pooling
- **GitHub Integration**: Direct Octokit calls for user profile data

### Attempted Solutions (What Hasn't Worked)

Based on session history, the following have been attempted with varying degrees of failure:

1. **Client-side React state only** → Lost on navigation
2. **localStorage snapshots** → Race conditions, stale data
3. **Custom hooks with useEffect** → Cleanup fires too early, loses streaming connection
4. **Ref-based persistence** → State doesn't trigger re-renders across components
5. **Stream reconnection logic** → Can't resume mid-stream, duplicate content
6. **"Regeneration store" pattern** → Unclear state ownership, component unmounting issues

### Current Stop/Cancel Implementation Status

**What Exists:**
- `AbortController` implemented in stream store (`src/lib/stream-store/store.ts`)
- `stopStream(id)` method available in stream store
- `stopStreaming()` in `use-learning-chat.ts` hook
- `stopComponent()` in `use-ai-focus.ts` hook (for component-level cancel)
- `stopTopicSkip()` in `use-ai-focus.ts` hook (specific to topic regeneration)
- Chat input has stop button (`src/components/ChatInput/index.tsx`)
- Topic card has stop button during skip/regeneration (`src/components/FocusItem/TopicCard.tsx`)

**What's Broken/Missing:**
- ❌ **Challenge card**: No stop button at all (only skip, no cancel during initial generation)
- ❌ **Goal card**: No stop button at all (only skip, no cancel during initial generation)
- ❌ **Chat stop button**: Exists but reliability concerns (may not properly cancel background jobs)
- ❌ **Topic stop button**: Only appears during skip/regeneration, NOT during initial generation
- ❌ **Cross-page stop**: Stop buttons don't persist when navigating away
- ❌ **History page stop**: No stop buttons in history view for in-progress items
- ❌ **Stop all**: No way to cancel multiple concurrent operations at once
- ❌ **Incomplete cleanup**: AbortController may not fully clean up:
  - Background jobs via operations manager not consistently cancelled
  - Partial data may remain in localStorage
  - SSE connections may not close immediately

**Technical Debt:**
1. Stop functionality is implemented inconsistently across operation types
2. `use-ai-focus.ts` has `stopComponent()` but it's not wired to UI consistently
3. Operations manager tracks operations but doesn't expose global stop/cancel API
4. No visual feedback when stop is in progress (button just disappears)
5. Stop button visibility logic is per-component, not shared pattern

## Requirements (What MUST Work)

### Functional Requirements

#### FR-1: Background AI Operations
**Priority: CRITICAL**
- [ ] AI operations (challenge gen, chat streaming) continue when user navigates away
- [ ] Operations can be tracked across entire app session
- [ ] Multiple concurrent operations supported (e.g., 2 challenges + 1 chat)
- [ ] Operations survive page refresh (with reasonable limits, e.g., 5-minute timeout)

#### FR-2: Cross-Page State Synchronization
**Priority: CRITICAL**
- [ ] Dashboard and History pages show **same loading state** for in-progress items
- [ ] Skeleton UI appears consistently across pages for generating items
- [ ] When generation completes, **all visible UIs update** without manual refresh
- [ ] State updates are atomic (no partial/corrupt data shown)

#### FR-3: Chat Conversation Persistence
**Priority: CRITICAL**
- [ ] Multi-turn chat conversations persist across navigation
- [ ] Streaming resumes when returning to chat page
- [ ] Chat shows accumulated message content up to current point
- [ ] No message duplication or loss during streaming
- [ ] Conversation history retained for session duration (or longer)

#### FR-4: UI State Indicators
**Priority: HIGH**
- [ ] Skeleton components shown during generation
- [ ] Progress indicators for long-running operations (>5s)
- [ ] "Skipped" badge appears on items marked as skipped
- [ ] Clear distinction between loading, completed, and errored states
- [ ] Smooth transitions (no flash of wrong content)

#### FR-5: History Page Behavior
**Priority: HIGH**
- [ ] Most recent items appear at top
- [ ] In-progress generations shown as skeletons at top
- [ ] Completed items show full content
- [ ] Items can be filtered by type (challenge/goal/topic) and status
- [ ] "Skip" action from Dashboard creates entry in history immediately

#### FR-6: Stop/Cancel Operations
**Priority: CRITICAL**
- [ ] **Every AI operation must be cancellable** by the user at any time
- [ ] Stop button appears on ALL items during generation/streaming:
  - Challenge generation (initial and skip/replace)
  - Goal generation (initial and skip/replace)
  - Learning topic generation (initial and skip/replace)
  - Chat message streaming
- [ ] Stop button replaces primary action button during operation (consistent UI pattern)
- [ ] Stop button remains visible and functional **across page navigation**
  - If user navigates away during generation, stop button appears in History page
  - If user returns to Dashboard, stop button still works
- [ ] Stopping an operation is **instantaneous** (<200ms perceived response)
- [ ] Stopped operations show clear state:
  - Challenge/Goal/Topic: Return to "Not Started" state (or previous state if skip)
  - Chat: Show "*(Response stopped)*" marker on partial message
  - History: Show "Cancelled" badge on incomplete items
- [ ] AbortController properly cleans up:
  - Fetch requests cancelled (no wasted bandwidth)
  - SSE streams closed
  - Background jobs terminated via operations manager
  - localStorage cleaned up (no orphaned partial data)
- [ ] Multiple concurrent stop actions supported (user can stop all 3 focus items at once)
- [ ] Stop doesn't break subsequent operations (can immediately click "New" again)

**User Flow Examples:**

*Challenge Generation Stop:*
```
1. User clicks "New" on Challenge card
2. Stop button appears (replaces "New" button)
3. User clicks Stop during generation
4. Challenge card returns to empty state with "New" button
5. No partial challenge data saved
6. User can immediately click "New" again
```

*Chat Streaming Stop:*
```
1. User sends chat message
2. AI starts streaming response
3. Stop button appears (replaces Send button)
4. User clicks Stop mid-response
5. Partial message shows with "*(Response stopped)*" footer
6. Chat input re-enables immediately
7. User can send new message (conversation continues)
```

*Cross-Page Stop:*
```
1. Dashboard: User clicks "New" on Challenge card
2. Dashboard: Challenge shows loading + Stop button
3. User navigates to History page
4. History: Most recent item shows loading + Stop button
5. User clicks Stop on History page
6. History: Item removed or shows "Cancelled"
7. User returns to Dashboard
8. Dashboard: Challenge card back to "New" state
```

### Non-Functional Requirements

#### NFR-1: Performance
- [ ] Page navigation feels instant (<100ms perceived)
- [ ] No blocking on AI operations
- [ ] Streaming content renders progressively (not all at once at end)
- [ ] History page handles 100+ items efficiently

#### NFR-2: Reliability
- [ ] No data loss during navigation
- [ ] Graceful degradation if AI service fails
- [ ] Operation timeout after 60 seconds (user notified)
- [ ] Retry logic for transient failures (max 2 retries)

#### NFR-3: Maintainability
- [ ] Clear separation of concerns (API ↔ State ↔ UI)
- [ ] TypeScript types enforce state contracts
- [ ] State transitions are predictable and testable
- [ ] Minimal coupling between components

#### NFR-4: Developer Experience
- [ ] State management pattern is discoverable and consistent
- [ ] Clear documentation of data flow
- [ ] Easy to add new AI operation types
- [ ] Observable/debuggable state changes

## Known Constraints & Context

### Technical Constraints
1. **Next.js App Router**: Must work with RSC and client components
2. **Streaming API**: SSE format (Server-Sent Events), not WebSocket
3. **AI SDK**: Copilot SDK with session pooling (don't break existing optimizations)
4. **localStorage**: Max 5-10MB, needs cleanup strategy for history
5. **No Backend Database**: Currently no persistent DB, localStorage + API state only

### User Experience Principles
1. **Transparency**: User should always know what's happening
2. **Continuity**: Work in progress should never feel "lost"
3. **Speed**: Perceived performance > actual performance (show progress immediately)
4. **Forgiveness**: Easy to undo/retry failed operations

### Business Context
- **Launch blocker**: Current issues prevent public launch
- **User trust**: Lost content = lost user confidence
- **Video demo**: Need stable demo for promotional video

## Success Criteria

The implementation will be considered successful when:

### Acceptance Tests

**Test 1: Dashboard → History Navigation During Generation**
```gherkin
Given I am on the Dashboard
When I click "New" on the Challenge card
And I see a skeleton loading state
And I navigate to the History page BEFORE generation completes
Then I should see:
  - A skeleton at the TOP of the history list
  - Label indicating "Generating new challenge..."
When the generation completes
Then the skeleton should resolve to the full challenge content
And when I return to Dashboard
Then the Dashboard should show the newly generated challenge (no skeleton)
```

**Test 2: Chat Streaming with Navigation**
```gherkin
Given I am in a learning topic chat
When I send a message "Explain React hooks"
And the AI begins streaming a response
And I navigate to the Dashboard DURING streaming
And I wait 3 seconds
And I navigate back to the learning topic chat
Then I should see:
  - My original message "Explain React hooks"
  - The AI response accumulated up to the current point
  - The streaming continues from where it was (no restart)
And when streaming completes
Then the full message should be visible
```

**Test 3: Multiple Concurrent Operations**
```gherkin
Given I am on the Dashboard
When I click "New" on Challenge card
And I click "New" on Goal card  
And I click "New" on Learning Topic card
Then all three cards should show skeleton states
And I can navigate between Dashboard and History
And all three operations complete independently
And history shows all three items when done
```

**Test 4: Stop/Cancel Operations**
```gherkin
Given I am on the Dashboard
When I click "New" on the Challenge card
And I see a loading state with a Stop button
And I click the Stop button
Then the loading should stop immediately
And the Challenge card should return to "New" state
And no partial challenge data should be saved
And I can immediately click "New" again successfully
```

**Test 5: Stop During Cross-Page Navigation**
```gherkin
Given I am on the Dashboard
When I click "New" on the Challenge card
And I see a loading state with a Stop button
And I navigate to the History page
Then I should see the in-progress challenge with a Stop button
When I click Stop on the History page
Then the challenge should be cancelled
And when I return to the Dashboard
Then the Challenge card should show "New" state (not loading)
```

**Test 6: Chat Stop with Partial Content**
```gherkin
Given I am in a learning topic chat
When I send a message "Explain TypeScript generics"
And the AI begins streaming a response
And I see a Stop button in the chat input
And I click Stop after 2 seconds of streaming
Then the streaming should stop immediately
And the partial message should be visible with "*(Response stopped)*" marker
And the chat input should re-enable
And I can send a new message immediately
```

**Test 7: Stop Multiple Concurrent Operations**
```gherkin
Given I am on the Dashboard
When I click "New" on Challenge, Goal, and Learning Topic cards
Then all three cards should show loading states with Stop buttons
When I click Stop on the Challenge card
Then only the Challenge generation should stop
And the Goal and Learning Topic generations should continue
And the Challenge card should return to "New" state
```

### Measurable Outcomes
- [ ] **0 reports** of lost content during navigation (vs. current ~100% failure rate)
- [ ] **<100ms** page navigation latency (excluding network)
- [ ] **100% consistency** between Dashboard and History states
- [ ] **0 stale data** shown (tested with rapid navigation patterns)

## Out of Scope (For This Iteration)

The following are explicitly NOT required for this specification:

- [ ] Multi-device synchronization (e.g., sync across browser tabs)
- [ ] Offline support / service worker
- [ ] Database migration (stay with localStorage + API)
- [ ] Real-time collaboration features
- [ ] Undo/redo system beyond basic retry
- [ ] Advanced analytics/telemetry
- [ ] Migration of existing stored data (can start fresh)

## Questions for Spec Manager

Please help clarify the following before proceeding to implementation:

### Architecture Decisions
1. **State Management Pattern**: Should we use:
   - React Context + useReducer (simple, built-in)
   - Zustand (lightweight, works across components easily)
   - Jotai (atomic state, less boilerplate)
   - Custom event bus + localStorage
   - Other recommendation?

2. **Operation Tracking**: How should we model background operations?
   - Finite State Machine (idle → loading → success → error)?
   - Event sourcing (log of state transitions)?
   - Simple status enum?

3. **Stream Persistence**: For streaming content (chat), should we:
   - Store partial content in memory + finalize to localStorage on complete?
   - Write every chunk to localStorage (performance concern)?
   - Use IndexedDB for larger conversations?

### Data Model Questions
4. **Operation Identity**: How do we uniquely identify operations across pages?
   - UUID generated on start?
   - Composite key (type + timestamp)?
   - Server-provided ID from API response?

5. **History Schema**: Should history items include:
   - Full operation metadata (prompt, tokens, duration)?
   - Just final result?
   - Link to original operation for debugging?

6. **Cleanup Strategy**: When should old items be removed?
   - After N days?
   - After N items (FIFO)?
   - User-initiated only?
   - Keep operations in progress forever until completion/timeout?

### Edge Cases
7. **Timeout Handling**: What happens if an operation takes >60s?
   - Show error state?
   - Allow user to cancel and retry?
   - Keep waiting with explicit progress?

8. **Navigation During Error**: If an operation fails while user is on different page:
   - Show notification on return?
   - Update history with error badge?
   - Retry automatically?

9. **Page Refresh**: Should operations survive a page refresh?
   - Yes, resume from API state if possible?
   - No, consider them cancelled?
   - Partial (only if <5min old)?

### Stop/Cancel Behavior
10. **Stop vs Cancel Semantics**: Should stopped operations:
    - Be treated as "never happened" (removed from history)?
    - Appear in history with "Cancelled" badge?
    - Preserve partial content for debugging?

11. **Stop Button Placement**: Should stop button:
    - Replace primary action button ("New" → "Stop")?
    - Appear alongside as secondary button?
    - Be in a consistent location across all card types?

12. **Partial Content Handling**: When chat streaming is stopped:
    - Keep partial message in conversation?
    - Discard partial message entirely?
    - Offer user choice ("Keep partial" vs "Discard")?

13. **Stop All Feature**: Should we provide:
    - Global "Stop All Operations" button?
    - Per-page stop all (e.g., "Stop all focus generation")?
    - No bulk stop (individual only)?

### Implementation Priorities
14. **Phase 1 Scope**: Should we implement all operation types at once, or:
    - Start with Challenge generation only?
    - Add Chat streaming second?
    - Defer History page full features?

15. **Testing Approach**: What level of testing is expected?
    - Unit tests for state logic?
    - Integration tests with mock API?
    - E2E tests with real streaming?
    - Manual QA sufficient for initial release?

16. **Stop/Cancel Testing**: How thoroughly should we test stop functionality?
    - Unit tests for AbortController cleanup?
    - Integration tests for each operation type?
    - E2E tests for cross-page stop scenarios?
    - Load testing (stop 100 concurrent operations)?

## Appendices

### Appendix A: User Profile Format
```typescript
interface UserProfile {
  username: string;
  languages: Record<string, { bytes: number; percentage: number }>;
  topics: string[];
  activity: { commits: number; prs: number; days: number; repos: string[] };
  readmeKeywords: string[];
  configuredSkills?: Record<string, 'beginner' | 'intermediate' | 'advanced'>;
  excludedSkills?: string[];
}
```

### Appendix B: Focus Content Types
```typescript
interface DailyChallenge {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  language: string;
  estimatedTime: string;
  whyThisChallenge: string[];
}

interface DailyGoal {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: string;
  reasoning: string;
}

interface LearningTopic {
  id: string;
  title: string;
  description: string;
  type: 'concept' | 'pattern' | 'best-practice';
  relatedTo: string;
}
```

### Appendix C: API Endpoints
```
POST /api/focus - Generate challenge + goal + topics (compact profile)
POST /api/copilot/stream - Streaming chat responses (SSE)
GET /api/profile - Fetch GitHub user profile
```

### Appendix D: Session Analysis Summary

Based on 15+ recent attempts (Jan 19-25, 2026), the following patterns emerged:

**Most Common Failures:**
1. State lost when component unmounts during streaming
2. useEffect cleanup interrupting in-progress operations
3. localStorage updates not triggering re-renders in other components
4. Race conditions between API completion and UI state updates
5. Skeleton UI shown on return but then replaced with stale data

**Attempted Fixes That Didn't Work:**
- Multiple iterations of "regeneration-store" pattern
- Various hook combinations (useRef + useState + useEffect)
- LocalStorage polling patterns
- Event emitters with React Context
- Stream "reconnection" logic that created duplicates

**Core Technical Debt:**
- Unclear ownership of operation state (API vs hook vs component)
- No single source of truth for operation lifecycle
- Streaming architecture not designed for disconnection/reconnection
- History page state refresh timing issues