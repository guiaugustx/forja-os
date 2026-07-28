import { describe, it, expect } from 'vitest';
import { baseDomainOf, registrableDomainOf } from './baseDomain';

describe('baseDomainOf', () => {
  it('mesmo nome-base em TLDs diferentes colapsa no mesmo rótulo', () => {
    expect(baseDomainOf('unlockprofile.lat')).toBe('unlockprofile');
    expect(baseDomainOf('unlockprofile.site')).toBe('unlockprofile');
    expect(baseDomainOf('unlockprofile.xyz')).toBe('unlockprofile');
  });

  it('sufixo composto é tratado pela PSL (foo.com.br → foo, não com)', () => {
    expect(baseDomainOf('metodoxyz.com.br')).toBe('metodoxyz');
    expect(baseDomainOf('loja.tienda.ar')).toBe('tienda');
  });

  it('subdomínio é ignorado — conta o registrável', () => {
    expect(baseDomainOf('www.unlockprofile.site')).toBe('unlockprofile');
    expect(baseDomainOf('checkout.metodoxyz.com.br')).toBe('metodoxyz');
  });

  it('normaliza caixa e espaços', () => {
    expect(baseDomainOf('  UnlockProfile.SITE ')).toBe('unlockprofile');
  });

  it('nomes-base diferentes não colidem', () => {
    expect(baseDomainOf('tryreportprofiler.site')).toBe('tryreportprofiler');
    expect(baseDomainOf('unlockprofile.site')).toBe('unlockprofile');
  });

  it('IP, vazio e nulo → null (nunca agrupam)', () => {
    expect(baseDomainOf('127.0.0.1')).toBeNull();
    expect(baseDomainOf('')).toBeNull();
    expect(baseDomainOf(null)).toBeNull();
    expect(baseDomainOf(undefined)).toBeNull();
  });

  // A regressão que quase passou: sem allowPrivateDomains, TODO site em
  // pages.dev/vercel.app/etc. viraria o mesmo nome-base ("pages"), colapsando
  // ofertas distintas. Com a flag, o subdomínio É o nome-base.
  it('hospedagem na seção PRIVADA da PSL usa o subdomínio como nome-base', () => {
    expect(baseDomainOf('vslfacebook.pages.dev')).toBe('vslfacebook');
    expect(baseDomainOf('menshealth-bcj.pages.dev')).toBe('menshealth-bcj');
    expect(baseDomainOf('promo-kit.vercel.app')).toBe('promo-kit');
    expect(baseDomainOf('curso.netlify.app')).toBe('curso');
    expect(baseDomainOf('loja-2026-4.myshopify.com')).toBe('loja-2026-4');
  });
});

describe('registrableDomainOf', () => {
  it('devolve o registrável COM sufixo', () => {
    expect(registrableDomainOf('www.unlockprofile.site')).toBe('unlockprofile.site');
    expect(registrableDomainOf('checkout.metodoxyz.com.br')).toBe('metodoxyz.com.br');
  });

  it('subdomínios do MESMO registrável colapsam no mesmo registrável', () => {
    expect(registrableDomainOf('fra.safefamilymonitor.com')).toBe('safefamilymonitor.com');
    expect(registrableDomainOf('esp.safefamilymonitor.com')).toBe('safefamilymonitor.com');
  });

  it('mesma marca em TLDs diferentes → registráveis diferentes (isto é spray)', () => {
    expect(registrableDomainOf('unlockprofile.lat')).toBe('unlockprofile.lat');
    expect(registrableDomainOf('unlockprofile.site')).toBe('unlockprofile.site');
    expect(registrableDomainOf('unlockprofile.xyz')).toBe('unlockprofile.xyz');
  });

  it('hospedagem privada: cada site é seu próprio registrável', () => {
    expect(registrableDomainOf('vslfacebook.pages.dev')).toBe('vslfacebook.pages.dev');
    expect(registrableDomainOf('menshealth-bcj.pages.dev')).toBe('menshealth-bcj.pages.dev');
  });

  it('IP/vazio/nulo → null', () => {
    expect(registrableDomainOf('127.0.0.1')).toBeNull();
    expect(registrableDomainOf(null)).toBeNull();
  });
});
