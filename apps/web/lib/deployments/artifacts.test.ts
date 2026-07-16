import { describe, expect, it } from 'vitest';
import { decodeDeployData, getAddress } from 'viem';
import { buildDeployData, abiFor, bytecodeFor } from './artifacts';
import type { DeployRequest } from './schema';

const OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

describe('buildDeployData — constructor arg encoding (round-trip against the ABI)', () => {
  it('encodes ERC-20 ctor args and decodes back to the same values', () => {
    const request: DeployRequest = {
      standard: 'ERC20',
      ownerAddress: getAddress(OWNER),
      name: 'Nexus Gold',
      symbol: 'NXG',
      initialSupply: '1000000000000000000000', // 1000e18 wei
      features: { mintable: true, burnable: true, pausable: false, permit: true },
    };
    const { contractName, data } = buildDeployData(request, OWNER);
    expect(contractName).toBe('NexusERC20');

    const decoded = decodeDeployData({
      abi: abiFor('NexusERC20'),
      bytecode: bytecodeFor('NexusERC20'),
      data,
    });
    const args = decoded.args ?? [];
    expect(args[0]).toBe('Nexus Gold');
    expect(args[1]).toBe('NXG');
    expect(args[2]).toBe(1000000000000000000000n);
    expect(getAddress(args[3] as string)).toBe(getAddress(OWNER));
    expect(args[4]).toMatchObject({
      mintable: true,
      burnable: true,
      pausable: false,
      permit: true,
    });
  });

  it('encodes ERC-721 ctor args (name/symbol/baseURI/owner/flags) round-trip', () => {
    const request: DeployRequest = {
      standard: 'ERC721',
      ownerAddress: getAddress(OWNER),
      name: 'Nexus Punks',
      symbol: 'NPUNK',
      baseUri: 'ipfs://base/',
      features: { mintable: true, burnable: false, pausable: true },
    };
    const { contractName, data } = buildDeployData(request, OWNER);
    expect(contractName).toBe('NexusERC721');

    const decoded = decodeDeployData({
      abi: abiFor('NexusERC721'),
      bytecode: bytecodeFor('NexusERC721'),
      data,
    });
    const args = decoded.args ?? [];
    expect(args[0]).toBe('Nexus Punks');
    expect(args[1]).toBe('NPUNK');
    expect(args[2]).toBe('ipfs://base/');
    expect(getAddress(args[3] as string)).toBe(getAddress(OWNER));
    expect(args[4]).toMatchObject({ mintable: true, burnable: false, pausable: true });
  });

  it('encodes ERC-1155 ctor args (baseURI/owner/flags) round-trip', () => {
    const request: DeployRequest = {
      standard: 'ERC1155',
      ownerAddress: getAddress(OWNER),
      baseUri: 'ipfs://multi/{id}.json',
      features: { mintable: true, burnable: true, pausable: false, supply: true },
    };
    const { contractName, data } = buildDeployData(request, OWNER);
    expect(contractName).toBe('NexusERC1155');

    const decoded = decodeDeployData({
      abi: abiFor('NexusERC1155'),
      bytecode: bytecodeFor('NexusERC1155'),
      data,
    });
    const args = decoded.args ?? [];
    expect(args[0]).toBe('ipfs://multi/{id}.json');
    expect(getAddress(args[1] as string)).toBe(getAddress(OWNER));
    expect(args[2]).toMatchObject({
      mintable: true,
      burnable: true,
      pausable: false,
      supply: true,
    });
  });

  it('honors feature flags: a flags-off encoding differs from flags-on', () => {
    const base = {
      standard: 'ERC20' as const,
      ownerAddress: getAddress(OWNER),
      name: 'Flag Token',
      symbol: 'FLAG',
      initialSupply: '0',
    };
    const off = buildDeployData(
      { ...base, features: { mintable: false, burnable: false, pausable: false, permit: false } },
      OWNER,
    ).data;
    const on = buildDeployData(
      { ...base, features: { mintable: true, burnable: false, pausable: false, permit: false } },
      OWNER,
    ).data;
    expect(off).not.toBe(on);
  });
});
