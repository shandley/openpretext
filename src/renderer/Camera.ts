/**
 * Camera controller for the contact map.
 * Handles pan (drag), zoom (scroll/pinch), and smooth animations.
 * 
 * Coordinate system:
 * - Map space: (0,0) top-left to (1,1) bottom-right of the contact matrix
 * - The camera center and zoom define what portion of the map is visible
 */

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export class Camera {
  // Current state
  x: number = 0.5;
  y: number = 0.5;
  zoom: number = 1.0;

  // Zoom limits
  minZoom: number = 0.5;
  maxZoom: number = 200.0;

  // When true, left-click does NOT pan (used by edit/scaffold modes)
  leftClickBlocked: boolean = false;

  // Drag state (mouse)
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragStartCamX: number = 0;
  private dragStartCamY: number = 0;

  // Touch state
  private activeTouches: Map<number, { x: number; y: number }> = new Map();
  private touchStartCamX: number = 0;
  private touchStartCamY: number = 0;
  private touchStartZoom: number = 1;
  private touchStartDist: number = 0;
  private touchStartCenterX: number = 0;
  private touchStartCenterY: number = 0;

  // Animation
  private animating: boolean = false;
  private animTarget: CameraState | null = null;
  private animStart: CameraState | null = null;
  private animStartTime: number = 0;
  private animDuration: number = 300;

  private canvas: HTMLCanvasElement;
  private onChange: (state: CameraState) => void;

  constructor(canvas: HTMLCanvasElement, onChange: (state: CameraState) => void) {
    this.canvas = canvas;
    this.onChange = onChange;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    const canvas = this.canvas;

    // Mouse drag for panning
    canvas.addEventListener('mousedown', (e) => {
      // In non-navigate modes, left-click is for interactions, not panning
      if (e.button === 0 && this.leftClickBlocked) return;
      if (e.button === 0 || e.button === 2) { // left or right click
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragStartCamX = this.x;
        this.dragStartCamY = this.y;
        canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      
      const dx = (e.clientX - this.dragStartX) / canvas.clientWidth;
      const dy = (e.clientY - this.dragStartY) / canvas.clientHeight;
      
      const scale = 1 / this.zoom;
      this.x = this.dragStartCamX - dx * scale;
      this.y = this.dragStartCamY - dy * scale;
      
      this.clamp();
      this.emitChange();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        canvas.style.cursor = 'grab';
      }
    });

    // Scroll for zoom (also handles trackpad pinch via ctrlKey)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / rect.width;
      const mouseY = (e.clientY - rect.top) / rect.height;

      if (e.ctrlKey) {
        // Trackpad pinch gesture (macOS sends ctrlKey + wheel for pinch)
        // Use a larger multiplier for smoother pinch feel
        const delta = -e.deltaY * 0.01;
        const factor = Math.exp(delta);
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));

        const zoomRatio = newZoom / this.zoom;
        const mapMouseX = this.x + (mouseX - 0.5) / this.zoom;
        const mapMouseY = this.y + (mouseY - 0.5) / this.zoom;

        this.x = mapMouseX - (mapMouseX - this.x) / zoomRatio;
        this.y = mapMouseY - (mapMouseY - this.y) / zoomRatio;
        this.zoom = newZoom;
      } else {
        // Normal scroll wheel zoom
        const delta = -e.deltaY * 0.001;
        const factor = Math.exp(delta);
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));

        const zoomRatio = newZoom / this.zoom;
        const mapMouseX = this.x + (mouseX - 0.5) / this.zoom;
        const mapMouseY = this.y + (mouseY - 0.5) / this.zoom;

        this.x = mapMouseX - (mapMouseX - this.x) / zoomRatio;
        this.y = mapMouseY - (mapMouseY - this.y) / zoomRatio;
        this.zoom = newZoom;
      }

      this.clamp();
      this.emitChange();
    }, { passive: false });

    // Prevent context menu
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      // Jump to diagonal (J key in PretextView)
      if (e.key === 'j' || e.key === 'J') {
        this.jumpToDiagonal();
      }
      // Reset view (Home)
      if (e.key === 'Home') {
        this.resetView();
      }
    });

    // Touch events for mobile/tablet and trackpad gestures
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.updateTouches(e);

      if (e.touches.length === 1) {
        // Single finger: start pan
        const t = e.touches[0];
        this.touchStartCamX = this.x;
        this.touchStartCamY = this.y;
        this.touchStartCenterX = t.clientX;
        this.touchStartCenterY = t.clientY;
      } else if (e.touches.length === 2) {
        // Two fingers: start pinch-zoom
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        this.touchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        this.touchStartZoom = this.zoom;
        this.touchStartCamX = this.x;
        this.touchStartCamY = this.y;
        this.touchStartCenterX = (t0.clientX + t1.clientX) / 2;
        this.touchStartCenterY = (t0.clientY + t1.clientY) / 2;
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();

      if (e.touches.length === 1) {
        // Single finger: pan
        const t = e.touches[0];
        const dx = (t.clientX - this.touchStartCenterX) / canvas.clientWidth;
        const dy = (t.clientY - this.touchStartCenterY) / canvas.clientHeight;
        const scale = 1 / this.zoom;
        this.x = this.touchStartCamX - dx * scale;
        this.y = this.touchStartCamY - dy * scale;
        this.clamp();
        this.emitChange();
      } else if (e.touches.length === 2) {
        // Two fingers: pinch-zoom + pan
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const currentDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const centerX = (t0.clientX + t1.clientX) / 2;
        const centerY = (t0.clientY + t1.clientY) / 2;

        // Zoom based on pinch distance change
        if (this.touchStartDist > 0) {
          const zoomRatio = currentDist / this.touchStartDist;
          const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.touchStartZoom * zoomRatio));

          // Zoom toward pinch center
          const rect = canvas.getBoundingClientRect();
          const pinchNormX = (this.touchStartCenterX - rect.left) / rect.width;
          const pinchNormY = (this.touchStartCenterY - rect.top) / rect.height;
          const mapPinchX = this.touchStartCamX + (pinchNormX - 0.5) / this.touchStartZoom;
          const mapPinchY = this.touchStartCamY + (pinchNormY - 0.5) / this.touchStartZoom;

          this.x = mapPinchX - (pinchNormX - 0.5) / newZoom;
          this.y = mapPinchY - (pinchNormY - 0.5) / newZoom;
          this.zoom = newZoom;
        }

        // Also pan with the two-finger center movement
        const dx = (centerX - this.touchStartCenterX) / canvas.clientWidth;
        const dy = (centerY - this.touchStartCenterY) / canvas.clientHeight;
        const scale = 1 / this.zoom;
        this.x -= dx * scale * 0.5;
        this.y -= dy * scale * 0.5;

        this.clamp();
        this.emitChange();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.activeTouches.clear();

      // If one finger lifted from pinch, reset single-finger pan start
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.touchStartCamX = this.x;
        this.touchStartCamY = this.y;
        this.touchStartCenterX = t.clientX;
        this.touchStartCenterY = t.clientY;
      }
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      this.activeTouches.clear();
    }, { passive: false });
  }

  /**
   * Update the internal touch tracking map from a TouchEvent.
   */
  private updateTouches(e: TouchEvent): void {
    this.activeTouches.clear();
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      this.activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }

  /**
   * Smoothly animate to a target position.
   */
  animateTo(target: Partial<CameraState>, duration: number = 300): void {
    this.animStart = { x: this.x, y: this.y, zoom: this.zoom };
    this.animTarget = {
      x: target.x ?? this.x,
      y: target.y ?? this.y,
      zoom: target.zoom ?? this.zoom,
    };
    this.animStartTime = performance.now();
    this.animDuration = duration;
    this.animating = true;
    this.tick();
  }

  private tick = (): void => {
    if (!this.animating || !this.animStart || !this.animTarget) return;
    
    const elapsed = performance.now() - this.animStartTime;
    const t = Math.min(1, elapsed / this.animDuration);
    
    // Ease out cubic
    const ease = 1 - Math.pow(1 - t, 3);
    
    this.x = this.animStart.x + (this.animTarget.x - this.animStart.x) * ease;
    this.y = this.animStart.y + (this.animTarget.y - this.animStart.y) * ease;
    this.zoom = this.animStart.zoom + (this.animTarget.zoom - this.animStart.zoom) * ease;
    
    this.emitChange();
    
    if (t < 1) {
      requestAnimationFrame(this.tick);
    } else {
      this.animating = false;
    }
  };

  jumpToDiagonal(): void {
    // Jump so the current view is centered on the diagonal
    // Keep zoom, just adjust x=y
    const center = (this.x + this.y) / 2;
    this.animateTo({ x: center, y: center });
  }

  resetView(): void {
    this.animateTo({ x: 0.5, y: 0.5, zoom: 1.0 });
  }

  /**
   * Zoom to fit a specific region (in map coordinates 0-1).
   */
  zoomToRegion(x1: number, y1: number, x2: number, y2: number): void {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    const maxDim = Math.max(width, height);
    const zoom = 1 / maxDim;
    
    this.animateTo({ x: cx, y: cy, zoom: Math.min(zoom, this.maxZoom) });
  }

  private clamp(): void {
    // Allow some overscroll but keep the map mostly visible
    const margin = 0.5 / this.zoom;
    this.x = Math.max(-margin, Math.min(1 + margin, this.x));
    this.y = Math.max(-margin, Math.min(1 + margin, this.y));
  }

  private emitChange(): void {
    this.onChange({ x: this.x, y: this.y, zoom: this.zoom });
  }

  getState(): CameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }
}
