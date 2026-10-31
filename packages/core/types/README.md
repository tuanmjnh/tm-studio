# @tmcut/types

Shared Timeline DSL v3 types for TMCut (docs §14).

- Type-only package: zero runtime code, zero dependencies.
- `MediaTime` is an integer tick count (`TICKS_PER_SECOND = 120_000`, docs §2).
  Ticks are stored as `number` (not `bigint`) so projects stay JSON-serializable;
  values remain exact well beyond any editable duration.
- `FrameRate` is rational (`{ numerator, denominator }`, docs §3).
- Clips reference `assetId`; `locator` is the transitional bridge for
  path-based projects (docs §15).
