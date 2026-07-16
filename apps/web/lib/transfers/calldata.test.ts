import { describe, expect, it } from 'vitest';
import { decodeFunctionData, getAddress } from 'viem';
import { NexusERC20Abi, NexusERC721Abi, NexusERC1155Abi } from '@nexus/types';
import { buildTransferCall } from './calldata';
import type { TransferRequest } from './schema';

const FROM = getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
const TO = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
const TOKEN = getAddress('0x5fbdb2315678afecb367f032d93f642f64180aa3');

describe('buildTransferCall — per-kind unsigned tx target/value/calldata', () => {
  it('NATIVE → value transfer with empty calldata to the recipient', () => {
    const req: TransferRequest = {
      kind: 'NATIVE',
      from: FROM,
      to: TO,
      amount: '1000000000000000000',
      sponsored: false,
    };
    const call = buildTransferCall(req);
    expect(call.to).toBe(TO);
    expect(call.value).toBe(1_000_000_000_000_000_000n);
    expect(call.data).toBe('0x');
  });

  it('ERC20 → transfer(to, amount) to the token, value 0', () => {
    const req: TransferRequest = {
      kind: 'ERC20',
      from: FROM,
      to: TO,
      tokenAddress: TOKEN,
      amount: '500',
      sponsored: false,
    };
    const call = buildTransferCall(req);
    expect(call.to).toBe(TOKEN);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: NexusERC20Abi, data: call.data });
    expect(decoded.functionName).toBe('transfer');
    expect(decoded.args).toEqual([TO, 500n]);
  });

  it('ERC721 → safeTransferFrom(from, to, tokenId) to the token, value 0', () => {
    const req: TransferRequest = {
      kind: 'ERC721',
      from: FROM,
      to: TO,
      tokenAddress: TOKEN,
      tokenId: '7',
      sponsored: false,
    };
    const call = buildTransferCall(req);
    expect(call.to).toBe(TOKEN);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: NexusERC721Abi, data: call.data });
    expect(decoded.functionName).toBe('safeTransferFrom');
    expect(decoded.args).toEqual([FROM, TO, 7n]);
  });

  it('ERC1155 → safeTransferFrom(from, to, id, amount, "0x") to the token, value 0', () => {
    const req: TransferRequest = {
      kind: 'ERC1155',
      from: FROM,
      to: TO,
      tokenAddress: TOKEN,
      tokenId: '3',
      amount: '10',
      sponsored: false,
    };
    const call = buildTransferCall(req);
    expect(call.to).toBe(TOKEN);
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: NexusERC1155Abi, data: call.data });
    expect(decoded.functionName).toBe('safeTransferFrom');
    expect(decoded.args).toEqual([FROM, TO, 3n, 10n, '0x']);
  });
});
