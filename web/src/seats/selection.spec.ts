import { describe, it, expect, beforeEach } from 'vitest';
import { SELECTION_STORAGE_KEY, loadSelection, saveSelection, clearSelection } from './selection';

describe('seat selection persistence (sessionStorage)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns an empty array when nothing is stored', () => {
    expect(loadSelection()).toEqual([]);
  });

  it('round-trips a selection through save/load', () => {
    saveSelection(['550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440011']);
    expect(loadSelection()).toEqual([
      '550e8400-e29b-41d4-a716-446655440010',
      '550e8400-e29b-41d4-a716-446655440011',
    ]);
  });

  it('saveSelection([]) clears the stored selection', () => {
    saveSelection(['a', 'b']);
    saveSelection([]);
    expect(loadSelection()).toEqual([]);
    expect(sessionStorage.getItem(SELECTION_STORAGE_KEY)).toBeNull();
  });

  it('clearSelection removes the stored selection', () => {
    saveSelection(['a', 'b']);
    clearSelection();
    expect(loadSelection()).toEqual([]);
  });

  it('loadSelection tolerates malformed JSON', () => {
    sessionStorage.setItem(SELECTION_STORAGE_KEY, '{not json');
    expect(loadSelection()).toEqual([]);
  });

  it('loadSelection ignores a non-array payload', () => {
    sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify({ id: 'x' }));
    expect(loadSelection()).toEqual([]);
  });

  it('loadSelection drops non-string entries', () => {
    sessionStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(['a', 7, 'b', null]));
    expect(loadSelection()).toEqual(['a', 'b']);
  });
});