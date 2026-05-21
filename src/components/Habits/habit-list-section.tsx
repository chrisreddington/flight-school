/**
 * Habit List Section Component
 *
 * Displays sections of habits (active, completed, abandoned) with individual habit cards.
 * Handles rendering of habit cards with appropriate actions and state.
 */

import type { HabitWithHistory } from '@/lib/habits/types';
import {
  CheckCircleIcon,
  ClockIcon,
  FlameIcon,
  GraphIcon,
  KebabHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SkipIcon,
  StopIcon,
  TrashIcon,
  UndoIcon,
} from '@primer/octicons-react';
import {
  ActionList,
  ActionMenu,
  Button,
  CounterLabel,
  Heading,
  IconButton,
  Label,
  Stack,
  Text,
} from '@primer/react';
import styles from '@/app/habits/habits.module.css';
import {
  isPendingToday,
  getRemainingSkips,
} from '@/lib/habits/state-machine';

interface HabitListSectionProps {
  activeHabits: HabitWithHistory[];
  completedHabits: HabitWithHistory[];
  abandonedHabits: HabitWithHistory[];
  onCheckIn: (habit: HabitWithHistory, value: number | boolean) => void;
  onSkip: (habit: HabitWithHistory) => void;
  onUndo: (habit: HabitWithHistory) => void;
  onEdit: (habit: HabitWithHistory) => void;
  onStop: (habit: HabitWithHistory) => void;
  onDelete: (habit: HabitWithHistory) => void;
  onNewHabitClick: () => void;
}

function getTrackingLabel(mode: 'time' | 'count' | 'binary'): string {
  switch (mode) {
    case 'time':
      return 'Time-based';
    case 'count':
      return 'Count-based';
    case 'binary':
      return 'Yes/No';
    default:
      return mode;
  }
}

function getStateLabel(habit: HabitWithHistory) {
  switch (habit.state) {
    case 'active':
      return <Label variant="success">Active</Label>;
    case 'not-started':
      return <Label variant="secondary">Not Started</Label>;
    case 'paused':
      return <Label variant="attention">Paused</Label>;
    case 'completed':
      return <Label variant="done">Completed</Label>;
    case 'abandoned':
      return <Label variant="danger">Abandoned</Label>;
    default:
      return null;
  }
}

interface HabitCardProps {
  habit: HabitWithHistory;
  showActions?: boolean;
  onCheckIn: (habit: HabitWithHistory, value: number | boolean) => void;
  onSkip: (habit: HabitWithHistory) => void;
  onUndo: (habit: HabitWithHistory) => void;
  onEdit: (habit: HabitWithHistory) => void;
  onStop: (habit: HabitWithHistory) => void;
  onDelete: (habit: HabitWithHistory) => void;
}

