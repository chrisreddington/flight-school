/**
 * Habit Creation Dialog
 * 
 * Form for creating new habits with guardrails.
 * Supports three tracking modes: time, count, binary.
 */

import { habitStore } from '@/lib/habits';
import { createHabit, type TrackingConfig } from '@/lib/habits/types';
import { Dialog, FormControl, Radio, RadioGroup, Select, Textarea, TextInput } from '@primer/react';
import { useCallback, useState } from 'react';

interface HabitCreationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

type TrackingMode = 'time' | 'count' | 'binary';

export function HabitCreationDialog({ isOpen, onClose, onCreated }: HabitCreationDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('time');
  const [minMinutes, setMinMinutes] = useState('20');
  const [maxMinutes, setMaxMinutes] = useState('30');
  const [countTarget, setCountTarget] = useState('3');
  const [countUnit, setCountUnit] = useState('tests');
  const [totalDays, setTotalDays] = useState('14');
  const [includesWeekends, setIncludesWeekends] = useState(false);
  const [error, setError] = useState('');

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

      const days = parseInt(totalDays, 10);
      if (isNaN(days) || days <= 0) {
        setError('Duration must be a positive number');
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
  }, [title, description, trackingMode, minMinutes, maxMinutes, countTarget, countUnit, totalDays, includesWeekends, onClose, onCreated]);

  if (!isOpen) return null;

  return (
    <Dialog
      title="Create New Habit"
      onClose={onClose}
      footerButtons={[
        { content: 'Cancel', onClick: onClose },
        { content: 'Create Habit', onClick: handleSubmit, buttonType: 'primary' },
      ]}
    >
      <FormControl>
        <FormControl.Label>Title</FormControl.Label>
        <TextInput block value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Daily CI focus" />
      </FormControl>

      <FormControl>
        <FormControl.Label>Description</FormControl.Label>
        <Textarea block value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Spend 20-30 min improving tests" rows={3} />
      </FormControl>

      <FormControl>
        <FormControl.Label>Tracking Mode</FormControl.Label>
        <RadioGroup name="trackingMode" onChange={(value) => setTrackingMode(value as TrackingMode)}>
          <FormControl><Radio value="time" checked={trackingMode === 'time'} /><FormControl.Label>Time-based (timer)</FormControl.Label></FormControl>
          <FormControl><Radio value="count" checked={trackingMode === 'count'} /><FormControl.Label>Count-based</FormControl.Label></FormControl>
          <FormControl><Radio value="binary" checked={trackingMode === 'binary'} /><FormControl.Label>Yes/No check-in</FormControl.Label></FormControl>
        </RadioGroup>
      </FormControl>

      {trackingMode === 'time' && (
        <>
          <FormControl><FormControl.Label>Min Minutes/Day</FormControl.Label><TextInput type="number" value={minMinutes} onChange={(e) => setMinMinutes(e.target.value)} /></FormControl>
          <FormControl><FormControl.Label>Max Minutes/Day (optional)</FormControl.Label><TextInput type="number" value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} /></FormControl>
        </>
      )}

      {trackingMode === 'count' && (
        <>
          <FormControl><FormControl.Label>Daily Target</FormControl.Label><TextInput type="number" value={countTarget} onChange={(e) => setCountTarget(e.target.value)} /></FormControl>
          <FormControl><FormControl.Label>Unit</FormControl.Label><TextInput value={countUnit} onChange={(e) => setCountUnit(e.target.value)} placeholder="tests" /></FormControl>
        </>
      )}

      <FormControl>
        <FormControl.Label>Duration</FormControl.Label>
        <Select value={totalDays} onChange={(e) => setTotalDays(e.target.value)}>
          <Select.Option value="7">7 days</Select.Option>
          <Select.Option value="14">14 days</Select.Option>
          <Select.Option value="21">21 days</Select.Option>
          <Select.Option value="30">30 days</Select.Option>
        </Select>
      </FormControl>

      <FormControl>
        <FormControl.Label>
          <input type="checkbox" checked={includesWeekends} onChange={(e) => setIncludesWeekends(e.target.checked)} style={{ marginRight: '8px' }} />
          Include weekends
        </FormControl.Label>
      </FormControl>

      {error && <div style={{ color: "var(--fgColor-danger)", marginTop: "8px" }}>{error}</div>}
    </Dialog>
  );
}
