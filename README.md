# renaiss-fair

Fair-play verification for Renaiss gacha pack rips. Every draw is resolved by
an [RFC 9381](https://www.rfc-editor.org/rfc/rfc9381.html) verifiable random
function (ECVRF-EDWARDS25519-SHA512-ELL2) over a seed the operator cannot
choose — and this repo is the tooling that lets anyone check that claim.

**Live app:** https://fair.renaiss.xyz

## Structure

| Path        | What                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| `apps/web`  | The verifier web app — replay any rip's draw math in your browser, plus the whitepaper.  |
| [`packages/ecvrf`](packages/ecvrf) | The RFC 9381 ECVRF implementation — spec-only, bytes-only, validated byte-for-byte against the official Appendix B.4 test vectors. |
| [`packages/verifiable-draw`](packages/verifiable-draw) | The draw pipeline over `ecvrf`: hex API, β→stream expansion, prove/verify-and-expand, and the draw-resolution seed and index derivations. |
| [`packages/algorithms`](packages/algorithms) | The fair-set selection algorithms — the "ranked" (adaptive score-and-rank) and "tilt" (globally monotone max-entropy value tilt) designs, one contract and acceptance check. Deterministic, VRF-seeded set creation with an EV band and per-tier quotas. |
| [`packages/replay-fair-set`](packages/replay-fair-set) | The algorithm-agnostic layer on top: the seed derivation that commits a build to public inputs, and the retry/record loop that replays a formation attempt by attempt. |

## Stack

- [Next.js](https://nextjs.org) (preview channel) + React 19
- TypeScript 7, strict everything
- Tailwind CSS v4 (CSS-first theme)
- [Turborepo](https://turborepo.com) + pnpm workspaces
- GSAP for the replay/choreography, `@noble/curves` for the cryptography

## Develop

```bash
pnpm install
pnpm dev          # apps/web dev server on port 3000
pnpm typecheck
pnpm test         # RFC 9381 Appendix B.4 vectors, draw pipeline, set-selection replay
pnpm build
```

The app reads the public Renaiss fair-play API when `NEXT_PUBLIC_RENAISS_API_URL`
is set (that is how https://fair.renaiss.xyz is built — see
`.github/workflows/deploy.yml`). Unset, it serves committed demo fixtures
generated with a real ECVRF keypair (`pnpm generate-fixtures` rerolls them),
so the in-browser verification is real either way. See `apps/web/README.md`
for the data-source details and the API's publication rules.

## Status

The protocol whitepaper served at `/whitepaper` is a working draft; wording
and figures may change as the protocol hardens.

## License

[MIT](./LICENSE). Third-party runtime dependencies keep their own licenses —
see [NOTICE](./NOTICE) (notably GSAP, which ships under GreenSock's Standard
License rather than MIT).
