/**
 * Simple typed event bus for inter-module communication.
 * Modules communicate through events rather than direct imports.
 */

type EventHandler<T = any> = (data: T) => void;

export interface AppEvents {
  'file:loaded': { filename: string; contigs: number; textureSize: number };
  'file:error': { message: string };
  'camera:changed': { x: number; y: number; zoom: number };
  'mode:changed': { mode: string; previous: string };
  'contig:selected': { index: number; name: string };
  'contig:deselected': {};
  'curation:cut': { contigIndex: number; position: number };
  'curation:invert': { contigIndex: number };
  'curation:move': { fromIndex: number; toIndex: number };
  'curation:join': { contigIndex: number };
  'curation:undo': {};
  'curation:redo': {};
  'grid:toggled': { visible: boolean };
  'tracks:toggled': { track: string; visible: boolean };
  'colormap:changed': { name: string };
  'render:request': {};
  'tutorial:started': { lessonId: string };
  'tutorial:step-advanced': { lessonId: string; stepId: string };
  'tutorial:completed': { lessonId: string; score?: number };
}

class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  on<K extends keyof AppEvents>(event: K, handler: EventHandler<AppEvents[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  emit<K extends keyof AppEvents>(event: K, data: AppEvents[K]): void {
    this.handlers.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (e) {
        console.error(`Error in event handler for '${event}':`, e);
      }
    });
  }

  off<K extends keyof AppEvents>(event: K, handler: EventHandler<AppEvents[K]>): void {
    this.handlers.get(event)?.delete(handler);
  }
}

// Singleton
export const events = new EventBus();
