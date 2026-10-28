// Generated from docs/design/tokens.json. Run pnpm tokens:generate.
export const tokens = {
  "name": "TypeDuel Minimal Competitive",
  "version": "1.0.0",
  "colors": {
    "background": "#0B1220",
    "surface": "#172235",
    "surfaceRaised": "#1D2B3F",
    "textPrimary": "#F8FAFC",
    "textSecondary": "#BBC8D8",
    "accent": "#2DD4BF",
    "accentText": "#042F2E",
    "border": "#334155",
    "error": "#FCA5A5"
  },
  "spacing": [
    0,
    4,
    8,
    12,
    16,
    24,
    32,
    48
  ],
  "radii": {
    "input": 12,
    "button": 14,
    "card": 16,
    "pill": 999
  },
  "touchTargetMinimum": {
    "iosPoints": 44,
    "androidDp": 48
  },
  "typography": {
    "fontFamily": "system",
    "body": 17,
    "label": 14,
    "heading": 28,
    "display": 36,
    "timer": 56
  },
  "notes": [
    "Prototype values: adjust for font scaling/physical-device usability testing",
    "Use native keyboard; never recreate it in production",
    "Gameplay scores and outcomes always come from server"
  ]
} as const;
