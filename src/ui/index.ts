/**
 * Barrel export for all UI modules.
 *
 * Re-exports every public symbol so consumers can use a single import path.
 */

// AppContext (type-only)
export type { AppContext } from './AppContext';

// ToastNotifications
export { showToast } from './ToastNotifications';

// LoadingOverlay
export { showLoading, updateLoading, hideLoading } from './LoadingOverlay';

// ShortcutsModal
export { toggleShortcutsModal, setupShortcutsModal } from './ShortcutsModal';

// Sidebar
export { formatBp, updateSidebarContigList, updateSidebarScaffoldList, setupContigSearch } from './Sidebar';

// StatsPanel
export { updateStatsPanel } from './StatsPanel';

// TrackConfig
export { updateTrackConfigPanel } from './TrackConfig';

// ColorMapControls
export { cycleColorMap, syncGammaSlider, syncColormapDropdown } from './ColorMapControls';

// ModeManager
export { setMode } from './ModeManager';

// ComparisonMode
export { toggleComparisonMode, renderComparisonOverlay } from './ComparisonMode';

// Tooltip
export { updateTooltip, hideTooltip } from './Tooltip';

// MouseTracking
export { setupMouseTracking, updateCursor, setupDragReorder } from './MouseTracking';

// ClickInteractions
export { setupClickInteractions, getContigNameAt } from './ClickInteractions';

// CurationActions
export { performUndo, performRedo, invertSelectedContigs, cutAtCursorPosition, joinSelectedContigs, toggleContigExclusion } from './CurationActions';

// BatchActions
export { runBatchSelectByPattern, runBatchSelectBySize, runBatchCut, runBatchJoin, runBatchInvert, runSortByLength, runAutoSort, runAutoCut, undoLastBatch } from './BatchActions';

// ExportSession
export { exportAGP, takeScreenshot, saveSession, loadSession, exportBEDFile, exportFASTAFile, loadReferenceFasta, setupFastaUpload, loadBedGraphTrack, setupTrackUpload } from './ExportSession';

// FileLoading
export { loadPretextFile, loadExampleDataset, loadSpecimen, loadDemoData, setupFileDrop, setupFileInput } from './FileLoading';

// RenderLoop
export { startRenderLoop, renderCutIndicator, onCameraChange, updateDetailTiles } from './RenderLoop';

// ScriptConsole
export { isScriptConsoleVisible, toggleScriptConsole, setupScriptConsole, runScript } from './ScriptConsole';

// CommandPalette
export { isCommandPaletteVisible, toggleCommandPalette, setupCommandPalette } from './CommandPalette';

// KeyboardShortcuts
export { setupKeyboardShortcuts } from './KeyboardShortcuts';

// Toolbar
export { setupToolbar } from './Toolbar';

// SpecimenPicker
export { setupSpecimenPicker } from './SpecimenPicker';

// TutorialOverlay
export { setupTutorialOverlay } from './TutorialOverlay';

// TutorialManager
export { TutorialManager } from './TutorialManager';

// AssessmentPanel
export { setupAssessmentPanel } from './AssessmentPanel';

// PatternGallery
export { togglePatternGallery, setupPatternGallery } from './PatternGallery';

// Boot
export { boot } from './Boot';

// EventWiring
export { setupEventListeners, refreshAfterCuration, rebuildContigBoundaries } from './EventWiring';
