/**
 * Habit Creation Dialog
 * 
 * Form for creating new habits with guardrails.
 * Supports three tracking modes: time, count, binary.
 */

import { habitStore } from '@/lib/habits';
import { createHabit, type TrackingConfig } from '@/lib/habits/types';
import { 
  Banner,
  Checkbox, 
  Dialog, 
  FormControl, 
  Heading, 
  Radio, 
  RadioGroup, 
  SegmentedControl, 
  Stack, 
  Textarea, 
  TextInput 
} from '@primer/react';
import { CalendarIcon, CheckCircleIcon, ClockIcon, NumberIcon } from '@primer/octicons-react';
import { useCallback, useState } from 'react';

interface HabitCreationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

type TrackingMode = 'time' | 'count' | 'binary';

/** Duration options showing active days (the actual commitment) */
const DURATION_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '21', label: '21 days' },
  { value: 'custom', label: 'Custom' },
];

/** Calculate approximate calendar duration based on active days and weekend setting */
function getCalendarDuration(activeDays: number, includesWeekends: boolean): string {
  // Calculate actual calendar days
  const calendarDays = includesWeekends 
    ? activeDays 
    : Math.ceil(activeDays / 5) * 7; // Weekdays only: 5 active days ≈ 7 calendar days
  
  // Show the most relevant unit based on the duration
  if (calendarDays <= 7) {
    return calendarDays === 1 ? '1 day' : `${calendarDays} days`;
  }
  
  const weeks = Math.round(calendarDays / 7);
  if (calendarDays <= 28) {
    return weeks === 1 ? '~1 week' : `~${weeks} weeks`;
  }
  
  const months = Math.round(calendarDays / 30);
  if (calendarDays <= 335) { // Up to ~11 months
    return months === 1 ? '~1 month' : `~${months} months`;
  }
  
  const years = Math.round(calendarDays / 365);
  return years === 1 ? '~1 year' : `~${years} years`;
}

