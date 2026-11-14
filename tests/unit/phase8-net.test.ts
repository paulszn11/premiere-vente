// Phase 8 : cryptographie de la mise en relation et des preuves, encodage MQTT.

import { describe, expect, it } from 'vitest';
import { mqttConnect, mqttPublish, mqttReadPublish, mqttSplit, mqttSubscribe } from '../../src/client/net/signaling';
import { checkCodeProof, checkIdentityProof, codeProof, deriveWorldKeys, identityProof, identityVerifier, newChallenge, newIdentity, openMessage, readRecoveryKey, recoveryKey, sealMessage } from '../../src/shared/net-crypto';
import { generateWorldCode } from '../../src/shared/worldcode';

describe('clés dérivées du code du monde', () => {
  it('même code (même saisie tolérante) : mêmes clés ; autre code : rien ne passe', async () => {
    const code = generateWorldCode();
    const a = (await deriveWorldKeys(code))!;
    const b = (await deriveWorldKeys(code.toLowerCase().replace(/-/g, ' ')))!;
    expect(a.topic).toBe(b.topic);
    expect(a.topic).toMatch(/^[0-9a-f]{32}$/);
    expect(a.topic).not.toContain(code.replace(/-/g, '').toLowerCase());
    const sealed = await sealMessage(a.seal, { k: 'join', from: 'x' });
    expect(await openMessage(b.seal, sealed)).toEqual({ k: 'join', from: 'x' });
    const other = (await deriveWorldKeys(generateWorldCode()))!;
    expect(other.topic).not.toBe(a.topic);
    expect(await openMessage(other.seal, sealed)).toBeNull();
    // Message altéré : refusé.
    expect(await openMessage(a.seal, sealed.slice(0, -4) + 'AAAA')).toBeNull();
    expect(await deriveWorldKeys('trop court')).toBeNull();
  });

  it('preuve du code : liée aux deux défis et au rôle', async () => {
    const keys = (await deriveWorldKeys(generateWorldCode()))!;
    const hc = newChallenge();
    const pc = newChallenge();
    const p = await codeProof(keys, 'joueur', hc, pc);
    expect(await checkCodeProof(keys, 'joueur', hc, pc, p)).toBe(true);
    expect(await checkCodeProof(keys, 'hote', hc, pc, p)).toBe(false);
    expect(await checkCodeProof(keys, 'joueur', newChallenge(), pc, p)).toBe(false);
    const other = (await deriveWorldKeys(generateWorldCode()))!;
    expect(await checkCodeProof(other, 'joueur', hc, pc, p)).toBe(false);
  });
});

describe('identité des joueurs', () => {
  it('preuve d’identité vérifiable avec l’empreinte seulement ; clé de récupération', async () => {
    const idn = newIdentity();
    const ver = await identityVerifier(idn.secret);
    expect(ver).toMatch(/^[0-9a-f]{64}$/);
    const hc = newChallenge();
    expect(await checkIdentityProof(ver, hc, await identityProof(idn.secret, hc))).toBe(true);
    expect(await checkIdentityProof(ver, hc, await identityProof(newIdentity().secret, hc))).toBe(false);
    const key = recoveryKey(idn);
    expect(key).toMatch(/^BAZ1-[0-9A-F]{96}$/);
    expect(readRecoveryKey(` ${key.slice(0, 30)} ${key.slice(30).toLowerCase()} `)).toEqual(idn);
    expect(readRecoveryKey('BAZ1-1234')).toBeNull();
  });
});

describe('MQTT minimal', () => {
  it('paquets bien formés, découpage d’un flux, lecture d’un PUBLISH', () => {
    const c = mqttConnect('baz-test');
    expect(c[0]).toBe(0x10);
    const s = mqttSubscribe(1, 'a/b');
    expect(s[0]).toBe(0x82);
    const long = 'x'.repeat(300);
    const p = mqttPublish('bienvenue/t', long);
    // Deux paquets collés + un morceau du suivant.
    const stream = new Uint8Array([...p, ...mqttPublish('bienvenue/t', 'court'), ...p.slice(0, 10)]);
    const { packets, rest } = mqttSplit(stream);
    expect(packets.length).toBe(2);
    expect(rest.length).toBe(10);
    expect(mqttReadPublish(packets[0]!.type, packets[0]!.body)).toEqual({ topic: 'bienvenue/t', payload: long });
    expect(mqttReadPublish(packets[1]!.type, packets[1]!.body)?.payload).toBe('court');
  });
});
