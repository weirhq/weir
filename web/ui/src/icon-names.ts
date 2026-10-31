// The Material Symbols the package bundles (scripts/fonts.ts cuts the font
// down to these). Add a name here and re-pin to use another icon.
export const iconNames = [
  'add',
  'arrow_back',
  'check',
  'close',
  'delete',
  'edit',
  'favorite',
  'more_vert',
  'pause',
  'play_arrow',
  'queue_music',
  'search',
  'settings',
  'skip_next',
  'skip_previous'
] as const

export type IconName = (typeof iconNames)[number]
