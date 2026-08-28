/**
 * β → float stream: expand one VRF output β into a deterministic, publicly
 * recomputable stream of floats in [0, 1) using a public counter. Anyone can
 * recompute any single value from β alone, so the whole stream is verifiable.
 *
 *   wordᵢ = SHA-512(β ‖ i as 32-byte BE), rᵢ = low 53 bits ÷ 2⁵³
 */

import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, concat, hexToBigInt, hexToBytes, type Hex } from "viem";
import type { Rng } from "./algo-types";

const TWO_POW_53 = 1n << 53n;

/** wordᵢ = SHA-512(β ‖ i as 32-byte big-endian), the raw expansion word. */
export const randomWordHex = (beta: string, index: number): Hex =>
  bytesToHex(
    sha512(
      concat([
        hexToBytes(beta as Hex),
        hexToBytes(`0x${index.toString(16).padStart(64, "0")}`),
      ]),
    ),
  );

/** rᵢ = (wordᵢ mod 2⁵³) ÷ 2⁵³ — low 53 bits, a JS double's mantissa. */
export const randomValue = (word: Hex): number =>
  Number(hexToBigInt(word) % TWO_POW_53) / Number(TWO_POW_53);

/** Successive values over β: randomValue(randomWordHex(β, 0)), (β, 1), … */
export const rngFromRandomness = (beta: string): Rng => {
  let i = 0;
  return () => randomValue(randomWordHex(beta, i++));
};
