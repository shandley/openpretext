import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showToast } from '../../src/ui/ToastNotifications';

// ---------------------------------------------------------------------------
// DOM mocking helpers for node environment
// ---------------------------------------------------------------------------

function createMockElement(tag = 'div'): any {
  const classes = new Set<string>();
  const children: any[] = [];
  return {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    classList: {
      add: vi.fn((cls: string) => classes.add(cls)),
      remove: vi.fn((cls: string) => classes.delete(cls)),
      has: (cls: string) => classes.has(cls),
    },
    appendChild: vi.fn((child: any) => { children.push(child); }),
    remove: vi.fn(),
    _children: children,
    _classes: classes,
  };
}

// ---------------------------------------------------------------------------
// showToast tests
// ---------------------------------------------------------------------------

describe('showToast', () => {
  let container: ReturnType<typeof createMockElement>;
  let createdElement: ReturnType<typeof createMockElement>;
  let rafCallbacks: Array<() => void>;
  let originalGetElementById: typeof document.getElementById;
  let originalCreateElement: typeof document.createElement;
  let originalRAF: typeof globalThis.requestAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();

    container = createMockElement();
    createdElement = createMockElement();
    rafCallbacks = [];

    // Mock document.getElementById
    originalGetElementById = globalThis.document?.getElementById;
    globalThis.document = {
      getElementById: vi.fn((id: string) => {
        if (id === 'toast-container') return container;
        return null;
      }),
      createElement: vi.fn((_tag: string) => {
        return createdElement;
      }),
    } as any;

    // Mock requestAnimationFrame
    originalRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb as unknown as () => void);
      return 1;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore globals
    if (originalGetElementById) {
      (globalThis as any).document = undefined;
    }
    if (originalRAF) {
      globalThis.requestAnimationFrame = originalRAF;
    }
  });

  it('should do nothing when toast-container is not found', () => {
    (document.getElementById as ReturnType<typeof vi.fn>).mockReturnValue(null);
    showToast('test');
    expect(document.createElement).not.toHaveBeenCalled();
  });

  it('should create a toast element with class "toast"', () => {
    showToast('Hello world');
    expect(document.createElement).toHaveBeenCalledWith('div');
    expect(createdElement.className).toBe('toast');
  });

  it('should set the toast text content to the message', () => {
    showToast('My message');
    expect(createdElement.textContent).toBe('My message');
  });

  it('should append the toast to the container', () => {
    showToast('Test');
    expect(container.appendChild).toHaveBeenCalledWith(createdElement);
  });

  it('should add "visible" class via requestAnimationFrame', () => {
    showToast('Test');
    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();

    // Simulate the rAF callback
    rafCallbacks.forEach(cb => cb());
    expect(createdElement.classList.add).toHaveBeenCalledWith('visible');
  });

  it('should remove "visible" class after the specified duration', () => {
    showToast('Test', 3000);

    // Advance past the duration
    vi.advanceTimersByTime(3000);
    expect(createdElement.classList.remove).toHaveBeenCalledWith('visible');
  });

  it('should remove the toast element 300ms after removing visible class', () => {
    showToast('Test', 2000);

    // Advance past the duration
    vi.advanceTimersByTime(2000);
    expect(createdElement.remove).not.toHaveBeenCalled();

    // Advance past the 300ms cleanup delay
    vi.advanceTimersByTime(300);
    expect(createdElement.remove).toHaveBeenCalled();
  });

  it('should use default duration of 2000ms when not specified', () => {
    showToast('Test');

    // Not removed at 1999ms
    vi.advanceTimersByTime(1999);
    expect(createdElement.classList.remove).not.toHaveBeenCalledWith('visible');

    // Removed at 2000ms
    vi.advanceTimersByTime(1);
    expect(createdElement.classList.remove).toHaveBeenCalledWith('visible');
  });
});