function HabitCard({
  habit,
  showActions = true,
  onCheckIn,
  onSkip,
  onUndo,
  onEdit,
  onStop,
  onDelete,
}: HabitCardProps) {
  const isPending = isPendingToday(habit);
  const hasCheckedIn = !isPending && habit.currentDay > 0;
  const progress = (habit.currentDay / habit.totalDays) * 100;
  const remainingSkips = getRemainingSkips(habit);

  return (
    <div className={styles.habitCard}>
      <div className={styles.habitCardHeader}>
        <div className={styles.habitCardInfo}>
          <div className={styles.habitTitle}>{habit.title}</div>
          {habit.description && (
            <div className={styles.habitDescription}>{habit.description}</div>
          )}
        </div>

        <Stack direction="horizontal" gap="condensed" align="center">
          {getStateLabel(habit)}

          {showActions && (
            <ActionMenu>
              <ActionMenu.Anchor>
                <IconButton
                  icon={KebabHorizontalIcon}
                  variant="invisible"
                  aria-label="Habit options"
                  size="small"
                />
              </ActionMenu.Anchor>
              <ActionMenu.Overlay>
                <ActionList>
                  <ActionList.Item onSelect={() => onEdit(habit)}>
                    <ActionList.LeadingVisual>
                      <PencilIcon />
                    </ActionList.LeadingVisual>
                    Edit
                  </ActionList.Item>
                  <ActionList.Divider />
                  <ActionList.Item onSelect={() => onStop(habit)}>
                    <ActionList.LeadingVisual>
                      <StopIcon />
                    </ActionList.LeadingVisual>
                    Stop Habit
                  </ActionList.Item>
                  <ActionList.Item variant="danger" onSelect={() => onDelete(habit)}>
                    <ActionList.LeadingVisual>
                      <TrashIcon />
                    </ActionList.LeadingVisual>
                    Delete
                  </ActionList.Item>
                </ActionList>
              </ActionMenu.Overlay>
            </ActionMenu>
          )}
        </Stack>
      </div>

      <div className={styles.habitMeta}>
        <Label size="small">
          <ClockIcon size={12} /> {habit.totalDays} days
        </Label>
        <Label size="small">{getTrackingLabel(habit.tracking.mode)}</Label>
        {habit.currentDay > 0 && (
          <Label size="small">
            Day {habit.currentDay}/{habit.totalDays}
          </Label>
        )}
        {habit.allowedSkips > 0 && habit.state !== 'not-started' && (
          <Label size="small" variant={remainingSkips === 0 ? 'attention' : 'secondary'}>
            <SkipIcon size={12} /> {remainingSkips} skip{remainingSkips !== 1 ? 's' : ''} left
          </Label>
        )}
      </div>

      {habit.state !== 'completed' && (
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
      )}

      {showActions && habit.state === 'active' && (
        <Stack direction="horizontal" gap="condensed" className={styles.actionsStack}>
          {isPending && (
            <>
              <Button
                size="small"
                variant="primary"
                leadingVisual={CheckCircleIcon}
                onClick={() => onCheckIn(habit, true)}
              >
                Complete Today
              </Button>
              {remainingSkips > 0 && (
                <Button
                  size="small"
                  variant="invisible"
                  leadingVisual={SkipIcon}
                  onClick={() => onSkip(habit)}
                >
                  Skip
                </Button>
              )}
            </>
          )}
          {hasCheckedIn && (
            <>
              <Label variant="success">
                <CheckCircleIcon size={12} /> Checked in today
              </Label>
              <Button
                size="small"
                variant="invisible"
                leadingVisual={UndoIcon}
                onClick={() => onUndo(habit)}
              >
                Undo
              </Button>
            </>
          )}
        </Stack>
      )}
    </div>
  );
}

export function HabitListSection({
  activeHabits,
  completedHabits,
  abandonedHabits,
  onCheckIn,
  onSkip,
  onUndo,
  onEdit,
  onStop,
  onDelete,
  onNewHabitClick,
}: HabitListSectionProps) {
  return (
    <>
      {/* Active Habits */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <Stack direction="horizontal" gap="condensed" align="center">
            <FlameIcon size={20} />
            <Heading as="h2" className={styles.sectionHeading}>
              Active Habits
            </Heading>
            <CounterLabel>{activeHabits.length}</CounterLabel>
          </Stack>
          <Button
            variant="primary"
            size="small"
            leadingVisual={PlusIcon}
            onClick={onNewHabitClick}
          >
            New Habit
          </Button>
        </div>

        {activeHabits.length === 0 ? (
          <div className={styles.emptyState}>
            <FlameIcon size={48} className={styles.emptyIcon} />
            <Heading as="h3" className={styles.emptyHeading}>
              No active habits yet
            </Heading>
            <Text as="p" className={styles.emptyText}>
              Start building better habits by creating your first one.
            </Text>
          </div>
        ) : (
          <div className={styles.habitsList}>
            {activeHabits.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                showActions={true}
                onCheckIn={onCheckIn}
                onSkip={onSkip}
                onUndo={onUndo}
                onEdit={onEdit}
                onStop={onStop}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </section>

      {/* Completed Habits */}
      {completedHabits.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Stack direction="horizontal" gap="condensed" align="center">
              <GraphIcon size={20} />
              <Heading as="h2" className={styles.sectionHeading}>
                Completed Habits
              </Heading>
              <CounterLabel>{completedHabits.length}</CounterLabel>
            </Stack>
          </div>

          <div className={styles.habitsList}>
            {completedHabits.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                showActions={false}
                onCheckIn={onCheckIn}
                onSkip={onSkip}
                onUndo={onUndo}
                onEdit={onEdit}
                onStop={onStop}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>
      )}

      {/* Abandoned/Stopped Habits */}
      {abandonedHabits.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Stack direction="horizontal" gap="condensed" align="center">
              <StopIcon size={20} />
              <Heading as="h2" className={styles.sectionHeading}>
                Stopped Habits
              </Heading>
              <CounterLabel>{abandonedHabits.length}</CounterLabel>
            </Stack>
          </div>

          <div className={styles.habitsList}>
            {abandonedHabits.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                showActions={false}
                onCheckIn={onCheckIn}
                onSkip={onSkip}
                onUndo={onUndo}
                onEdit={onEdit}
                onStop={onStop}
                onDelete={onDelete}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
