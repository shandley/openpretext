import { describe, it, expect } from 'vitest';
import { escapeHtml, cssColor } from '../../src/ui/Html';

describe('escapeHtml', () => {
  it('escapes everything that can open a tag, an entity or leave an attribute', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&\``))
      .toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;&#96;');
  });

  it('leaves ordinary contig names alone', () => {
    for (const name of ['scaffold_12', 'SUPER_1_unloc_3', 'ptg000001l|arrow', 'chr1:1-200', 'a.b-c+d']) {
      expect(escapeHtml(name)).toBe(name);
    }
  });

  it('accepts non-strings', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('cssColor', () => {
  it('passes hex, rgb/hsl and named colours', () => {
    for (const c of ['#fff', '#e6194B', '#11223344', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(120 50% 50% / 0.3)', 'red']) {
      expect(cssColor(c)).toBe(c);
    }
    expect(cssColor('  #abc ')).toBe('#abc');
  });

  it('replaces anything that could leave the style attribute or add to it', () => {
    for (const c of [
      'red" onmouseover="x', 'red;background:url(//evil)', 'url(javascript:1)', '#12', '#ggg',
      'rgb(1,2,3);x', 'expression(alert(1))', '', 'var(--x)', "red'",
    ]) {
      expect(cssColor(c)).toBe('#888888');
    }
    expect(cssColor(undefined, '#000')).toBe('#000');
    expect(cssColor(7 as unknown)).toBe('#888888');
  });
});
