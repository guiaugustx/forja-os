import { describe, it, expect } from 'vitest';
import { extractGatewayFromUrl } from './gateway';

describe('extractGatewayFromUrl', () => {
  it('tira o rótulo da marca de um host com prefixo pay e TLD composto', () => {
    expect(extractGatewayFromUrl('https://pay.cakto.com.br/produto-a')).toBe('cakto');
  });

  it('tira o rótulo da marca de um host com prefixo pay e TLD simples', () => {
    expect(extractGatewayFromUrl('https://pay.kirvano.com/checkout/xyz')).toBe('kirvano');
  });

  it('funciona sem prefixo de subdomínio', () => {
    expect(extractGatewayFromUrl('https://kiwify.com.br/x')).toBe('kiwify');
  });

  it('devolve null para URL inválida', () => {
    expect(extractGatewayFromUrl('não é url')).toBeNull();
  });
});
