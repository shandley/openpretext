/**
 * AssemblyReset — the one place that forgets an assembly.
 *
 * Everything the app holds about the loaded assembly, outside `state.map`
 * itself, is dropped here: curation history, scaffolds, exclusions, tags,
 * flags, waypoints, tracks, sequences, analysis results, derived map views and
 * detail tiles. Each of these refers to the old assembly's contig ids, names
 * or coordinates, and is wrong (often silently) against any other.
 *
 * Call it before installing a new map, and when returning to the start
 * screen. State that belongs to a new kind of per-assembly feature must be
 * cleared here, not in the individual loaders.
 */

import type { AppContext } from './AppContext';
import { state } from '../core/State';
import { contigExclusion } from '../curation/ContigExclusion';
import { metaTags } from '../curation/MetaTagManager';
import { clearAnalysisTracks, clearEnhancedMap, updateFastaHint } from './AnalysisPanel';
import { resetOEMap } from './OEMapToggle';
import { closeCutReview, isCutReviewActive } from './CutReviewPanel';
import { isMacroRecording, toggleMacroRecording } from './MacroRecorder';

export function resetForNewAssembly(ctx: AppContext): void {
  const hadAssembly = state.get().map !== null;

  // Anything mid-flight that reads the history or the contig list.
  if (isCutReviewActive()) closeCutReview(ctx);
  if (isMacroRecording()) toggleMacroRecording(ctx);

  // Detail tiles and the cached finer overview are the old file's texels.
  if (ctx.tileDecodeDebounce !== null) { clearTimeout(ctx.tileDecodeDebounce); ctx.tileDecodeDebounce = null; }
  ctx.tileDecoder?.cancel();
  if (ctx.tileManager) { ctx.tileManager.dispose(); ctx.tileManager = null; }
  ctx.faithfulOverviewOriginal = null;

  // Derived views. Leaving the O/E view first restores the colour settings it
  // replaced, so the new file's contrast is not overwritten afterwards.
  resetOEMap(ctx);
  clearAnalysisTracks(ctx); // analysis caches, model output, misassembly flags
  clearEnhancedMap();

  // Curation state keyed by contig id or order index.
  state.clearHistory();
  ctx.scaffoldManager.clear();
  contigExclusion.clearAll();
  metaTags.clearAll();
  ctx.waypointManager.clearAll();
  ctx.currentWaypointId = null;
  ctx.hoveredContigIndex = -1;
  ctx.flashHighlightUntil = 0;

  // Tracks and sequences. A FASTA loaded before any map is kept for the map
  // about to arrive; one loaded alongside a previous assembly is not, because
  // contig names such as "scaffold_1" recur between assemblies and the export
  // would take the wrong sequence without complaint.
  ctx.trackRenderer?.clearTracks();
  ctx.fastaTrackData = null;
  if (hadAssembly) ctx.referenceSequences = null;
  updateFastaHint(ctx);

  // Before/after comparison and progress baselines.
  ctx.metricsTracker.clear();
  ctx.comparisonSnapshot = null;
  ctx.comparisonInvertedSnapshot = null;
  ctx.comparisonVisible = false;
  ctx.progressReference = null;
  ctx.previousProgress = null;

  ctx.updateUndoHistoryPanel();
  ctx.updateTrackConfigPanel();
}
