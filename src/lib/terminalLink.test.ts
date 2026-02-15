import { describe, it, expect } from 'vitest';
import { shouldOpenTerminalLink } from './terminal';

function createMouseEvent(button: number, modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}) {
  return {
    button,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  } as MouseEvent;
}

describe('shouldOpenTerminalLink', () => {
  it('returns true for Ctrl + left click', () => {
    expect(shouldOpenTerminalLink(createMouseEvent(0, { ctrlKey: true }))).toBe(true);
  });

  it('returns true for Cmd + left click', () => {
    expect(shouldOpenTerminalLink(createMouseEvent(0, { metaKey: true }))).toBe(true);
  });

  it('returns false without modifier key', () => {
    expect(shouldOpenTerminalLink(createMouseEvent(0))).toBe(false);
  });

  it('returns false for non-left button clicks', () => {
    expect(shouldOpenTerminalLink(createMouseEvent(2, { ctrlKey: true }))).toBe(false);
  });
});
