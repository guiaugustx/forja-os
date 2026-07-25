import { describe, it, expect } from 'vitest';
import { parseGrowth } from './growth';

describe('parseGrowth', () => {
  it('percentual positivo com sinal e símbolo', () => {
    expect(parseGrowth('+120%')).toBe(120);
  });

  it('percentual negativo', () => {
    expect(parseGrowth('-8%')).toBe(-8);
  });

  it('devolve null quando a entrada é null', () => {
    expect(parseGrowth(null)).toBeNull();
  });

  it('devolve null para string não numérica', () => {
    expect(parseGrowth('n/a')).toBeNull();
  });
});
