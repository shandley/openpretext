/**
 * LessonBrowser — modal listing all available tutorial lessons.
 *
 * Shows lesson title, difficulty badge, estimated time, and introduction excerpt.
 * Clicking a lesson card starts it via TutorialManager.
 */

import type { AppContext } from './AppContext';

interface LessonMeta {
  id: string;
  title: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  introExcerpt: string;
}

const LESSONS: LessonMeta[] = [
  { id: '01-reading-the-map', title: 'Reading a Hi-C Contact Map', difficulty: 'beginner', estimatedMinutes: 10, introExcerpt: 'Learn how to read and interpret a Hi-C contact map. Explore the wrasse genome and identify key features like the diagonal, chromosome blocks, and navigation tools.' },
  { id: '02-understanding-chromosomes', title: 'Understanding Chromosome Structure', difficulty: 'beginner', estimatedMinutes: 15, introExcerpt: 'Discover how chromosomes appear as bright square blocks along the diagonal and learn to distinguish inter- vs intra-chromosomal contacts.' },
  { id: '03-detecting-misassembly', title: 'Detecting Misassembly Patterns', difficulty: 'intermediate', estimatedMinutes: 15, introExcerpt: 'Learn to spot common misassembly signatures in Hi-C maps including chimeric joins, inversions, and translocations.' },
  { id: '04-cutting-and-joining', title: 'Cutting and Joining Contigs', difficulty: 'intermediate', estimatedMinutes: 20, introExcerpt: 'Practice the core curation operations: cutting misassembled contigs and joining fragments that belong together.' },
  { id: '05-scaffold-assignment', title: 'Manual Scaffold Assignment', difficulty: 'intermediate', estimatedMinutes: 20, introExcerpt: 'Assign contigs to chromosome scaffolds manually and learn to organize a genome assembly into pseudo-chromosomes.' },
  { id: '06-full-curation-exercise', title: 'Full Curation Exercise', difficulty: 'advanced', estimatedMinutes: 30, introExcerpt: 'Put all skills together in a complete genome curation workflow from start to finish on a real assembly.' },
  { id: '07-analysis-workflow', title: '3D Genomics Analysis', difficulty: 'intermediate', estimatedMinutes: 20, introExcerpt: 'Run insulation scores, P(s) decay, and compartment analysis to assess assembly quality using 3D genomics metrics.' },
  { id: '08-contig-classification', title: 'Classifying Contigs with Meta Tags', difficulty: 'intermediate', estimatedMinutes: 15, introExcerpt: 'Learn to classify contigs as haplotigs, contaminants, or sex chromosomes using meta tags for better assembly organization.' },
  { id: '09-automated-misassembly', title: 'Automated Misassembly Detection', difficulty: 'advanced', estimatedMinutes: 25, introExcerpt: 'Use the automated detection pipeline combining TAD boundaries, compartment switching, and pattern recognition to find misassemblies.' },
  { id: '10-ml-enhancement', title: 'ML-Powered Enhancement (Evo2HiC)', difficulty: 'intermediate', estimatedMinutes: 20, introExcerpt: 'Connect to the Evo2HiC server to enhance contact maps, predict epigenomic tracks, and compare observed vs sequence-predicted Hi-C patterns.' },
  { id: '11-exercise-cockle', title: 'Exercise: Curate a Mollusc (Prickly Cockle)', difficulty: 'intermediate', estimatedMinutes: 20, introExcerpt: 'A self-directed exercise on a real, uncurated Darwin Tree of Life assembly. Assess and refine the prickly cockle genome yourself, with no answer key, just as a curator meets a newly assembled species.' },
  { id: '12-exercise-starfish', title: 'Exercise: Fix a Fragmented Assembly (Goose-foot Starfish)', difficulty: 'advanced', estimatedMinutes: 30, introExcerpt: 'A hands-on fix-it exercise on a real, uncurated starfish assembly. Separate the real chromosomes from a large unplaced tail, triage haplotigs and placeable contigs, and refine the core by hand.' },
  { id: '13-exercise-celegans', title: 'Exercise: Verify a Model Genome (C. elegans)', difficulty: 'beginner', estimatedMinutes: 15, introExcerpt: 'A gentle verification exercise on the roundworm C. elegans, whose six chromosomes give you a known target. Learn what a near-complete assembly looks like and when to leave it alone.' },
  { id: '14-exercise-mushroom', title: 'Exercise: Read a Compact Genome (Button Mushroom)', difficulty: 'intermediate', estimatedMinutes: 15, introExcerpt: 'A short exercise on reading a small, dense fungal genome. Tune the contrast controls to see the structure under the density, and learn not to mistake compactness for disorder.' },
  { id: '15-exercise-earthworm', title: 'Exercise: Curate at Scale (Green Worm)', difficulty: 'advanced', estimatedMinutes: 30, introExcerpt: 'A fix-it exercise on a heavily fragmented assembly (nearly 8,000 contigs). Learn where to spend effort: build the real chromosomes, let auto-sort organise the mass, and accept an honest unplaced bin.' },
  { id: '16-exercise-maple', title: 'Exercise: Read a Busy Map (Sycamore Maple)', difficulty: 'advanced', estimatedMinutes: 25, introExcerpt: 'The hardest exercise: a plant genome with a busy off-diagonal checkerboard. Reason about whether it is biology (compartments) or an assembly problem before curating, and practise restraint.' },
];

export function isLessonBrowserVisible(): boolean {
  const modal = document.getElementById('lesson-browser-modal');
  return modal?.classList.contains('visible') ?? false;
}

export function toggleLessonBrowser(ctx: AppContext): void {
  const modal = document.getElementById('lesson-browser-modal');
  if (!modal) return;

  if (modal.classList.contains('visible')) {
    modal.classList.remove('visible');
  } else {
    renderLessonList(ctx);
    modal.classList.add('visible');
  }
}

function renderLessonList(ctx: AppContext): void {
  const list = document.getElementById('lesson-browser-list');
  if (!list) return;

  list.innerHTML = '';
  for (const lesson of LESSONS) {
    const item = document.createElement('div');
    item.className = 'lesson-item';
    item.innerHTML = `
      <div class="lesson-item-header">
        <span class="lesson-item-title">${lesson.title}</span>
        <span class="lesson-badge ${lesson.difficulty}">${lesson.difficulty}</span>
        <span class="lesson-time">${lesson.estimatedMinutes} min</span>
      </div>
      <div class="lesson-desc">${lesson.introExcerpt}</div>
    `;
    item.addEventListener('click', () => {
      document.getElementById('lesson-browser-modal')?.classList.remove('visible');
      ctx.tutorialManager?.startLesson(ctx, lesson.id);
    });
    list.appendChild(item);
  }
}

export function setupLessonBrowser(ctx: AppContext): void {
  const modal = document.getElementById('lesson-browser-modal');
  if (!modal) return;

  // Click backdrop to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('visible');
  });

  // Esc to close (handled at capture phase so it doesn't conflict)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('visible')) {
      modal.classList.remove('visible');
      e.stopPropagation();
    }
  });
}