export function HabitCreationDialog({ isOpen, onClose, onCreated }: HabitCreationDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('time');
  const [minMinutes, setMinMinutes] = useState('20');
  const [maxMinutes, setMaxMinutes] = useState('30');
  const [countTarget, setCountTarget] = useState('3');
  const [countUnit, setCountUnit] = useState('tests');
  const [totalDays, setTotalDays] = useState('14');
  const [customDays, setCustomDays] = useState('');
  const [includesWeekends, setIncludesWeekends] = useState(true);
  const [error, setError] = useState('');

  // Get actual days value (handles custom option)
  const getActiveDays = useCallback(() => {
    if (totalDays === 'custom') {
      const parsed = parseInt(customDays, 10);
      return isNaN(parsed) ? 0 : parsed;
    }
    return parseInt(totalDays, 10);
  }, [totalDays, customDays]);

  const handleSubmit = useCallback(() => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!description.trim()) {
      setError('Description is required');
      return;
    }

    try {
      let tracking: TrackingConfig;
      
      if (trackingMode === 'time') {
        const min = parseInt(minMinutes, 10);
        const max = maxMinutes ? parseInt(maxMinutes, 10) : undefined;
        
        if (isNaN(min) || min <= 0) {
          setError('Minimum minutes must be a positive number');
          return;
        }
        if (max !== undefined && (isNaN(max) || max < min)) {
          setError('Maximum minutes must be greater than minimum');
          return;
        }
        
        tracking = { mode: 'time', minMinutes: min, maxMinutes: max };
      } else if (trackingMode === 'count') {
        const target = parseInt(countTarget, 10);
        
        if (isNaN(target) || target <= 0) {
          setError('Count target must be a positive number');
          return;
        }
        if (!countUnit.trim()) {
          setError('Count unit is required');
          return;
        }
        
        tracking = { mode: 'count', target, unit: countUnit.trim() };
      } else {
        tracking = { mode: 'binary' };
      }

      const days = getActiveDays();
      if (days <= 0) {
        setError('Duration must be a positive number');
        return;
      }
      if (days > 365) {
        setError('Duration cannot exceed 365 days');
        return;
      }

      const habit = createHabit(title.trim(), description.trim(), tracking, days, includesWeekends);
      habitStore.create(habit);

      setTitle('');
      setDescription('');
      setError('');
      
      if (onCreated) onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create habit');
    }
  }, [title, description, trackingMode, minMinutes, maxMinutes, countTarget, countUnit, getActiveDays, includesWeekends, onClose, onCreated]);

  const handleTrackingModeChange = (index: number) => {
    const modes: TrackingMode[] = ['time', 'count', 'binary'];
    setTrackingMode(modes[index]);
  };

  if (!isOpen) return null;

  return (
    <Dialog
      title="Create New Habit"
      subtitle="Build consistency with daily practice"
      onClose={onClose}
      width="large"
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        { content: 'Create Habit', onClick: handleSubmit, buttonType: 'primary' },
      ]}
    >
      <Stack direction="vertical" gap="spacious">
        {/* Basic Info Section */}
        <div>
          <Stack direction="vertical" gap="normal">
            <FormControl required>
              <FormControl.Label>Habit name</FormControl.Label>
              <TextInput 
                block 
                value={title} 
                onChange={(e) => setTitle(e.target.value)} 
                placeholder="e.g., Daily CI focus"
                size="large"
              />
              <FormControl.Caption>Choose a clear, motivating name</FormControl.Caption>
            </FormControl>

            <FormControl required>
              <FormControl.Label>What will you do?</FormControl.Label>
              <Textarea 
                block 
                value={description} 
                onChange={(e) => setDescription(e.target.value)} 
                placeholder="e.g., Spend 20-30 min improving tests" 
                rows={2}
                resize="vertical"
              />
              <FormControl.Caption>Describe your daily commitment</FormControl.Caption>
            </FormControl>
          </Stack>
        </div>

        {/* Tracking Mode Section */}
        <div
          style={{
            padding: 'var(--base-size-16)',
            borderRadius: 'var(--borderRadius-medium)',
            border: '1px solid var(--borderColor-default)',
            backgroundColor: 'var(--bgColor-muted)',
          }}
        >
          <Stack direction="vertical" gap="normal">
            <Heading as="h4" className="f6">
              How do you want to track progress?
            </Heading>
            
            <SegmentedControl 
              aria-label="Tracking mode" 
              fullWidth
              onChange={handleTrackingModeChange}
            >
              <SegmentedControl.Button 
                selected={trackingMode === 'time'}
                leadingVisual={ClockIcon}
              >
                Time
              </SegmentedControl.Button>
              <SegmentedControl.Button 
                selected={trackingMode === 'count'}
                leadingVisual={NumberIcon}
              >
                Count
              </SegmentedControl.Button>
              <SegmentedControl.Button 
                selected={trackingMode === 'binary'}
                leadingVisual={CheckCircleIcon}
              >
                Check-in
              </SegmentedControl.Button>
            </SegmentedControl>

            {/* Time-based options */}
            {trackingMode === 'time' && (
              <div style={{ paddingTop: 'var(--base-size-8)' }}>
                <Stack direction="horizontal" gap="normal">
                  <FormControl>
                    <FormControl.Label>Min minutes/day</FormControl.Label>
                    <TextInput 
                      type="number" 
                      value={minMinutes} 
                      onChange={(e) => setMinMinutes(e.target.value)}
                      leadingVisual={ClockIcon}
                      trailingVisual={() => <span className="fgColor-muted f6">min</span>}
                      style={{ width: '140px' }}
                    />
                  </FormControl>
                  <FormControl>
                    <FormControl.Label>Max (optional)</FormControl.Label>
                    <TextInput 
                      type="number" 
                      value={maxMinutes} 
                      onChange={(e) => setMaxMinutes(e.target.value)}
                      trailingVisual={() => <span className="fgColor-muted f6">min</span>}
                      style={{ width: '140px' }}
                    />
                  </FormControl>
                </Stack>
                <p className="fgColor-muted f6" style={{ marginTop: 'var(--base-size-8)' }}>
                  Set a range to give yourself flexibility
                </p>
              </div>
            )}

            {/* Count-based options */}
            {trackingMode === 'count' && (
              <div style={{ paddingTop: 'var(--base-size-8)' }}>
                <Stack direction="horizontal" gap="normal" align="end">
                  <FormControl>
                    <FormControl.Label>Daily target</FormControl.Label>
                    <TextInput 
                      type="number" 
                      value={countTarget} 
                      onChange={(e) => setCountTarget(e.target.value)}
                      leadingVisual={NumberIcon}
                      style={{ width: '100px' }}
                    />
                  </FormControl>
                  <FormControl>
                    <FormControl.Label>Unit</FormControl.Label>
                    <TextInput 
                      value={countUnit} 
                      onChange={(e) => setCountUnit(e.target.value)} 
                      placeholder="tests"
                      style={{ width: '140px' }}
                    />
                  </FormControl>
                </Stack>
                <p className="fgColor-muted f6" style={{ marginTop: 'var(--base-size-8)' }}>
                  Example: 3 tests, 5 commits, 2 reviews
                </p>
              </div>
            )}

            {/* Binary options */}
            {trackingMode === 'binary' && (
              <div style={{ paddingTop: 'var(--base-size-8)' }}>
                <p className="fgColor-muted">
                  Simply check in each day to mark your habit complete. 
                  Perfect for habits like &quot;Read documentation&quot; or &quot;Review PRs&quot;.
                </p>
              </div>
            )}
          </Stack>
        </div>

        {/* Schedule & Duration Section */}
        <div
          style={{
            padding: 'var(--base-size-16)',
            borderRadius: 'var(--borderRadius-medium)',
            border: '1px solid var(--borderColor-default)',
            backgroundColor: 'var(--bgColor-muted)',
          }}
        >
          <Stack direction="vertical" gap="normal">
            <Heading as="h4" className="f6">
              <Stack direction="horizontal" gap="condensed" align="center">
                <CalendarIcon size={16} />
                <span>Schedule &amp; duration</span>
              </Stack>
            </Heading>

            {/* Schedule toggle FIRST - this affects how duration is interpreted */}
            <FormControl>
              <Checkbox 
                checked={includesWeekends} 
                onChange={(e) => setIncludesWeekends(e.target.checked)} 
              />
              <FormControl.Label>Practice on weekends too</FormControl.Label>
            </FormControl>

            {/* Duration selector */}
            <FormControl>
              <FormControl.Label>How many days to complete?</FormControl.Label>
              <RadioGroup name="duration" onChange={(value) => setTotalDays(value || '14')}>
                <Stack direction="horizontal" gap="normal" wrap="wrap" align="center">
                  {DURATION_OPTIONS.map((option) => (
                    <FormControl key={option.value}>
                      <Radio value={option.value} checked={totalDays === option.value} />
                      <FormControl.Label>{option.label}</FormControl.Label>
                    </FormControl>
                  ))}
                  {totalDays === 'custom' && (
                    <TextInput
                      type="number"
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value.replace(/\D/g, ''))}
                      placeholder="30"
                      min={1}
                      max={365}
                      style={{ width: '80px' }}
                      aria-label="Custom number of days"
                    />
                  )}
                </Stack>
              </RadioGroup>
            </FormControl>

            {/* Dynamic summary showing real commitment */}
            {getActiveDays() > 0 && (
              <div 
                style={{ 
                  padding: 'var(--base-size-12)',
                  borderRadius: 'var(--borderRadius-small)',
                  backgroundColor: 'var(--bgColor-accent-muted)',
                  border: '1px solid var(--borderColor-accent-muted)',
                }}
              >
                <p style={{ margin: 0, color: 'var(--fgColor-default)' }}>
                  <strong>Your commitment:</strong> {getActiveDays()} {includesWeekends ? 'consecutive' : 'weekday'} check-ins over {getCalendarDuration(getActiveDays(), includesWeekends)}
                </p>
              </div>
            )}
          </Stack>
        </div>

        {/* Error Display */}
        {error && (
          <Banner title="Error" variant="critical" description={error} />
        )}
      </Stack>
    </Dialog>
  );
}
