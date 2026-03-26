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
